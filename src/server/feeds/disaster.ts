import type { FeedSeverity, LiveItem } from "@/types/feeds";
import { canonicalIso3, countriesInText } from "./countries";
import { countryFromCoords, fetchJson, FeedError, num, str, summaryOrNull, toIso, plainText, type FeedContext, type FeedSourceDef } from "./util";

// ---------------------------------------------------------------------------
// GDACS : alertes officielles (ONU / Commission européenne)
// ---------------------------------------------------------------------------

interface GdacsProps {
  eventtype?: string;
  eventid?: number;
  episodeid?: number;
  name?: string;
  htmldescription?: string;
  url?: { report?: string };
  alertlevel?: string;
  fromdate?: string;
  datemodified?: string;
  country?: string;
  iso3?: string;
  affectedcountries?: Array<{ iso3?: string }>;
  severitydata?: { severity?: number; severitytext?: string; severityunit?: string };
  source?: string;
}
interface GdacsFeature {
  geometry?: { coordinates?: number[] };
  properties?: GdacsProps;
}

const GDACS_SEVERITY: Record<string, FeedSeverity> = { green: "minor", orange: "moderate", red: "severe" };
const GDACS_LEVEL_FR: Record<string, string> = { green: "verte", orange: "orange", red: "rouge" };
const GDACS_TYPES: Record<string, { label: string; metric: string }> = {
  EQ: { label: "Séisme", metric: "Magnitude" },
  TC: { label: "Cyclone tropical", metric: "Vent maximal" },
  FL: { label: "Inondation", metric: "Gravité" },
  VO: { label: "Volcan", metric: "Gravité" },
  DR: { label: "Sécheresse", metric: "Gravité" },
  WF: { label: "Feu de forêt", metric: "Surface" },
  TS: { label: "Tsunami", metric: "Gravité" },
};

/** Convertit la réponse de l'API GDACS (GeoJSON) : un élément par événement (dernier épisode). */
export function parseGdacs(raw: unknown, ctx: FeedContext): LiveItem[] {
  const features = (raw as { features?: GdacsFeature[] } | null)?.features;
  if (!Array.isArray(features)) throw new FeedError("GDACS : format de réponse inattendu.");
  const latest = new Map<string, GdacsFeature>();
  for (const feature of features) {
    const p = feature.properties;
    if (!p?.eventtype || p.eventid === undefined) continue;
    const key = `${p.eventtype}:${p.eventid}`;
    const known = latest.get(key)?.properties;
    if (!known || (toIso(p.datemodified) ?? "") > (toIso(known.datemodified) ?? "")) latest.set(key, feature);
  }
  const items: LiveItem[] = [];
  for (const [key, feature] of latest) {
    const p = feature.properties as GdacsProps;
    const [lon, lat] = feature.geometry?.coordinates ?? [];
    const type = GDACS_TYPES[p.eventtype ?? ""] ?? { label: p.eventtype ?? "Événement", metric: "Gravité" };
    const level = (p.alertlevel ?? "").toLowerCase();
    const countries = new Set<string>();
    for (const code of [p.iso3, ...(p.affectedcountries ?? []).map((c) => c.iso3)]) {
      const iso = canonicalIso3(code ?? "");
      if (iso) countries.add(iso);
    }
    if (!countries.size) for (const iso of countryFromCoords(ctx.index, num(lat), num(lon))) countries.add(iso);
    const sev = p.severitydata;
    const description = [plainText(p.htmldescription), sev?.severitytext ? plainText(sev.severitytext) : ""].filter(Boolean).join(" — ");
    items.push({
      id: `gdacs:${key}`,
      category: "disaster",
      nature: "official_alert",
      title: `${plainText(p.name) || type.label}${GDACS_LEVEL_FR[level] ? ` — alerte ${GDACS_LEVEL_FR[level]}` : ""}`,
      summary: summaryOrNull(description),
      url: str(p.url?.report),
      sourceId: "gdacs",
      sourceName: "GDACS (ONU / Commission européenne)",
      publishedAt: toIso(p.datemodified),
      occurredAt: toIso(p.fromdate),
      fetchedAt: ctx.fetchedAt,
      countries: [...countries],
      lat: num(lat),
      lon: num(lon),
      severity: GDACS_SEVERITY[level] ?? null,
      metric: num(sev?.severity) !== null ? { label: type.metric, value: num(sev?.severity) as number, unit: str(sev?.severityunit) } : null,
      caveat: "Niveau d'alerte GDACS issu de modèles automatiques d'impact potentiel, non d'un bilan constaté.",
    });
  }
  return items;
}

function ymd(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// USGS : séismes (capteurs sismiques)
// ---------------------------------------------------------------------------

interface UsgsFeature {
  id?: string;
  properties?: {
    mag?: number | null;
    place?: string | null;
    time?: number | null;
    updated?: number | null;
    url?: string | null;
    status?: string | null;
    tsunami?: number | null;
    magType?: string | null;
    alert?: string | null;
    type?: string | null;
  };
  geometry?: { coordinates?: number[] };
}

function magnitudeSeverity(mag: number): FeedSeverity {
  if (mag >= 7.5) return "extreme";
  if (mag >= 6.5) return "severe";
  if (mag >= 5.5) return "moderate";
  return "minor";
}

/** Fusionne plusieurs flux GeoJSON USGS (déduplication par identifiant). */
export function parseUsgs(rawFeeds: unknown[], ctx: FeedContext): LiveItem[] {
  const byId = new Map<string, UsgsFeature>();
  for (const raw of rawFeeds) {
    const features = (raw as { features?: UsgsFeature[] } | null)?.features;
    if (!Array.isArray(features)) throw new FeedError("USGS : format de réponse inattendu.");
    for (const f of features) if (f.id && f.properties) byId.set(f.id, f);
  }
  const items: LiveItem[] = [];
  for (const [id, f] of byId) {
    const p = f.properties!;
    const mag = num(p.mag);
    const [lon, lat, depth] = f.geometry?.coordinates ?? [];
    if (mag === null || p.type !== "earthquake") continue;
    const place = plainText(p.place) || "lieu non précisé";
    const countries = countryFromCoords(ctx.index, num(lat), num(lon));
    const nameCountries = countries.length ? countries : countriesInText(place.split(",").pop() ?? "");
    const preliminary = p.status && p.status !== "reviewed";
    items.push({
      id: `usgs:${id}`,
      category: "disaster",
      nature: "sensor_measurement",
      title: `Séisme de magnitude ${mag.toFixed(1)} — ${place}`,
      summary: `Magnitude ${mag.toFixed(1)}${p.magType ? ` (${p.magType})` : ""}${num(depth) !== null ? `, profondeur ${Math.round(num(depth) as number)} km` : ""}. Statut USGS : ${p.status ?? "inconnu"}${p.tsunami ? ". Alerte tsunami associée." : "."}`,
      url: str(p.url),
      sourceId: "usgs",
      sourceName: "USGS Earthquake Hazards Program",
      publishedAt: toIso(p.updated),
      occurredAt: toIso(p.time),
      fetchedAt: ctx.fetchedAt,
      countries: nameCountries,
      lat: num(lat),
      lon: num(lon),
      severity: magnitudeSeverity(mag),
      metric: { label: "Magnitude", value: mag, unit: p.magType ? `M${p.magType}` : "M" },
      caveat: preliminary ? "Mesure préliminaire : magnitude et localisation peuvent être révisées par l'USGS." : null,
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// NASA EONET v3 : événements naturels ouverts
// ---------------------------------------------------------------------------

interface EonetEvent {
  id?: string;
  title?: string;
  description?: string | null;
  link?: string;
  categories?: Array<{ id?: string; title?: string }>;
  sources?: Array<{ id?: string; url?: string }>;
  geometry?: Array<{ magnitudeValue?: number | null; magnitudeUnit?: string | null; date?: string; type?: string; coordinates?: unknown }>;
}

export function parseEonet(raw: unknown, ctx: FeedContext): LiveItem[] {
  const events = (raw as { events?: EonetEvent[] } | null)?.events;
  if (!Array.isArray(events)) throw new FeedError("NASA EONET : format de réponse inattendu.");
  const items: LiveItem[] = [];
  for (const event of events) {
    if (!event.id || !event.title) continue;
    const points = (event.geometry ?? []).filter((g) => g.type === "Point" && Array.isArray(g.coordinates) && g.date);
    const last = points.sort((a, b) => (toIso(a.date) ?? "").localeCompare(toIso(b.date) ?? "")).at(-1);
    const [lon, lat] = (last?.coordinates as number[] | undefined) ?? [];
    const category = event.categories?.[0];
    const magnitude = num(last?.magnitudeValue);
    const origins = (event.sources ?? []).map((s) => s.id).filter(Boolean).join(", ");
    const storm = category?.id === "severeStorms";
    items.push({
      id: `eonet:${event.id}`,
      category: "disaster",
      nature: storm ? "official_alert" : "sensor_measurement",
      title: plainText(event.title),
      summary: summaryOrNull(
        [category?.title, event.description, origins ? `Source(s) : ${origins}` : "", last?.date ? `Dernière position : ${toIso(last.date)?.slice(0, 16).replace("T", " ")} UTC` : ""]
          .filter(Boolean)
          .join(". "),
      ),
      url: str(event.sources?.[0]?.url) ?? str(event.link),
      sourceId: "eonet",
      sourceName: "NASA EONET",
      publishedAt: null,
      occurredAt: toIso(last?.date),
      fetchedAt: ctx.fetchedAt,
      countries: countryFromCoords(ctx.index, num(lat), num(lon)),
      lat: num(lat),
      lon: num(lon),
      severity: null,
      metric: magnitude !== null ? { label: "Magnitude", value: magnitude, unit: str(last?.magnitudeUnit) } : null,
      caveat: "Événement ouvert recensé par la NASA à partir de sources tierces ; la position est la dernière connue.",
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Définitions des sources
// ---------------------------------------------------------------------------

export const disasterSources: FeedSourceDef[] = [
  {
    sourceId: "gdacs",
    sourceName: "GDACS (ONU / Commission européenne)",
    category: "disaster",
    homepage: "https://www.gdacs.org",
    license: "Domaine public (GDACS)",
    ttlMs: 5 * 60_000,
    async load(ctx) {
      const url = `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF&alertlevel=Green;Orange;Red&fromDate=${ymd(-30)}&toDate=${ymd(1)}`;
      return parseGdacs(await fetchJson(url), ctx);
    },
  },
  {
    sourceId: "usgs",
    sourceName: "USGS Earthquake Hazards Program",
    category: "disaster",
    homepage: "https://earthquake.usgs.gov",
    license: "Domaine public (USGS)",
    ttlMs: 2 * 60_000,
    async load(ctx) {
      const base = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary";
      const [day, significant] = await Promise.all([fetchJson(`${base}/4.5_day.geojson`), fetchJson(`${base}/significant_week.geojson`)]);
      return parseUsgs([day, significant], ctx);
    },
  },
  {
    sourceId: "eonet",
    sourceName: "NASA EONET",
    category: "disaster",
    homepage: "https://eonet.gsfc.nasa.gov",
    license: "Données ouvertes NASA",
    ttlMs: 15 * 60_000,
    async load(ctx) {
      return parseEonet(await fetchJson("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=20"), ctx);
    },
  },
];
