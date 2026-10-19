"use client";

import { useEffect, useRef, useState } from "react";
import type { LayerId } from "@/types/layers";
import { absoluteDateTime, int } from "@/lib/format";
import { tr, type Locale } from "@/lib/i18n";
import { useIntelStore } from "@/store/useIntelStore";
import { LAYER_ORDER, LAYER_STYLE, layerSourceLine, type LayerGlyph } from "./layerModel";

/**
 * Sélecteur « Calques » du dock du globe : menu repliable, cases à cocher,
 * tous les calques éteints par défaut. Chaque calque dit sa source, la date de
 * sa donnée (ou que la source ne la publie pas), son nombre d'éléments et son
 * avertissement. Les données ne sont chargées qu'à l'allumage.
 */

export function LayerGlyphIcon({ glyph, color }: { glyph: LayerGlyph; color: string }) {
  if (glyph === "ring") return <span className="layer-glyph" data-glyph="ring" style={{ borderColor: color }} aria-hidden />;
  if (glyph === "square") return <span className="layer-glyph" data-glyph="square" style={{ background: color }} aria-hidden />;
  if (glyph === "line") return <span className="layer-glyph" data-glyph="line" style={{ background: color, boxShadow: `0 0 6px ${color}` }} aria-hidden />;
  return <span className="layer-glyph" data-glyph="tint" style={{ background: `${color}40`, borderColor: `${color}aa` }} aria-hidden />;
}

function LayerRow({ id, locale }: { id: LayerId; locale: Locale }) {
  const on = useIntelStore((s) => s.layersOn[id]);
  const load = useIntelStore((s) => s.layers[id]);
  const summary = useIntelStore((s) => s.layerCatalog.items.find((l) => l.layerId === id));
  const toggleLayer = useIntelStore((s) => s.toggleLayer);
  const ensureLayer = useIntelStore((s) => s.ensureLayer);
  const style = LAYER_STYLE[id];
  const data = load?.data ?? null;
  const meta = data ?? summary ?? null;
  const count = data ? data.features.length : (summary?.itemCount ?? null);
  const fmt = (iso: string) => absoluteDateTime(iso, locale);

  let state: { tone: "ok" | "warn" | "error" | "off"; text: string };
  if (load?.status === "loading") state = { tone: "warn", text: tr(locale, "Source en cours de chargement…", "Source loading…") };
  else if (load?.status === "error") state = { tone: "error", text: `${tr(locale, "Indisponible", "Unavailable")} : ${load.error}` };
  else if (meta?.status === "error") state = { tone: "error", text: `${tr(locale, "Source indisponible", "Source unavailable")}${meta.message ? ` : ${meta.message}` : ""}` };
  else if (meta?.status === "stale") state = { tone: "warn", text: meta.message ?? tr(locale, "Données anciennes (cache)", "Stale data (cache)") };
  else if (count !== null) state = { tone: on ? "ok" : "off", text: `${int(count)} ${id === "sanctions" ? tr(locale, "pays", "countries") : tr(locale, "éléments", "items")}` };
  else state = { tone: "off", text: tr(locale, "Chargé à l'allumage", "Loaded when switched on") };

  const failed = load?.status === "error" || meta?.status === "error";

  return (
    <li className="layer-row" data-on={on}>
      <label className="layer-toggle">
        <input type="checkbox" checked={on} onChange={() => toggleLayer(id)} />
        <LayerGlyphIcon glyph={style.glyph} color={style.color} />
        <span className="layer-name">{style.label[locale]}</span>
        <span className="layer-state" data-tone={state.tone}>
          {state.tone === "error" || state.tone === "warn" ? <span className="status-dot" data-tone={state.tone} /> : null}
          {state.tone === "error" ? tr(locale, "indisponible", "unavailable") : state.tone === "warn" && load?.status === "loading" ? tr(locale, "chargement…", "loading…") : state.text}
        </span>
      </label>
      <p className="meta layer-meta">
        {meta ? layerSourceLine(meta, locale, fmt) : tr(locale, "Source et date affichées après chargement.", "Source and date shown once loaded.")}
        {meta?.homepage ? (
          <>
            {" "}
            <a className="feed-link-inline" href={meta.homepage} target="_blank" rel="noopener noreferrer">
              {tr(locale, "Source ↗", "Source ↗")}
            </a>
          </>
        ) : null}
      </p>
      {on && (state.tone === "error" || state.tone === "warn") ? (
        <p className={state.tone === "error" ? "error-note mt-1" : "meta mt-1"}>
          {state.text}
          {failed ? (
            <button type="button" className="link-button ml-2" onClick={() => void ensureLayer(id, true)}>
              {tr(locale, "Réessayer", "Retry")}
            </button>
          ) : null}
        </p>
      ) : null}
      {on && id === "sanctions" && !failed ? <p className="meta mt-1">{tr(locale, "Teinte légère des pays concernés (pas une échelle de risque) ; nombre et programmes dans la fiche pays.", "Light tint of the countries concerned (not a risk scale); count and programs in the country profile.")}</p> : null}
      {on && (meta?.caveat || meta?.license) ? (
        <details className="layer-caveat">
          <summary>{tr(locale, "Avertissement et licence", "Caveat and license")}</summary>
          {meta.caveat ? <p className="feed-caveat mt-1">{meta.caveat}</p> : null}
          {meta.license ? (
            <p className="meta mt-1">
              {tr(locale, "Licence", "License")} : {meta.license}
            </p>
          ) : null}
        </details>
      ) : null}
    </li>
  );
}

export function LayersMenu() {
  const [open, setOpen] = useState(false);
  const locale = useIntelStore((s) => s.locale);
  const layersOn = useIntelStore((s) => s.layersOn);
  const catalogStatus = useIntelStore((s) => s.layerCatalog.status);
  const catalogError = useIntelStore((s) => s.layerCatalog.error);
  const loadLayerCatalog = useIntelStore((s) => s.loadLayerCatalog);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const active = LAYER_ORDER.filter((id) => layersOn[id]).length;

  // Catalogue (source, date, nombre d'éléments) demandé à chaque ouverture s'il manque :
  // dépendance volontaire à `open` seul, pour ne pas boucler sur un échec.
  useEffect(() => {
    if (open && (catalogStatus === "idle" || catalogStatus === "error")) void loadLayerCatalog();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="layers-menu">
      <button
        ref={buttonRef}
        type="button"
        className="dock-wide"
        aria-expanded={open}
        aria-controls="layers-popover"
        data-active={active > 0}
        onClick={() => setOpen((v) => !v)}
        title={tr(locale, "Calques de référence : centrales, bases, câbles, sanctions", "Reference layers: plants, bases, cables, sanctions")}
      >
        {tr(locale, "Calques", "Layers")}
        {active ? <span className="dock-count">{active}</span> : null}
      </button>
      {open ? (
        <div id="layers-popover" role="dialog" aria-label={tr(locale, "Calques de référence", "Reference layers")} className="panel corners layers-popover scroll-thin">
          <span className="corner" />
          <h3 className="section-title">{tr(locale, "Calques de référence", "Reference layers")}</h3>
          <p className="meta mt-0.5">{tr(locale, "Ce qui existe (installations, câbles, listes officielles) — pas des événements.", "What exists (facilities, cables, official lists) — not events.")}</p>
          {catalogStatus === "error" ? <p className="error-note mt-2">{tr(locale, "Catalogue des calques indisponible", "Layer catalog unavailable")} : {catalogError}</p> : null}
          <ul className="mt-2 space-y-2.5">
            {LAYER_ORDER.map((id) => (
              <LayerRow key={id} id={id} locale={locale} />
            ))}
          </ul>
          <p className="meta mt-2">{tr(locale, "Clic sur un élément du globe : détail sourcé.", "Click an item on the globe: sourced details.")}</p>
        </div>
      ) : null}
    </div>
  );
}
