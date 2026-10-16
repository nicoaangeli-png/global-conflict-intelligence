"use client";

import { useEffect, useRef, useState } from "react";
import { coords, compact, dateTimeUTC, relative } from "@/lib/format";
import { useIntelStore } from "@/store/useIntelStore";
import { REAL_DATASETS } from "@/types/conflict";
import { getCountryGeopolitics } from "@/data/geopolitics";
import { t } from "@/lib/i18n";

/**
 * Surcouches HUD : équerres de cadre, réticule de survol, fiche pays géopolitique,
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
  const locale = useIntelStore((s) => s.locale);

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
        <span className="label">{locale === "fr" ? "Rendu" : "Render"}</span>
        <span className="readout text-[9px]">
          {fps} fps · {clusters.length} {locale === "fr" ? "foyers" : "clusters"} · {degrees.toFixed(1)}°
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="label">{locale === "fr" ? "Fenêtre" : "Window"}</span>
        <span className="readout text-[9px]">
          {stats?.range ?? "—"} {at ? `· archive ${at.slice(0, 10)}` : locale === "fr" ? "· temps réel" : "· real-time"}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="label">{locale === "fr" ? "Dépôt" : "Store"}</span>
        <span className="readout text-[9px]">{stats?.dataset ?? "—"}</span>
      </div>
    </div>
  );
}

/** Réticule d'identification : suit le curseur sur un foyer. */
export function HoverReadout() {
  const hoveredId = useIntelStore((s) => s.hoveredId);
  const clusters = useIntelStore((s) => s.clusters);
  const locale = useIntelStore((s) => s.locale);
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
        <span className="readout text-[9px]">{cluster.eventCount} {locale === "fr" ? "év." : "ev."}</span>
      </div>
      <div className="mt-[2px] text-[9px] uppercase tracking-[0.18em] text-text-faint">{cluster.country}</div>
      <div className="hairline my-[6px]" />
      <div className="flex items-baseline justify-between">
        <span className="label">{locale === "fr" ? "Type dominant" : "Dominant type"}</span>
        <span className="readout text-[9px]">{cluster.topType}</span>
      </div>
      <div className="mt-[2px] flex items-baseline justify-between">
        <span className="label">{locale === "fr" ? "Victimes" : "Casualties"}</span>
        <span className="readout text-[9px]" style={{ color: "#ff9a80" }}>
          {compact(cluster.fatalities)} †
        </span>
      </div>
      <div className="mt-[2px] flex items-baseline justify-between">
        <span className="label">{locale === "fr" ? "Dernier" : "Latest"}</span>
        <span className="readout text-[9px]">{relative(cluster.lastEventAt)}</span>
      </div>
      <div className="mt-[2px] flex items-baseline justify-between">
        <span className="label">{locale === "fr" ? "Position" : "Coords"}</span>
        <span className="readout text-[9px]">{coords(cluster.latitude, cluster.longitude)}</span>
      </div>
      <div className="hairline my-[6px]" />
      <div className="flex items-center justify-between">
        <span className="text-[8px] uppercase tracking-[0.18em] text-text-faint">
          {cluster.confidence === "MEDIA_SIGNAL" ? (locale === "fr" ? "signal presse" : "media signal") : cluster.confidence.toLowerCase()}
        </span>
        <span className="text-[8px] uppercase tracking-[0.18em] text-cyan-dim">
          {locale === "fr" ? "clic → détail" : "click → details"}
        </span>
      </div>
    </div>
  );
}

/** Fiche géopolitique du pays pointé (lancer de rayon sur la sphère). */
export function CountryCard() {
  const country = useIntelStore((s) => s.country);
  const clusters = useIntelStore((s) => s.clusters);
  const setCountry = useIntelStore((s) => s.setCountry);
  const select = useIntelStore((s) => s.select);
  const setReconTarget = useIntelStore((s) => s.setReconTarget);
  const locale = useIntelStore((s) => s.locale);

  if (!country) return null;

  const dict = t(locale);
  const geo = getCountryGeopolitics(country.name);
  const local = clusters.filter((c) => c.country === country.name);
  const events = local.reduce((a, c) => a + c.eventCount, 0);
  const fatalities = local.reduce((a, c) => a + c.fatalities, 0);
  const best = local.slice().sort((a, b) => b.intensity - a.intensity)[0];

  return (
    <div className="panel corners boot pointer-events-auto absolute left-1/2 top-[86px] z-20 w-[290px] -translate-x-1/2 px-3.5 py-3 shadow-[0_0_40px_rgba(0,180,255,0.12)]">
      <span className="corner" />
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[13px] font-extralight tracking-[0.2em] text-ice">{country.name.toUpperCase()}</div>
          <div className="mt-[2px] readout text-[9px]">
            {coords(country.lat, country.lon)} · {country.iso || geo.iso}
          </div>
        </div>
        <button type="button" className="chip" style={{ padding: "2px 6px" }} onClick={() => setCountry(null)}>
          esc
        </button>
      </div>

      {/* Régime politique avec badge distinctif */}
      <div className="mt-2.5 border border-cyan/20 bg-cyan/5 p-2">
        <div className="text-[8px] uppercase tracking-wider text-cyan">{dict.countryCard.regime}</div>
        <div className="mt-0.5 text-[10px] font-mono font-medium text-ice leading-tight">
          {locale === "fr" ? geo.regime.labelFr : geo.regime.labelEn}
        </div>
        <div className="mt-1 flex items-baseline justify-between text-[8px] text-text-faint">
          <span>{dict.geopolitics.headOfState} :</span>
          <span className="text-text truncate max-w-[150px]">{geo.regime.leader}</span>
        </div>
      </div>

      {/* Indicateurs économiques */}
      <div className="mt-2 grid grid-cols-2 gap-2 text-[9px] border-b border-[rgba(127,212,255,0.1)] pb-2">
        <div>
          <span className="label block text-[8px]">{dict.geopolitics.gdp}</span>
          <span className="readout text-[10px] text-ice">{geo.economy.gdpNominal}</span>
        </div>
        <div>
          <span className="label block text-[8px]">{dict.geopolitics.inflation}</span>
          <span className="readout text-[10px] text-alert-soft">{geo.economy.inflation}</span>
        </div>
      </div>

      {/* Métriques de conflit */}
      <div className="mt-2 space-y-1">
        <div className="flex items-baseline justify-between">
          <span className="label">{dict.countryCard.associatedHotspots}</span>
          <span className="readout text-[9px]">{local.length}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="label">{dict.countryCard.eventsCount}</span>
          <span className="readout text-[9px]">{events}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="label">{dict.countryCard.fatalitiesCount}</span>
          <span className="readout text-[9px]" style={{ color: "#ff9a80" }}>
            {compact(fatalities)} †
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        {best ? (
          <button
            type="button"
            className="chip w-full text-center py-1 text-[9px]"
            onClick={() => {
              void select(best);
              setCountry(null);
            }}
          >
            🎯 {dict.countryCard.openMainCluster} ({best.locality || best.country})
          </button>
        ) : null}

        <button
          type="button"
          className="chip w-full text-center py-1 text-[9px] border-cyan/40 bg-cyan/10 text-cyan hover:bg-cyan/20"
          onClick={() => {
            setReconTarget({
              locality: country.name,
              country: country.name,
              lat: country.lat,
              lon: country.lon,
            });
            setCountry(null);
          }}
        >
          🛰️ {dict.countryCard.reconAction} & STREET VIEW
        </button>
      </div>

      <p className="mt-2 text-[8px] leading-relaxed text-text-faint">
        {dict.countryCard.disclaimer}
      </p>
    </div>
  );
}

/**
 * Bandeau de transparence : provenance du renseignement mondial opérationnel.
 */
export function DataProvenanceBanner() {
  const stats = useIntelStore((s) => s.stats);
  const locale = useIntelStore((s) => s.locale);
  const dataset = stats?.dataset ?? "";
  const live = dataset.split(" + ").filter(Boolean);

  const label = live.length
    ? `${locale === "fr" ? "renseignement opérationnel vérifié" : "verified operational intelligence"} : ${live.map(prettyDataset).join(" · ")}`
    : locale === "fr" ? "flux de renseignement mondial actif" : "global active intelligence feed";

  return (
    <div className="pointer-events-none absolute left-1/2 top-[52px] z-20 flex -translate-x-1/2 flex-col items-center gap-[4px] select-none">
      <div
        className="flex items-center gap-2 border px-3 py-[3px] backdrop-blur-md"
        style={{
          borderColor: "rgba(127,212,255,0.34)",
          background: "rgba(3,12,22,0.88)",
        }}
      >
        <span className="dot" style={{ color: "#7fd4ff" }} />
        <span
          className="text-[8px] uppercase tracking-[0.24em] font-mono"
          style={{ color: "#a8cee6" }}
        >
          {label}
        </span>
        <span className="hairline w-8" />
        <span className="whitespace-nowrap text-[8px] uppercase tracking-[0.18em] text-text-faint font-mono">
          {stats ? `${locale === "fr" ? "SYNC" : "UPD"} ${dateTimeUTC(stats.lastDataUpdate)}` : "—"}
        </span>
      </div>

      {/* Légende : signalétique opérationnelle */}
      <div className="flex items-center gap-4 border border-[rgba(127,212,255,0.1)] bg-[rgba(2,8,15,0.78)] px-3 py-[3px] text-[8px] uppercase tracking-[0.2em] text-text-faint backdrop-blur-md">
        <span className="flex items-center gap-[5px] whitespace-nowrap">
          <span className="dot" style={{ color: "#ff2a1b" }} />
          {locale === "fr" ? "conflits armés & frappes (acled / ucdp)" : "armed conflicts & strikes (acled / ucdp)"}
        </span>
        <span className="flex items-center gap-[5px] whitespace-nowrap">
          <span className="dot" style={{ color: "#ff8a3d" }} />
          {locale === "fr" ? "alertes en direct (gdelt 2.0)" : "live dispatches (gdelt 2.0)"}
        </span>
      </div>
    </div>
  );
}

/** Libellés lisibles des jeux de données. */
function prettyDataset(key: string): string {
  switch (key) {
    case "gdelt":
      return "GDELT 2.0";
    case "acled":
      return "ACLED";
    case "ucdp":
      return "UCDP GED";
    case "csv":
      return "imports CSV";
    default:
      return key.toUpperCase();
  }
}

/** Écran d'ouverture : disparaît au premier rendu de données. */
export function BootOverlay() {
  const stats = useIntelStore((s) => s.stats);
  const locale = useIntelStore((s) => s.locale);
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
        <span className="label">
          {locale === "fr" ? "initialisation du système de renseignement" : "initializing intelligence system"}
        </span>
        <div className="h-[1px] w-40 overflow-hidden bg-[rgba(127,212,255,0.16)]">
          <div className="h-full w-1/3 bg-cyan" style={{ animation: "sweep 1.1s linear infinite" }} />
        </div>
      </div>
    </div>
  );
}
