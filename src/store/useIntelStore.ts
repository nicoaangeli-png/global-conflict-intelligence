"use client";

import { create } from "zustand";
import type {
  Confidence,
  ConflictCluster,
  ConflictEvent,
  EventFilters,
  EventType,
  StatsResponse,
  TimeRangeKey,
} from "@/types/conflict";

/**
 * État global de l'application.
 *
 * Séparation nette : les données (foyers agrégés, statistiques) viennent du
 * serveur ; la caméra et la sélection sont locales. Toute modification de
 * filtre ou de niveau d'agrégation déclenche une ré-interrogation, jamais un
 * rechargement complet de la base.
 */

export type CountryFocus = { name: string; iso: string; lat: number; lon: number } | null;

/** Interrupteurs de couches du globe (contrôle « digital twin »). */
export interface LayerToggles {
  land: boolean;
  borders: boolean;
  cities: boolean;
  graticule: boolean;
  orbits: boolean;
  stars: boolean;
  heat: boolean;
  particles: boolean;
}

interface IntelStore {
  filters: EventFilters;
  /** Rayon d'agrégation courant (dérivé du zoom caméra). */
  degrees: number;
  clusters: ConflictCluster[];
  stats: StatsResponse | null;
  selected: ConflictCluster | null;
  selectedEvents: ConflictEvent[];
  /** Pays pointé sur le globe. */
  country: CountryFocus;
  hoveredId: string | null;
  loading: boolean;
  selecting: boolean;
  error: string | null;
  streamStatus: "connecting" | "open" | "closed";
  lastSync: string | null;
  ingestNotice: string | null;
  /** Incrémenté à chaque nouveau jeu de données : pilote l'apparition des marqueurs. */
  dataEpoch: number;
  /** Demande de recentrage caméra (consommée par la scène 3D). */
  focusRequest: { lat: number; lon: number; at: number } | null;
  layers: LayerToggles;
  setLayer: (key: keyof LayerToggles, value: boolean) => void;

  setRange: (range: TimeRangeKey) => void;
  /** Curseur temporel : reconstruit la situation à une date donnée. */
  setAt: (at: string | null) => void;
  toggleType: (type: EventType) => void;
  /**
   * Restreint l'affichage à certains jeux de données. Passer un tableau vide
   * affiche tout ; `REAL_DATASETS` masque la démonstration.
   */
  setDatasets: (d: string[]) => void;
  setConfidences: (c: Confidence[]) => void;
  setMinFatalities: (n: number) => void;
  setDegrees: (degrees: number) => void;
  refresh: () => Promise<void>;
  select: (cluster: ConflictCluster | null) => Promise<void>;
  /** Recharge uniquement le détail (sans recentrer la caméra). */
  loadClusterDetail: (cluster: ConflictCluster) => Promise<void>;
  hover: (id: string | null) => void;
  focus: (lat: number, lon: number) => void;
  setCountry: (country: CountryFocus) => void;
  setStreamStatus: (s: IntelStore["streamStatus"]) => void;
}

const DEFAULT_FILTERS: EventFilters = {
  range: "30d",
  types: [],
  datasets: [],
  confidences: [],
  countries: [],
  minFatalities: 0,
  at: null,
};

const queryOf = (filters: EventFilters, degrees: number) => {
  const params = new URLSearchParams({ range: filters.range, degrees: degrees.toFixed(2) });
  if (filters.types.length) params.set("types", filters.types.join(","));
  if (filters.datasets.length) params.set("datasets", filters.datasets.join(","));
  if (filters.confidences.length) params.set("confidences", filters.confidences.join(","));
  if (filters.countries.length) params.set("countries", filters.countries.join(","));
  if (filters.minFatalities) params.set("minFatalities", String(filters.minFatalities));
  if (filters.at) params.set("at", filters.at);
  return params;
};

let inFlight: AbortController | null = null;

/**
 * Re-résout un foyer sélectionné dans une nouvelle grille d'agrégation.
 * On cherche la cellule la plus proche (< 4° angulaires) ; à défaut, la
 * sélection d'origine est conservée pour ne pas perdre le contexte de
 * l'analyste lors d'un zoom.
 */
function resolveSelection(prev: ConflictCluster, clusters: ConflictCluster[]): ConflictCluster {
  const exact = clusters.find((c) => c.id === prev.id);
  if (exact) return exact;
  const cosLat = Math.cos((prev.latitude * Math.PI) / 180);
  let best: ConflictCluster | null = null;
  let bestD = 16; // 4° au carré
  for (const c of clusters) {
    const dLat = c.latitude - prev.latitude;
    const dLon = (c.longitude - prev.longitude) * cosLat;
    const d = dLat * dLat + dLon * dLon;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best ?? prev;
}

export const useIntelStore = create<IntelStore>((set, get) => ({
  filters: DEFAULT_FILTERS,
  degrees: 2.4,
  clusters: [],
  stats: null,
  selected: null,
  selectedEvents: [],
  country: null,
  hoveredId: null,
  loading: true,
  selecting: false,
  error: null,
  streamStatus: "connecting",
  lastSync: null,
  ingestNotice: null,
  dataEpoch: 0,
  focusRequest: null,
  layers: {
    land: true,
    borders: true,
    cities: true,
    graticule: true,
    orbits: true,
    stars: true,
    heat: true,
    particles: true,
  },

  setLayer: (key, value) => set({ layers: { ...get().layers, [key]: value } }),

  setRange: (range) => {
    set({ filters: { ...get().filters, range } });
    void get().refresh();
  },

  setAt: (at) => {
    set({ filters: { ...get().filters, at } });
    void get().refresh();
  },

  toggleType: (type) => {
    const current = get().filters.types;
    const types = current.includes(type) ? current.filter((t) => t !== type) : [...current, type];
    set({ filters: { ...get().filters, types } });
    void get().refresh();
  },

  setDatasets: (datasets) => {
    set({ filters: { ...get().filters, datasets } });
    void get().refresh();
  },

  setConfidences: (confidences) => {
    set({ filters: { ...get().filters, confidences } });
    void get().refresh();
  },

  setMinFatalities: (minFatalities) => {
    set({ filters: { ...get().filters, minFatalities } });
    void get().refresh();
  },

  setDegrees: (degrees) => {
    if (Math.abs(degrees - get().degrees) < 0.05) return;
    set({ degrees });
    void get().refresh();
  },

  refresh: async () => {
    const { filters, degrees } = get();
    inFlight?.abort();
    inFlight = new AbortController();
    set({ loading: true, error: null });
    try {
      const params = queryOf(filters, degrees);
      const [eventsRes, statsRes] = await Promise.all([
        fetch(`/api/events?${params}`, { signal: inFlight.signal, cache: "no-store" }),
        fetch(`/api/stats?${params}`, { signal: inFlight.signal, cache: "no-store" }),
      ]);
      if (!eventsRes.ok || !statsRes.ok) throw new Error("réponse serveur invalide");
      const events = (await eventsRes.json()) as { clusters: ConflictCluster[]; generatedAt: string };
      const stats = (await statsRes.json()) as StatsResponse;

      // La sélection doit survivre au changement de niveau d'agrégation :
      // le foyer cliqué est re-résolu dans la nouvelle grille (au plus près),
      // et conservé tel quel si aucune cellule ne correspond.
      const prev = get().selected;
      const next = prev ? resolveSelection(prev, events.clusters) : null;

      set((s) => ({
        clusters: events.clusters,
        stats,
        loading: false,
        lastSync: events.generatedAt,
        dataEpoch: s.dataEpoch + 1,
        selected: next,
        // élargit le halo de sélection : le détail est rechargé ci-dessous
        selectedEvents: next && prev && next.id === prev.id ? s.selectedEvents : [],
      }));

      if (next && prev && next.id !== prev.id) void get().loadClusterDetail(next);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      set({ loading: false, error: err instanceof Error ? err.message : "erreur de chargement" });
    }
  },

  select: async (cluster) => {
    if (!cluster) {
      set({ selected: null, selectedEvents: [] });
      return;
    }
    set({ selected: cluster, selecting: true, selectedEvents: [] });
    get().focus(cluster.latitude, cluster.longitude);
    await get().loadClusterDetail(cluster);
  },

  loadClusterDetail: async (cluster) => {
    set({ selecting: true });
    try {
      const { filters, degrees } = get();
      const res = await fetch("/api/cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters: Object.fromEntries(queryOf(filters, degrees)),
          degrees,
          lat: cluster.latitude,
          lon: cluster.longitude,
        }),
      });
      const data = (await res.json()) as { events: ConflictEvent[] };
      set({ selectedEvents: data.events ?? [], selecting: false });
    } catch {
      set({ selecting: false });
    }
  },

  hover: (hoveredId) => set({ hoveredId }),
  focus: (lat, lon) => set({ focusRequest: { lat, lon, at: Date.now() } }),
  setCountry: (country) => set({ country }),
  setStreamStatus: (streamStatus) => set({ streamStatus }),
}));
