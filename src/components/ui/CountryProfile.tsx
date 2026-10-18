"use client";

import { getCountryGeopolitics } from "@/data/geopolitics";
import { CountryIndicators } from "./CountryIndicators";

export function CountryProfileStatus({ country, locale }: { country: string; locale: "fr" | "en" }) {
  const profile = getCountryGeopolitics(country);
  return (
    <p className="mt-2 border border-cyan/20 bg-cyan/5 p-2 text-[10px] leading-relaxed text-text-dim">
      {profile.provenance.kind === "static-unverified"
        ? locale === "fr"
          ? "Contenu historique conservé · Assertions non vérifiées, sans sources ni date. Elles ne sont pas présentées comme des faits actuels."
          : "Historical content retained · Claims are unverified, unsourced and undated. They are not presented as current facts."
        : locale === "fr"
          ? "Fiche indisponible · Sources et date inconnues · N/A = donnée non disponible."
          : "Profile unavailable · Sources and date unknown · N/A = unavailable data."}
    </p>
  );
}

export function CountryProfile({ country, iso, locale }: { country: string; iso: string; locale: "fr" | "en" }) {
  const french = locale === "fr";
  return (
    <div className="border-t border-cyan/20 px-3 py-2">
      <h3 className="label-strong">{country}</h3>
      <CountryIndicators iso={iso} locale={locale} />
      <CountryProfileStatus country={iso || country} locale={locale} />
      <dl className="mt-2 space-y-2 text-[10px]">
        <div className="flex justify-between gap-3">
          <dt className="shrink-0 text-text-faint">{french ? "Population, dirigeant, régime, économie" : "Population, leader, regime, economy"}</dt>
          <dd className="text-right text-text">{french ? "Non vérifiés" : "Unverified"}</dd>
        </div>
      </dl>
    </div>
  );
}
