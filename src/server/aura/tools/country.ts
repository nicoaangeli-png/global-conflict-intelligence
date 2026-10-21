import "server-only";
import { canonicalCountryIdentity, normalizeCountryName, resolveCountryIdentity } from "@/lib/geo/country";
import type { WorldIndex } from "@/lib/geo/world";
import { loadWorldIndex } from "@/server/world";
import { SELECTED_ISO3 } from "../context";
import { cleanText } from "../sanitize";
import type { AgentContext } from "../types";
import type { ToolArgs } from "./types";

/** Résolution stricte d'un pays demandé par le modèle (ISO3 ou nom), sans correspondance approximative. */

const nameIndexCache = new WeakMap<WorldIndex, Map<string, string>>();

function worldIsoByName(world: WorldIndex, name: string): string | null {
  let index = nameIndexCache.get(world);
  if (!index) {
    index = new Map();
    for (const country of world.countries) if (country.iso) index.set(normalizeCountryName(country.name), country.iso);
    nameIndexCache.set(world, index);
  }
  return index.get(normalizeCountryName(name)) ?? null;
}

export function isoOfStoreCountry(name: string, world: WorldIndex | null): string | null {
  const identity = canonicalCountryIdentity(name);
  if (identity && identity.iso3 !== identity.name) return identity.iso3;
  return world ? worldIsoByName(world, name) : null;
}

type ResolvedCountry =
  | { ok: true; iso3: string | null; label: string; world: WorldIndex | null }
  | { ok: false; error: string };

export async function resolveRequestedCountry(args: ToolArgs, context: AgentContext): Promise<ResolvedCountry> {
  const world = await loadWorldIndex().catch(() => null);
  const rawName = cleanText(args.country, 80);
  const rawIso = typeof args.iso3 === "string" ? args.iso3.trim().toUpperCase() : "";
  const fromIso = SELECTED_ISO3.test(rawIso) ? resolveCountryIdentity(rawIso) : null;
  const fromName = rawName ? canonicalCountryIdentity(rawName) : null;
  const nameIso = fromName && fromName.iso3 !== fromName.name ? fromName.iso3 : rawName && world ? worldIsoByName(world, rawName) : null;
  if (fromIso && nameIso && fromIso.iso3 !== nameIso) return { ok: false, error: "iso3 et nom de pays incohérents : précise un seul pays" };
  const iso3 = fromIso?.iso3 ?? nameIso ?? (!rawIso && !rawName ? (context.country?.iso3 ?? null) : null);
  if (rawIso && !fromIso) return { ok: false, error: "Code ISO alpha-3 invalide" };
  if (iso3 && world && !world.byIso.has(iso3)) return { ok: false, error: "Pays inconnu du référentiel" };
  const label = (iso3 && world?.byIso.get(iso3)?.name) || fromIso?.name || fromName?.name || rawName;
  if (!iso3 && !rawName) return { ok: false, error: "Aucun pays précisé" };
  return { ok: true, iso3, label, world };
}

export async function resolveIso3Only(args: ToolArgs, context: AgentContext): Promise<{ iso3: string } | { error: string }> {
  const resolved = await resolveRequestedCountry({ iso3: args.iso3 }, context);
  if (!resolved.ok) return { error: resolved.error };
  if (!resolved.iso3) return { error: "Code ISO alpha-3 attendu" };
  return { iso3: resolved.iso3 };
}
