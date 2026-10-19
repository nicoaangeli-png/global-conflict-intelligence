import type { FeedSeverity, LiveItem } from "@/types/feeds";
import { canonicalIso3, countriesInText } from "./countries";
import { fetchJson, FeedError, num, plainText, str, summaryOrNull, toIso, type FeedContext, type FeedSourceDef } from "./util";

interface IodaEntity {
  code?: string;
  name?: string;
  type?: string;
  attrs?: { fqid?: string; country_code?: string; country_name?: string };
}

interface IodaAlert {
  datasource?: string;
  entity?: IodaEntity;
  time?: number;
  level?: string;
  condition?: string;
  value?: number;
  historyValue?: number;
  method?: string;
}

interface IodaResponse {
  data?: IodaAlert[];
  error?: unknown;
}

const IODA_CAVEAT = "Mesure automatique de connectivité (IODA) : une baisse peut avoir une cause technique, électrique ou politique";

function iodaCountry(entity: IodaEntity): string[] {
  const code = entity.type === "country" ? entity.code : entity.attrs?.country_code;
  const name = entity.type === "country" ? entity.name : entity.attrs?.country_name;
  const displayName = code?.length === 2 ? new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) : null;
  const iso3 = canonicalIso3(code) ?? countriesInText(name ?? "")[0] ?? countriesInText(displayName ?? "")[0];
  return iso3 ? [iso3] : [];
}

/** Garde une transition critique par entité et horodatage (un épisode IODA). */
export function parseIodaAlerts(raw: unknown, ctx: FeedContext): LiveItem[] {
  const responses = Array.isArray(raw) ? raw : [raw];
  const byEpisode = new Map<string, { alert: IodaAlert; drop: number | null }>();
  for (const responseRaw of responses) {
    const response = responseRaw as IodaResponse | null;
    if (!response || !Array.isArray(response.data) || response.error) throw new FeedError("IODA : format de réponse inattendu.");
    for (const alert of response.data) {
      const entity = alert.entity;
      const type = str(entity?.type);
      const time = num(alert.time);
      const entityId = str(entity?.attrs?.fqid) ?? (type && str(entity?.code) ? `${type}.${str(entity?.code)}` : null);
      if (!entity || (type !== "country" && type !== "region") || alert.level?.toLowerCase() !== "critical" || time === null || !entityId) continue;
      const value = num(alert.value);
      const history = num(alert.historyValue);
      const drop = value !== null && history !== null && history > 0 ? Math.max(0, ((history - value) / history) * 100) : null;
      const key = `${entityId}:${Math.trunc(time)}`;
      const current = byEpisode.get(key);
      // Plusieurs détecteurs au même instant décrivent le même épisode : garde la baisse la plus forte.
      if (!current || (drop ?? -1) > (current.drop ?? -1)) byEpisode.set(key, { alert, drop });
    }
  }

  const items: LiveItem[] = [];
  for (const [episode, { alert, drop }] of byEpisode) {
    const entity = alert.entity as IodaEntity;
    const time = num(alert.time) as number;
    const value = num(alert.value);
    const history = num(alert.historyValue);
    const name = plainText(entity.name) || plainText(entity.attrs?.country_name) || "entité non nommée";
    const source = plainText(alert.datasource);
    const metric = drop !== null ? Math.round(drop * 10) / 10 : null;
    items.push({
      id: `ioda-outages:${episode}`,
      category: "infrastructure",
      nature: "sensor_measurement",
      title: `Baisse de connectivité IODA — ${name}`,
      summary: summaryOrNull(
        [
          source ? `Détecteur : ${source}` : "",
          value !== null && history !== null ? `Valeur mesurée : ${value}, référence historique : ${history}` : "",
          metric !== null ? `Baisse estimée : ${metric} %` : "",
        ]
          .filter(Boolean)
          .join(". "),
      ),
      url: "https://ioda.inetintel.cc.gatech.edu/",
      sourceId: "ioda-outages",
      sourceName: "IODA (Georgia Tech)",
      publishedAt: null,
      occurredAt: new Date(time * 1000).toISOString(),
      fetchedAt: ctx.fetchedAt,
      countries: iodaCountry(entity),
      lat: null,
      lon: null,
      severity: "severe",
      metric: metric !== null ? { label: "Baisse de connectivité", value: metric, unit: "%" } : null,
      caveat: IODA_CAVEAT,
    });
  }
  return items;
}

interface PortWatchAttributes {
  eventid?: number | string;
  eventtype?: string;
  eventname?: string;
  htmlname?: string;
  htmldescription?: string;
  alertlevel?: string;
  country?: string | null;
  fromdate?: number;
  todate?: number | null;
  severitytext?: string | null;
  lat?: number;
  long?: number;
  editdate?: number;
  affectedports?: string | null;
  n_affectedports?: number;
  pageid?: string | null;
}

interface PortWatchFeature {
  attributes?: PortWatchAttributes;
}

const PORTWATCH_SEVERITY: Record<string, FeedSeverity> = { GREEN: "minor", ORANGE: "moderate", RED: "severe" };

export function parsePortWatch(raw: unknown, ctx: FeedContext): LiveItem[] {
  const features = (raw as { features?: PortWatchFeature[] } | null)?.features;
  if (!Array.isArray(features)) throw new FeedError("FMI PortWatch : format de réponse inattendu.");
  const nowMs = Date.parse(ctx.fetchedAt);
  const cutoff = nowMs - 30 * 86_400_000;
  const items: LiveItem[] = [];
  for (const feature of features) {
    const p = feature.attributes;
    const eventId = p?.eventid === undefined || p.eventid === null ? null : String(p.eventid);
    const ports = num(p?.n_affectedports);
    const startMs = num(p?.fromdate);
    const endMs = num(p?.todate);
    if (!p || !eventId || ports === null || ports <= 0 || startMs === null || (endMs !== null && endMs < cutoff)) continue;
    const lat = num(p.lat);
    const lon = num(p.long);
    const title = plainText(p.htmlname) || plainText(p.eventname) || "Perturbation portuaire";
    const countries = countriesInText(p.country ?? "");
    items.push({
      id: `imf-portwatch:${eventId}`,
      category: "infrastructure",
      nature: "official_publication",
      title,
      summary: summaryOrNull(
        [plainText(p.htmldescription), plainText(p.severitytext), `${ports} port${ports > 1 ? "s" : ""} ou passage${ports > 1 ? "s" : ""} affecté${ports > 1 ? "s" : ""}`, endMs !== null ? `Fin déclarée : ${toIso(endMs)}` : "Épisode déclaré en cours"].filter(Boolean).join(". "),
      ),
      url: "https://portwatch.imf.org/",
      sourceId: "imf-portwatch",
      sourceName: "FMI PortWatch",
      publishedAt: toIso(p.editdate),
      occurredAt: toIso(startMs),
      fetchedAt: ctx.fetchedAt,
      countries,
      lat,
      lon,
      severity: PORTWATCH_SEVERITY[(str(p.alertlevel) ?? "").toUpperCase()] ?? null,
      metric: { label: "Ports ou passages affectés", value: ports, unit: null },
      caveat: "Perturbation recensée par PortWatch ; l’enregistrement décrit des ports ou passages affectés, pas nécessairement une fermeture totale.",
    });
  }
  return items;
}

function iodaUrl(ctx: FeedContext, entityType: "country" | "region"): string {
  const until = Math.floor(Date.parse(ctx.fetchedAt) / 1000);
  if (!Number.isFinite(until)) throw new FeedError("IODA : date de collecte invalide.");
  const url = new URL("https://api.ioda.inetintel.cc.gatech.edu/v2/outages/alerts");
  url.searchParams.set("from", String(until - 86_400));
  url.searchParams.set("until", String(until));
  url.searchParams.set("entityType", entityType);
  url.searchParams.set("limit", "500");
  return url.toString();
}

const PORTWATCH_FIELDS = [
  "eventid",
  "eventtype",
  "eventname",
  "htmlname",
  "htmldescription",
  "alertlevel",
  "country",
  "fromdate",
  "todate",
  "severitytext",
  "lat",
  "long",
  "editdate",
  "affectedports",
  "n_affectedports",
  "pageid",
].join(",");

function portWatchUrl(): string {
  const url = new URL("https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/portwatch_disruptions_database/FeatureServer/0/query");
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", PORTWATCH_FIELDS);
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");
  return url.toString();
}

export const infrastructureSources: FeedSourceDef[] = [
  {
    sourceId: "ioda-outages",
    sourceName: "IODA (Georgia Tech)",
    category: "infrastructure",
    homepage: "https://ioda.inetintel.cc.gatech.edu/",
    license: "This data is Copyright (c) 2021-2025 Georgia Tech Research Corporation. All Rights Reserved.",
    ttlMs: 30 * 60_000,
    async load(ctx) {
      const responses = await Promise.all([
        fetchJson<IodaResponse>(iodaUrl(ctx, "country"), { maxBytes: 2 * 1024 * 1024 }),
        fetchJson<IodaResponse>(iodaUrl(ctx, "region"), { maxBytes: 2 * 1024 * 1024 }),
      ]);
      const items = parseIodaAlerts(responses, ctx);
      const limited = responses.some((response) => response.data?.length === 500);
      return limited ? { items, message: "IODA a atteint la limite de 500 transitions pour au moins un niveau géographique ; résultat potentiellement partiel." } : items;
    },
  },
  {
    sourceId: "imf-portwatch",
    sourceName: "FMI PortWatch",
    category: "infrastructure",
    homepage: "https://portwatch.imf.org/",
    license: "© Fonds monétaire international (FMI) — aucune licence explicite publiée dans le service ArcGIS ; conditions d’utilisation du FMI applicables",
    ttlMs: 30 * 60_000,
    async load(ctx) {
      return parsePortWatch(await fetchJson(portWatchUrl(), { maxBytes: 2 * 1024 * 1024 }), ctx);
    },
  },
];
