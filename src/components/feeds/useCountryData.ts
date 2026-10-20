"use client";

import { useEffect, useState } from "react";
import type { CountryIndicators } from "@/server/countryIndicators";
import type { FeedsResponse, LiveItem } from "@/types/feeds";
import type { LayerId } from "@/types/layers";

/**
 * Données de la fiche pays, chargées indépendamment les unes des autres : une source
 * en échec (flux, Wikidata / Banque mondiale) laisse les autres sections s'afficher.
 */

export type Load<T> = { status: "loading" | "ready" | "error"; data: T | null };

export function useCountryData(iso: string, validIso: boolean, ensureLayer: (id: LayerId) => Promise<void>) {
  const [countryFeeds, setCountryFeeds] = useState<Load<LiveItem[]>>({ status: "loading", data: null });
  const [indicators, setIndicators] = useState<Load<CountryIndicators>>({ status: "loading", data: null });

  // Flux du pays : une requête générale + une requête économie (les cotations ne sont jamais évincées).
  useEffect(() => {
    if (!validIso) {
      setCountryFeeds({ status: "error", data: null });
      return;
    }
    const controller = new AbortController();
    setCountryFeeds({ status: "loading", data: null });
    const get = (q: string) =>
      fetch(`/api/feeds?${q}`, { signal: controller.signal, cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<FeedsResponse>;
      });
    Promise.allSettled([get(`country=${iso}&limit=300`), get(`category=economy&country=${iso}&limit=50`)]).then((results) => {
      if (controller.signal.aborted) return;
      const items = new Map<string, LiveItem>();
      let ok = false;
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        ok = true;
        for (const item of r.value.items ?? []) items.set(item.id, item);
      }
      setCountryFeeds(ok ? { status: "ready", data: [...items.values()] } : { status: "error", data: null });
    });
    return () => controller.abort();
  }, [iso, validIso]);

  // Dirigeants (Wikidata) et indicateurs annuels (Banque mondiale), avec année.
  useEffect(() => {
    if (!validIso) {
      setIndicators({ status: "error", data: null });
      return;
    }
    const controller = new AbortController();
    setIndicators({ status: "loading", data: null });
    fetch(`/api/country?iso=${iso}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok && r.status !== 502) throw new Error(String(r.status));
        return r.json() as Promise<CountryIndicators>;
      })
      .then((data) => setIndicators({ status: "ready", data }))
      .catch(() => {
        if (!controller.signal.aborted) setIndicators({ status: "error", data: null });
      });
    return () => controller.abort();
  }, [iso, validIso]);

  // Calques de référence utiles à la fiche (chargés une fois pour la session, même éteints).
  useEffect(() => {
    if (!validIso) return;
    for (const id of ["sanctions", "nuclear_plants", "military_bases"] as const) void ensureLayer(id);
  }, [validIso, ensureLayer]);

  return { countryFeeds, indicators };
}
