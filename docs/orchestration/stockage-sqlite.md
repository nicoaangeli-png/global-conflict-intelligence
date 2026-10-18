# ORBITAL — Stockage SQLite

Date : 18 octobre 2026  
Périmètre : dépôt d'événements, sélection du stockage, migration et tests.

## Fait

- `SqliteRepository` implémente l'interface `Repository` existante : initialisation, upsert, requête, lecture par identifiants, compteurs et vidage.
- Chaque événement reste stocké intégralement dans `payload` au format JSON. Les champs additifs présents ou futurs (`title`, `geoPrecision`, provenance, etc.) sont donc restitués sans projection destructive.
- Les colonnes SQL dédiées sont : `id` (clé primaire), `source_dataset`, `event_type`, `country`, `country_iso3`, `confidence`, `fatalities`, `event_date`, `lat`, `lon`, `updated_at`. Les index couvrent date, dataset/date, type/date, pays/date, ISO3/date, coordonnées et mise à jour.
- Les filtres de l'interface existante (dates, pays ou ISO3, type, dataset, confiance, mortalité minimale) sont exécutés en SQL avant l'hydratation du JSON.
- SQLite utilise WAL, `synchronous=NORMAL`, un `busy_timeout` de 5 secondes par défaut, des fichiers locaux en mode `0600` et une transaction `BEGIN IMMEDIATE` pour chaque lot d'upsert. Il n'y a plus de fichier `.lock` applicatif susceptible de devenir orphelin.
- La rétention automatique s'exécute à l'ouverture et après chaque upsert : uniquement `source_dataset = 'gdelt'` au-delà de 30 jours et uniquement `source_dataset = 'firms'` au-delà de 14 jours. UCDP, ACLED et `import:csv` ne sont jamais visés, même si leur `eventType` ressemble à une mention presse ou à une détection thermique.
- `createRepository()` conserve PostgreSQL lorsque `DATABASE_URL` est défini, choisit le JSON uniquement avec `ORBITAL_STORAGE=json`, et choisit SQLite dans les autres cas. `pickRepository()` utilise cette fabrique.
- Le migrateur `scripts/migrate-json-to-sqlite.cjs` est idempotent, ne modifie pas le JSON source, contrôle son hash avant/après, compare tous les payloads attendus et exécute `PRAGMA integrity_check`.
- `.gitignore` ignore `data/*.sqlite*` (base, WAL et SHM).

## Configuration

| Variable | Défaut | Rôle |
|---|---:|---|
| `ORBITAL_STORAGE` | `sqlite` implicite | Mettre exactement `json` pour conserver explicitement l'ancien dépôt JSON. |
| `ORBITAL_SQLITE_PATH` | `data/intel-events.sqlite` | Chemin de la base SQLite. |
| `ORBITAL_SQLITE_BUSY_TIMEOUT_MS` | `5000` | Attente maximale d'un verrou SQLite, en millisecondes. |
| `ORBITAL_RETENTION_GDELT_DAYS` | `30` | Durée de conservation des mentions GDELT. `0` désactive cette purge. |
| `ORBITAL_RETENTION_FIRMS_DAYS` | `14` | Durée de conservation des détections FIRMS. `0` désactive cette purge. |

`DATABASE_URL` reste prioritaire et conserve le comportement PostgreSQL existant.

Commande prévue pour l'orchestrateur, à lancer seulement après sauvegarde et validation du chemin cible :

```bash
node scripts/migrate-json-to-sqlite.cjs \
  --source data/intel-events.json \
  --target data/intel-events.sqlite
```

Le migrateur ne purge rien afin que le compte et les payloads restent identiques. La politique de rétention s'applique ensuite automatiquement lorsque l'application ouvre la base.

Pour obtenir un compte strictement stable en production, exécuter la migration pendant une fenêtre sans écriture concurrente. Le script sait fusionner idempotemment dans une cible existante, mais ne supprime volontairement aucune ligne cible absente du JSON.

## Vérifié

### Tests et typage

- `pnpm typecheck` : une exécution complète a réussi après les changements du lot. Les reruns finaux sur l'arbre partagé échouent ensuite dans des changements concurrents hors périmètre (`tests/aura-live-feeds.test.ts:43`, puis `src/server/briefing/collect.ts` et `write.ts`) ; aucun fichier du lot stockage n'est signalé. Un `tsc --noEmit` ciblé sur le dépôt SQLite, la fabrique et leurs tests réussit.
- `pnpm test` : 15 fichiers réussis, 1 ignoré ; 138 tests réussis, 1 ignoré.
- `pnpm vitest run tests/sqlite-repository.test.ts` : 6 tests réussis.
- Le fichier dédié couvre : choix du backend, WAL/index, atomicité transactionnelle, insertion, mise à jour/dédoublonnage, conservation des champs JSON additifs, filtres SQL, rétention par dataset et migration idempotente sur fixture sans réseau.

### Migration sur copie temporaire

Le script n'a pas été exécuté sur `data/intel-events.json`. Le fichier a d'abord été copié vers `/tmp/orbital-sqlite-migration.71V8x9/intel-events-copy.json`, puis cette copie a été migrée.

- Source : 22 755 enregistrements, tous avec un identifiant distinct.
- SQLite après première migration : 22 755 (`inserted=22755`, `updated=0`).
- Vérification : `missing=0`, `payloadMismatches=0`, `sqliteIntegrity=ok`, `sourceUnchanged=true`.
- Seconde exécution : 22 755 avant et après (`inserted=0`, `updated=22755`).
- SHA-256 du fichier du dépôt et de sa copie après migration : `e2afcba4328dfa47e57ebc4eb924c171824268e7e22958826cc746b4614eb075`.

### Temps de requête avant/après

Mesure locale Node 25.9, 40 itérations à chaud, même sélection du 18 septembre au 18 octobre 2026, datasets GDELT + FIRMS, hydratation complète des événements. Les deux chemins renvoient 9 096 enregistrements.

| Stockage | Moyenne | Médiane | p95 |
|---|---:|---:|---:|
| JSON (`readFile` + `JSON.parse` + filtres) | 56,10 ms | 54,97 ms | 85,78 ms |
| SQLite (filtres indexés + parsing des payloads retenus) | 34,59 ms | 31,49 ms | 46,13 ms |

La médiane observée est environ 1,75 fois plus rapide. Le gain augmente pour les sélections plus étroites ; cette mesure n'est pas un test de charge multi-processus.

## Non vérifié

- Aucun benchmark de concurrence multi-processus ni de durée longue n'a été exécuté.
- Le chemin PostgreSQL n'a pas été connecté à une base réelle ; son implémentation n'a pas été modifiée.
- Le dernier état global du typecheck reste à reverdir dans les lots AURA/briefing concurrents indiqués plus haut.
- Aucune requête HTTP n'a été envoyée au serveur sur le port 3005 ; il n'a été ni arrêté ni redémarré.
- `next build` n'a pas été lancé, conformément aux règles communes.

## Limites

- SQLite duplique certaines valeurs indexées et le JSON canonique : la base temporaire mesurée occupe environ 24,4 Mo contre 12,5 Mo pour le JSON. C'est le coût assumé des index et de la suppression des réécritures intégrales.
- Un processus Next déjà présent dans ce répertoire a ouvert la nouvelle cible ignorée `data/intel-events.sqlite` pendant le travail. Il n'a pas été interrompu. L'orchestrateur doit donc coordonner sa migration finale avec cette cible potentiellement active ; la preuve chiffrée ci-dessus reste celle de la copie isolée sous `/tmp`.
- `country_iso3` est rempli lorsqu'un connecteur fournit `countryIso3`, `country_iso3` ou `iso3`. Les anciens enregistrements qui ne portent qu'un nom de pays gardent un ISO3 nul ; le filtre historique par nom reste indexé et fonctionnel.
- Les appels restent synchrones au niveau du module natif `node:sqlite`, derrière l'interface asynchrone existante. À cette volumétrie, les mesures restent inférieures au chemin JSON, mais une charge concurrente élevée devra être mesurée avant de fixer les seuils de passage à PostgreSQL.
- La purge supprime les lignes brutes expirées ; aucun agrégat historique longue durée n'est créé dans ce lot.

## Fichiers du lot

- `src/server/sqliteRepository.ts` : nouveau dépôt SQLite et rétention.
- `src/server/repository.ts` : interface étendue au type `sqlite` et fabrique `createRepository()`.
- `src/server/intel.ts` : branchement minimal de `pickRepository()` sur la fabrique.
- `scripts/migrate-json-to-sqlite.cjs` : migration contrôlée et idempotente.
- `tests/sqlite-repository.test.ts` : tests du dépôt, de la rétention et de la migration.
- `.gitignore` : exclusion des fichiers SQLite locaux.
- `docs/orchestration/stockage-sqlite.md` : présent rapport.
