"use client";

import { useEffect, useState } from "react";
import type { CountryIndicators } from "@/server/countryIndicators";
import type { FeedsResponse, LiveItem } from "@/types/feeds";
import type { LayerId } from "@/types/layers";
import { isLayerResponse, type LayerLoad } from "@/components/layers/layerModel";

/**
 * Données de la fiche pays, chargées indépendamment les unes des autres : une source
 * en échec (flux, Wikidata / Banque mondiale) laisse les autres sections s'afficher.
 */

export type Load<T> = { status: "loading" | "ready" | "error"; data: T | null };

/** Calques de référence affichés dans la fiche pays. */
const COUNTRY_LAYER_IDS = ["sanctions", "nuclear_plants", "military_bases"] as const;
type CountryLayerId = (typeof COUNTRY_LAYER_IDS)[number];

/**
 * `storeLayers` : calques déjà chargés en entier (affichés sur le globe) ; réutilisés tels
 * quels. Sinon, seuls les éléments du pays sont demandés (`/api/layers?id=…&country=…`).
 */
export function useCountryData(iso: string, validIso: boolean, storeLayers: Partial<Record<LayerId, LayerLoad>>) {
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

  // Calques de la fiche : éléments du pays seulement, sauf si le calque complet est déjà chargé.
  // L'état est rattaché à l'ISO : changer de pays ne réutilise jamais les éléments du précédent.
  const [countryLayers, setCountryLayers] = useState<{ iso: string; loads: Partial<Record<CountryLayerId, LayerLoad>> }>({ iso: "", loads: {} });
  const loads = countryLayers.iso === iso ? countryLayers.loads : {};
  const loadedInStore = (id: CountryLayerId) => storeLayers[id]?.status === "ready" && Boolean(storeLayers[id]?.data);
  useEffect(() => {
    if (!validIso) return;
    // Les calques déjà chargés en entier pour le globe sont réutilisés : rien à demander.
    const ids = COUNTRY_LAYER_IDS.filter((id) => !(storeLayers[id]?.status === "ready" && storeLayers[id]?.data));
    if (!ids.length) {
      setCountryLayers({ iso, loads: {} });
      return;
    }
    const controller = new AbortController();
    const requestedAt = Date.now();
    setCountryLayers({ iso, loads: Object.fromEntries(ids.map((id) => [id, { status: "loading", data: null, error: null, requestedAt }])) });
    for (const id of ids) {
      fetch(`/api/layers?id=${id}&country=${iso}`, { signal: controller.signal, cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const body: unknown = await response.json();
          if (!isLayerResponse(body, id)) throw new Error("réponse invalide");
          setCountryLayers((previous) => ({
            iso,
            loads: { ...(previous.iso === iso ? previous.loads : {}), [id]: { status: "ready", data: body, error: null, requestedAt } },
          }));
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const message = error instanceof Error && error.message !== "Failed to fetch" ? error.message : "réseau indisponible";
          setCountryLayers((previous) => ({
            iso,
            loads: { ...(previous.iso === iso ? previous.loads : {}), [id]: { status: "error", data: null, error: message, requestedAt } },
          }));
        });
    }
    return () => controller.abort();
    // `storeLayers` est lu au moment du chargement du pays ; son évolution ne doit pas
    // relancer les requêtes (sinon chaque calque allumé sur le globe recharge la fiche).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso, validIso]);

  const layers: Partial<Record<CountryLayerId, LayerLoad>> = {};
  for (const id of COUNTRY_LAYER_IDS) layers[id] = loadedInStore(id) ? storeLayers[id] : loads[id];

  return { countryFeeds, indicators, layers };
}
