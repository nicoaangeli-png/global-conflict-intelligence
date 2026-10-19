/**
 * Logique pure des CALQUES DE RÉFÉRENCE (sans React ni Three.js, testée dans
 * tests/ui-layers.test.ts) : styles, lecture défensive de `/api/layers`,
 * agrégats par pays (sanctions, installations) et attributs bruts affichables.
 *
 * Un calque de référence décrit ce qui existe (installation, câble, liste
 * officielle), jamais un événement : il porte la date de sa source (`asOf`),
 * distincte de la collecte.
 */
import { LAYER_IDS, type LayerFeature, type LayerId, type LayerResponse } from "@/types/layers";
import type { Locale } from "@/lib/i18n";

/** Ordre d'affichage dans le sélecteur « Calques ». */
export const LAYER_ORDER: readonly LayerId[] = ["nuclear_plants", "military_bases", "submarine_cables", "sanctions"];

export type LayerGlyph = "ring" | "square" | "line" | "tint";

/** Style sobre de chaque calque, dans la palette du globe (aucune icône). */
export const LAYER_STYLE: Record<LayerId, { label: { fr: string; en: string }; color: string; glyph: LayerGlyph }> = {
  nuclear_plants: { label: { fr: "Centrales nucléaires", en: "Nuclear power plants" }, color: "#d4ff4f", glyph: "ring" },
  military_bases: { label: { fr: "Bases militaires", en: "Military bases" }, color: "#b4c48e", glyph: "square" },
  submarine_cables: { label: { fr: "Câbles sous-marins", en: "Submarine cables" }, color: "#6fd3ff", glyph: "line" },
  sanctions: { label: { fr: "Sanctions OFAC (pays)", en: "OFAC sanctions (countries)" }, color: "#ffb066", glyph: "tint" },
};

export const isLayerId = (value: unknown): value is LayerId => typeof value === "string" && (LAYER_IDS as readonly string[]).includes(value);

/** Métadonnées d'un calque sans ses éléments (réponse de `GET /api/layers`). */
export type LayerSummary = Omit<LayerResponse, "features"> & { itemCount: number | null };

/** État de chargement d'un calque côté client. */
export interface LayerLoad {
  status: "loading" | "ready" | "error";
  data: LayerResponse | null;
  /** Échec de la requête elle-même (route absente, réseau…), distinct d'un `status: "error"` de la source. */
  error: string | null;
  requestedAt: number;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** Réponse `GET /api/layers?id=…` valide (contrat `src/types/layers.ts`). */
export function isLayerResponse(body: unknown, id?: LayerId): body is LayerResponse {
  if (!body || typeof body !== "object") return false;
  const b = body as Partial<LayerResponse>;
  return isLayerId(b.layerId) && (!id || b.layerId === id) && Array.isArray(b.features) && typeof b.fetchedAt === "string";
}

/** Catalogue `GET /api/layers` : `{ layers: [...] }` ; tout élément mal formé est ignoré. */
export function parseLayerCatalog(body: unknown): LayerSummary[] {
  const list = Array.isArray(body) ? body : body && typeof body === "object" && Array.isArray((body as { layers?: unknown }).layers) ? (body as { layers: unknown[] }).layers : [];
  const out: LayerSummary[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const layerId = r.layerId ?? r.id;
    if (!isLayerId(layerId)) continue;
    const status = r.status === "ok" || r.status === "stale" || r.status === "error" ? r.status : "error";
    out.push({
      layerId,
      title: str(r.title) ?? layerId,
      sourceName: str(r.sourceName) ?? "",
      homepage: str(r.homepage) ?? "",
      license: str(r.license),
      asOf: str(r.asOf),
      fetchedAt: str(r.fetchedAt) ?? "",
      status,
      message: str(r.message),
      caveat: str(r.caveat),
      itemCount: typeof r.itemCount === "number" && Number.isFinite(r.itemCount) ? r.itemCount : null,
    });
  }
  return out;
}

/** Position d'un élément ponctuel ; null pour une ligne ou un agrégat sans géométrie. */
export function featurePoint(feature: LayerFeature): { lat: number; lon: number } | null {
  const g = feature.geometry;
  if (!g || g.type !== "Point") return null;
  const [lon, lat] = g.coordinates;
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

/** Tronçons d'une ligne (LineString → 1, MultiLineString → n), coordonnées [lon, lat] valides uniquement. */
export function lineParts(feature: LayerFeature): [number, number][][] {
  const g = feature.geometry;
  const parts = !g ? [] : g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
  return parts
    .map((part) => part.filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[1]) <= 90))
    .filter((part) => part.length >= 2);
}

/** Premier point d'une ligne (recentrage caméra au clic). */
export function featureAnchor(feature: LayerFeature): { lat: number; lon: number } | null {
  const point = featurePoint(feature);
  if (point) return point;
  const first = lineParts(feature)[0]?.[0];
  return first ? { lat: first[1], lon: first[0] } : null;
}

export interface CountrySanctions {
  /** Entités de la liste SDN ayant une adresse dans le pays (définition de la source). */
  entities: number;
  /** Programmes de sanctions, du plus fréquent au moins fréquent (nombre d'entités si publié). */
  programs: { name: string; count: number | null }[];
  feature: LayerFeature;
}

/** Programmes d'un élément « sanctions » : objet JSON `{ programme: n }`, ou liste séparée par virgules. */
export function parsePrograms(value: unknown): { name: string; count: number | null }[] {
  if (typeof value !== "string" || !value.trim()) return [];
  const text = value.trim();
  if (text.startsWith("{")) {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      return Object.entries(obj)
        .map(([name, n]) => ({ name, count: typeof n === "number" && Number.isFinite(n) ? n : null }))
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }
  return text
    .split(/[;,]/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name, count: null }));
}

/** Sanctions par pays (ISO3). Le nombre d'entités vient de la source ; à défaut, un élément = une entité. */
export function sanctionsByCountry(features: LayerFeature[]): Map<string, CountrySanctions> {
  const out = new Map<string, CountrySanctions>();
  for (const feature of features) {
    const raw = feature.properties.entityCount ?? feature.properties.count;
    const entities = typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : 1;
    const programs = parsePrograms(feature.properties.programs ?? feature.properties.program);
    for (const iso of feature.countries) {
      if (!/^[A-Z]{3}$/.test(iso)) continue;
      const prev = out.get(iso);
      if (!prev) {
        out.set(iso, { entities, programs, feature });
        continue;
      }
      // Plusieurs éléments pour un même pays : on additionne (une entité par élément).
      const merged = new Map(prev.programs.map((p) => [p.name, p.count] as const));
      for (const p of programs) merged.set(p.name, p.count === null ? (merged.get(p.name) ?? null) : (merged.get(p.name) ?? 0) + p.count);
      out.set(iso, {
        entities: prev.entities + entities,
        programs: [...merged.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.name.localeCompare(b.name)),
        feature: prev.feature,
      });
    }
  }
  return out;
}

/** Éléments d'un calque rattachés à un pays par la source (jamais déduits d'une position). */
export function featuresInCountry(features: LayerFeature[], iso3: string): LayerFeature[] {
  return features.filter((f) => f.countries.includes(iso3)).sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

/** Libellés des attributs connus ; une clé inconnue est affichée telle quelle. */
const PROPERTY_LABELS: Record<string, { fr: string; en: string }> = {
  operator: { fr: "Opérateur", en: "Operator" },
  status: { fr: "Statut (source)", en: "Status (source)" },
  commissioningDate: { fr: "Mise en service", en: "Commissioning" },
  closureDate: { fr: "Arrêt", en: "Closure" },
  capacity: { fr: "Capacité (valeur brute)", en: "Capacity (raw value)" },
  type: { fr: "Type", en: "Type" },
  condition: { fr: "État (source)", en: "Condition (source)" },
  entityCount: { fr: "Entités SDN avec adresse dans le pays", en: "SDN entities with an address in the country" },
  programs: { fr: "Programmes", en: "Programs" },
  // TeleGeography : position de l'étiquette sur sa carte (pas un point d'atterrissement).
  landingPoint: { fr: "Repère de la carte source", en: "Source map anchor" },
};

/** Attributs de présentation de la source, sans valeur informative. */
const HIDDEN_PROPERTIES = new Set(["color"]);

/** Attributs bruts à afficher dans le détail : valeurs de la source, sans conversion ni ajout. */
export function propertyRows(feature: LayerFeature, locale: Locale): { key: string; label: string; value: string }[] {
  const rows: { key: string; label: string; value: string }[] = [];
  for (const [key, value] of Object.entries(feature.properties)) {
    if (value === null || value === "" || HIDDEN_PROPERTIES.has(key)) continue;
    let text: string;
    if (key === "programs") {
      const programs = parsePrograms(value);
      text = programs.length ? programs.map((p) => (p.count === null ? p.name : `${p.name} (${p.count})`)).join(", ") : String(value);
    } else if (typeof value === "boolean") {
      text = value ? (locale === "fr" ? "oui" : "yes") : locale === "fr" ? "non" : "no";
    } else if (typeof value === "number") {
      text = value.toLocaleString(locale === "fr" ? "fr-FR" : "en-US");
    } else {
      text = value;
    }
    const entry = PROPERTY_LABELS[key];
    rows.push({ key, label: entry ? entry[locale] : key, value: text });
  }
  return rows;
}

/** Ligne de légende : source, date de la donnée (ou son absence dite honnêtement), collecte. */
export function layerSourceLine(meta: Pick<LayerResponse, "sourceName" | "asOf" | "fetchedAt" | "license">, locale: Locale, formatDate: (iso: string) => string): string {
  const fr = locale === "fr";
  const parts = [meta.sourceName || (fr ? "source non précisée" : "unspecified source")];
  parts.push(meta.asOf ? `${fr ? "donnée du" : "data as of"} ${formatDate(meta.asOf)}` : fr ? "date de la donnée non publiée par la source" : "data date not published by the source");
  if (meta.fetchedAt) parts.push(`${fr ? "collecte" : "collected"} ${formatDate(meta.fetchedAt)}`);
  return parts.join(" · ");
}
