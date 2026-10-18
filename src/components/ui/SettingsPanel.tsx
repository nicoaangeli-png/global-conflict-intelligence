"use client";

import { useIntelStore } from "@/store/useIntelStore";

/**
 * Réglages de déploiement locaux.
 *
 * ACLED (source principale) : renseignez vos identifiants pour activer le
 * connecteur réel. Ils restent côté serveur ; l'interface n'affiche que
 * l'état du connecteur, jamais un jeton.
 */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const stats = useIntelStore((s) => s.stats);

  return (
    <section className="panel corners boot flex max-h-[62vh] w-[min(340px,calc(100vw-40px))] flex-col">
      <span className="corner" />
      <div className="flex items-center justify-between px-3 pt-[10px]">
        <span className="label-strong">Paramètres · Sources & déploiement</span>
        <button type="button" className="chip" style={{ padding: "2px 6px" }} onClick={onClose}>
          fermer
        </button>
      </div>
      <div className="hairline mx-3 mt-2" />
      <div className="scroll-thin space-y-3 overflow-y-auto px-3 py-3">
        <div>
          <span className="label">Variables d&apos;environnement</span>
          <pre className="mt-2 overflow-x-auto border border-[rgba(127,212,255,0.12)] bg-[rgba(2,8,16,0.6)] p-2 text-[9px] leading-relaxed text-text-dim">
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
          <span className="label">Import de fichiers</span>
          <p className="mt-1 text-[9px] leading-relaxed text-text-dim">
            Déposez un export CSV ACLED ou UCDP dans <span className="value">data/imports/</span> puis lancez{" "}
            <span className="value">POST /api/ingest</span> avec le jeton serveur dans l&apos;en-tête Authorization Bearer.
            Les secrets restent dans .env.local ; redémarrez le serveur après modification.
          </p>
        </div>

        <div>
          <span className="label">État courant</span>
          <ul className="mt-1 space-y-[3px]">
            {(stats?.connectors ?? []).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 text-[9px] text-text-dim">
                <span>{c.label}</span>
                <span className="readout" title={c.note}>{c.events} · {c.reachable === false ? "erreur" : c.configured ? "configuré" : "inactif"}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="text-[9px] leading-relaxed text-text-dim">
          <span className="label">Couverture et indicateurs</span>
          <p className="mt-1">ACLED / UCDP nécessitent vos accès. GDELT signale des mentions presse, pas des incidents confirmés.
            La Banque mondiale fournit population et PIB annuels, avec l&apos;année et le lien source dans la fiche pays.
            Les budgets militaires SIPRI restent à importer depuis leurs publications : aucun flux tactique n&apos;est simulé.</p>
        </div>

        <p className="text-[9px] leading-relaxed text-text-faint">
          Règle appliquée dans tout le système : aucune position n&apos;est présentée comme tactique, aucune donnée n&apos;est
          déduite. Chaque événement affiche sa source, sa date et son niveau de confiance ; GDELT reste un signal presse.
        </p>
      </div>
    </section>
  );
}
