"use client";

import type { LayerFeature, LayerId } from "@/types/layers";
import { absoluteDateTime, coords } from "@/lib/format";
import { tr, type Locale } from "@/lib/i18n";
import { useIntelStore } from "@/store/useIntelStore";
import { countryLabel, useCountryReference } from "@/components/feeds/countryReference";
import { LAYER_STYLE, featurePoint, layerSourceLine, lineParts, propertyRows } from "./layerModel";
import { LayerGlyphIcon } from "./LayersMenu";

/**
 * Détail sourcé d'un élément de calque de référence (inspecteur de droite) :
 * nom, pays, attributs bruts de la source, source / date / licence / avertissement,
 * lien vers la fiche de l'élément chez la source.
 */
export function LayerFeatureDetail({ layerId, feature, locale }: { layerId: LayerId; feature: LayerFeature; locale: Locale }) {
  const selectLayerFeature = useIntelStore((s) => s.selectLayerFeature);
  const setCountry = useIntelStore((s) => s.setCountry);
  const focus = useIntelStore((s) => s.focus);
  const meta = useIntelStore((s) => s.layers[layerId]?.data ?? null);
  const { ref } = useCountryReference();
  const style = LAYER_STYLE[layerId];
  const point = featurePoint(feature);
  const parts = lineParts(feature);
  const rows = propertyRows(feature, locale);

  return (
    <section className="panel corners boot inspector" aria-label={tr(locale, "Détail de l'élément de calque", "Layer item details")}>
      <span className="corner" />
      <header className="inspector-head">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="category-tag" style={{ color: style.color }}>
            <LayerGlyphIcon glyph={style.glyph} color={style.color} />
            {style.label[locale]}
          </span>
          <span className="nature-badge">{tr(locale, "Référence — pas un événement", "Reference — not an event")}</span>
        </div>
        <button type="button" className="chip" onClick={() => selectLayerFeature(null)} aria-label={tr(locale, "Fermer le détail", "Close details")}>
          ✕
        </button>
      </header>
      <div className="inspector-body scroll-thin">
        <h2 className="break-words text-[15px] font-light leading-snug text-[#eaf6ff]">{feature.name}</h2>
        <dl className="kv mt-3">
          {rows.map((row) => (
            <div key={row.key} className="contents">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
          {point ? (
            <>
              <dt>{tr(locale, "Position", "Position")}</dt>
              <dd>{coords(point.lat, point.lon)}</dd>
            </>
          ) : null}
          {parts.length ? (
            <>
              <dt>{tr(locale, "Tracé", "Route")}</dt>
              <dd>
                {parts.length} {tr(locale, parts.length > 1 ? "tronçons" : "tronçon", parts.length > 1 ? "segments" : "segment")} · {parts.reduce((n, p) => n + p.length, 0)} {tr(locale, "points publiés", "published points")}
              </dd>
            </>
          ) : null}
          <dt>{tr(locale, "Identifiant source", "Source ID")}</dt>
          <dd>{feature.id.split(":").slice(1).join(":") || feature.id}</dd>
        </dl>
        <div className="mt-3">
          <div className="section-title">{tr(locale, "Pays", "Countries")}</div>
          {feature.countries.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {feature.countries.map((code) => {
                const entry = ref?.get(code);
                return (
                  <button
                    key={code}
                    type="button"
                    className="chip"
                    disabled={!entry?.center}
                    onClick={() => {
                      if (!entry?.center) return;
                      setCountry({ name: entry.name, iso: code, lat: entry.center.lat, lon: entry.center.lon, source: "explorer" });
                      focus(entry.center.lat, entry.center.lon);
                    }}
                  >
                    {countryLabel(code, ref, locale)}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="empty-line mt-1">{tr(locale, "La source ne rattache cet élément à aucun pays.", "The source links this item to no country.")}</p>
          )}
        </div>
        {meta ? (
          <div className="mt-3">
            <div className="section-title">{tr(locale, "Source", "Source")}</div>
            <p className="meta mt-1">{layerSourceLine(meta, locale, (iso) => absoluteDateTime(iso, locale))}</p>
            {meta.license ? (
              <p className="meta">
                {tr(locale, "Licence", "License")} : {meta.license}
              </p>
            ) : null}
            {meta.caveat ? <p className="feed-caveat mt-1">{meta.caveat}</p> : null}
          </div>
        ) : null}
        {feature.url ? (
          <a className="action-button mt-4" href={feature.url} target="_blank" rel="noopener noreferrer">
            {tr(locale, "Fiche à la source ↗", "Open at the source ↗")}
          </a>
        ) : (
          <p className="meta mt-4">{tr(locale, "La source ne fournit pas de lien direct.", "The source provides no direct link.")}</p>
        )}
      </div>
    </section>
  );
}
