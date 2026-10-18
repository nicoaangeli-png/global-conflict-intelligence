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
import type { Locale } from "@/lib/i18n";
import { REAL_DATASETS } from "@/types/conflict";

/**
 * État global de l'application.
 *
 * Séparation nette : les données (foyers agrégés, statistiques) viennent du
 * serveur ; la caméra et la sélection sont locales. Toute modification de
 * filtre ou de niveau d'agrégation déclenche une ré-interrogation, jamais un
 * rechargement complet de la base.
 */

export type CountryFocus = { name: string; iso: string; lat: number; lon: number; source?: "globe" | "explorer" } | null;

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

export type ReconTarget = {
  locality: string;
  country: string;
  lat: number;
  lon: number;
} | null;

interface IntelStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  reconTarget: ReconTarget;
  setReconTarget: (target: ReconTarget) => void;

  filters: EventFilters;
  /** Rayon d'agrégation courant (dérivé du zoom caméra). */
  degrees: number;
  clusters: ConflictCluster[];
  stats: StatsResponse | null;
  selected: ConflictCluster | null;
  selectedEvents: ConflictEvent[];
  /** Pays pointé sur le globe (ouvert au clic). */
  country: CountryFocus;
  /** Pays survolé sous le curseur (badge discret, ne masque pas la carte). */
  hoveredCountry: CountryFocus;
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
  /** Panneau AURA (analyste IA) ouvert : masque la colonne droite. */
  agentOpen: boolean;
  setAgentOpen: (open: boolean) => void;
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
  setHoveredCountry: (country: CountryFocus) => void;
  setStreamStatus: (s: IntelStore["streamStatus"]) => void;
}

const DEFAULT_FILTERS: EventFilters = {
  range: "30d",
  types: [],
  datasets: [...REAL_DATASETS],
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
let refreshSequence = 0;
let detailSequence = 0;

/**
 * Re-résout un foyer sélectionné uniquement si la nouvelle grille partage
 * au moins un de ses événements.
 */
function resolveSelection(prev: ConflictCluster, clusters: ConflictCluster[]): ConflictCluster | null {
  let best: ConflictCluster | null = null;
  let bestOverlap = 0;
  let bestDistance = Infinity;
  const previousEventIds = new Set(prev.eventIds);
  for (const c of clusters) {
    const overlap = c.eventIds.reduce((count, eventId) => count + Number(previousEventIds.has(eventId)), 0);
    if (overlap === 0) continue;
    const dLat = c.latitude - prev.latitude;
    const dLon = (c.longitude - prev.longitude) * Math.cos((prev.latitude * Math.PI) / 180);
    const distance = dLat * dLat + dLon * dLon;
    if (overlap > bestOverlap || (overlap === bestOverlap && distance < bestDistance)) {
      bestOverlap = overlap;
      bestDistance = distance;
      best = c;
    }
  }
  return best;
}

export const useIntelStore = create<IntelStore>((set, get) => ({
  locale: "fr",
  setLocale: (locale) => set({ locale }),
  reconTarget: null,
  setReconTarget: (reconTarget) => set({ reconTarget }),

  filters: DEFAULT_FILTERS,
  degrees: 2.4,
  clusters: [],
  stats: null,
  selected: null,
  selectedEvents: [],
  country: null,
  hoveredCountry: null,
  hoveredId: null,
  loading: true,
  selecting: false,
  error: null,
  streamStatus: "connecting",
  lastSync: null,
  ingestNotice: null,
  dataEpoch: 0,
  focusRequest: null,
  agentOpen: false,
  setAgentOpen: (agentOpen) => set({ agentOpen }),
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
    detailSequence++;
    const controller = new AbortController();
    inFlight = controller;
    const request = ++refreshSequence;
    set({ loading: true, error: null, selecting: false });
    try {
      const params = queryOf(filters, degrees);
      const [eventsRes, statsRes] = await Promise.all([
        fetch(`/api/events?${params}`, { signal: controller.signal, cache: "no-store" }),
        fetch(`/api/stats?${params}`, { signal: controller.signal, cache: "no-store" }),
      ]);
      if (!eventsRes.ok || !statsRes.ok) throw new Error("réponse serveur invalide");
      const events = (await eventsRes.json()) as { clusters: ConflictCluster[]; generatedAt: string };
      const stats = (await statsRes.json()) as StatsResponse;
      if (controller.signal.aborted || request !== refreshSequence) return;

      // La sélection survit au changement de grille par ses événements, jamais
      // par la seule proximité de coordonnées.
      const prev = get().selected;
      const next = prev ? resolveSelection(prev, events.clusters) : null;

      set((s) => ({
        clusters: events.clusters,
        stats,
        loading: false,
        lastSync: events.generatedAt,
        dataEpoch: s.dataEpoch + 1,
        selected: next,
        // Le détail dépend aussi des filtres actifs : ne pas garder l'ancien lot.
        selectedEvents: [],
      }));

      if (next) void get().loadClusterDetail(next);
    } catch (err) {
      if ((err as Error).name === "AbortError" || request !== refreshSequence) return;
      set({ loading: false, error: err instanceof Error ? err.message : "erreur de chargement" });
    }
  },

  select: async (cluster) => {
    detailSequence++;
    if (!cluster) {
      set({ selected: null, selectedEvents: [], selecting: false });
      return;
    }
    set({ selected: cluster, selecting: true, selectedEvents: [] });
    get().focus(cluster.latitude, cluster.longitude);
    await get().loadClusterDetail(cluster);
  },

  loadClusterDetail: async (cluster) => {
    const request = ++detailSequence;
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
          clusterId: cluster.id,
        }),
      });
      if (!res.ok) throw new Error("détail indisponible");
      const data = (await res.json()) as { events: ConflictEvent[] };
      if (request === detailSequence && get().selected?.id === cluster.id) set({ selectedEvents: data.events ?? [], selecting: false });
    } catch {
      if (request === detailSequence) set({ selecting: false });
    }
  },

  hover: (hoveredId) => set({ hoveredId }),
  focus: (lat, lon) => set({ focusRequest: { lat, lon, at: Date.now() } }),
  setCountry: (country) => set({ country }),
  setHoveredCountry: (hoveredCountry) => set({ hoveredCountry }),
  setStreamStatus: (streamStatus) => set({ streamStatus }),
}));
