import { aggregateClusters, dedupe } from "@/lib/clustering/cluster";
import { TIME_RANGES, type ConnectorStatus, type DailyBucket, type EventFilters, type TimeRangeKey } from "@/types/conflict";
import { acledConnector } from "./connectors/acled";
import { csvConnector } from "./connectors/csvImport";
import { gdeltConnector } from "./connectors/gdelt";
import { type Connector } from "./connectors/types";
import { ucdpConnector } from "./connectors/ucdp";
import { loadDemoSeed } from "./dataset";
import { MemoryRepository, PgRepository, type Repository } from "./repository";

/**
 * Service d'ingestion et d'interrogation.
 *
 * Pipeline : connecteurs → normalisation (faite par chaque connecteur) →
 * déduplication → persistance → agrégation géographique → API.
 * Le frontend ne reçoit que des foyers agrégés, jamais les formats bruts.
 */

const CONNECTORS: Connector[] = [csvConnector, acledConnector, ucdpConnector, gdeltConnector];

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
  return url ? new PgRepository(url) : new MemoryRepository();
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
    } catch (err) {
      console.warn("[intel] PostgreSQL indisponible, bascule en mémoire :", err);
      state.repository = new MemoryRepository();
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
  })();
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
    } catch (err) {
      console.warn("[intel] ingestion automatique impossible :", err);
    }
  };

  setTimeout(() => void tick(), AUTO_REFRESH_FIRST_MS);
  g.__orbitalAutoRefresh = setInterval(() => void tick(), AUTO_REFRESH_MS);
  g.__orbitalAutoRefresh.unref?.();
}

async function refreshStatuses() {
  const counts = await state.repository.counts();
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
      id: "import",
      label: "Import CSV",
      configured: true,
      reachable: null,
      note: csvConnector.describe(),
      events: Math.max(0, counts.total - Object.entries(counts.byDataset).filter(([k]) => k !== "import").reduce((a, [, v]) => a + v, 0)),
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
}

/** Lance une ingestion complète. */
export async function runIngest(options: { days?: number; includeDemo?: boolean } = {}) {
  await ensureReady();
  const days = options.days ?? 30;
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
      const st = state.statuses.find((s) => s.id === connector.id);
      if (st) st.reachable = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "erreur inconnue";
      notes.push(`${connector.label} : ${message}`);
      const st = state.statuses.find((s) => s.id === connector.id);
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

  state.lastIngestAt = new Date().toISOString();
  if (collected.some((e) => e.sourceDataset !== "demo")) state.lastRealIngestAt = Date.now();
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

function bounds(range: TimeRangeKey, now = Date.now(), at?: string | null) {
  const days = TIME_RANGES.find((r) => r.key === range)?.days ?? 30;
  const to = at ? new Date(at) : new Date(now);
  return { from: new Date(to.getTime() - days * 86400e3), to };
}

/** Interroge les événements agrégés en foyers. */
export async function queryClusters(filters: EventFilters, degrees: number) {
  await ensureReady();
  const { from, to } = bounds(filters.range, Date.now(), filters.at);
  const events = await state.repository.query({
    from,
    to,
    types: filters.types.length ? filters.types : undefined,
    datasets: filters.datasets.length ? filters.datasets : undefined,
    confidences: filters.confidences.length ? filters.confidences : undefined,
    countries: filters.countries.length ? filters.countries : undefined,
    minFatalities: filters.minFatalities || undefined,
  });

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
    totalFatalities,
    clusters,
    daily,
  };
}

function distinctDatasets(events: { sourceDataset: string }[]): string {
  const set = new Set(events.map((e) => e.sourceDataset));
  // Liste explicite (jamais un simple compteur) : l'interface doit pouvoir
  // dire d'où vient chaque donnée et signaler la présence de démonstration.
  return [...set].sort().join(" + ") || "—";
}

/** Séries journalières (ou hebdomadaires au-delà de 6 mois). */
export function dailyBuckets(
  events: { eventDate: string; fatalities: number }[],
  range: TimeRangeKey,
  toDate?: Date,
): DailyBucket[] {
  const days = TIME_RANGES.find((r) => r.key === range)?.days ?? 30;
  const bucketDays = days > 200 ? 7 : 1;
  const buckets = new Map<string, DailyBucket>();
  const now = (toDate ?? new Date()).getTime();
  const count = Math.ceil(days / bucketDays);

  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now - i * bucketDays * 86400e3);
    d.setUTCHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, { day: key, events: 0, fatalities: 0 });
  }

  for (const e of events) {
    const d = new Date(e.eventDate);
    d.setUTCHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
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
  const events = await state.repository.query({
    from,
    to,
    types: filters.types.length ? filters.types : undefined,
    datasets: filters.datasets.length ? filters.datasets : undefined,
    confidences: filters.confidences.length ? filters.confidences : undefined,
    countries: filters.countries.length ? filters.countries : undefined,
    minFatalities: filters.minFatalities || undefined,
  });
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
) {
  await ensureReady();
  const { from, to } = bounds(filters.range, Date.now(), filters.at);
  const events = await state.repository.query({
    from,
    to,
    types: filters.types.length ? filters.types : undefined,
    datasets: filters.datasets.length ? filters.datasets : undefined,
    confidences: filters.confidences.length ? filters.confidences : undefined,
    countries: filters.countries.length ? filters.countries : undefined,
    minFatalities: filters.minFatalities || undefined,
  });

  const clusters = aggregateClusters(events, { degrees, now: Date.now() });
  // foyer le plus proche du point demandé
  let best: (typeof clusters)[number] | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const c of clusters) {
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
  const events = await state.repository.query({
    from,
    to,
    types: filters.types.length ? filters.types : undefined,
    datasets: filters.datasets.length ? filters.datasets : undefined,
    confidences: filters.confidences.length ? filters.confidences : undefined,
    countries: filters.countries.length ? filters.countries : undefined,
    minFatalities: filters.minFatalities || undefined,
  });

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
