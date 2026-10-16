"use client";

import { buildCityLights, type CityLights } from "@/lib/geo/cityLights";
import { buildLandDots, type LandDots } from "@/lib/geo/landDots";
import { buildWorldIndex, type WorldIndex } from "@/lib/geo/world";

/**
 * Chargement unique des référentiels géographiques côté navigateur.
 * Les données Natural Earth (frontières, villes, masque terre/mer) sont
 * mises en cache au niveau du module : un seul fetch par session.
 */

let worldPromise: Promise<WorldIndex> | null = null;
let landPromise: Promise<LandDots> | null = null;
let citiesPromise: Promise<CityLights> | null = null;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function loadWorld(): Promise<WorldIndex> {
  if (!worldPromise) {
    worldPromise = getJson<{ features: never[] }>("/data/ne_110m_countries.geojson").then((gj) =>
      buildWorldIndex(gj as unknown as { features: never[] }),
    );
  }
  return worldPromise;
}

export function loadLandDots(): Promise<LandDots> {
  if (!landPromise) landPromise = buildLandDots();
  return landPromise;
}

export function loadCityLights(): Promise<CityLights> {
  if (!citiesPromise) {
    citiesPromise = getJson<{ features: never[] }>("/data/ne_110m_places.geojson").then((gj) =>
      buildCityLights(gj as unknown as { features: never[] }),
    );
  }
  return citiesPromise;
}
