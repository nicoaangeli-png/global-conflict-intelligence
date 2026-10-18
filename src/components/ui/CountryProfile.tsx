"use client";

import { getCountryGeopolitics } from "@/data/geopolitics";
import { CountryIndicators } from "./CountryIndicators";

export function CountryProfileStatus({ country, locale }: { country: string; locale: "fr" | "en" }) {
  const profile = getCountryGeopolitics(country);
  return (
    <p className="mt-2 border border-cyan/20 bg-cyan/5 p-2 text-[10px] leading-relaxed text-text-dim">
      {profile.provenance.kind === "static-unverified"
        ? locale === "fr"
          ? "Fiche statique non vérifiée · Sources non renseignées · Date des données inconnue. Ne décrit pas nécessairement la situation actuelle."
          : "Unverified static profile · Sources not recorded · Data date unknown. May not reflect the current situation."
        : locale === "fr"
          ? "Fiche indisponible · Sources et date inconnues · N/A = donnée non disponible."
          : "Profile unavailable · Sources and date unknown · N/A = unavailable data."}
    </p>
  );
}

export function CountryProfile({ country, iso, locale }: { country: string; iso: string; locale: "fr" | "en" }) {
  const profile = getCountryGeopolitics(country);
  const french = locale === "fr";
  const fields = [
    [french ? "Population" : "Population", profile.demographics.population],
    [french ? "Capitale" : "Capital", profile.demographics.capital],
    [french ? "Régime" : "Regime", french ? profile.regime.labelFr : profile.regime.labelEn],
    [french ? "Dirigeant" : "Leader", profile.regime.leader],
    [french ? "Forces actives" : "Active forces", profile.military.activeArmedForces],
    [french ? "Budget défense" : "Defense budget", profile.military.defenseBudget],
    [french ? "Nucléaire" : "Nuclear status", french ? profile.military.nuclearStatusFr : profile.military.nuclearStatusEn],
    [french ? "PIB nominal" : "Nominal GDP", profile.economy.gdpNominal],
    ["Inflation", profile.economy.inflation],
  ];
  return (
    <div className="border-t border-cyan/20 px-3 py-2">
      <h3 className="label-strong">{country}</h3>
      <CountryIndicators iso={iso} locale={locale} />
      <CountryProfileStatus country={country} locale={locale} />
      <dl className="mt-2 space-y-2 text-[10px]">
        {fields.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="shrink-0 text-text-faint">{label}</dt>
            <dd className="text-right text-text">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[9px] text-cyan-dim">{french ? profile.military.pentagonAlertFr : profile.military.pentagonAlertEn}</p>
      <p className="mt-2 text-[10px] leading-relaxed text-text-dim">{french ? profile.geopolitics.summaryFr : profile.geopolitics.summaryEn}</p>
    </div>
  );
}
