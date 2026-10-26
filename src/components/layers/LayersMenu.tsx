"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { LayerId } from "@/types/layers";
import { absoluteDateTime, int } from "@/lib/format";
import { tr, type Locale } from "@/lib/i18n";
import { useIntelStore } from "@/store/useIntelStore";
import { LAYER_ORDER, LAYER_STYLE, layerSourceLine, type LayerGlyph } from "./layerModel";
import { sourceVehicleKind, vehicleOf, type VehicleKind } from "@/components/feeds/vehicleModel";
import { sourceStatusLabel } from "@/components/feeds/feedModel";
import { VEHICLE_COLORS } from "@/components/globe/MobileLayer";
import { CoverageLine } from "@/components/coverage/CoverageLine";
import { useSensorCoverage } from "@/components/coverage/useSensorCoverage";

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

/** Symbole d'un mobile (chevron d'aéronef, coque de navire), comme sur le globe. */
export function MobileGlyph({ kind }: { kind: VehicleKind }) {
  return <span className="mobile-glyph" data-kind={kind} style={{ background: VEHICLE_COLORS[kind] }} aria-hidden />;
}

const MOBILE_LABELS: Record<VehicleKind, { fr: string; en: string }> = {
  aircraft: { fr: "Avions militaires", en: "Military aircraft" },
  vessel: { fr: "Navires militaires", en: "Military vessels" },
  merchant: { fr: "Trafic des détroits (navires civils)", en: "Strait traffic (civilian vessels)" },
};

/** Mobiles en direct (allumés par défaut) : nombre réel, source, avertissement. */
function MobileRow({ kind, locale }: { kind: VehicleKind; locale: Locale }) {
  const on = useIntelStore((s) => s.mobilesOn[kind]);
  const toggleMobile = useIntelStore((s) => s.toggleMobile);
  const feeds = useIntelStore((s) => s.feeds);
  const feedsStatus = useIntelStore((s) => s.feedsStatus);
  const sources = useIntelStore((s) => s.feedSources);
  const mine = feeds.filter((item) => vehicleOf(item) === kind);
  const tracked = mine.filter((item) => (item.track?.length ?? 0) > 0).length;
  const sourceNames = [...new Set(mine.map((item) => item.sourceName))];
  // Sources de ce type de mobile déclarées par le serveur (opérationnelles ou non).
  const kindSources = sources.filter((src) =>
    kind === "merchant" ? src.category === "shipping" : src.category === "military" && sourceVehicleKind(src.sourceId) === kind,
  );
  const failing = kindSources.filter((src) => src.status !== "ok");
  const caveat = mine.find((item) => item.caveat)?.caveat ?? null;
  // Couverture mondiale du capteur : avions → ADS-B, navires militaires → AIS.
  const sensor = kind === "aircraft" ? "adsb" : kind === "vessel" ? "ais" : null;
  const coverage = useSensorCoverage(null, sensor !== null);
  const refresh = kind === "aircraft" ? tr(locale, "positions rafraîchies toutes les 30 s", "positions refreshed every 30 s") : tr(locale, "flux AIS continu", "continuous AIS stream");
  const state = mine.length
    ? `${int(mine.length)} ${tr(locale, "en direct", "live")}`
    : feedsStatus === "loading" || feedsStatus === "idle"
      ? tr(locale, "chargement…", "loading…")
      : tr(locale, "aucun reçu", "none received");
  return (
    <li className="layer-row" data-on={on}>
      <label className="layer-toggle">
        <input type="checkbox" checked={on} onChange={() => toggleMobile(kind)} />
        <MobileGlyph kind={kind} />
        <span className="layer-name">{MOBILE_LABELS[kind][locale]}</span>
        <span className="layer-state" data-tone={mine.length ? "ok" : "off"}>
          {state}
        </span>
      </label>
      <p className="meta layer-meta">
        {mine.length
          ? `${sourceNames.join(", ")} · ${refresh} · ${
              tracked ? tr(locale, `${tracked} trajet(s) observé(s)`, `${tracked} observed track(s)`) : tr(locale, "trajets pas encore publiés par la source", "tracks not yet published by the source")
            }`
          : kindSources.length
            ? `${kindSources.map((src) => src.sourceName).join(", ")} · ${tr(locale, "aucune position reçue pour l'instant", "no position received yet")}`
            : tr(locale, "Source en cours de branchement : rien à afficher pour l'instant.", "Source being connected: nothing to show yet.")}
      </p>
      {sensor ? <CoverageLine sensor={sensor} coverage={coverage.data?.[sensor] ?? null} loading={coverage.status === "loading"} locale={locale} /> : null}
      {failing.map((src) => (
        <p key={src.sourceId} className={src.status === "not_configured" ? "meta layer-meta" : "error-note mt-1"}>
          {src.sourceName} : {sourceStatusLabel(src, locale)}
          {src.message ? ` — ${src.message}` : ""}
        </p>
      ))}
      {on && caveat ? (
        <details className="layer-caveat">
          <summary>{tr(locale, "Avertissement", "Caveat")}</summary>
          <p className="feed-caveat mt-1">{caveat}</p>
        </details>
      ) : null}
    </li>
  );
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

export function LayersMenu({ embedded = false }: { embedded?: boolean }) {
  const [open, setOpen] = useState(embedded);
  const popoverId = useId();
  const locale = useIntelStore((s) => s.locale);
  const layersOn = useIntelStore((s) => s.layersOn);
  const catalogStatus = useIntelStore((s) => s.layerCatalog.status);
  const catalogError = useIntelStore((s) => s.layerCatalog.error);
  const loadLayerCatalog = useIntelStore((s) => s.loadLayerCatalog);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const mobilesOn = useIntelStore((s) => s.mobilesOn);
  const camerasOn = useIntelStore((s) => s.camerasOn);
  const toggleCameras = useIntelStore((s) => s.toggleCameras);
  const loadCameras = useIntelStore((s) => s.loadCameras);
  const camerasStatus = useIntelStore((s) => s.camerasStatus);
  const camerasMessage = useIntelStore((s) => s.camerasMessage);
  const camerasCount = useIntelStore((s) => s.cameras.length);
  const camerasTotal = useIntelStore((s) => s.camerasTotal);
  const active = LAYER_ORDER.filter((id) => layersOn[id]).length + Number(mobilesOn.aircraft) + Number(mobilesOn.vessel) + Number(mobilesOn.merchant) + Number(camerasOn);

  // Catalogue (source, date, nombre d'éléments) demandé à chaque ouverture s'il manque :
  // dépendance volontaire à `open` seul, pour ne pas boucler sur un échec.
  useEffect(() => {
    if (open && (catalogStatus === "idle" || catalogStatus === "error")) void loadLayerCatalog();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || embedded) return;
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
  }, [open, embedded]);

  return (
    <div ref={rootRef} className={embedded ? "layers-menu layers-embedded" : "layers-menu"}>
      {!embedded && <button
        ref={buttonRef}
        type="button"
        className="dock-wide"
        aria-expanded={open}
        aria-controls={popoverId}
        data-active={active > 0}
        onClick={() => setOpen((v) => !v)}
        title={tr(locale, "Calques : avions et navires militaires en direct ; centrales, bases, câbles, sanctions", "Layers: live military aircraft and vessels; plants, bases, cables, sanctions")}
      >
        {tr(locale, "Calques", "Layers")}
        {active ? <span className="dock-count">{active}</span> : null}
      </button>}
      {open ? (
        <div id={popoverId} role={embedded ? undefined : "dialog"} aria-label={tr(locale, "Calques", "Layers")} className={embedded ? "layers-content" : "panel corners layers-popover scroll-thin"}>
          <span className="corner" />
          <h3 className="section-title">{tr(locale, "En direct", "Live")}</h3>
          <p className="meta mt-0.5">{tr(locale, "Positions publiées et trajets observés, sur tous les thèmes.", "Published positions and observed tracks, on every theme.")}</p>
          <ul className="mt-2 space-y-2.5">
            <MobileRow kind="aircraft" locale={locale} />
            <MobileRow kind="vessel" locale={locale} />
            <MobileRow kind="merchant" locale={locale} />
          </ul>
          <h3 className="section-title mt-3 border-t border-[rgba(127,212,255,0.12)] pt-3">{tr(locale, "Caméras publiques", "Public cameras")}</h3>
          <ul className="mt-2"><li className="layer-row" data-on={camerasOn}>
            <label className="layer-toggle"><input type="checkbox" checked={camerasOn} onChange={toggleCameras} /><span className="layer-glyph" data-glyph="square" style={{ background: "#8be8ff" }} aria-hidden /><span className="layer-name">CAMÉRAS</span><span className="layer-state" data-tone={camerasStatus === "error" ? "error" : camerasStatus === "stale" ? "warn" : camerasOn ? "ok" : "off"}>{camerasStatus === "loading" ? tr(locale, "chargement…", "loading…") : camerasOn ? `${int(camerasCount)} / ${int(camerasTotal)}` : tr(locale, "désactivé", "off")}</span></label>
            <p className="meta layer-meta">Fintraffic / Digitraffic · Finlande · {tr(locale, "images périodiques ~10 min, pas de vidéo directe", "periodic images ~10 min, no live video")} · CC BY 4.0</p>
            {camerasOn && camerasMessage ? <p className={camerasStatus === "error" ? "error-note mt-1" : "meta mt-1"}>{camerasMessage} <button type="button" className="link-button ml-2" onClick={() => void loadCameras(true)}>{tr(locale, "Réessayer", "Retry")}</button></p> : null}
          </li></ul>
          <h3 className="section-title mt-3 border-t border-[rgba(127,212,255,0.12)] pt-3">{tr(locale, "Calques de référence", "Reference layers")}</h3>
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
