"use client";

import { useEffect, useState } from "react";
import { canonicalCountryIdentity } from "@/lib/geo/country";
import { countryInteriorPoint } from "@/lib/geo/world";
import type { Locale } from "@/lib/i18n";

/**
 * Référentiel pays côté client (Natural Earth 110m, déjà servi par l'application) :
 * ISO3 canonique → nom, ISO2 (drapeau, nom localisé par le navigateur) et point intérieur.
 * Chargé une seule fois et partagé par la recherche, le fil et la fiche pays.
 */
export interface CountryRef {
  iso3: string;
  iso2: string | null;
  name: string;
  center: { lat: number; lon: number } | null;
}

// Natural Earth code « -99 » pour quelques ISO2 : complément explicite, jamais deviné.
const ISO2_FALLBACK: Record<string, string> = { FRA: "FR", NOR: "NO", KOS: "XK" };

let cache: Promise<Map<string, CountryRef>> | null = null;

export function loadCountryReference(): Promise<Map<string, CountryRef>> {
  cache ??= fetch("/data/ne_110m_countries.geojson")
    .then((response) => {
      if (!response.ok) throw new Error("référentiel pays indisponible");
      return response.json();
    })
    .then((data: { features: { properties: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } }[] }) => {
      const map = new Map<string, CountryRef>();
      for (const { properties, geometry } of data.features) {
        const sourceName = properties.ADMIN || properties.NAME;
        if (typeof sourceName !== "string") continue;
        const identity = canonicalCountryIdentity(sourceName, { isoA3: properties.ISO_A3, adm0A3: properties.ADM0_A3, sovA3: properties.SOV_A3 });
        if (!identity?.iso3 || map.has(identity.iso3)) continue;
        const iso2Raw = [properties.ISO_A2, properties.WB_A2].find((v) => typeof v === "string" && /^[A-Z]{2}$/.test(v)) as string | undefined;
        map.set(identity.iso3, {
          iso3: identity.iso3,
          iso2: iso2Raw ?? ISO2_FALLBACK[identity.iso3] ?? null,
          name: identity.name ?? sourceName,
          center: countryInteriorPoint(geometry),
        });
      }
      return map;
    })
    .catch((err) => {
      cache = null; // nouvelle tentative au prochain appel
      throw err;
    });
  return cache;
}

export function useCountryReference(): { ref: Map<string, CountryRef> | null; status: "loading" | "ready" | "error" } {
  const [state, setState] = useState<{ ref: Map<string, CountryRef> | null; status: "loading" | "ready" | "error" }>({ ref: null, status: "loading" });
  useEffect(() => {
    let alive = true;
    loadCountryReference()
      .then((ref) => alive && setState({ ref, status: "ready" }))
      .catch(() => alive && setState({ ref: null, status: "error" }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

const displayNames: Partial<Record<Locale, Intl.DisplayNames | null>> = {};

/** Nom du pays dans la langue de l'interface (Intl du navigateur), sinon nom Natural Earth, sinon ISO3. */
export function countryLabel(iso3: string, ref: Map<string, CountryRef> | null, locale: Locale): string {
  const entry = ref?.get(iso3);
  if (entry?.iso2) {
    if (displayNames[locale] === undefined) {
      try {
        displayNames[locale] = new Intl.DisplayNames([locale], { type: "region" });
      } catch {
        displayNames[locale] = null;
      }
    }
    const localized = displayNames[locale]?.of(entry.iso2);
    if (localized && localized !== entry.iso2) return localized;
  }
  return entry?.name ?? iso3;
}
