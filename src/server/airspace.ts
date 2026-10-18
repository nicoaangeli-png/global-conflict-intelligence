import "server-only";
import { countryAt } from "@/lib/geo/world";
import { loadWorldIndex } from "./world";

/**
 * Trafic aérien en direct au-dessus d'un pays (OpenSky Network).
 *
 * Accès anonyme : environ 400 crédits par jour, une requête par pays coûte
 * 1 à 4 crédits selon la taille de la zone. Résultat mis en cache 10 min.
 * Les transpondeurs militaires sont rarement visibles : un ciel vide signale
 * surtout une fermeture de l'espace aérien civil, pas une activité militaire.
 */

const API = "https://opensky-network.org/api/states/all";
const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; result: AirspaceActivity }>();

export type AirspaceActivity = {
  iso: string;
  country: string;
  observedAt: string;
  airborne: number;
  onGround: number;
  operatorsByRegistration: { country: string; aircraft: number }[];
  sample: { callsign: string; registration: string; altitudeM: number | null; speedKmh: number | null }[];
  source: string;
  note: string;
};

type StateVector = [string, string | null, string, number | null, number, number | null, number | null, number | null, boolean, number | null, ...unknown[]];

export async function getAirspaceActivity(iso: string): Promise<AirspaceActivity | { error: string }> {
  if (!/^[A-Z]{3}$/.test(iso)) return { error: "Code ISO alpha-3 attendu" };
  const cached = cache.get(iso);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.result;

  const world = await loadWorldIndex();
  const country = world.byIso.get(iso);
  if (!country) return { error: "Pays inconnu du référentiel" };
  const [minLon, minLat, maxLon, maxLat] = country.bbox;
  const params = new URLSearchParams({ lamin: String(minLat), lomin: String(minLon), lamax: String(maxLat), lomax: String(maxLon) });
  const res = await fetch(`${API}?${params}`, { signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (res.status === 429) return { error: "Quota quotidien OpenSky atteint, réessayer plus tard" };
  if (!res.ok) return { error: `OpenSky HTTP ${res.status}` };
  const json = (await res.json()) as { time?: number; states?: StateVector[] | null };

  // Le rectangle déborde sur les voisins : on ne garde que les avions au-dessus du territoire.
  const inside = (json.states ?? []).filter((s) => s[5] != null && s[6] != null && countryAt(world, s[6], s[5])?.iso === iso);
  const airborne = inside.filter((s) => !s[8]);
  const operators = new Map<string, number>();
  for (const s of airborne) operators.set(s[2], (operators.get(s[2]) ?? 0) + 1);

  const result: AirspaceActivity = {
    iso,
    country: country.name,
    observedAt: new Date((json.time ?? Date.now() / 1000) * 1000).toISOString(),
    airborne: airborne.length,
    onGround: inside.length - airborne.length,
    operatorsByRegistration: [...operators.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, aircraft]) => ({ country: name, aircraft })),
    sample: airborne.slice(0, 10).map((s) => ({
      callsign: (s[1] ?? "").trim() || s[0],
      registration: s[2],
      altitudeM: s[7] == null ? null : Math.round(s[7]),
      speedKmh: s[9] == null ? null : Math.round(s[9] * 3.6),
    })),
    source: "OpenSky Network (ADS-B, accès anonyme)",
    note: "Seuls les avions équipés d'un transpondeur ADS-B visible sont comptés. Les vols militaires y échappent souvent : un ciel vide indique d'abord une fermeture de l'espace aérien civil.",
  };
  cache.set(iso, { at: Date.now(), result });
  return result;
}
