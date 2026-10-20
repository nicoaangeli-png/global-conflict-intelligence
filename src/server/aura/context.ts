import "server-only";
import { canonicalCountryIdentity } from "@/lib/geo/country";
import { RANGE_KEYS } from "./config";
import { cleanPlaceLabel, cleanText } from "./sanitize";
import type { AgentContext } from "./types";

/**
 * Contexte de l'écran envoyé par l'interface (pays ouvert, foyer sélectionné, fenêtre).
 * Données non fiables : seuls des codes et noms de lieux vérifiés sont conservés.
 */

export const SELECTED_ISO3 = /^[A-Z]{3}$/;

export function normalizeContext(raw: unknown): AgentContext {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const country = source.country && typeof source.country === "object" ? (source.country as Record<string, unknown>) : null;
  const cluster = source.cluster && typeof source.cluster === "object" ? (source.cluster as Record<string, unknown>) : null;
  const context: AgentContext = {
    locale: source.locale === "en" ? "en" : "fr",
    range: typeof source.range === "string" && (RANGE_KEYS as string[]).includes(source.range) ? source.range : undefined,
    country: null,
    cluster: null,
  };

  // Texte libre de l'interface inséré dans les consignes : seuls de vrais noms de lieux passent.
  const countryName = cleanPlaceLabel(country?.name);
  if (country && countryName) {
    const rawHint = cleanText(country.iso3 ?? country.iso, 8).toUpperCase();
    const hint = SELECTED_ISO3.test(rawHint) ? rawHint : "";
    const identity = canonicalCountryIdentity(countryName, { isoA3: hint || undefined });
    const iso3 = identity && SELECTED_ISO3.test(identity.iso3) ? identity.iso3 : undefined;
    context.country = { name: identity && identity.name !== identity.iso3 ? identity.name : countryName, iso3 };
  }

  if (cluster) {
    const clusterCountry = cleanPlaceLabel(cluster.country);
    const locality = cleanPlaceLabel(cluster.locality);
    if (clusterCountry || locality) {
      const identity = clusterCountry ? canonicalCountryIdentity(clusterCountry) : null;
      context.cluster = {
        locality: locality || undefined,
        country: clusterCountry || undefined,
        countryIso3: identity && SELECTED_ISO3.test(identity.iso3) ? identity.iso3 : undefined,
        eventCount: typeof cluster.eventCount === "number" && Number.isFinite(cluster.eventCount) ? Math.min(10_000_000, Math.max(0, Math.floor(cluster.eventCount))) : undefined,
      };
    }
  }
  return context;
}
