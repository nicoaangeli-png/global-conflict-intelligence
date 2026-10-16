"use client";

import React, { useState } from "react";
import { useIntelStore } from "@/store/useIntelStore";
import { getCountryGeopolitics } from "@/data/geopolitics";
import { coords } from "@/lib/format";
import { t } from "@/lib/i18n";

export function TacticalReconModal() {
  const reconTarget = useIntelStore((s) => s.reconTarget);
  const setReconTarget = useIntelStore((s) => s.setReconTarget);
  const locale = useIntelStore((s) => s.locale);
  const selected = useIntelStore((s) => s.selected);
  const [tab, setTab] = useState<"satellite" | "street" | "intel">("satellite");

  if (!reconTarget) return null;

  const dict = t(locale);
  const geo = getCountryGeopolitics(reconTarget.country);
  const lat = reconTarget.lat;
  const lon = reconTarget.lon;

  // URLs pour intégrations cartographiques
  const esriSatelliteUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lon - 0.08}%2C${lat - 0.05}%2C${lon + 0.08}%2C${lat + 0.05}&layer=mapnik&marker=${lat}%2C${lon}`;
  const googleMapsSatelliteEmbed = `https://maps.google.com/maps?q=${lat},${lon}&t=k&z=14&ie=UTF8&iwloc=&output=embed`;
  const googleStreetViewEmbed = `https://maps.google.com/maps?q=${lat},${lon}&layer=c&cbll=${lat},${lon}&cbp=12,0,0,0,0&output=svembed`;

  const externalGoogleMaps = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
  const externalGoogleEarth = `https://earth.google.com/web/@${lat},${lon},500a,35d,35y,0h,45t,0r`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
      <div className="panel corners relative flex h-[88vh] w-[95vw] max-w-[1240px] flex-col overflow-hidden border border-cyan/40 bg-[#020712]/95 shadow-[0_0_60px_rgba(0,180,255,0.18)]">
        <span className="corner" />
        
        {/* En-tête HUD Tactique */}
        <div className="flex flex-wrap items-center justify-between border-b border-[rgba(127,212,255,0.16)] px-5 py-3.5 bg-[#030d1c]/80">
          <div className="flex items-center gap-4">
            <span className="inline-block h-2 w-2 animate-ping rounded-full bg-alert" />
            <div>
              <div className="flex items-baseline gap-2">
                <span className="label-strong text-ice tracking-[0.2em]">{dict.recon.title}</span>
                <span className="readout text-[10px] text-cyan">
                  // {reconTarget.locality || reconTarget.country}
                </span>
              </div>
              <div className="mt-0.5 readout text-[9px] text-text-faint">
                {dict.recon.coordinates} : {coords(lat, lon)} · {reconTarget.country.toUpperCase()}
              </div>
            </div>
          </div>

          {/* Onglets de vue tactique */}
          <div className="flex items-center gap-1.5 bg-[#041427] p-1 border border-cyan/20">
            <button
              type="button"
              className={`chip text-[10px] px-3 py-1 ${tab === "satellite" ? "bg-cyan/20 text-ice border-cyan" : "text-text-dim"}`}
              onClick={() => setTab("satellite")}
            >
              🛰️ {dict.recon.satelliteTab}
            </button>
            <button
              type="button"
              className={`chip text-[10px] px-3 py-1 ${tab === "street" ? "bg-cyan/20 text-ice border-cyan" : "text-text-dim"}`}
              onClick={() => setTab("street")}
            >
              👁️ {dict.recon.streetViewTab}
            </button>
            <button
              type="button"
              className={`chip text-[10px] px-3 py-1 ${tab === "intel" ? "bg-cyan/20 text-ice border-cyan" : "text-text-dim"}`}
              onClick={() => setTab("intel")}
            >
              📊 {dict.geopolitics.regimeType} & DOSSIER
            </button>
          </div>

          <button
            type="button"
            className="chip hover:border-alert hover:text-alert px-3 py-1"
            onClick={() => setReconTarget(null)}
          >
            ✕ {dict.recon.close}
          </button>
        </div>

        {/* Contenu principal */}
        <div className="flex flex-1 flex-col md:flex-row overflow-hidden">
          
          {/* Cadre de visualisation interactif */}
          <div className="relative flex-1 bg-black overflow-hidden flex flex-col">
            {tab === "satellite" && (
              <div className="relative h-full w-full">
                <iframe
                  title="Satellite Recon"
                  src={googleMapsSatelliteEmbed}
                  className="h-full w-full border-0"
                  allowFullScreen
                  loading="lazy"
                />
                {/* Réticule HUD superposé */}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-60">
                  <div className="h-24 w-24 border border-cyan/30 rounded-full flex items-center justify-center">
                    <div className="h-2 w-2 bg-alert rounded-full" />
                  </div>
                </div>
              </div>
            )}

            {tab === "street" && (
              <div className="relative h-full w-full flex flex-col items-center justify-center bg-[#010610]">
                <iframe
                  title="Street View Recon"
                  src={googleStreetViewEmbed}
                  className="h-full w-full border-0"
                  allowFullScreen
                  loading="lazy"
                />
                <div className="pointer-events-none absolute top-3 left-3 bg-[#010816]/90 border border-cyan/20 p-2.5 max-w-sm">
                  <span className="label text-cyan">{dict.recon.opticalIntel}</span>
                  <p className="mt-1 text-[9px] text-text-dim leading-relaxed">
                    {dict.recon.streetViewNotice}
                  </p>
                </div>
              </div>
            )}

            {tab === "intel" && (
              <div className="scroll-thin h-full overflow-y-auto p-6 bg-[#020917]">
                <div className="max-w-3xl mx-auto space-y-6">
                  {/* Titre et régime */}
                  <div className="border border-cyan/30 bg-[#041427]/70 p-5">
                    <div className="flex items-baseline justify-between">
                      <h2 className="text-[18px] font-extralight tracking-[0.2em] text-ice uppercase">
                        {geo.country}
                      </h2>
                      <span className="readout text-[11px] text-cyan">ISO: {geo.iso}</span>
                    </div>

                    <div className="mt-3 inline-block px-3 py-1 bg-alert/15 border border-alert/50 text-alert text-[11px] tracking-wider uppercase font-mono">
                      {locale === "fr" ? geo.regime.labelFr : geo.regime.labelEn}
                    </div>

                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-[11px]">
                      <div>
                        <span className="label block">{dict.geopolitics.headOfState}</span>
                        <span className="value mt-0.5 block text-ice">{geo.regime.leader}</span>
                      </div>
                      <div>
                        <span className="label block">{dict.geopolitics.democracyIndex}</span>
                        <span className="value mt-0.5 block text-text">{geo.regime.freedomScore}</span>
                      </div>
                    </div>
                  </div>

                  {/* Économie & Sanctions */}
                  <div className="border border-[rgba(127,212,255,0.18)] bg-[#030f1e]/60 p-5">
                    <h3 className="label-strong text-cyan tracking-widest uppercase">
                      {dict.countryCard.economicProfile}
                    </h3>
                    <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-4 text-[11px]">
                      <div>
                        <span className="label block">{dict.geopolitics.gdp}</span>
                        <span className="readout mt-0.5 block text-ice">{geo.economy.gdpNominal}</span>
                      </div>
                      <div>
                        <span className="label block">{dict.geopolitics.inflation}</span>
                        <span className="readout mt-0.5 block text-alert-soft">{geo.economy.inflation}</span>
                      </div>
                      <div>
                        <span className="label block">{dict.geopolitics.sanctions}</span>
                        <span className="text-[10px] mt-0.5 block text-text-dim">
                          {locale === "fr" ? geo.economy.sanctionsFr : geo.economy.sanctionsEn}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4">
                      <span className="label block">{dict.geopolitics.strategicResources}</span>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {(locale === "fr" ? geo.economy.strategicResourcesFr : geo.economy.strategicResourcesEn).map((res, i) => (
                          <span key={i} className="px-2 py-0.5 border border-cyan/20 bg-cyan/5 text-[9px] text-cyan">
                            {res}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Analyse Géopolitique & Conflit */}
                  <div className="border border-[rgba(127,212,255,0.18)] bg-[#030f1e]/60 p-5">
                    <h3 className="label-strong text-ice tracking-widest uppercase">
                      {dict.geopolitics.tensionsDrivers}
                    </h3>
                    <p className="mt-2 text-[11px] leading-relaxed text-text">
                      {locale === "fr" ? geo.geopolitics.summaryFr : geo.geopolitics.summaryEn}
                    </p>

                    <div className="mt-4">
                      <span className="label block">MOTEURS CLÉS / CONFLICT DRIVERS</span>
                      <ul className="mt-2 space-y-1.5 text-[10px] text-text-dim">
                        {(locale === "fr" ? geo.geopolitics.driversFr : geo.geopolitics.driversEn).map((driver, i) => (
                          <li key={i} className="flex items-center gap-2">
                            <span className="h-1.5 w-1.5 bg-alert" />
                            <span>{driver}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Volet latéral de métadonnées tactiques */}
          <div className="w-full md:w-[320px] border-t md:border-t-0 md:border-l border-[rgba(127,212,255,0.16)] bg-[#020b17] p-4 flex flex-col justify-between">
            <div className="space-y-4">
              <div>
                <span className="label block uppercase tracking-wider">Cible d'observation</span>
                <span className="text-[15px] font-extralight tracking-widest text-ice block mt-0.5">
                  {reconTarget.locality || "Zone d'opérations"}
                </span>
                <span className="readout text-[10px] text-text-dim block">
                  {reconTarget.country}
                </span>
              </div>

              <div className="border border-cyan/20 bg-cyan/5 p-3">
                <span className="label text-cyan block">{dict.geopolitics.regimeType}</span>
                <span className="text-[11px] text-ice font-mono block mt-1">
                  {locale === "fr" ? geo.regime.labelFr : geo.regime.labelEn}
                </span>
                <span className="text-[9px] text-text-faint block mt-1">
                  Leader : {geo.regime.leader}
                </span>
              </div>

              {selected && (
                <div className="border border-alert/20 bg-alert/5 p-3">
                  <span className="label text-alert block">Indicateurs de combat</span>
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className="text-[10px] text-text-dim">Intensité opérationnelle</span>
                    <span className="readout text-[11px] text-alert">
                      {Math.round(selected.intensity * 100)}%
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className="text-[10px] text-text-dim">Victimes déclarées</span>
                    <span className="readout text-[11px] text-ice">
                      {selected.fatalities} †
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className="text-[10px] text-text-dim">Événements indexés</span>
                    <span className="readout text-[11px] text-cyan">
                      {selected.eventCount}
                    </span>
                  </div>
                </div>
              )}

              <div className="space-y-2 pt-2">
                <span className="label block">Liens de reconnaissance satellite</span>
                <a
                  href={externalGoogleMaps}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="row-button flex items-center justify-between text-[10px] p-2 hover:border-cyan text-text"
                >
                  <span>📍 {dict.recon.openGoogleMaps}</span>
                  <span className="readout text-cyan">↗</span>
                </a>
                <a
                  href={externalGoogleEarth}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="row-button flex items-center justify-between text-[10px] p-2 hover:border-cyan text-text"
                >
                  <span>🌍 {dict.recon.openGoogleEarth}</span>
                  <span className="readout text-cyan">↗</span>
                </a>
              </div>
            </div>

            <div className="pt-4 border-t border-[rgba(127,212,255,0.12)]">
              <span className="readout text-[8px] text-text-faint block leading-relaxed">
                SURVEILLANCE TACTIQUE OSINT · ORBITAL CONFLICT INTELLIGENCE SYSTEM
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
