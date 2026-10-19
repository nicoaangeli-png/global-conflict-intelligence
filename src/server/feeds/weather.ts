import type { FeedSeverity, LiveItem } from "@/types/feeds";
import { countriesInText } from "./countries";
import { countryFromCoords, fetchJson, FeedError, num, plainText, str, summaryOrNull, toIso, type FeedContext, type FeedSourceDef } from "./util";

interface GeoJsonGeometry {
  type?: string;
  coordinates?: unknown;
}

interface WmoAlert {
  id?: string;
  event?: string;
  headline?: string;
  sent?: string;
  effective?: string;
  expires?: string;
  areaDesc?: string;
  s?: number;
  capURL?: string;
  /** Certains producteurs utilisent encore `url` pour le même chemin CAP relatif. */
  url?: string;
}

const WMO_SEVERITY: Record<number, FeedSeverity | null> = { 0: null, 1: "minor", 2: "moderate", 3: "severe", 4: "extreme" };
const TEXT_SEVERITY: Record<string, FeedSeverity> = { minor: "minor", moderate: "moderate", severe: "severe", extreme: "extreme" };
const CANADA_RISK: Record<string, FeedSeverity> = { green: "minor", yellow: "moderate", orange: "severe", red: "extreme" };

/** Les dates du sommaire OMM sont UTC mais ne portent pas de suffixe. */
function wmoIso(value: string | null | undefined): string | null {
  const text = str(value);
  if (!text) return null;
  return toIso(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(" ", "T")}Z` : text);
}

function isCurrent(effective: string | null, expires: string | null, nowMs: number): boolean {
  const expiryMs = expires ? Date.parse(expires) : Number.NaN;
  if (!Number.isFinite(expiryMs) || expiryMs <= nowMs) return false;
  const effectiveMs = effective ? Date.parse(effective) : Number.NaN;
  return !Number.isFinite(effectiveMs) || effectiveMs <= nowMs;
}

function capUrl(alert: WmoAlert): string | null {
  const path = str(alert.capURL) ?? str(alert.url);
  if (!path || path.includes("..") || !/^[a-z0-9._/-]+$/i.test(path)) return null;
  return new URL(`/v2/cap-alerts/${path.replace(/^\/+/, "")}`, "https://severeweather.wmo.int").toString();
}

function wmoCountry(alert: WmoAlert): string[] {
  const path = str(alert.capURL) ?? str(alert.url);
  const alpha2 = /^([a-z]{2})-/i.exec(path ?? "")?.[1];
  const name = alpha2 ? new Intl.DisplayNames(["en"], { type: "region" }).of(alpha2.toUpperCase()) : null;
  const iso3 = countriesInText(name ?? "")[0];
  return iso3 ? [iso3] : [];
}

/** Sommaire mondial OMM ; les CAP NWS sont omises car la source NWS dédiée les fournit. */
export function parseWmoAlerts(raw: unknown, ctx: FeedContext): LiveItem[] {
  const alerts = (raw as { items?: WmoAlert[] } | null)?.items;
  if (!Array.isArray(alerts)) throw new FeedError("OMM Severe Weather : format de réponse inattendu.");
  const nowMs = Date.parse(ctx.fetchedAt);
  const items: LiveItem[] = [];
  const seen = new Set<string>();
  for (const alert of alerts) {
    const id = str(alert.id);
    const url = capUrl(alert);
    const relative = str(alert.capURL) ?? str(alert.url) ?? "";
    // Le flux NWS dédié ne demande que Severe/Extreme : déduplique ces CAP sans perdre les avis US moins graves de l'OMM.
    if (!id || seen.has(id) || (relative.toLowerCase().startsWith("us-noaa-nws-") && (num(alert.s) ?? -1) >= 3) || !url) continue;
    const publishedAt = wmoIso(alert.sent);
    const effective = wmoIso(alert.effective) ?? publishedAt;
    const expires = wmoIso(alert.expires);
    if (!isCurrent(effective, expires, nowMs)) continue;
    seen.add(id);
    const area = plainText(alert.areaDesc);
    items.push({
      id: `wmo-severe-weather:${id}`,
      category: "weather",
      nature: "official_alert",
      title: plainText(alert.headline) || plainText(alert.event) || "Alerte météorologique officielle",
      summary: summaryOrNull([area, expires ? `Expiration : ${expires}` : ""].filter(Boolean).join(". ")),
      url,
      sourceId: "wmo-severe-weather",
      sourceName: "OMM Severe Weather Information Centre",
      publishedAt,
      occurredAt: effective,
      fetchedAt: ctx.fetchedAt,
      countries: wmoCountry(alert),
      lat: null,
      lon: null,
      severity: WMO_SEVERITY[num(alert.s) ?? -1] ?? null,
      metric: null,
      caveat: "Alerte CAP agrégée par l’OMM ; le sommaire mondial ne fournit pas le polygone, donc aucune position n’est inventée.",
    });
  }
  return items;
}

function ringCentroid(ring: unknown): { lat: number; lon: number; area: number } | null {
  if (!Array.isArray(ring)) return null;
  const points = ring
    .map((point) => (Array.isArray(point) ? [num(point[0]), num(point[1])] : [null, null]))
    .filter((point): point is [number, number] => point[0] !== null && point[1] !== null && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90);
  if (points.length < 3) return null;
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const cross = current[0] * next[1] - next[0] * current[1];
    twiceArea += cross;
    x += (current[0] + next[0]) * cross;
    y += (current[1] + next[1]) * cross;
  }
  if (Math.abs(twiceArea) < 1e-12) {
    return { lon: points.reduce((sum, point) => sum + point[0], 0) / points.length, lat: points.reduce((sum, point) => sum + point[1], 0) / points.length, area: 0 };
  }
  return { lon: x / (3 * twiceArea), lat: y / (3 * twiceArea), area: Math.abs(twiceArea / 2) };
}

/** Centroïde du plus grand polygone GeoJSON ; null quand la source ne donne pas de surface. */
function geometryCentroid(geometry: GeoJsonGeometry | null | undefined): { lat: number; lon: number } | null {
  if (!geometry || !Array.isArray(geometry.coordinates)) return null;
  const rings = geometry.type === "Polygon" ? [geometry.coordinates[0]] : geometry.type === "MultiPolygon" ? geometry.coordinates.map((polygon) => (Array.isArray(polygon) ? polygon[0] : null)) : [];
  const candidates = rings.map(ringCentroid).filter((value): value is NonNullable<typeof value> => value !== null);
  const largest = candidates.sort((a, b) => b.area - a.area)[0];
  return largest ? { lat: largest.lat, lon: largest.lon } : null;
}

interface NwsFeature {
  id?: string;
  geometry?: GeoJsonGeometry | null;
  properties?: {
    id?: string;
    sent?: string;
    effective?: string;
    onset?: string;
    expires?: string;
    ends?: string | null;
    status?: string;
    severity?: string;
    event?: string;
    headline?: string;
    description?: string;
    areaDesc?: string;
  };
}

export function parseNwsAlerts(raw: unknown, ctx: FeedContext): LiveItem[] {
  const features = (raw as { features?: NwsFeature[] } | null)?.features;
  if (!Array.isArray(features)) throw new FeedError("NWS : format de réponse inattendu.");
  const nowMs = Date.parse(ctx.fetchedAt);
  const items: LiveItem[] = [];
  for (const feature of features) {
    const p = feature.properties;
    const capId = str(p?.id);
    const publishedAt = toIso(p?.sent);
    const effective = toIso(p?.effective) ?? toIso(p?.onset) ?? publishedAt;
    const expires = toIso(p?.expires);
    if (!p || !capId || p.status?.toLowerCase() !== "actual" || !isCurrent(effective, expires, nowMs)) continue;
    const center = geometryCentroid(feature.geometry);
    items.push({
      id: `nws-alerts:${capId}`,
      category: "weather",
      nature: "official_alert",
      title: plainText(p.headline) || plainText(p.event) || "Alerte NWS",
      summary: summaryOrNull([p.areaDesc, expires ? `Expiration : ${expires}` : "", p.description].filter(Boolean).join(". ")),
      url: str(feature.id),
      sourceId: "nws-alerts",
      sourceName: "US National Weather Service",
      publishedAt,
      occurredAt: effective,
      fetchedAt: ctx.fetchedAt,
      countries: center ? countryFromCoords(ctx.index, center.lat, center.lon) : ["USA"],
      lat: center?.lat ?? null,
      lon: center?.lon ?? null,
      severity: TEXT_SEVERITY[(str(p.severity) ?? "").toLowerCase()] ?? null,
      metric: null,
      caveat: null,
    });
  }
  return items;
}

interface CanadaFeature {
  id?: string;
  geometry?: GeoJsonGeometry | null;
  properties?: {
    alert_type?: string;
    alert_name_en?: string;
    alert_name_fr?: string;
    publication_datetime?: string;
    expiration_datetime?: string;
    validity_datetime?: string;
    event_end_datetime?: string;
    alert_text_en?: string;
    alert_text_fr?: string;
    risk_colour_en?: string | null;
    feature_name_en?: string;
    feature_name_fr?: string;
    province?: string;
  };
}

export function parseCanadaAlerts(raw: unknown, ctx: FeedContext): LiveItem[] {
  const features = (raw as { features?: CanadaFeature[] } | null)?.features;
  if (!Array.isArray(features)) throw new FeedError("Environnement Canada : format de réponse inattendu.");
  const nowMs = Date.parse(ctx.fetchedAt);
  const items: LiveItem[] = [];
  for (const feature of features) {
    const p = feature.properties;
    const id = str(feature.id);
    if (!p || !id || p.alert_type?.toLowerCase() !== "warning") continue;
    const publishedAt = toIso(p.publication_datetime);
    const effective = toIso(p.validity_datetime) ?? publishedAt;
    const expires = toIso(p.expiration_datetime) ?? toIso(p.event_end_datetime);
    if (!isCurrent(effective, expires, nowMs)) continue;
    const center = geometryCentroid(feature.geometry);
    const place = plainText(p.feature_name_fr) || plainText(p.feature_name_en);
    const label = plainText(p.alert_name_fr) || plainText(p.alert_name_en) || "Avertissement météorologique";
    items.push({
      id: `environment-canada-alerts:${id}`,
      category: "weather",
      nature: "official_alert",
      title: place ? `${label} — ${place}` : label,
      summary: summaryOrNull([expires ? `Expiration : ${expires}` : "", p.alert_text_fr || p.alert_text_en].filter(Boolean).join(". ")),
      url: "https://api.weather.gc.ca/collections/weather-alerts/items?f=json",
      sourceId: "environment-canada-alerts",
      sourceName: "Environnement et Changement climatique Canada",
      publishedAt,
      occurredAt: effective,
      fetchedAt: ctx.fetchedAt,
      countries: ["CAN"],
      lat: center?.lat ?? null,
      lon: center?.lon ?? null,
      severity: CANADA_RISK[(str(p.risk_colour_en) ?? "").toLowerCase()] ?? null,
      metric: null,
      caveat: null,
    });
  }
  return items;
}

interface NhcStorm {
  id?: string;
  name?: string;
  classification?: string;
  intensity?: string | number;
  pressure?: string | number;
  latitudeNumeric?: number;
  longitudeNumeric?: number;
  movementDir?: number;
  movementSpeed?: number;
  lastUpdate?: string;
  publicAdvisory?: { issuance?: string; url?: string } | null;
}

const STORM_LABELS: Record<string, string> = { TD: "Dépression tropicale", TS: "Tempête tropicale", HU: "Ouragan", SD: "Dépression subtropicale", SS: "Tempête subtropicale", PT: "Cyclone post-tropical" };

export function parseNhcStorms(raw: unknown, ctx: FeedContext): LiveItem[] {
  const storms = (raw as { activeStorms?: NhcStorm[] } | null)?.activeStorms;
  if (!Array.isArray(storms)) throw new FeedError("NOAA NHC : format de réponse inattendu.");
  const items: LiveItem[] = [];
  for (const storm of storms) {
    const id = str(storm.id);
    const name = plainText(storm.name);
    const lat = num(storm.latitudeNumeric);
    const lon = num(storm.longitudeNumeric);
    if (!id || !name) continue;
    const wind = num(storm.intensity);
    const pressure = num(storm.pressure);
    const movement = num(storm.movementSpeed);
    const direction = num(storm.movementDir);
    const classification = (str(storm.classification) ?? "").toUpperCase();
    items.push({
      id: `noaa-nhc:${id.toLowerCase()}`,
      category: "weather",
      nature: "official_alert",
      title: `${STORM_LABELS[classification] ?? "Cyclone tropical"} ${name}`,
      summary: summaryOrNull(
        [wind !== null ? `Vent maximal : ${wind} kt` : "", pressure !== null ? `Pression : ${pressure} hPa` : "", movement !== null ? `Déplacement : ${movement} kt${direction !== null ? ` vers ${direction}°` : ""}` : ""].filter(Boolean).join(". "),
      ),
      url: str(storm.publicAdvisory?.url),
      sourceId: "noaa-nhc",
      sourceName: "NOAA National Hurricane Center",
      publishedAt: toIso(storm.publicAdvisory?.issuance) ?? toIso(storm.lastUpdate),
      occurredAt: toIso(storm.lastUpdate),
      fetchedAt: ctx.fetchedAt,
      countries: countryFromCoords(ctx.index, lat, lon),
      lat,
      lon,
      // La catégorie du cyclone décrit son intensité, pas directement la gravité de ses impacts.
      severity: null,
      metric: wind !== null ? { label: "Vent maximal", value: wind, unit: "kt" } : pressure !== null ? { label: "Pression centrale", value: pressure, unit: "hPa" } : null,
      caveat: "Cyclone actif selon le NHC ; la trajectoire et l’intensité peuvent évoluer à chaque avis.",
    });
  }
  return items;
}

export const weatherSources: FeedSourceDef[] = [
  {
    sourceId: "wmo-severe-weather",
    sourceName: "OMM Severe Weather Information Centre",
    category: "weather",
    homepage: "https://severeweather.wmo.int/",
    license: "© OMM — usage personnel non commercial ; courts extraits autorisés avec mention de la source, restrictions spécifiques possibles",
    ttlMs: 10 * 60_000,
    async load(ctx) {
      return parseWmoAlerts(await fetchJson("https://severeweather.wmo.int/json/wmo_all.json", { maxBytes: 2 * 1024 * 1024 }), ctx);
    },
  },
  {
    sourceId: "nws-alerts",
    sourceName: "US National Weather Service",
    category: "weather",
    homepage: "https://www.weather.gov/",
    license: "Domaine public (NOAA / National Weather Service)",
    ttlMs: 10 * 60_000,
    async load(ctx) {
      return parseNwsAlerts(await fetchJson("https://api.weather.gov/alerts/active?status=actual&severity=Extreme,Severe", { maxBytes: 3 * 1024 * 1024 }), ctx);
    },
  },
  {
    sourceId: "environment-canada-alerts",
    sourceName: "Environnement et Changement climatique Canada",
    category: "weather",
    homepage: "https://meteo.gc.ca/",
    license: "Licence du gouvernement ouvert – Canada",
    ttlMs: 10 * 60_000,
    async load(ctx) {
      return parseCanadaAlerts(await fetchJson("https://api.weather.gc.ca/collections/weather-alerts/items?f=json", { maxBytes: 3 * 1024 * 1024 }), ctx);
    },
  },
  {
    sourceId: "noaa-nhc",
    sourceName: "NOAA National Hurricane Center",
    category: "weather",
    homepage: "https://www.nhc.noaa.gov/",
    license: "Domaine public (NOAA / National Hurricane Center)",
    ttlMs: 10 * 60_000,
    async load(ctx) {
      return parseNhcStorms(await fetchJson("https://www.nhc.noaa.gov/CurrentStorms.json", { maxBytes: 512 * 1024 }), ctx);
    },
  },
];
