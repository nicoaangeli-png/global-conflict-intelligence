import { aggregateClusters, dedupe } from "@/lib/clustering/cluster";
import { TIME_RANGES, type ConnectorStatus, type DailyBucket, type EventFilters, type TimeRangeKey } from "@/types/conflict";
import { acledConnector } from "./connectors/acled";
import { csvConnector } from "./connectors/csvImport";
import { gdeltConnector } from "./connectors/gdelt";
import { type Connector } from "./connectors/types";
import { ucdpConnector } from "./connectors/ucdp";
import { firmsConnector } from "./connectors/firms";
import { loadDemoSeed } from "./dataset";
import { LocalRepository, PgRepository, type Repository } from "./repository";
import { ConnectorError } from "./connectors/types";

/**
 * Service d'ingestion et d'interrogation.
 *
 * Pipeline : connecteurs → normalisation (faite par chaque connecteur) →
 * déduplication → persistance → agrégation géographique → API.
 * Le frontend ne reçoit que des foyers agrégés, jamais les formats bruts.
 */

const CONNECTORS: Connector[] = [csvConnector, acledConnector, ucdpConnector, firmsConnector, gdeltConnector];

interface IntelState {
  repository: Repository;
  ready: Promise<void> | null;
  lastIngestAt: string | null;
  lastDemoAt: string | null;
  /** Dernière ingestion ayant ramené des données de source réelle. */
  lastRealIngestAt: number | null;
  statuses: ConnectorStatus[];
  ingestReport: string;
}

/**
 * État serveur partagé.
 *
 * En développement, chaque route peut être compilée dans son propre bundle :
 * l'état doit donc être rattaché à `globalThis` pour qu'une ingestion lancée
 * depuis une route soit visible par les autres (dépôt, statuts, dernière MAJ).
 */
const globalRef = globalThis as unknown as { __orbitalIntelState?: IntelState };

const state: IntelState =
  globalRef.__orbitalIntelState ??
  (globalRef.__orbitalIntelState = {
    repository: pickRepository(),
    ready: null,
    lastIngestAt: null,
    lastDemoAt: null,
    lastRealIngestAt: null,
    statuses: [],
    ingestReport: "aucune ingestion lancée",
  });

function pickRepository(): Repository {
  const url = process.env.DATABASE_URL;
  return url ? new PgRepository(url) : new LocalRepository();
}

/** Abonnés SSE : notifiés à chaque ingestion (partagé entre bundles). */
const globalBus = globalThis as unknown as { __orbitalSubscribers?: Set<(payload: string) => void> };
const subscribers = (globalBus.__orbitalSubscribers ??= new Set<(payload: string) => void>());

export function subscribe(fn: (payload: string) => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function broadcast(type: string, data: Record<string, unknown>) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const fn of subscribers) {
    try {
      fn(payload);
    } catch {
      subscribers.delete(fn);
    }
  }
}

/** Initialise le dépôt et charge le jeu de démonstration si la base est vide. */
export async function ensureReady(): Promise<void> {
  if (state.ready) return state.ready;
  state.ready = (async () => {
    try {
      await state.repository.init();
    } catch {
      if (state.repository.kind !== "postgres") throw new Error("Local persistence unavailable");
      console.warn("[intel] PostgreSQL indisponible, bascule sur le dépôt local durable");
      state.repository = new LocalRepository();
      await state.repository.init();
    }

    const counts = await state.repository.counts();
    if (counts.total === 0) {
      const { events, generatedAt } = await loadDemoSeed();
      await state.repository.upsert(events);
      state.lastDemoAt = generatedAt;
      state.ingestReport = `jeu de démonstration chargé (${events.length} événements)`;
      state.lastIngestAt = new Date().toISOString();
    }
    await refreshStatuses();
    startAutoRefresh();
  })().catch((error) => {
    state.ready = null;
    throw error;
  });
  return state.ready;
}

/**
 * Rafraîchissement automatique.
 *
 * GDELT publie toutes les quinze minutes : le serveur relance donc une
 * ingestion en tâche de fond au démarrage puis à intervalle régulier. Les
 * clients connectés sont prévenus par SSE (`ingest`) et ne rechargent que
 * l'agrégat filtré. Aucun connecteur inutilisable n'est sollicité.
 */
const AUTO_REFRESH_MS = 15 * 60 * 1000;
const AUTO_REFRESH_FIRST_MS = 2_000;

function startAutoRefresh() {
  const g = globalThis as unknown as { __orbitalAutoRefresh?: ReturnType<typeof setInterval> };
  if (g.__orbitalAutoRefresh) return; // déjà planifié (rechargement à chaud)

  const tick = async () => {
    const configured = CONNECTORS.filter((c) => c.id !== "csv" && c.isConfigured());
    if (!configured.length) return;
    if (Date.now() - (state.lastRealIngestAt ?? 0) < AUTO_REFRESH_MS - 5_000) return;
    try {
      await runIngest();
      console.log("[intel] ingestion automatique :", state.ingestReport);
    } catch {
      console.warn("[intel] ingestion automatique impossible");
    }
  };

  setTimeout(() => void tick(), AUTO_REFRESH_FIRST_MS);
  g.__orbitalAutoRefresh = setInterval(() => void tick(), AUTO_REFRESH_MS);
  g.__orbitalAutoRefresh.unref?.();
}

async function refreshStatuses() {
  const counts = await state.repository.counts();
  const previous = state.statuses;
  state.statuses = [
    {
      id: "acled",
      label: "ACLED",
      configured: acledConnector.isConfigured(),
      reachable: null,
      note: acledConnector.describe(),
      events: counts.byDataset["acled"] ?? 0,
    },
    {
      id: "gdelt",
      label: "GDELT 2.0",
      configured: gdeltConnector.isConfigured(),
      reachable: null,
      note: gdeltConnector.describe(),
      events: counts.byDataset["gdelt"] ?? 0,
    },
    {
      id: "ucdp",
      label: "UCDP GED",
      configured: ucdpConnector.isConfigured(),
      reachable: null,
      note: ucdpConnector.describe(),
      events: counts.byDataset["ucdp"] ?? 0,
    },
    {
      id: "firms",
      label: "NASA FIRMS",
      configured: firmsConnector.isConfigured(),
      reachable: null,
      note: firmsConnector.describe(),
      events: counts.byDataset["firms"] ?? 0,
    },
    {
      id: "import",
      label: "Import CSV",
      configured: true,
      reachable: null,
      note: csvConnector.describe(),
      events: counts.byDataset["import:csv"] ?? 0,
    },
    {
      id: "demo",
      label: "Jeu de démonstration",
      configured: true,
      reachable: true,
      note: "Données de démonstration non sourcées — jamais présentées comme un renseignement réel.",
      events: counts.byDataset["demo:seed"] ?? 0,
    },
  ];
  for (const status of state.statuses) {
    const prior = previous.find((entry) => entry.id === status.id);
    if (status.configured && prior?.reachable != null) {
      status.reachable = prior.reachable;
      if (!prior.reachable) status.note = prior.note;
    }
  }
}

/** Lance une ingestion complète. */
export async function runIngest(options: { days?: number; includeDemo?: boolean } = {}) {
  const globalIngest = globalThis as unknown as { __orbitalIngest?: Promise<unknown> };
  if (globalIngest.__orbitalIngest) throw new Error("Ingestion already running");
  const pending = ingest(options);
  globalIngest.__orbitalIngest = pending;
  try {
    return await pending;
  } finally {
    delete globalIngest.__orbitalIngest;
  }
}

async function ingest(options: { days?: number; includeDemo?: boolean }) {
  await ensureReady();
  const days = Math.min(365, Math.max(1, Math.trunc(options.days ?? 30)));
  if (!Number.isFinite(days)) throw new Error("Invalid ingestion window");
  const started = Date.now();
  const collected = [];
  const notes: string[] = [];

  for (const connector of CONNECTORS) {
    if (!connector.isConfigured()) {
      notes.push(`${connector.label} : non configuré`);
      continue;
    }
    try {
      const events = await connector.fetchEvents({ days });
      collected.push(...events);
      notes.push(`${connector.label} : ${events.length} événements`);
      const st = state.statuses.find((s) => s.id === (connector.id === "csv" ? "import" : connector.id));
      if (st) {
        st.reachable = true;
        st.note = connector.describe();
      }
    } catch (err) {
      const detail = err instanceof ConnectorError ? (connector.id === "csv" ? err.kind : err.message) : "réponse invalide";
      const message = `${connector.label}: ${detail}`;
      notes.push(`${connector.label} : ${message}`);
      const st = state.statuses.find((s) => s.id === (connector.id === "csv" ? "import" : connector.id));
      if (st) {
        st.reachable = false;
        st.note = message;
      }
    }
  }

  const { kept, removed } = dedupe(collected);
  let upserted = { inserted: 0, updated: 0 };
  if (kept.length) upserted = await state.repository.upsert(kept);

  // Toujours garder l'application démontrable : si aucune source réelle n'a
  // répondu, on conserve le jeu de démonstration (clairement étiqueté).
  if (!kept.length && options.includeDemo !== false) {
    const counts = await state.repository.counts();
    if (!counts.total) {
      const { events } = await loadDemoSeed();
      await state.repository.upsert(events);
      state.lastDemoAt = new Date().toISOString();
      notes.push(`démo : ${events.length} événements (aucune source réelle disponible)`);
    }
  }

  delete zoneRef.__orbitalConflictZones;
  state.lastIngestAt = new Date().toISOString();
  if (collected.some((e) => !e.sourceDataset.startsWith("demo"))) state.lastRealIngestAt = Date.now();
  state.ingestReport = notes.join(" · ") || "aucun événement";
  await refreshStatuses();
  broadcast("ingest", {
    at: state.lastIngestAt,
    inserted: upserted.inserted,
    updated: upserted.updated,
    deduped: removed,
    ms: Date.now() - started,
    report: state.ingestReport,
  });
  return {
    at: state.lastIngestAt,
    received: collected.length,
    deduped: removed,
    ...upserted,
    ms: Date.now() - started,
    report: state.ingestReport,
  };
}

/**
 * Zones de conflit connues, pour filtrer les anomalies thermiques FIRMS.
 *
 * Une détection satellite n'est montrée que si elle tombe à proximité
 * (cellule de 0,25° et ses voisines, ~25 à 55 km) d'un événement réel :
 * UCDP / ACLED / import sur un an, ou signal presse GDELT sur 30 jours.
 * Sans ce filtre, la carte serait couverte de feux agricoles et de torchères.
 */
const ZONE_CELL_DEG = 0.25;
const ZONE_TTL_MS = 15 * 60 * 1000;
const zoneRef = globalThis as unknown as { __orbitalConflictZones?: { at: number; cells: Set<string> } };
const zoneCell = (lat: number, lon: number) => `${Math.floor(lat / ZONE_CELL_DEG)}:${Math.floor(lon / ZONE_CELL_DEG)}`;

async function conflictZones(): Promise<Set<string>> {
  const cached = zoneRef.__orbitalConflictZones;
  if (cached && Date.now() - cached.at < ZONE_TTL_MS) return cached.cells;
  const now = Date.now();
  const events = await state.repository.query({ from: new Date(now - 365 * 86400e3), to: new Date(now) });
  const mediaFrom = now - 30 * 86400e3;
  const cells = new Set<string>();
  for (const event of events) {
    if (event.eventType === "Thermal anomaly" || event.sourceDataset.startsWith("demo") || event.confidence === "DEMO") continue;
    if (event.sourceDataset === "gdelt" && Date.parse(event.eventDate) < mediaFrom) continue;
    cells.add(zoneCell(event.latitude, event.longitude));
  }
  zoneRef.__orbitalConflictZones = { at: now, cells };
  return cells;
}

function nearConflict(cells: Set<string>, lat: number, lon: number): boolean {
  const row = Math.floor(lat / ZONE_CELL_DEG);
  const col = Math.floor(lon / ZONE_CELL_DEG);
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (cells.has(`${row + dr}:${col + dc}`)) return true;
  return false;
}

/** Lecture commune à la carte, aux indicateurs et aux listes : mêmes filtres partout. */
async function selectEvents(filters: EventFilters, from: Date, to: Date) {
  const events = await state.repository.query({
    from,
    to,
    types: filters.types.length ? filters.types : undefined,
    datasets: filters.datasets.length ? filters.datasets : undefined,
    confidences: filters.confidences.length ? filters.confidences : undefined,
    countries: filters.countries.length ? filters.countries : undefined,
    minFatalities: filters.minFatalities || undefined,
  });
  if (!events.some((event) => event.eventType === "Thermal anomaly")) return events;
  const cells = await conflictZones();
  return events.filter((event) => event.eventType !== "Thermal anomaly" || nearConflict(cells, event.latitude, event.longitude));
}

function bounds(range: TimeRangeKey, now = Date.now(), at?: string | null) {
  const days = TIME_RANGES.find((r) => r.key === range)?.days ?? 30;
  const to = at ? new Date(at) : new Date(now);
  return { from: new Date(to.getTime() - days * 86400e3), to };
}

/** Interroge les événements agrégés en foyers. */
export async function queryClusters(filters: EventFilters, degrees: number) {
  await ensureReady();
  const { from, to } = bounds(filters.range, Date.now(), filters.at);
  const events = await selectEvents(filters, from, to);

  const clusters = aggregateClusters(events, { degrees, now: Date.now() });
  const totalFatalities = events.reduce((a, e) => a + e.fatalities, 0);
  const daily = dailyBuckets(events, filters.range, to);

  return {
    generatedAt: new Date().toISOString(),
    dataset: distinctDatasets(events),
    range: filters.range,
    from: from.toISOString(),
    to: to.toISOString(),
    totalEvents: events.length,
    coverage: coverage(events),
    totalFatalities,
    clusters,
    daily,
  };
}

function distinctDatasets(events: { sourceDataset: string }[]): string {
  const set = new Set(events.map((e) => e.sourceDataset));
  // Liste explicite (jamais un simple compteur) : l'interface doit pouvoir
  // dire d'où vient chaque donnée et signaler la présence de démonstration.
  return [...set].sort().join(" + ");
}

function coverage(events: { sourceDataset: string; confidence: string; eventType: string }[]) {
  const demo = events.filter((event) => event.sourceDataset.startsWith("demo") || event.confidence === "DEMO").length;
  const media = events.filter((event) => !event.sourceDataset.startsWith("demo") && event.confidence !== "DEMO" && event.eventType !== "Thermal anomaly" && (event.confidence === "MEDIA_SIGNAL" || event.sourceDataset === "gdelt")).length;
  const thermal = events.filter((event) => event.eventType === "Thermal anomaly").length;
  return { documented: events.length - demo - media - thermal, media, demo, thermal };
}

/** Séries journalières (ou hebdomadaires au-delà de 6 mois). */
export function dailyBuckets(
  events: { eventDate: string; fatalities: number }[],
  range: TimeRangeKey,
  toDate?: Date,
): DailyBucket[] {
  const days = TIME_RANGES.find((r) => r.key === range)?.days ?? 30;
  const bucketDays = days >= 182 ? 7 : 1;
  const buckets = new Map<string, DailyBucket>();
  const now = (toDate ?? new Date()).getTime();
  const duration = range === "24h" ? 3600e3 : bucketDays * 86400e3;
  const from = now - days * 86400e3;
  const start = Math.floor(from / duration) * duration;

  for (let timestamp = start; timestamp <= now; timestamp += duration) {
    const date = new Date(timestamp).toISOString();
    const key = range === "24h" ? date : date.slice(0, 10);
    buckets.set(key, { day: key, events: 0, fatalities: 0 });
  }

  for (const e of events) {
    const timestamp = Date.parse(e.eventDate);
    if (!Number.isFinite(timestamp) || timestamp < from || timestamp > now) continue;
    const date = new Date(Math.floor(timestamp / duration) * duration).toISOString();
    const key = range === "24h" ? date : date.slice(0, 10);
    const b = buckets.get(key);
    if (b) {
      b.events++;
      b.fatalities += e.fatalities;
    }
  }

  return [...buckets.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** Statistiques globales (panneau gauche). */
export async function queryStats(filters: EventFilters, degrees = 2.4) {
  await ensureReady();
  const now = Date.now();
  const { from, to } = bounds(filters.range, now, filters.at);
  // Les indicateurs décrivent EXACTEMENT la même sélection que la carte :
  // mêmes bornes, mêmes filtres de type, de source et de confiance.
  const events = await selectEvents(filters, from, to);
  const counts = await state.repository.counts();

  const ref = to.getTime();
  const since = (h: number) => ref - h * 3600e3;
  const events24h = events.filter((e) => Date.parse(e.eventDate) >= since(24)).length;
  const events7d = events.filter((e) => Date.parse(e.eventDate) >= since(24 * 7)).length;
  const events30d = events.filter((e) => Date.parse(e.eventDate) >= since(24 * 30)).length;

  // Même granularité que la carte : les indicateurs et les foyers affichés
  // décrivent exactement la même agrégation.
  const clusters = aggregateClusters(events, { degrees, now });
  const major = clusters.filter((c) => c.intensity >= 0.5).length;

  return {
    generatedAt: new Date().toISOString(),
    range: filters.range,
    activeZones: clusters.length,
    majorZones: major,
    events24h,
    events7d,
    events30d,
    fatalitiesRange: events.reduce((a, e) => a + e.fatalities, 0),
    lastDataUpdate: counts.lastUpdated ?? new Date().toISOString(),
    lastIngestAt: state.lastIngestAt ?? new Date().toISOString(),
    dataset: distinctDatasets(events),
    totalInStore: counts.total,
    coverage: coverage(events),
    connectors: state.statuses,
    daily: dailyBuckets(events, filters.range, to),
    ingestReport: state.ingestReport,
  };
}

/** Détail d'un foyer : les événements contenus dans une cellule géographique. */
export async function queryClusterEvents(
  filters: EventFilters,
  degrees: number,
  lat: number,
  lon: number,
  limit = 120,
  clusterId?: string,
) {
  await ensureReady();
  const { from, to } = bounds(filters.range, Date.now(), filters.at);
  const events = await selectEvents(filters, from, to);

  const clusters = aggregateClusters(events, { degrees, now: Date.now() });
  // foyer le plus proche du point demandé
  let best: (typeof clusters)[number] | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const c of clusters) {
    if (clusterId && c.id !== clusterId) continue;
    const d = (c.latitude - lat) ** 2 + (c.longitude - lon) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  if (!best) return { cluster: null, events: [] };

  const byId = new Map(events.map((e) => [e.id, e]));
  const detail = best.eventIds
    .map((id) => byId.get(id))
    .filter((e): e is NonNullable<typeof e> => Boolean(e))
    .sort((a, b) => Date.parse(b.eventDate) - Date.parse(a.eventDate))
    .slice(0, limit);

  return { cluster: best, events: detail };
}

/** Derniers événements bruts (vue « LIVE EVENTS »). */
export async function queryLatestEvents(filters: EventFilters, limit = 60) {
  await ensureReady();
  const { from, to } = bounds(filters.range, Date.now(), filters.at);
  const events = await selectEvents(filters, from, to);

  return events
    .sort((a, b) => Date.parse(b.eventDate) - Date.parse(a.eventDate))
    .slice(0, Math.min(400, limit));
}

export function healthInfo() {
  return {
    repository: state.repository.kind,
    connectors: state.statuses,
    lastIngestAt: state.lastIngestAt,
    report: state.ingestReport,
  };
}
