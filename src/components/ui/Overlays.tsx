"use client";

import { useEffect, useState } from "react";
import { relativeTime } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { useIntelStore } from "@/store/useIntelStore";
import { clusterSummary } from "@/components/feeds/conflictModel";
import { NATURE_LABELS, THEME_COLORS, THEME_LABELS, label } from "@/components/feeds/feedModel";
import { countryLabel, useCountryReference } from "@/components/feeds/countryReference";
import { LAYER_STYLE } from "@/components/layers/layerModel";
import { formatDuration, trackDurationMs, vehicleOf } from "@/components/feeds/vehicleModel";
import { VEHICLE_LABELS } from "@/components/feeds/FeedItem";
import { LayerGlyphIcon } from "@/components/layers/LayersMenu";

/**
 * Surcouches HUD : équerres de cadre, info-bulles de survol (zone de conflit,
 * élément de flux, pays) et écran d'ouverture. Alimentées par l'état réel.
 */

export function FrameCorners() {
  return (
    <div className="pointer-events-none absolute inset-3 z-10 select-none" aria-hidden>
      {(
        [
          ["top-0 left-0", "border-t border-l"],
          ["top-0 right-0", "border-t border-r"],
          ["bottom-0 left-0", "border-b border-l"],
          ["bottom-0 right-0", "border-b border-r"],
        ] as const
      ).map(([pos, edges]) => (
        <span key={pos} className={`absolute ${pos} ${edges} h-4 w-4`} style={{ borderColor: "rgba(127,212,255,0.34)" }} />
      ))}
    </div>
  );
}

function usePointer() {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const onMove = (e: PointerEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);
  return pos;
}

function Tip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  const left = Math.min(x + 16, window.innerWidth - 300);
  const top = Math.min(y + 14, window.innerHeight - 140);
  return (
    <div className="panel hover-tip pointer-events-none absolute z-40" style={{ left, top }}>
      {children}
    </div>
  );
}

/** Info-bulle au survol d'une zone de conflit : natures séparées, jamais de bilan pour la presse. */
export function HoverReadout() {
  const hoveredId = useIntelStore((s) => s.hoveredId);
  const clusters = useIntelStore((s) => s.clusters);
  const locale = useIntelStore((s) => s.locale);
  const pos = usePointer();
  const cluster = hoveredId ? clusters.find((c) => c.id === hoveredId) ?? null : null;
  if (!cluster) return null;
  return (
    <Tip x={pos.x} y={pos.y}>
      <div className="flex items-center gap-2">
        <span className="category-dot" style={{ background: THEME_COLORS.conflict }} />
        <span className="break-words text-[13px] text-[#eaf6ff]">{cluster.locality || cluster.region || cluster.country}</span>
      </div>
      <p className="mt-1 text-[12px] text-[#cfe6f5]">{clusterSummary(cluster, locale)}</p>
      <p className="meta mt-1">
        {cluster.country ? `${cluster.country} · ` : ""}
        {tr(locale, "dernier", "latest")} {relativeTime(cluster.lastEventAt, locale)} · {tr(locale, "clic → détail", "click → details")}
      </p>
    </Tip>
  );
}

/** Info-bulle au survol d'un point de flux sur le globe (ou d'une ligne du fil). */
export function HoverFeedReadout() {
  const hoveredFeedId = useIntelStore((s) => s.hoveredFeedId);
  const feeds = useIntelStore((s) => s.feeds);
  const locale = useIntelStore((s) => s.locale);
  const pos = usePointer();
  const item = hoveredFeedId ? feeds.find((f) => f.id === hoveredFeedId) ?? null : null;
  // Survol d'une ligne du fil : le pointeur est sur le panneau, pas d'info-bulle doublon.
  if (!item || pos.x < 420) return null;
  return (
    <Tip x={pos.x} y={pos.y}>
      <div className="flex items-center gap-2">
        <span className="category-dot" style={{ background: THEME_COLORS[item.category] }} />
        <span className="meta">
          {label(THEME_LABELS[item.category], locale)} · {vehicleOf(item) ? label(VEHICLE_LABELS[vehicleOf(item)!], locale) : label(NATURE_LABELS[item.nature], locale)}
        </span>
      </div>
      <p className="mt-1 line-clamp-3 text-[13px] leading-snug text-[#eaf6ff]">{item.title}</p>
      {item.summary && vehicleOf(item) ? <p className="meta mt-0.5">{item.summary}</p> : null}
      <p className="meta mt-1">
        {item.sourceName} · {relativeTime(item.occurredAt ?? item.publishedAt, locale)}
        {vehicleOf(item) && trackDurationMs(item) !== null ? ` · ${tr(locale, "trajet observé", "observed track")} ${formatDuration(trackDurationMs(item)!, locale)}` : ""} ·{" "}
        {tr(locale, "clic → détail", "click → details")}
      </p>
    </Tip>
  );
}

/** Info-bulle au survol d'un élément de calque de référence (installation, câble). */
export function HoverLayerReadout() {
  const hovered = useIntelStore((s) => s.hoveredLayerFeature);
  const meta = useIntelStore((s) => (hovered ? (s.layers[hovered.layerId]?.data ?? null) : null));
  const locale = useIntelStore((s) => s.locale);
  const { ref } = useCountryReference();
  const pos = usePointer();
  if (!hovered || pos.x < 420) return null;
  const style = LAYER_STYLE[hovered.layerId];
  const countries = hovered.feature.countries.slice(0, 3).map((iso) => countryLabel(iso, ref, locale));
  return (
    <Tip x={pos.x} y={pos.y}>
      <div className="flex items-center gap-2">
        <LayerGlyphIcon glyph={style.glyph} color={style.color} />
        <span className="meta">{style.label[locale]}</span>
      </div>
      <p className="mt-1 break-words text-[13px] leading-snug text-[#eaf6ff]">{hovered.feature.name}</p>
      <p className="meta mt-1">
        {countries.length ? `${countries.join(", ")} · ` : ""}
        {meta?.sourceName ?? ""} · {tr(locale, "clic → détail", "click → details")}
      </p>
    </Tip>
  );
}

/** Badge discret au survol d'un pays (bas du globe, ne masque aucun panneau). */
export function HoverCountryBadge() {
  const hoveredCountry = useIntelStore((s) => s.hoveredCountry);
  const country = useIntelStore((s) => s.country);
  const locale = useIntelStore((s) => s.locale);
  const { ref } = useCountryReference();
  if (!hoveredCountry || country?.iso === hoveredCountry.iso) return null;
  const name = hoveredCountry.iso ? countryLabel(hoveredCountry.iso, ref, locale) : hoveredCountry.name;
  return (
    <div className="hover-country pointer-events-none absolute z-20">
      <span className="status-dot" data-tone="ok" />
      <span className="text-[13px] text-[#eaf6ff]">{name}</span>
      <span className="meta">{tr(locale, "clic → fiche pays", "click → country profile")}</span>
    </div>
  );
}

/** Écran d'ouverture : disparaît au premier rendu de données. */
export function BootOverlay() {
  const stats = useIntelStore((s) => s.stats);
  const error = useIntelStore((s) => s.error);
  const locale = useIntelStore((s) => s.locale);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!stats && !error) return;
    const id = setTimeout(() => setHidden(true), 340);
    return () => clearTimeout(id);
  }, [stats, error]);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center transition-opacity duration-700"
      style={{ opacity: hidden ? 0 : 1, background: "rgba(1,4,10,0.82)" }}
      aria-hidden={hidden}
    >
      <div className="flex flex-col items-center gap-3">
        <span className="brand text-[15px]">ORBITAL</span>
        <span className="meta">{tr(locale, "connexion aux sources…", "connecting to sources…")}</span>
      </div>
    </div>
  );
}
