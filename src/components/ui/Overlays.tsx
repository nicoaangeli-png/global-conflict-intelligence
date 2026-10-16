"use client";

import { useEffect, useRef, useState } from "react";
import { coords, compact, dateTimeUTC, relative } from "@/lib/format";
import { useIntelStore } from "@/store/useIntelStore";
import { REAL_DATASETS } from "@/types/conflict";

/**
 * Surcouches HUD : équerres de cadre, réticule de survol, fiche pays,
 * indicateurs système. Tout est alimenté par l'état réel de l'application.
 */

export function FrameCorners() {
  return (
    <div className="pointer-events-none absolute inset-3 z-10 select-none">
      {(
        [
          ["top-0 left-0", "border-t border-l"],
          ["top-0 right-0", "border-t border-r"],
          ["bottom-0 left-0", "border-b border-l"],
          ["bottom-0 right-0", "border-b border-r"],
        ] as const
      ).map(([pos, edges]) => (
        <span
          key={pos}
          className={`absolute ${pos} ${edges} h-4 w-4`}
          style={{ borderColor: "rgba(127,212,255,0.34)" }}
        />
      ))}
      <span className="absolute left-1/2 top-0 h-[1px] w-16 -translate-x-1/2 bg-[rgba(127,212,255,0.3)]" />
      <span className="absolute bottom-0 left-1/2 h-[1px] w-16 -translate-x-1/2 bg-[rgba(127,212,255,0.3)]" />
    </div>
  );
}

/** Compteur d'images réel (mesure par requestAnimationFrame). */
export function SystemReadout() {
  const [fps, setFps] = useState(0);
  const frames = useRef(0);
  const last = useRef(performance.now());
  const degrees = useIntelStore((s) => s.degrees);
  const clusters = useIntelStore((s) => s.clusters);
  const stats = useIntelStore((s) => s.stats);
  const at = useIntelStore((s) => s.filters.at);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      frames.current++;
      const now = performance.now();
      if (now - last.current >= 1000) {
        setFps(Math.round((frames.current * 1000) / (now - last.current)));
        frames.current = 0;
        last.current = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="pointer-events-none absolute bottom-[128px] left-[305px] z-10 flex flex-col gap-[3px] select-none border border-[rgba(127,212,255,0.1)] bg-[rgba(2,8,15,0.55)] px-2 py-[5px] backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <span className="label">Rendu</span>
        <span className="readout text-[9px]">
          {fps} fps · {clusters.length} foyers · agrégat {degrees.toFixed(1)}°
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="label">Fenêtre</span>
        <span className="readout text-[9px]">
          {stats?.range ?? "—"} {at ? `· archive ${at.slice(0, 10)}` : "· temps réel"}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="label">Dépôt</span>
        <span className="readout text-[9px]">{stats?.dataset ?? "—"}</span>
      </div>
    </div>
  );
}

/** Réticule d'identification : suit le curseur sur un foyer. */
export function HoverReadout() {
  const hoveredId = useIntelStore((s) => s.hoveredId);
  const clusters = useIntelStore((s) => s.clusters);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const cluster = clusters.find((c) => c.id === hoveredId) ?? null;

  useEffect(() => {
    const onMove = (e: PointerEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  if (!cluster) return null;
  const x = Math.min(pos.x + 16, window.innerWidth - 230);
  const y = Math.min(pos.y + 14, window.innerHeight - 150);

  return (
    <div
      className="panel corners pointer-events-none absolute z-30 w-[216px] px-3 py-2"
      style={{ left: x, top: y }}
    >
      <span className="corner" />
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-light tracking-wide text-ice">
          {cluster.locality || cluster.region || cluster.country}
        </span>
        <span className="readout text-[9px]">{cluster.eventCount} év.</span>
      </div>
      <div className="mt-[2px] text-[9px] uppercase tracking-[0.18em] text-text-faint">{cluster.country}</div>
      <div className="hairline my-[6px]" />
      <div className="flex items-baseline justify-between">
        <span className="label">Type dominant</span>
        <span className="readout text-[9px]">{cluster.topType}</span>
      </div>
      <div className="mt-[2px] flex items-baseline justify-between">
        <span className="label">Victimes</span>
        <span className="readout text-[9px]" style={{ color: "#ff9a80" }}>
          {compact(cluster.fatalities)} †
        </span>
      </div>
      <div className="mt-[2px] flex items-baseline justify-between">
        <span className="label">Dernier</span>
        <span className="readout text-[9px]">{relative(cluster.lastEventAt)}</span>
      </div>
      <div className="mt-[2px] flex items-baseline justify-between">
        <span className="label">Position</span>
        <span className="readout text-[9px]">{coords(cluster.latitude, cluster.longitude)}</span>
      </div>
      <div className="hairline my-[6px]" />
      <div className="flex items-center justify-between">
        <span className="text-[8px] uppercase tracking-[0.18em] text-text-faint">
          {cluster.confidence === "MEDIA_SIGNAL" ? "signal presse" : cluster.confidence.toLowerCase()}
        </span>
        <span className="text-[8px] uppercase tracking-[0.18em] text-cyan-dim">clic → détail</span>
      </div>
    </div>
  );
}

/** Fiche du pays pointé (lancer de rayon sur la sphère). */
export function CountryCard() {
  const country = useIntelStore((s) => s.country);
  const clusters = useIntelStore((s) => s.clusters);
  const setCountry = useIntelStore((s) => s.setCountry);
  const select = useIntelStore((s) => s.select);

  if (!country) return null;

  const local = clusters.filter((c) => c.country === country.name);
  const events = local.reduce((a, c) => a + c.eventCount, 0);
  const fatalities = local.reduce((a, c) => a + c.fatalities, 0);
  const best = local.slice().sort((a, b) => b.intensity - a.intensity)[0];

  return (
    <div className="panel corners boot pointer-events-auto absolute left-1/2 top-[86px] z-20 w-[248px] -translate-x-1/2 px-3 py-2">
      <span className="corner" />
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[12px] font-light tracking-[0.16em] text-ice">{country.name.toUpperCase()}</div>
          <div className="mt-[2px] readout text-[9px]">
            {coords(country.lat, country.lon)} · {country.iso || "—"}
          </div>
        </div>
        <button type="button" className="chip" style={{ padding: "2px 6px" }} onClick={() => setCountry(null)}>
          esc
        </button>
      </div>
      <div className="hairline my-2" />
      <div className="flex items-baseline justify-between">
        <span className="label">Foyers rattachés</span>
        <span className="readout text-[9px]">{local.length}</span>
      </div>
      <div className="mt-[2px] flex items-baseline justify-between">
        <span className="label">Événements</span>
        <span className="readout text-[9px]">{events}</span>
      </div>
      <div className="mt-[2px] flex items-baseline justify-between">
        <span className="label">Victimes</span>
        <span className="readout text-[9px]" style={{ color: "#ff9a80" }}>
          {compact(fatalities)} †
        </span>
      </div>
      {best ? (
        <button
          type="button"
          className="chip mt-2 w-full"
          onClick={() => {
            void select(best);
            setCountry(null);
          }}
        >
          ouvrir le foyer principal
        </button>
      ) : null}
      <p className="mt-2 text-[8px] leading-relaxed text-text-faint">
        Rattachement indicatif des foyers à l&apos;emprise du pays — jamais une localisation tactique.
      </p>
    </div>
  );
}

/**
 * Bandeau de transparence : provenance des données, toujours visible, et
 * séparation explicite entre données réelles et démonstration.
 *
 * La nature de la donnée se lit aussi à la couleur sur le globe :
 * rouge/orange = source réelle, violet = jeu de démonstration.
 */
export function DataProvenanceBanner() {
  const stats = useIntelStore((s) => s.stats);
  const datasets = useIntelStore((s) => s.filters.datasets);
  const setDatasets = useIntelStore((s) => s.setDatasets);
  const dataset = stats?.dataset ?? "";
  const isDemo = dataset.includes("demo");
  const live = dataset.split(" + ").filter((d) => d && d !== "demo:seed" && d !== "demo");
  /** Démonstration masquée : ne restent que les sources réelles. */
  const realOnly = datasets.length > 0 && !datasets.includes("demo:seed");

  const label = realOnly
    ? live.length
      ? `sources réelles uniquement : ${live.map(prettyDataset).join(" + ")}`
      : "sources réelles uniquement"
    : isDemo
      ? live.length
        ? `jeu de démonstration + ${live.map(prettyDataset).join(" + ")} en direct`
        : "jeu de démonstration — données non sourcées"
      : live.length
        ? `sources actives : ${live.map(prettyDataset).join(" + ")}`
        : "aucune source active";

  return (
    <div className="pointer-events-none absolute left-1/2 top-[52px] z-20 flex -translate-x-1/2 flex-col items-center gap-[4px] select-none">
      <div
        className="flex items-center gap-2 border px-3 py-[3px] backdrop-blur-md"
        style={{
          borderColor: realOnly ? "rgba(127,212,255,0.3)" : isDemo ? "rgba(201,160,255,0.38)" : "rgba(127,212,255,0.2)",
          background: realOnly ? "rgba(3,12,22,0.84)" : isDemo ? "rgba(38,20,62,0.84)" : "rgba(4,13,24,0.8)",
        }}
      >
        <span className="dot" style={{ color: realOnly || !isDemo ? "#7fd4ff" : "#c9a0ff" }} />
        <span
          className="text-[8px] uppercase tracking-[0.24em]"
          style={{ color: realOnly ? "#a8cee6" : isDemo ? "#d9c2ff" : "#8fb4cc" }}
        >
          {label}
        </span>
        <span className="hairline w-8" />
        <span className="whitespace-nowrap text-[8px] uppercase tracking-[0.18em] text-text-faint">
          {stats ? `MAJ ${dateTimeUTC(stats.lastDataUpdate)}` : "—"}
        </span>
        <span className="hairline w-8" />
        <span className="pointer-events-auto flex items-center gap-[4px]">
          <button className="chip whitespace-nowrap" data-active={!realOnly} onClick={() => setDatasets([])}>
            tout
          </button>
          <button
            className="chip whitespace-nowrap"
            data-active={realOnly}
            onClick={() => setDatasets([...REAL_DATASETS])}
          >
            réel seulement
          </button>
        </span>
      </div>

      {/* Légende : la couleur du marqueur dit la nature de la donnée. */}
      <div className="flex items-center gap-4 border border-[rgba(127,212,255,0.1)] bg-[rgba(2,8,15,0.78)] px-3 py-[3px] text-[8px] uppercase tracking-[0.2em] text-text-faint backdrop-blur-md">
        <span className="flex items-center gap-[5px] whitespace-nowrap">
          <span className="dot" style={{ color: "#ff6b52" }} />
          données réelles
        </span>
        <span className="flex items-center gap-[5px] whitespace-nowrap">
          <span className="dot" style={{ color: "#b58cff" }} />
          démonstration — non sourcée
        </span>
      </div>
    </div>
  );
}

/** Libellés lisibles des jeux de données. */
function prettyDataset(key: string): string {
  switch (key) {
    case "gdelt":
      return "signaux presse";
    case "acled":
      return "ACLED";
    case "ucdp":
      return "UCDP";
    case "csv":
      return "imports";
    default:
      return key;
  }
}

/** Écran d'ouverture : disparaît au premier rendu de données. */
export function BootOverlay() {
  const stats = useIntelStore((s) => s.stats);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!stats) return;
    const id = setTimeout(() => setHidden(true), 340);
    return () => clearTimeout(id);
  }, [stats]);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center transition-opacity duration-700"
      style={{ opacity: hidden ? 0 : 1, background: "rgba(1,4,10,0.82)" }}
    >
      <div className="flex flex-col items-center gap-3">
        <span className="text-[13px] font-extralight tracking-[0.6em] text-ice">ORBITAL</span>
        <span className="label">initialisation du système de renseignement</span>
        <div className="h-[1px] w-40 overflow-hidden bg-[rgba(127,212,255,0.16)]">
          <div className="h-full w-1/3 bg-cyan" style={{ animation: "sweep 1.1s linear infinite" }} />
        </div>
      </div>
    </div>
  );
}
