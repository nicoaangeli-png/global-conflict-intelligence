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
import type { FeedCategory, FeedSourceState, FeedsResponse, LiveItem } from "@/types/feeds";
import { FETCH_CATEGORIES, mergeCategoryResults, type CategoryResult, type ThemeKey } from "@/components/feeds/feedModel";

/**
 * État global de l'application.
 *
 * Séparation nette : les données (foyers agrégés, statistiques) viennent du
 * serveur ; la caméra et la sélection sont locales. Toute modification de
 * filtre ou de niveau d'agrégation déclenche une ré-interrogation, jamais un
 * rechargement complet de la base.
 */

export type CountryFocus = { name: string; iso: string; lat: number; lon: number; source?: "globe" | "explorer" } | null;

/** État de chargement des flux mondiaux (`/api/feeds`). */
export type FeedsStatus = "idle" | "loading" | "ready" | "error";

interface IntelStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;

  /**
   * Thème de navigation : filtre le FIL MONDIAL et n'allume sur le globe que
   * le calque correspondant (« all » = tous les calques).
   */
  theme: ThemeKey;
  setTheme: (theme: ThemeKey) => void;

  /** Flux mondiaux (hors conflits armés), fusionnés depuis une requête par catégorie. */
  feeds: LiveItem[];
  feedSources: FeedSourceState[];
  feedsStatus: FeedsStatus;
  /** Catégories dont la requête a échoué (route absente, erreur serveur…). */
  feedFailures: { category: FeedCategory; error: string }[];
  /** Date de génération de la réponse serveur la plus récente. */
  feedsGeneratedAt: string | null;
  /** Fin du dernier rafraîchissement côté client (réussi ou non). */
  feedsCheckedAt: string | null;
  refreshFeeds: () => Promise<void>;
  /** Élément de flux inspecté (clic sur un point du globe ou dans le fil). */
  selectedFeedItem: LiveItem | null;
  selectFeedItem: (item: LiveItem | null) => void;
  hoveredFeedId: string | null;
  hoverFeed: (id: string | null) => void;
  /** Question pré-remplie pour AURA (consommée par le panneau AURA). */
  auraPrompt: string | null;
  openAura: (prompt?: string | null) => void;
  consumeAuraPrompt: () => void;

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
  /** Panneau AURA (analyste IA) ouvert : occupe la colonne droite. */
  agentOpen: boolean;
  setAgentOpen: (open: boolean) => void;

  setRange: (range: TimeRangeKey) => void;
  /** Curseur temporel : reconstruit la situation à une date donnée. */
  setAt: (at: string | null) => void;
  toggleType: (type: EventType) => void;
  /**
   * Restreint l'affichage à certains jeux de données. Passer un tableau vide
   * affiche tout ; `REAL_DATASETS` = toutes les sources réelles.
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
let feedsInFlight: AbortController | null = null;

/** Une requête par catégorie : une catégorie volumineuse n'évince jamais les autres. */
const FEEDS_PER_CATEGORY = 150;

async function fetchCategory(category: FeedCategory, signal: AbortSignal): Promise<CategoryResult> {
  try {
    const res = await fetch(`/api/feeds?category=${category}&limit=${FEEDS_PER_CATEGORY}`, { signal, cache: "no-store" });
    if (!res.ok) return { category, ok: false, error: res.status === 404 ? "service des flux absent (HTTP 404)" : `HTTP ${res.status}` };
    const body = (await res.json()) as FeedsResponse;
    if (!body || !Array.isArray(body.items)) return { category, ok: false, error: "réponse invalide" };
    return { category, ok: true, body };
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    return { category, ok: false, error: "réseau indisponible" };
  }
}
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

  theme: "all",
  setTheme: (theme) => {
    const { selectedFeedItem, selected } = get();
    // Changer de thème ferme l'inspection qui n'appartient plus au calque visible.
    const keepItem = selectedFeedItem && (theme === "all" || selectedFeedItem.category === theme);
    const keepCluster = selected && (theme === "all" || theme === "conflict");
    set({
      theme,
      selectedFeedItem: keepItem ? selectedFeedItem : null,
      hoveredFeedId: null,
      ...(keepCluster ? {} : { selected: null, selectedEvents: [] }),
    });
  },

  feeds: [],
  feedSources: [],
  feedsStatus: "idle",
  feedFailures: [],
  feedsGeneratedAt: null,
  feedsCheckedAt: null,
  refreshFeeds: async () => {
    feedsInFlight?.abort();
    const controller = new AbortController();
    feedsInFlight = controller;
    set({ feedsStatus: "loading" });
    try {
      const results = await Promise.all(FETCH_CATEGORIES.map((category) => fetchCategory(category, controller.signal)));
      if (controller.signal.aborted) return;
      const merged = mergeCategoryResults(results);
      const allFailed = merged.failedCategories.length === FETCH_CATEGORIES.length;
      set((s) => ({
        // Échec total : on garde le dernier état connu plutôt que d'effacer le fil.
        feeds: allFailed ? s.feeds : merged.items,
        feedSources: allFailed ? s.feedSources : merged.sources,
        feedFailures: merged.failedCategories,
        feedsGeneratedAt: allFailed ? s.feedsGeneratedAt : merged.generatedAt,
        feedsCheckedAt: new Date().toISOString(),
        feedsStatus: allFailed ? "error" : "ready",
      }));
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      set({ feedsStatus: "error", feedsCheckedAt: new Date().toISOString() });
    }
  },
  selectedFeedItem: null,
  selectFeedItem: (item) => {
    detailSequence++;
    // Sélection unique : inspecter un élément ferme la fiche pays et le foyer.
    set(item ? { selectedFeedItem: item, country: null, selected: null, selectedEvents: [], selecting: false } : { selectedFeedItem: null });
    if (item && item.lat !== null && item.lon !== null) get().focus(item.lat, item.lon);
  },
  hoveredFeedId: null,
  hoverFeed: (hoveredFeedId) => {
    if (get().hoveredFeedId !== hoveredFeedId) set({ hoveredFeedId });
  },
  auraPrompt: null,
  openAura: (prompt = null) => set({ agentOpen: true, auraPrompt: prompt }),
  consumeAuraPrompt: () => set({ auraPrompt: null }),

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
    // Sélection unique : un foyer ferme la fiche pays et l'élément de flux inspecté.
    set({ selected: cluster, selecting: true, selectedEvents: [], country: null, selectedFeedItem: null });
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
  setCountry: (country) => {
    if (!country) {
      set({ country: null });
      return;
    }
    // Sélection unique : la fiche pays remplace foyer et élément inspectés.
    detailSequence++;
    set({ country, selected: null, selectedEvents: [], selecting: false, selectedFeedItem: null });
  },
  setHoveredCountry: (hoveredCountry) => set({ hoveredCountry }),
  setStreamStatus: (streamStatus) => set({ streamStatus }),
}));
