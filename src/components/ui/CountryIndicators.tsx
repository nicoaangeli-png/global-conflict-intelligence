"use client";

import { useEffect, useState } from "react";
import type { CountryIndicators as IndicatorResponse } from "@/server/countryIndicators";

export function CountryIndicators({ iso, locale }: { iso: string; locale: "fr" | "en" }) {
  const [result, setResult] = useState<IndicatorResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setStatus("loading");
    if (!/^[A-Z]{3}$/.test(iso)) {
      setStatus("error");
      return () => controller.abort();
    }
    fetch(`/api/country?iso=${encodeURIComponent(iso)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Indicators unavailable");
        return response.json() as Promise<IndicatorResponse>;
      })
      .then((data) => { setResult(data); setStatus("ready"); })
      .catch(() => { if (!controller.signal.aborted) setStatus("error"); });
    return () => controller.abort();
  }, [iso]);
  const french = locale === "fr";
  const leaders = result?.leaders;
  return (
    <>
    <section className="mt-2 border border-cyan/20 bg-cyan/5 p-2 text-[10px]">
      <h4 className="text-cyan">{french ? "Dirigeants en exercice · Wikidata" : "Current leaders · Wikidata"}</h4>
      {status === "loading" ? <p className="mt-1 text-text-dim">{french ? "Chargement…" : "Loading…"}</p>
        : !leaders || leaders.status !== "available" ? <p className="mt-1 text-text-dim">{leaders?.status === "error" ? (french ? "N/A · Wikidata indisponible." : "N/A · Wikidata unavailable.") : (french ? "N/A · Aucun dirigeant renseigné." : "N/A · No leader recorded.")}</p>
        : (
          <dl className="mt-1 space-y-1">
            {leaders.leaders.map((leader) => (
              <div key={`${leader.role}-${leader.wikidataId}`} className="flex items-baseline justify-between gap-2">
                <dt className="shrink-0 text-text-faint">{leader.role === "head_of_state" ? (french ? "Chef de l'État" : "Head of state") : (french ? "Chef du gouv." : "Head of gov.")}</dt>
                <dd className="text-right">
                  <a className="text-ice hover:text-cyan" href={leader.sourceUrl} target="_blank" rel="noopener noreferrer">{leader.name}</a>
                  {leader.since ? <span className="block text-[9px] text-text-faint">{french ? "depuis" : "since"} {leader.since}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        )}
      <p className="mt-1 text-[9px] text-text-faint">{french ? "Base communautaire : peut avoir du retard sur un changement récent. Demande à AURA de vérifier en direct." : "Community-maintained: may lag recent changes. Ask AURA to verify live."}</p>
    </section>
    <section className="mt-2 border border-cyan/20 bg-cyan/5 p-2 text-[10px]">
      <h4 className="text-cyan">{french ? "Banque mondiale · Indicateurs annuels" : "World Bank · Annual indicators"}</h4>
      {status !== "ready" ? <p className="mt-1 text-text-dim">{status === "loading" ? (french ? "Chargement des données…" : "Loading data…") : (french ? "N/A · Service ou code pays indisponible." : "N/A · Service or country code unavailable.")}</p> : (
        <dl className="mt-1 space-y-2">
          {(["population", "gdp"] as const).map((key) => {
            const indicator = result?.[key];
            const available = indicator?.status === "available" && indicator.value !== null;
            const value = available ? new Intl.NumberFormat(french ? "fr-FR" : "en-US", key === "gdp" ? { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 } : { maximumFractionDigits: 0 }).format(indicator.value!) : "N/A";
            return <div key={key}>
              <div className="flex justify-between gap-2"><dt className="text-text-faint">{key === "population" ? "Population" : (french ? "PIB nominal (USD)" : "Nominal GDP (USD)")}</dt><dd className="text-ice">{value}{available ? ` · ${indicator.year}` : ""}</dd></div>
              {indicator && <a className="text-cyan underline" href={indicator.sourceUrl} target="_blank" rel="noopener noreferrer">{french ? "Source officielle" : "Official source"}</a>}
            </div>;
          })}
        </dl>
      )}
      <p className="mt-1 text-[9px] text-text-faint">{french ? "Dernière observation disponible par indicateur, pas du temps réel." : "Latest available observation per indicator, not real-time data."}</p>
    </section>
    </>
  );
}
