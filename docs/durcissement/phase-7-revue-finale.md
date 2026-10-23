# Phase 7 — Revue générale sécurité et architecture (2026-10-20)

Dernière phase du plan : vérifier l'ensemble des routes, les secrets, les contrôles
d'entrée, les en-têtes HTTP et la séparation des couches, corriger les écarts simples,
puis consigner sans surestimer ce qui reste ouvert.

## 1. Surface HTTP

14 routes, toutes en `runtime = "nodejs"`. Aucun CORS permissif, aucun
`Access-Control-Allow-Origin` : les lectures cross-origin sont bloquées par le
navigateur ; les écritures coûteuses sont en plus protégées.

| Route | Contrôles en place | Reste |
|---|---|---|
| `POST /api/agent` | origine stricte, jeton facultatif, `Content-Type`, corps borné, validation, budget requêtes/tokens, débit, concurrence, doublons | PostgreSQL distribué en production avec `DATABASE_URL` |
| `POST /api/agent/voice` | mêmes contrôles + quota de caractères réservé/rendu | mêmes compteurs et leases distribués |
| `POST /api/briefing` | **origine stricte partagée avec AURA**, client `aura`, JSON, corps borné, cooldown 10 min | pas de budget OpenAI dédié (génération mise en cache) |
| `GET /api/briefing` | lecture publique du bilan en cache ; génération au premier accès | un cache manquant déclenche une génération (coût borné par jour) |
| `POST /api/cluster` | **JSON obligatoire, corps borné à 16 Ko**, validation des nombres | pas de limite par IP |
| `GET /api/events` | filtres validés et **listes bornées à 50 valeurs**, cache de sélection | réponse lourde (~648 Ko brut), compression par le proxy |
| `GET /api/stats` | filtres et rayon validés/bornés, cache partagé avec `/api/events` | pas de limite par IP |
| `GET /api/latest` | `limit` entier 1–400, filtres bornés, erreurs gérées | pas de limite par IP |
| `GET /api/layers` | identifiants de calque fermés, cache disque 24 h, catalogue sans téléchargement | chargement d'un calque = appel externe (dédupliqué) |
| `GET /api/country` | ISO3 strict, référentiel, taille bornée, TTL, `redirect: "error"` | — |
| `GET /api/feeds` | catégories/pays bornés, cache amont | pas de limite par IP |
| `GET /api/health` | lecture seule, aucun appel réseau | expose version de schéma/uptime (faible sensibilité) |
| `GET /api/sources/status` | lecture seule du registre | — |
| `POST /api/ingest` | `INGEST_TOKEN`, comparaison à temps constant, `days` 1–365, verrou 60 s | — |
| `GET /api/ingest` | **désormais protégé par le même jeton** | — |
| `GET /api/stream` | plafond 64 connexions, battement, fermeture à 5 min | plafond global, pas par IP |

## 2. Corrections appliquées dans cette phase

1. **Briefing : suppression de l'ancien contrôle d'origine dupliqué.** Il acceptait
   tout hôte `*.sslip.io` et toute IP littérale, exactement le défaut corrigé pour AURA
   en phase 2. La route utilise maintenant `checkOrbitalOrigin` (allowlist stricte,
   boucle locale, aucun joker, en-tête `X-Orbital-Client`). Le client envoyait déjà cet
   en-tête. Test dédié : hôte `evil.sslip.io`, origine tierce et mauvais client → 403.
2. **Corps des routes POST restantes.** `/api/cluster` exige `application/json` et lit au
   plus 16 Ko (longueur déclarée **et** flux interrompu au-delà) ; `/api/briefing` lit au
   plus 1 Ko. Fini le `request.json()` non borné.
3. **`GET /api/ingest` protégé.** Il exposait publiquement le type de dépôt, le rapport
   d'ingestion et les notes internes des connecteurs. Il exige désormais le jeton
   `INGEST_TOKEN` ; les états publics restent disponibles via `/api/health` et
   `/api/sources/status`, sans notes internes.
4. **Bornes des filtres.** Chaque liste (`types`, `confidences`, `countries`, `datasets`)
   est limitée à 50 valeurs et dédupliquée. Une URL ne peut plus gonfler la clause `IN`
   ni le travail de décodage.
5. **Modules serveur à secrets marqués `server-only`** : briefing (écriture OpenAI),
   connecteurs ACLED/FIRMS, flux maritimes/snapshot, calques (fs), dépôts SQLite/
   PostgreSQL, orchestrateur `intel`. Une importation accidentelle depuis un composant
   client échoue au build au lieu d'embarquer du code serveur.
6. **En-têtes HTTP** : ajout de `Strict-Transport-Security` (ignoré en HTTP local),
   `Cross-Origin-Opener-Policy: same-origin` et `X-DNS-Prefetch-Control: off`. La CSP
   existante est conservée.
7. **Script `pnpm lint` retiré** : `next lint` est déprécié dans Next 15.5 et lançait un
   assistant interactif, donc échouait en CI. La validation repose sur `typecheck`,
   361 tests, le build, l'audit et 24 tests navigateur ; aucun lint n'est prétendu.

## 3. Revue d'architecture

### Ce qui est sain

- **Sens unique des dépendances** : connecteurs → normalisation/validation → dépôt →
  services (`intel`, `feeds`, `layers`, `briefing`, `health`) → routes → composants.
  Aucun composant client n'importe un module serveur au runtime.
- **Contrats partagés** dans `src/types` et `src/lib` (types d'événements, calques,
  clustering, formatage), donc pas de duplication client/serveur des règles métier.
- **AURA découpée** en couches testables (origine, accès, identité, débit, budget, corps,
  assainissement, outils) ; les routes ne contiennent plus cette logique.
- **Une seule source de vérité par sujet** : registre de santé des sources, référentiel
  pays ISO3, cache de sélection, migrations versionnées. Les erreurs d'une source ne
  contaminent pas les autres (états `loading/ready/error` par bloc).
- **Dégradation explicite** : les réponses distinguent non configuré, indisponible,
  en retard et vide ; l'interface ne fabrique pas de zéro. Les tests E2E couvrent ces
  modes (base vide, source en panne, OpenAI indisponible, réseau coupé, mobile).

### Dette restante, assumée

- `src/server/intel.ts` (704 lignes) reste un orchestrateur large : ingestion, sélection,
  agrégats, SSE et santé. Le découper maintenant (sélection d'un côté, ingestion de
  l'autre) serait mécanique mais toucherait tous les appelants ; à faire avec des tests
  de non-régression supplémentaires, pas en fin de durcissement.
- `useIntelStore.ts` (529 lignes) et `GlobeScene.tsx` (617 lignes) sont les deux gros
  modules clients. Ils sont déjà découpés par sous-composants/hooks et couverts par les
  scénarios navigateur, mais un découpage plus fin reste possible.
- Le rendu Three.js n'a pas de test de régression visuelle par capture ; les E2E
  vérifient la présence du canvas, la navigation et les interactions, pas les pixels.
- Pas de linter reproductible (voir ci-dessus). Un ESLint flat config explicite serait la
  prochaine amélioration de qualité, avec un jeu de règles limité pour éviter le bruit.

## 4. Risques de sécurité résiduels (documentés, non « corrigés »)

- **CSP avec `'unsafe-inline'`** sur `script-src`/`style-src` : contrainte du rendu Next
  sans nonce. Les scripts injectés par des données tierces restent neutralisés par le
  rendu React (pas de `dangerouslySetInnerHTML`) et l'assainissement d'AURA, mais une CSP
  à nonce serait plus forte.
- **AURA sans jeton** reste ouverte à un script dans la limite des budgets ; c'est le
  compromis d'un site public sans comptes. Les limites sont partagées par PostgreSQL
  en production ; le backend mémoire reste un choix mono-instance explicite.
- **Pas de limitation par IP sur les lectures** (`events`, `stats`, `latest`, `cluster`).
  Le corps est borné, les filtres sont bornés et la sélection est mise en cache 60 s,
  mais un proxy/WAF doit fournir le débit global si le site devient réellement exposé.
- **Briefing** : une génération OpenAI est déclenchée au premier `GET` du jour si le
  cache est absent. Le coût est borné par le cache journalier et le cooldown de
  régénération, mais il n'existe pas de budget de tokens dédié comme pour AURA.
- **`GET /api/stream`** plafonne à 64 connexions pour l'instance, pas par client.
- **SSRF** : tous les appels sortants visent des hôtes fixes (OpenAI, UCDP, GDELT, NASA,
  Banque mondiale, Wikidata, OpenSky, TeleGeography, OFAC). Les URL fournies par des
  données/model ne sont jamais utilisées pour un `fetch` serveur ; `safeHttpUrl` reste
  syntaxique et sert uniquement à l'affichage.
- **Secrets** : aucune variable `NEXT_PUBLIC_*` ; `.env.local` est ignoré et en `0600`.
  `/api/health` n'expose aucun secret. Les erreurs internes ne sont plus renvoyées telles
  quelles sur les routes AURA.

## 5. Validation finale

- Node 24.22.0 : `pnpm typecheck` OK.
- `pnpm test` : **43 fichiers réussis, 2 ignorés ; 361 tests réussis, 6 ignorés**
  (les 6 ignorés sont les tests PostgreSQL sans `ORBITAL_TEST_DATABASE_URL`).
- PostgreSQL 17 réel : `tests/postgres-migrations.test.ts` **4/4** (migrations v1→v3,
  base historique, JSON/filtre ISO3/rétention, schéma futur refusé).
- Copie de la base SQLite de production : **25 923 lignes** conservées, schéma v1,
  `quick_check` OK ; WAL de 52 Mo supprimé après un `SIGTERM` propre.
- `pnpm build` : code 0, JS initial **104 Ko** (First Load JS).
- `pnpm test:e2e` sur build de production : **24/24** scénarios navigateur.
- `pnpm audit` : code 0 ; deux alertes connues, ignorées et justifiées dans
  `pnpm-workspace.yaml`.

## 6. État final du plan

Les sept phases sont terminées et documentées :

1. Node LTS + CI (matrice 22/24, audit, build, E2E, PostgreSQL réel) ;
2. sécurité AURA (origine, identité, débit, budget, corps, assainissement) ;
3. santé normalisée des sources et intégration UI/AURA ;
4. découpage des gros modules AURA/caméra/client ;
5. scénarios E2E déterministes (24) ;
6. base de données versionnée, rétention, robustesse et performances ;
7. revue sécurité/architecture et corrections transverses.

### Prochaines étapes optionnelles, par impact

1. Configurer la compression du proxy et vérifier `/api/events` compressé en production.
2. Ajouter un lint ESLint explicite (règles ciblées) et le brancher à la CI.
3. Extraire la sélection de `intel.ts` et ajouter des tests de charge (filtres, zooms,
   plusieurs clients SSE).
4. Si plusieurs instances : partager ou désactiver le cache de sélection et ajouter une
   limite de débit au niveau du proxy ; `RateLimitStore` est déjà distribué.
5. CSP à nonce et test de régression visuelle du globe.
6. Exercice de restauration SQLite/PostgreSQL (sauvegarde → restauration → health).
