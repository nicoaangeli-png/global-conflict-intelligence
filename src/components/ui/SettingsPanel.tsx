"use client";

import { useEffect, useRef } from "react";
import { useIntelStore } from "@/store/useIntelStore";

/**
 * Réglages de déploiement locaux & état des sources de données réelles.
 * Dialog accessible avec focus management (piège de tabulation, touche Échap, restauration du focus).
 *
 * ACLED / UCDP : connecteurs réels côté serveur.
 * Données réelles uniquement : aucune source de démonstration n'est active.
 * Aucun formulaire de clé API n'est exposé côté client.
 */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const stats = useIntelStore((s) => s.stats);
  const locale = useIntelStore((s) => s.locale);

  const panelRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Gestion du focus initial et de la restauration à la fermeture
  useEffect(() => {
    triggerRef.current = (document.activeElement as HTMLElement) || document.getElementById("settings-trigger-button");
    closeButtonRef.current?.focus();

    return () => {
      triggerRef.current?.focus?.();
    };
  }, []);

  // Fermeture sur Échap avec capture immédiate
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  // Piège du focus (Tab / Shift+Tab) dans la modale
  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusableElements = panelRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusableElements.length === 0) return;
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      }
    } else {
      if (document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    }
  };

  // Connecteurs de la base de conflits (le type peut encore contenir un identifiant historique : exclu).
  const realConnectors = (stats?.connectors ?? []).filter((c) => (c.id as string) !== "demo");

  return (
    <section
      ref={panelRef}
      id="settings-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-dialog-title"
      onKeyDown={handleKeyDown}
      className="panel corners boot flex max-h-[calc(100vh-130px)] w-[min(420px,calc(100vw-40px))] flex-col"
    >
      <span className="corner" />
      <div className="flex items-center justify-between px-3 pt-[10px]">
        <h2 id="settings-dialog-title" className="label-strong">
          {locale === "fr" ? "Paramètres · Sources & déploiement" : "Settings · Sources & Deployment"}
        </h2>
        <button
          ref={closeButtonRef}
          type="button"
          className="chip"
                    onClick={onClose}
          aria-label={locale === "fr" ? "Fermer les paramètres" : "Close settings"}
        >
          {locale === "fr" ? "fermer" : "close"}
        </button>
      </div>
      <div className="hairline mx-3 mt-2" />
      <div className="scroll-thin space-y-3 overflow-y-auto px-3 py-3">
        <div>
          <span className="label">{locale === "fr" ? "Variables d'environnement" : "Environment variables"}</span>
          <pre
            tabIndex={0}
            aria-label="Configuration d'environnement recommandée"
            className="mt-2 overflow-x-auto border border-[rgba(127,212,255,0.12)] bg-[rgba(2,8,16,0.6)] p-2 text-[11px] leading-relaxed text-[#a9c8dc] focus:border-cyan focus:outline-none"
          >
{`# .env.local (racine du projet)
ACLED_EMAIL=vous@exemple.org
ACLED_PASSWORD=••••••
# ou un jeton direct
ACLED_ACCESS_TOKEN=...

UCDP_ACCESS_TOKEN=...
UCDP_VERSION=26.1

# Protection du déclenchement manuel
INGEST_TOKEN=...

# PostgreSQL conseillé en production
DATABASE_URL=postgresql://user@localhost:5432/orbital_intel

# Désactivation ciblée
GDELT_DISABLED=1
UCDP_DISABLED=1`}
          </pre>
        </div>

        <div>
          <span className="label">{locale === "fr" ? "Import de fichiers" : "File imports"}</span>
          <p className="mt-1 text-[11px] leading-relaxed text-[#a9c8dc]">
            {locale === "fr"
              ? "Déposez un export CSV ACLED ou UCDP dans data/imports/ puis lancez POST /api/ingest avec le jeton serveur dans l'en-tête Authorization Bearer. Les secrets restent dans .env.local ; redémarrez le serveur après modification."
              : "Drop an ACLED or UCDP CSV export in data/imports/ then run POST /api/ingest with the server token in Authorization Bearer. Secrets remain in .env.local; restart server after update."}
          </p>
        </div>

        <div>
          <span className="label">{locale === "fr" ? "Sources réelles actives" : "Active real sources"}</span>
          <ul className="mt-1 space-y-[3px]">
            {realConnectors.length > 0 ? (
              realConnectors.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 text-[11px] text-[#a9c8dc]">
                  <span>{c.label}</span>
                  <span className="readout" title={c.note}>
                    {c.events} · {c.reachable === false ? (locale === "fr" ? "erreur" : "error") : c.configured ? (locale === "fr" ? "configuré" : "configured") : (locale === "fr" ? "inactif" : "inactive")}
                  </span>
                </li>
              ))
            ) : (
              <li className="text-[11px] text-[#8fb4cc]">
                {locale === "fr" ? "État des connecteurs en cours de chargement…" : "Loading connector status…"}
              </li>
            )}
          </ul>
        </div>

        <div className="text-[11px] leading-relaxed text-[#a9c8dc]">
          <span className="label">{locale === "fr" ? "Couverture et indicateurs" : "Coverage and indicators"}</span>
          <p className="mt-1">
            {locale === "fr"
              ? "ACLED / UCDP nécessitent vos accès. GDELT signale des mentions presse, pas des incidents confirmés. La Banque mondiale fournit population et PIB annuels, avec l'année et le lien source dans la fiche pays. Les budgets militaires SIPRI restent à importer depuis leurs publications : aucun flux tactique n'est simulé."
              : "ACLED / UCDP require credentials. GDELT reports media mentions, not confirmed incidents. World Bank provides annual population and GDP with year and source link in country view. SIPRI military budgets remain to be imported from releases: no tactical feed is simulated."}
          </p>
        </div>

        <p className="text-[11px] leading-relaxed text-[#8fb4cc]">
          {locale === "fr"
            ? "Règle appliquée dans tout le système : données réelles et sourcées exclusivement. Aucune position n'est déduite ni inventée. Chaque événement affiche sa source, sa date et son niveau de confiance."
            : "System-wide rule: exclusively real and sourced data. No positions are inferred or invented. Each event displays its source, date, and confidence level."}
        </p>
      </div>
    </section>
  );
}
