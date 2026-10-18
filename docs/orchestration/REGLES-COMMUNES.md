# ORBITAL — Règles communes à tous les agents (vague 1, 18/10/2026)

Projet : `/Users/nicolas/Projects/global-conflict-intelligence` — Next.js 15 / React 19 / Three.js / Zustand / Node 25.
Coordination et intégration : Claude Opus 5.5 (chef d'orchestre). Lis aussi `docs/audit-2026-10-18/01-SYNTHESE.md`,
`02-code-et-verite-des-donnees.md` et `05-ARBITRAGE-SOL.md` (arbitrage qui fait autorité en cas de désaccord).

## Exigence du propriétaire
« Contrôleur de la planète en temps réel, sans fake ni information fictive, travail parfait sans erreur. »

## Règles de vérité (non négociables)
1. **Aucune donnée inventée.** Pas de valeur par défaut présentée comme un fait, pas de « stable », « calme », « aucune menace » pour une absence de donnée. Inconnu = `null` + raison (`not_covered | no_data | stale | error | not_configured`).
2. **Chaque donnée porte sa provenance** : source, URL, date de l'événement (ou de publication) **distincte** de la date de collecte, licence/attribution si connue.
3. **Trois natures jamais additionnées ni confondues** : incident structuré (UCDP/ACLED/import), mention/article de presse (GDELT, RSS), détection/mesure (satellite, capteur, marché, alerte officielle).
4. Une mention presse n'a **jamais** de bilan humain (`fatalities` non applicable) et n'est jamais « confirmée ».
5. Ne jamais contourner une protection anti-robot, un captcha, un paywall ou des conditions d'utilisation (ex. ReliefWeb 406, IAEA Cloudflare). Respecter les quotas (cache obligatoire).
6. Codes pays : ISO3 canonique partout. GDELT utilise **FIPS 10-4** (UK, GM, RS, UP…) ; `sourcecountry` de GDELT DOC = pays du **média**, pas du lieu de l'événement.

## Règles de travail
- **Ne modifie que les fichiers de ton périmètre** (listés dans ta mission). Un autre agent travaille en parallèle sur d'autres fichiers du même dépôt : n'y touche pas, ne les reformate pas. Si tu as besoin d'un changement hors périmètre, décris-le dans ton rapport.
- **Interdits** : `git commit`/`push`/`reset`/`checkout`/`stash`, `next build` (écraserait le build du serveur en cours), redémarrer/arrêter un serveur, lire ou afficher `.env.local`, supprimer `data/`, installer des dépendances (demande-le dans le rapport).
- **Autorisé** : `pnpm typecheck` (des erreurs dans les fichiers d'un autre agent peuvent apparaître temporairement : ne corrige que les tiennes), `pnpm test`, requêtes GET vers `http://127.0.0.1:3005`, `curl` léger vers les API publiques pour valider un format (une fois, puis fixture).
- **Tests obligatoires** dans `tests/*.test.ts` (Vitest, alias `@/` → `src/`), sur **fixtures enregistrées** dans `tests/fixtures/` (extraits réels, réduits). Aucun test ne doit appeler le réseau.
- Code : TypeScript strict, style et densité de commentaires du code existant, commentaires en français, pas de dépendance nouvelle sans justification.
- **Rapport final** dans `docs/orchestration/<ta-mission>.md` : ce qui est fait, preuves (commandes + résultats), limites, ce qui reste, changements demandés hors périmètre. Distingue « vérifié » / « non vérifié ». Ne déclare jamais terminé un point non testé.
