# ORBITAL — Stockage SQLite

Date : 18 octobre 2026  
Périmètre : dépôt d'événements, sélection du stockage, migration et tests.

## Fait

- `SqliteRepository` implémente l'interface `Repository` existante : initialisation, upsert, requête, lecture par identifiants, compteurs et vidage.
- Chaque événement reste stocké intégralement dans `payload` au format JSON. Les champs additifs présents ou futurs (`title`, `geoPrecision`, provenance, etc.) sont donc restitués sans projection destructive.
- Les colonnes SQL dédiées sont : `id` (clé primaire), `source_dataset`, `event_type`, `country`, `country_iso3`, `confidence`, `fatalities`, `event_date`, `event_ts`, `lat`, `lon`, `updated_at`. `event_ts` contient `Date.parse(eventDate)` en millisecondes UTC ou `NULL` pour une date invalide. Les index temporels utilisent cet entier.
- Les filtres de l'interface existante (dates inclusives, pays ou ISO3, type, dataset, confiance, mortalité minimale) sont exécutés en SQL avant l'hydratation du JSON. Leur sémantique temporelle est maintenant identique à `LocalRepository`, y compris pour les fuseaux et les formats ISO équivalents.
- Une base existante sans `event_ts` est mise à niveau de façon idempotente par `ALTER TABLE`, puis rétroremplie depuis le payload JSON. Une date invalide reste stockée, n'entre dans aucune requête temporelle et n'est jamais supprimée par la rétention.
- SQLite utilise WAL, `synchronous=NORMAL`, un `busy_timeout` de 5 secondes par défaut, des fichiers locaux en mode `0600` et une transaction `BEGIN IMMEDIATE` pour chaque lot d'upsert. Les gros upserts sont découpés en lots de 500, avec restitution de la main à la boucle Node.js entre les lots. Il n'y a plus de fichier `.lock` applicatif susceptible de devenir orphelin.
- La rétention automatique s'exécute à l'ouverture et après chaque upsert : uniquement `source_dataset = 'gdelt'` au-delà de 30 jours et uniquement `source_dataset = 'firms'` au-delà de 14 jours. UCDP, ACLED et `import:csv` ne sont jamais visés, même si leur `eventType` ressemble à une mention presse ou à une détection thermique.
- `createRepository()` conserve PostgreSQL lorsque `DATABASE_URL` est défini, choisit le JSON uniquement avec `ORBITAL_STORAGE=json`, et choisit SQLite dans les autres cas. `pickRepository()` utilise cette fabrique.
- Au premier démarrage, une base vide importe automatiquement le fichier `intel-events.json` voisin s'il existe et contient des événements. La validation et toutes les écritures sont transactionnelles ; une erreur annule l'import et remonte explicitement. Le JSON n'est pas modifié.
- Le migrateur `scripts/migrate-json-to-sqlite.cjs` est idempotent, ne modifie pas le JSON source, contrôle son hash avant/après, compare tous les payloads attendus et exécute `PRAGMA integrity_check` avant `COMMIT`. Tout échec déclenche `ROLLBACK`.
- Le contrat `Repository` expose désormais `close()` de façon optionnelle ; `SqliteRepository` ferme effectivement sa connexion.
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

- `pnpm typecheck` : réussi.
- `pnpm vitest run tests/sqlite-repository.test.ts` : 12 tests réussis.
- `pnpm test` : 205 tests réussis, 2 ignorés, 1 échec concurrent hors périmètre dans `tests/aura-live-feeds.test.ts:101` ; les 12 tests SQLite exécutés sont réussis.
- Le fichier dédié couvre notamment : mise à niveau de schéma, `Z` sans millisecondes, fuseau `-05:00`, borne exacte inclusive, date invalide, import initial et rollback, lots de 500, rétention, migration idempotente et rollback d'un échec d'intégrité simulé.

### Migration sur copie temporaire

Le script n'a pas été exécuté sur `data/intel-events.json`. Le fichier a d'abord été copié vers `/tmp/orbital-sqlite-correctifs.ovbgea/intel-events.json`, puis cette copie a été migrée et importée au premier démarrage dans deux bases temporaires distinctes.

- Source : 22 887 enregistrements, tous avec un identifiant distinct.
- SQLite après première migration : 22 887 (`inserted=22887`, `updated=0`).
- SQLite après import initial : 22 887.
- Vérification : `missing=0`, `payloadMismatches=0`, `sqliteIntegrity=ok`, `sourceUnchanged=true`.
- SHA-256 de la copie avant/après migration : `c9b3026b6ae4df9307df753a2d71c44f2eb40978264a7eb4a1d453a26450434d`.

Comparaison réelle entre `LocalRepository` et `SqliteRepository` sur la copie, avec borne haute au dernier événement (`2026-10-18T13:45:00.000Z`) : 5 668 événements sur 24 h, 9 228 sur 7 jours et 9 228 sur 30 jours dans les deux dépôts.

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
- La suite globale reste à reverdir dans le lot AURA concurrent (`tests/aura-live-feeds.test.ts:101`) ; le typecheck global est vert.
- Aucune requête HTTP n'a été envoyée au serveur sur le port 3005 ; il n'a été ni arrêté ni redémarré.
- `next build` n'a pas été lancé, conformément aux règles communes.

## Limites

- SQLite duplique certaines valeurs indexées et le JSON canonique : la base temporaire mesurée occupe environ 24,4 Mo contre 12,5 Mo pour le JSON. C'est le coût assumé des index et de la suppression des réécritures intégrales.
- Un processus Next déjà présent dans ce répertoire a ouvert la nouvelle cible ignorée `data/intel-events.sqlite` pendant le travail. Il n'a pas été interrompu. L'orchestrateur doit donc coordonner sa migration finale avec cette cible potentiellement active ; la preuve chiffrée ci-dessus reste celle de la copie isolée sous `/tmp`.
- `country_iso3` est rempli lorsqu'un connecteur fournit `countryIso3`, `country_iso3` ou `iso3`. Les anciens enregistrements qui ne portent qu'un nom de pays gardent un ISO3 nul ; le filtre historique par nom reste indexé et fonctionnel.
- Les appels restent synchrones au niveau du module natif `node:sqlite`, derrière l'interface asynchrone existante. Le lot de 500 borne chaque section bloquante et rend la main entre les transactions ; une charge concurrente élevée devra encore être mesurée avant de fixer les seuils de passage à PostgreSQL.
- La purge supprime les lignes brutes expirées ; aucun agrégat historique longue durée n'est créé dans ce lot.

## Fichiers du lot

- `src/server/sqliteRepository.ts` : nouveau dépôt SQLite et rétention.
- `src/server/repository.ts` : interface étendue au type `sqlite` et fabrique `createRepository()`.
- `src/server/intel.ts` : branchement minimal de `pickRepository()` sur la fabrique.
- `scripts/migrate-json-to-sqlite.cjs` : migration contrôlée et idempotente.
- `tests/sqlite-repository.test.ts` : tests du dépôt, de la rétention et de la migration.
- `.gitignore` : exclusion des fichiers SQLite locaux.
- `docs/orchestration/stockage-sqlite.md` : présent rapport.
