"use client";

import { useEffect, useState } from "react";
import type { CoverageResponse } from "@/types/coverage";

/**
 * Couverture ADS-B / AIS calculée par le serveur (`/api/coverage`), partagée entre
 * composants (une requête par zone et par minute au plus). Rien n'est recalculé côté
 * client ni dans la boucle de rendu du globe.
 */

/** Pays : son centre (facultatif) sert de repli si le territoire est absent du fond de carte. */
export type CoverageTarget = { country: string; lat?: number | null; lon?: number | null } | { lat: number; lon: number } | null;

const REFRESH_MS = 60_000;
const CELL_DEG = 5;
const cache = new Map<string, { at: number; data: CoverageResponse | null; pending: Promise<CoverageResponse | null> | null }>();

/** Clé et URL : un point est ramené au centre de sa cellule de 5°, pour partager le résultat. */
export function coverageUrl(target: CoverageTarget): string {
  const center = (value: number, max: number) => Math.min(max - 0.01, Math.max(-max, Math.floor(value / CELL_DEG) * CELL_DEG + CELL_DEG / 2));
  const point = (lat: number | null | undefined, lon: number | null | undefined) =>
    typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon) ? `lat=${center(lat, 90)}&lon=${center(lon, 180)}` : null;
  if (target && "country" in target) {
    const fallback = point(target.lat, target.lon);
    return `/api/coverage?country=${encodeURIComponent(target.country)}${fallback ? `&${fallback}` : ""}`;
  }
  if (target) return `/api/coverage?${point(target.lat, target.lon) ?? ""}`;
  return "/api/coverage";
}

function load(url: string): Promise<CoverageResponse | null> {
  const entry = cache.get(url);
  if (entry?.pending) return entry.pending;
  // Marge de 5 s : plusieurs composants abonnés à la même zone partagent une seule requête par minute.
  if (entry && Date.now() - entry.at < REFRESH_MS - 5_000) return Promise.resolve(entry.data);
  const pending = fetch(url, { cache: "no-store" })
    .then((response) => (response.ok ? (response.json() as Promise<CoverageResponse>) : null))
    .catch(() => null)
    .then((data) => {
      cache.set(url, { at: Date.now(), data, pending: null });
      return data;
    });
  cache.set(url, { at: entry?.at ?? 0, data: entry?.data ?? null, pending });
  return pending;
}

export function useSensorCoverage(target: CoverageTarget, enabled = true): { data: CoverageResponse | null; status: "loading" | "ready" | "error" } {
  const url = coverageUrl(target);
  const [state, setState] = useState<{ url: string; data: CoverageResponse | null; done: boolean }>(() => ({ url, data: cache.get(url)?.data ?? null, done: Boolean(cache.get(url)?.data) }));
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const run = () => void load(url).then((data) => { if (alive) setState({ url, data, done: true }); });
    run();
    const timer = setInterval(run, REFRESH_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [url, enabled]);
  const current = state.url === url ? state : { url, data: cache.get(url)?.data ?? null, done: false };
  return { data: current.data, status: current.data ? "ready" : current.done ? "error" : "loading" };
}
