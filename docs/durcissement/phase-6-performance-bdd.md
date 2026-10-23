# Phase 6 — Base de données et performances (2026-10-20)

Périmètre : audits SQLite/PostgreSQL, migrations versionnées, rétention, robustesse à
l'arrêt brutal, puis mesures avant optimisation (API, cache, bundle, calques).

## Constat mesuré (base réelle, copie de production)

- 25 923 enregistrements : UCDP 13 659, GDELT 8 379, FIRMS 3 885 ; fichier SQLite 34 Mo.
- Sélection de 30 jours : 12 264 événements ; lecture SQL ~21 ms, décodage JSON ~16 ms.
- `GET /api/events?range=30d&degrees=2.40` : 838 foyers, 8 761 événements, réponse 648 Ko
  (dont 241 Ko d'identifiants échantillonnés) ; 313 ms à froid (ouverture + migration),
  17–22 ms à chaud.
- `GET /api/stats` à chaud : ~20 ms. `GET /api/layers` (catalogue) : 5 ms, 2,1 Ko.
- Bundle : 104 Ko de JS initial ; le groupe Three.js (~316 + 180 Ko) reste dans des chunks
  séparés chargés avec la scène ; 1,6 Mo de chunks statiques au total.

## Modifications

### Schéma et migrations

- **SQLite** (`src/server/migrations/sqlite.ts`) : version dans `PRAGMA user_version`,
  migrations appliquées une fois, en `BEGIN IMMEDIATE`, relues sous verrou ; une base au
  schéma plus récent est refusée. La migration v1 reprend le schéma historique et calcule
  `event_ts` pour les lignes existantes (base de production migrée sans perte :
  25 923 lignes avant/après, `quick_check` OK).
- **PostgreSQL** (`src/server/migrations/postgres.ts`) : table `orbital_schema_migrations`,
  verrou consultatif `pg_advisory_xact_lock`, toutes les migrations en attente dans une
  transaction. v2 ajoute `payload JSONB`, `country_iso3` et les index
  `(source_dataset, event_date)` / `(country_iso3)` ; v3 ajoute l'index `updated_at`
  utilisé par `MAX(updated_at)` des statistiques de santé.
- **PostgreSQL** (`src/server/repository.ts`) : upsert du JSON complet (champs additifs des
  connecteurs conservés), filtre pays par nom **ou** ISO3, rétention GDELT/FIRMS identique
  à SQLite, purge après ingestion, `diagnostics()` (version du schéma).

### Robustesse et intégrité

- SQLite : `PRAGMA journal_size_limit` (WAL borné), `PRAGMA optimize` et
  `wal_checkpoint(TRUNCATE)` à la fermeture ; fermeture enregistrée sur `exit` du processus.
  Vérifié sur le build de production : après un `SIGTERM`, le fichier `-wal` de 52 Mo
  disparaît (checkpoint) ; l'arrêt `SIGKILL` reste couvert par les tests WAL.
- `PRAGMA quick_check` à l'ouverture, exposé dans `/api/health` (`storage.schemaVersion`,
  `storage.integrity`) ; une intégrité non `ok` dégrade le statut global.
- Rétention : GDELT 30 j, FIRMS 14 j (`ORBITAL_RETENTION_GDELT_DAYS` /
  `ORBITAL_RETENTION_FIRMS_DAYS`), sur SQLite et PostgreSQL.
- Tests : migrations neuves/historiques, refus d'un schéma futur, échec de migration
  annulé, arrêt brutal (processus tué en transaction), concurrence de migrations
  PostgreSQL.

### Performances

- **Cache de sélection serveur** (`src/server/intel.ts`) : la lecture + décodage de la
  période était refaite à chaque zoom/filtre. Cache 60 s, invalidé à chaque ingestion,
  borné à 8 entrées et 60 000 événements (une sélection peut peser plusieurs Mo). Les
  appelants reçoivent une copie du tableau ; `/api/events` et `/api/stats` partagent la
  même sélection.
- **Charge utile des foyers** (`src/app/api/events/route.ts`) : 24 identifiants par foyer,
  répartis régulièrement (premier, dernier, intervalles) au lieu des N premiers. Le client
  ne s'en sert que pour retrouver le foyer sélectionné au changement de grille ; le détail
  est recalculé côté serveur. Sur la base réelle : ~241 Ko au lieu d'environ 359 Ko
  estimés, sans changer les compteurs ni le détail. Effet moindre que supposé (beaucoup de
  foyers ont moins de 24 événements), d'où un commentaire corrigé.
- **Calques de la fiche pays** : `/api/layers?id=…&country=ISO3` ne renvoie que les
  éléments du pays ; `useCountryData` réutilise les calques complets déjà chargés pour le
  globe, garde les données par ISO et ne relance plus les requêtes quand un calque est
  allumé sur le globe (plus de clignotement ni de double téléchargement).
- **Catalogue des calques** : `listLayers` ne déclenche plus le chargement des quatre
  calques (jusqu'à ~750 Ko chacun, Wikidata/OFAC) pour afficher le menu. Il lit les
  comptes déjà connus (mémoire ou cache disque) et renvoie `itemCount: null` sinon ;
  l'interface affiche déjà « Chargé à l'allumage ».
- Déjà en place et conservé : `GlobeScene`, `AgentPanel`, `WorldFeedPanel` et
  `LayersMenu` en imports dynamiques ; budget de marqueurs selon l'appareil
  (`globeQuality`) ; calques chargés à la demande ; cache disque 24 h des calques.

## Fichiers touchés

- `src/server/migrations/sqlite.ts`, `src/server/migrations/postgres.ts` (nouveaux)
- `src/server/sqliteRepository.ts`, `src/server/repository.ts`
- `src/server/intel.ts`, `src/server/health/service.ts`
- `src/app/api/events/route.ts`, `src/app/api/layers/route.ts`
- `src/components/feeds/useCountryData.ts`, `src/components/feeds/CountryPanel.tsx`
- `src/server/layers/index.ts`, `src/types/conflict.ts`
- `tests/sqlite-migrations.test.ts`, `tests/postgres-migrations.test.ts`,
  `tests/events-route.test.ts`, `tests/layers-route.test.ts`, `tests/layers-loaders.test.ts`
- `.github/workflows/ci.yml` (job PostgreSQL réel, dépendant de `validate`)

## Validation exécutée

- Node 24.22.0 : `pnpm typecheck` OK ; `pnpm test` **355 réussis, 6 ignorés**.
- PostgreSQL 17 local : `tests/postgres-migrations.test.ts` **4/4** (base neuve, base
  historique, JSON/filtre ISO3/rétention, schéma futur refusé).
- Copie de la base de production : migration v1, 25 923 lignes conservées,
  `quick_check` OK, `-wal` supprimé à la fermeture, 12 264 événements sur 30 j.
- `pnpm build` : code 0, JS initial 104 Ko.
- `pnpm test:e2e` sur build de production : **24/24** (13 scénarios + 11 mobiles).
- `pnpm audit` : code 0 (2 alertes connues et justifiées dans `pnpm-workspace.yaml`).

## Risques et limites

- PostgreSQL : l'upsert est découpé en lots sans transaction englobante ; une panne entre
  deux lots laisse une ingestion partielle, mais rejouable sans doublon (upsert par `id`).
- Les lignes PostgreSQL antérieures à la v2 ont `payload = NULL` : les colonnes historiques
  restent lues (repli), les champs additifs réapparaissent au prochain upsert.
- La migration SQLite v1 recalcule `event_ts` en une transaction : sur plusieurs millions
  de lignes, prévoir une fenêtre de maintenance (26 000 lignes : < 1 s).
- `/api/events` reste à 648 Ko brut pour 30 jours ; Next ne compresse pas les réponses JSON
  des routes (mesuré), il faut activer la compression du proxy (Caddy/nginx). L'échantillon
  d'identifiants ne représentait que ~16 % de la réponse sur ce jeu.
- Le cache de sélection est **par processus** (60 s) : plusieurs instances ne le partagent
  pas. Ce n'est pas un cache distribué, seulement une économie de décodage locale.
- La limitation de débit d'AURA utilise PostgreSQL en mode distribué ; la mémoire reste
  disponible uniquement comme backend mono-instance explicite.
- Pas de linter reproductible : le script `pnpm lint` (déprécié, échouait) a été retiré.
  `typecheck` + tests + build + audit couvrent la CI ; un lint pourra être ajouté avec une
  configuration explicite.

## Prochaine phase recommandée

Phase 7 — revue générale sécurité + architecture : contrôle d'origine partagé (le briefing
avait conservé l'ancien joker `*.sslip.io`), corps bornés sur les routes POST restantes,
`server-only` sur les modules à secrets, en-têtes HTTP, puis vérification de la chaîne
connecteurs → validation → stockage → repository → services → API → UI.
