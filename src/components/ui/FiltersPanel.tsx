"use client";

import { EVENT_TYPES, type Confidence, type EventType } from "@/types/conflict";
import { useIntelStore } from "@/store/useIntelStore";

/**
 * Filtres de la carte : types d'événements, niveau de confiance, seuil de
 * létalité, et interrupteurs de couches. Chaque changement réinterroge
 * l'agrégat serveur (aucun filtrage « cosmétique » côté client).
 */

const CONFIDENCES: { key: Confidence; label: string }[] = [
  { key: "CONFIRMED", label: "confirmée" },
  { key: "REPORTED", label: "rapportée" },
  { key: "MEDIA_SIGNAL", label: "presse" },
  { key: "DEMO", label: "démo" },
];

const LAYERS: { key: keyof ReturnType<typeof pickLayers>; label: string }[] = [
  { key: "land", label: "continents" },
  { key: "borders", label: "frontières" },
  { key: "cities", label: "villes" },
  { key: "graticule", label: "grille" },
  { key: "orbits", label: "orbites" },
  { key: "stars", label: "étoiles" },
  { key: "heat", label: "chaleur" },
  { key: "particles", label: "colonnes" },
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
  const setMinFatalities = useIntelStore((s) => s.setMinFatalities);
  const layers = useIntelStore((s) => s.layers);
  const setLayer = useIntelStore((s) => s.setLayer);

  // Répartition observée dans l'agrégat courant (aide à la lecture)
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
        <span className="label-strong">Filtres</span>
        <button
          type="button"
          className="chip"
          style={{ padding: "2px 6px" }}
          onClick={() => {
            setConfidences([]);
            useIntelStore.setState({ filters: { ...filters, types: [], minFatalities: 0 } });
          }}
        >
          réinit.
        </button>
      </div>
      <div className="hairline mx-3 mt-2" />

      <div className="px-3 pt-2">
        <span className="label">Type d&apos;événement</span>
        <div className="mt-[6px] flex flex-wrap gap-[5px]">
          {/* Triés par effectif décroissant : le type dominant de la sélection
              courante apparaît en premier (les types ACLED valent 0 quand la
              sélection ne contient que des signaux presse). */}
          {[...EVENT_TYPES]
            .sort((a, b) => (typeCounts.get(b) ?? 0) - (typeCounts.get(a) ?? 0))
            .map((t) => (
              <button
                key={t}
                type="button"
                className="chip"
                data-active={filters.types.includes(t)}
                onClick={() => toggleType(t)}
                title={`${typeCounts.get(t) ?? 0} événements dans la fenêtre`}
              >
                {shortType(t)}
                <span className="ml-[6px] text-[8px] opacity-70">{typeCounts.get(t) ?? 0}</span>
              </button>
            ))}
        </div>
      </div>

      <div className="hairline mx-3 mt-3" />
      <div className="px-3 pt-2">
        <span className="label">Confiance</span>
        <div className="mt-[6px] flex flex-wrap gap-[5px]">
          {CONFIDENCES.map((c) => (
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
          <span className="label">Victimes minimales</span>
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
        <span className="label">Couches</span>
        <div className="mt-[6px] flex flex-wrap gap-[5px]">
          {LAYERS.map((l) => (
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

function shortType(t: EventType): string {
  switch (t) {
    case "Battles":
      return "combats";
    case "Explosions/Remote violence":
      return "explosions";
    case "Violence against civilians":
      return "violences civ.";
    case "Riots":
      return "émeutes";
    case "Protests":
      return "manifestations";
    case "Media signal":
      return "signaux presse";
    default:
      return "stratégique";
  }
}
