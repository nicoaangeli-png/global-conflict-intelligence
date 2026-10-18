"use client";

import { EVENT_TYPES, REAL_DATASETS, type Confidence, type EventType } from "@/types/conflict";
import { useIntelStore } from "@/store/useIntelStore";
import { t } from "@/lib/i18n";

/**
 * Filtres de la carte : types d'événements, niveau de confiance, seuil de
 * létalité, et interrupteurs de couches.
 */

const CONFIDENCES = (locale: "fr" | "en"): { key: Confidence; label: string }[] => [
  { key: "CONFIRMED", label: locale === "fr" ? "confirmée" : "confirmed" },
  { key: "REPORTED", label: locale === "fr" ? "rapportée" : "reported" },
  { key: "MEDIA_SIGNAL", label: locale === "fr" ? "presse" : "press" },
  { key: "DEMO", label: locale === "fr" ? "démo" : "demo" },
];

const LAYERS = (locale: "fr" | "en"): { key: keyof ReturnType<typeof pickLayers>; label: string }[] => [
  { key: "land", label: locale === "fr" ? "continents" : "landmass" },
  { key: "borders", label: locale === "fr" ? "frontières" : "borders" },
  { key: "cities", label: locale === "fr" ? "villes" : "cities" },
  { key: "graticule", label: locale === "fr" ? "grille" : "grid" },
  { key: "orbits", label: locale === "fr" ? "orbites" : "orbits" },
  { key: "stars", label: locale === "fr" ? "étoiles" : "stars" },
  { key: "heat", label: locale === "fr" ? "chaleur" : "heat" },
  { key: "particles", label: locale === "fr" ? "colonnes" : "columns" },
];

function pickLayers() {
  return {
    land: true,
    borders: true,
    cities: true,
    graticule: true,
    orbits: true,
    stars: true,
    heat: true,
    particles: true,
  };
}

export function FiltersPanel() {
  const filters = useIntelStore((s) => s.filters);
  const clusters = useIntelStore((s) => s.clusters);
  const toggleType = useIntelStore((s) => s.toggleType);
  const setConfidences = useIntelStore((s) => s.setConfidences);
  const setDatasets = useIntelStore((s) => s.setDatasets);
  const setMinFatalities = useIntelStore((s) => s.setMinFatalities);
  const layers = useIntelStore((s) => s.layers);
  const setLayer = useIntelStore((s) => s.setLayer);
  const locale = useIntelStore((s) => s.locale);

  const dict = t(locale);

  // Répartition observée dans l'agrégat courant
  const typeCounts = new Map<EventType, number>();
  for (const c of clusters) {
    for (const [t, n] of Object.entries(c.typeCounts)) {
      typeCounts.set(t as EventType, (typeCounts.get(t as EventType) ?? 0) + (n ?? 0));
    }
  }

  return (
    <section className="panel corners w-[268px]">
      <span className="corner" />
      <div className="flex items-center justify-between px-3 pt-[10px]">
        <span className="label-strong">{dict.filters.title}</span>
        <button
          type="button"
          className="chip"
          style={{ padding: "2px 6px" }}
          onClick={() => {
            useIntelStore.setState({ filters: { ...filters, types: [], confidences: [], minFatalities: 0, datasets: [...REAL_DATASETS] } });
            void useIntelStore.getState().refresh();
          }}
        >
          {locale === "fr" ? "réinit." : "reset"}
        </button>
      </div>
      <div className="hairline mx-3 mt-2" />

      <div className="px-3 pt-2">
        <span className="label">{locale === "fr" ? "Provenance" : "Provenance"}</span>
        <div className="mt-[6px] flex flex-wrap gap-[5px]">
          {[
            { label: locale === "fr" ? "Sources documentées" : "Documented sources", datasets: ["acled", "ucdp", "import:csv"] },
            { label: locale === "fr" ? "Presse GDELT" : "GDELT media", datasets: ["gdelt"] },
            { label: locale === "fr" ? "Démo fictive" : "Fictional demo", datasets: ["demo:seed"] },
            { label: locale === "fr" ? "Sources + presse" : "Sources + media", datasets: [...REAL_DATASETS] },
          ].map((mode) => (
            <button key={mode.label} type="button" className="chip"
              data-active={mode.datasets.length === filters.datasets.length && mode.datasets.every((dataset) => filters.datasets.includes(dataset))}
              onClick={() => { useIntelStore.setState({ filters: { ...filters, confidences: [] }, selected: null, selectedEvents: [] }); setDatasets(mode.datasets); }}>
              {mode.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[9px] leading-relaxed text-text-faint">
          {locale === "fr" ? "La démo est exclue par défaut. Un signal presse ne confirme pas un incident. Aucune donnée ne signifie pas absence de conflit." : "Demo is excluded by default. Media signals do not confirm incidents. No data does not mean no conflict."}
        </p>
      </div>
      <div className="hairline mx-3 mt-3" />
      <div className="px-3 pt-2">
        <span className="label">{dict.filters.conflictTypes}</span>
        <div className="mt-[6px] flex flex-wrap gap-[5px]">
          {[...EVENT_TYPES]
            .sort((a, b) => (typeCounts.get(b) ?? 0) - (typeCounts.get(a) ?? 0))
            .map((type) => (
              <button
                key={type}
                type="button"
                className="chip"
                data-active={filters.types.includes(type)}
                onClick={() => toggleType(type)}
                title={`${typeCounts.get(type) ?? 0} ${locale === "fr" ? "événements dans la fenêtre" : "events in frame"}`}
              >
                {shortType(type, locale)}
                <span className="ml-[6px] text-[8px] opacity-70">{typeCounts.get(type) ?? 0}</span>
              </button>
            ))}
        </div>
      </div>

      <div className="hairline mx-3 mt-3" />
      <div className="px-3 pt-2">
        <span className="label">{dict.filters.dataSources}</span>
        <div className="mt-[6px] flex flex-wrap gap-[5px]">
          {CONFIDENCES(locale).map((c) => (
            <button
              key={c.key}
              type="button"
              className={`chip ${c.key === "CONFIRMED" || c.key === "DEMO" ? "chip-alert" : ""}`}
              data-active={filters.confidences.includes(c.key)}
              onClick={() =>
                setConfidences(
                  filters.confidences.includes(c.key)
                    ? filters.confidences.filter((x) => x !== c.key)
                    : [...filters.confidences, c.key],
                )
              }
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="hairline mx-3 mt-3" />
      <div className="px-3 pt-2">
        <div className="flex items-baseline justify-between">
          <span className="label">{dict.filters.minFatalities}</span>
          <span className="readout text-[9px]">{filters.minFatalities} †</span>
        </div>
        <input
          type="range"
          min={0}
          max={40}
          step={1}
          value={filters.minFatalities}
          onChange={(e) => setMinFatalities(Number(e.target.value))}
          className="mt-[6px] w-full"
        />
      </div>

      <div className="hairline mx-3 mt-3" />
      <div className="px-3 pb-3 pt-2">
        <span className="label">{locale === "fr" ? "Couches orbitales" : "Orbital layers"}</span>
        <div className="mt-[6px] flex flex-wrap gap-[5px]">
          {LAYERS(locale).map((l) => (
            <button
              key={l.key}
              type="button"
              className="chip"
              data-active={layers[l.key]}
              onClick={() => setLayer(l.key, !layers[l.key])}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function shortType(t: EventType, locale: "fr" | "en"): string {
  switch (t) {
    case "Battles":
      return locale === "fr" ? "combats" : "battles";
    case "Explosions/Remote violence":
      return locale === "fr" ? "explosions / frappes" : "explosions";
    case "Violence against civilians":
      return locale === "fr" ? "violences civ." : "civ. violence";
    case "Riots":
      return locale === "fr" ? "émeutes" : "riots";
    case "Protests":
      return locale === "fr" ? "manifestations" : "protests";
    case "Thermal anomaly":
      return locale === "fr" ? "anomalies thermiques" : "thermal anomalies";
    case "Media signal":
      return locale === "fr" ? "signaux presse" : "media signal";
    default:
      return locale === "fr" ? "stratégique" : "strategic";
  }
}
