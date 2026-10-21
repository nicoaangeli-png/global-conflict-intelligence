# Détection ORBITAL partagée avec PostgreSQL

État : 21 octobre 2026. Ce document décrit le backend PostgreSQL du moteur de
détection, la stratégie de concurrence, les migrations et la procédure de reprise
des données SQLite existantes. Il ne remplace pas `docs/orchestration/moteur-detection.md`,
qui décrit le rapprochement métier et les scores.

## Sélection du backend

| Configuration | Backend de détection |
| --- | --- |
| `ORBITAL_DETECTION_STORAGE=sqlite` | SQLite local, même si `DATABASE_URL` existe |
| `ORBITAL_DETECTION_STORAGE=postgres` | PostgreSQL ; `DATABASE_URL` obligatoire |
| `ORBITAL_DETECTION_STORAGE=auto` (défaut) + `DATABASE_URL` | PostgreSQL |
| `ORBITAL_DETECTION_STORAGE=auto` (défaut), sans `DATABASE_URL` | SQLite `data/detection.sqlite` |

Une erreur PostgreSQL ne bascule **jamais** silencieusement sur SQLite : en
multi-instance, cela créerait deux états divergents. Le snapshot renvoie
`status: "unavailable"` et l'ingestion conserve son message générique, sans URL
ni secret. `ORBITAL_DETECTION_STORAGE=sqlite` est l'échappatoire explicite
pendant une migration de données.

SQLite reste le mode mono-instance pris en charge. Plusieurs processus ne doivent
pas partager `data/detection.sqlite` en production ; le verrou `BEGIN IMMEDIATE`
protège l'intégrité mais ne fournit pas la disponibilité d'un serveur partagé.

## Interface et absence de duplication métier

`DetectionStore` et `DetectionTransaction` (`src/server/detection/store.ts`)
exposent uniquement : `bySignal`, `candidates`, `put`, `remember`, `recent`,
`purge` et `lock`. Le moteur (`engine.ts`) ne connaît ni SQL ni `pg` ; il exécute
le même rapprochement, les mêmes scores et les mêmes timelines avec les deux
backends.

Les méthodes sont asynchrones parce que PostgreSQL est distant. SQLite conserve
son comportement synchrone en interne, avec une file de transactions par store :
une connexion `node:sqlite` ne peut pas ouvrir deux transactions concurrentes.

## Schéma PostgreSQL (migration v4)

```sql
CREATE TABLE detection_events (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  anchor        DOUBLE PRECISION NOT NULL,   -- epoch ms de la plus ancienne preuve
  last_received TIMESTAMPTZ NOT NULL,        -- dernière ingestion
  payload       JSONB NOT NULL,              -- OrbitalEvent complet
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX detection_candidates      ON detection_events (kind, anchor);
CREATE INDEX detection_matching_order  ON detection_events (kind, anchor, id);
CREATE INDEX detection_retention       ON detection_events (anchor);
CREATE INDEX detection_recent          ON detection_events (last_received DESC, id);

CREATE TABLE detection_signals (
  id       TEXT PRIMARY KEY,                -- identifiant du signal source
  event_id TEXT NOT NULL REFERENCES detection_events(id) ON DELETE CASCADE,
  digest   TEXT NOT NULL
);
CREATE INDEX detection_signals_event ON detection_signals (event_id);
```

- `payload` JSONB conserve l'événement complet sans figer ses champs additifs.
  JSONB normalise l'ordre des clés, pas les valeurs relues par l'application.
- `anchor` est un nombre (et non un timestamp) pour rester identique au `REAL`
  SQLite et à l'API du moteur.
- `last_received` est un `TIMESTAMPTZ` : tri et comparaison corrects, y compris
  entre instances.
- L'index sur `detection_signals.event_id` est indispensable : PostgreSQL
  n'indexe pas automatiquement la colonne référencée d'une clé étrangère, et la
  purge en cascade balayerait autrement toute la table des signaux.
- Aucun index sur `payload` : aucune requête ne filtre dans le JSON.

## Concurrence

### Verrou par catégorie

Chaque transaction d'ingestion prend un verrou consultatif transactionnel par
catégorie de signal présente dans le lot :

```sql
SELECT pg_advisory_xact_lock(hashtext('orbital:detection:' || kind), 0);
```

Les catégories sont triées avant acquisition. Toutes les instances prennent donc
les mêmes verrous dans le même ordre : pas de cycle, pas de deadlock entre deux
ingestions. Le verrou est relâché au commit ou au rollback.

Pourquoi la catégorie entière plutôt qu'un seau temporel : deux signaux séparés
de moins de 45 minutes peuvent tomber de part et d'autre d'une frontière de
seau. Un verrou par seau exigerait de verrouiller les seaux voisins et laisse
encore une course au bord de la fenêtre. Huit catégories au plus ; la
sérialisation ne concerne que les ingestions de la même catégorie, jamais les
autres tables ORBITAL ni les autres catégories.

La purge et la lecture d'instantané ne prennent pas ce verrou. Elles ne
participent pas au calcul de cluster et utilisent des mécanismes propres
(ci-dessous).

### Niveau d'isolation : READ COMMITTED

READ COMMITTED est volontaire. En REPEATABLE READ, le snapshot est fixé au
premier ordre de la transaction, avant que le verrou consultatif ne soit obtenu :
la deuxième instance ne verrait pas le cluster créé par la première et créerait
un doublon. En READ COMMITTED, chaque ordre voit les commits précédents ; après
l'attente du verrou, `bySignal` et `candidates` lisent l'état à jour.

Aucun `SERIALIZABLE` n'est utilisé : les verrous ciblés suffisent et évitent les
échecs de sérialisation à réessayer.

### Idempotence

- `detection_signals.id` est la clé primaire : un signal ne peut être mémorisé
  qu'une fois. `remember` fait un UPSERT.
- L'identifiant d'événement créé par le moteur est déterministe :
  `orbital:` + hash du signal. Deux instances qui créent le même événement
  écrivent la même ligne.
- Avant tout traitement, `bySignal` renvoie le digest mémorisé. Un signal
  identique (même contenu, `receivedAt` exclu du digest) est compté `skipped` et
  ne produit ni preuve ni entrée de timeline.
- Un contenu modifié pour le même identifiant de signal est une révision
  assumée : la preuve est remplacée, la timeline enregistre `evidence_updated`.
- Les UPSERT `put` et `remember` sont idempotents. Deux ingestions simultanées du
  même signal sont sérialisées par le verrou de catégorie : la seconde voit le
  digest et s'arrête.

### Mises à jour simultanées du même événement

Deux signaux différents du même cluster sont sérialisés par le verrou de
catégorie. La seconde transaction relit l'événement après le commit de la
première et ajoute sa preuve : aucune preuve n'est perdue.

Les instantanés (`snapshot`) sont en lecture seule du point de vue des preuves ;
ils ne modifient que la timeline d'évaluation. Leur écriture est protégée par une
garde :

```sql
ON CONFLICT (id) DO UPDATE ... WHERE EXCLUDED.last_received >= detection_events.last_received
```

Un instantané calculé sur un état ancien ne peut donc pas écraser une ingestion
plus récente, sauf égalité exacte à la milliseconde près (voir risques résiduels).
Si deux instantanés écrivent le même état, le dernier gagne : les
deux états sont dérivés des mêmes preuves.

Cette garde suppose des horloges synchronisées (NTP) entre instances. Une horloge
très en retard peut voir ses écritures ignorées ; c'est préférable à un écrasement
de données plus récentes.

### Purge concurrente

La purge supprime les événements dont `anchor` est antérieur au seuil de
rétention. En PostgreSQL, elle utilise `FOR UPDATE SKIP LOCKED` :

```sql
DELETE FROM detection_events
 WHERE ctid IN (
   SELECT ctid FROM detection_events
    WHERE anchor < $1 ORDER BY anchor LIMIT 1000
    FOR UPDATE SKIP LOCKED
 );
```

Une purge ne bloque donc jamais sur une ligne qu'une ingestion tient ; les lignes
verrouillées sont reprises au prochain passage. La suppression en cascade des
signaux est protégée par la clé étrangère et son index. Deux purges simultanées
sont sans danger : la seconde supprime zéro ligne. Un événement tout juste purgé
peut être réinséré par une ingestion qui l'avait lu avant le commit ; il sera
supprimé au passage suivant, sans corruption ni doublon.

## Migrations

La migration v4 est ajoutée à `POSTGRES_MIGRATIONS`
(`src/server/migrations/postgres.ts`), donc au même mécanisme que les tables de
conflits :

- une seule transaction pour toutes les migrations en attente ;
- verrou consultatif `pg_advisory_xact_lock` : plusieurs instances qui démarrent
  ensemble n'appliquent chaque migration qu'une fois ;
- table `orbital_schema_migrations` (version, nom, date) ;
- une base au schéma plus récent que l'application est refusée.

`PostgresDetectionStore` vérifie en plus les colonnes et types attendus
(`information_schema`). Un schéma altéré ou futur est refusé au démarrage, même
si la table de versions est incohérente. Aucune migration destructive n'est
automatique.

SQLite conserve `PRAGMA user_version = 1` et le schéma historique. Une base
SQLite de détection existante s'ouvre sans modification ; une version supérieure
à 1 est refusée plutôt que migrée à l'aveugle.

## Reprise des données SQLite existantes (volontaire)

Aucune migration automatique n'est faite au démarrage. Procédure recommandée :

1. **Sauvegarder** `data/detection.sqlite` (et `-wal`/`-shm` après arrêt du
   processus) ainsi que PostgreSQL (`pg_dump`).
2. Vérifier que le schéma PostgreSQL est en v4 : démarrer une fois l'application
   avec `DATABASE_URL`, ou appliquer les migrations par le chemin habituel.
3. **Simulation** (aucune écriture) :

   ```sh
   DATABASE_URL=postgresql://… \
     node scripts/migrate-detection-sqlite-to-postgres.cjs \
     --sqlite data/detection.sqlite
   ```

4. **Application** :

   ```sh
   DATABASE_URL=postgresql://… \
     node scripts/migrate-detection-sqlite-to-postgres.cjs \
     --sqlite data/detection.sqlite --apply
   ```

   Le script ouvre SQLite en lecture seule, copie dans une transaction sous le
   verrou des migrations, et ne supprime jamais la source. Les événements
   PostgreSQL plus récents (`last_received`) ne sont pas écrasés ; les signaux
   déjà présents ne sont pas remappés. Rejouer le script est sans effet sur les
   lignes déjà copiées.
5. Vérifier `GET /api/detection` et les comptages. Laisser
   `ORBITAL_DETECTION_STORAGE=sqlite` tant que la vérification n'est pas
   terminée, puis passer à `auto` (ou `postgres`) et redémarrer.
6. Retour arrière : remettre `ORBITAL_DETECTION_STORAGE=sqlite`. Les données
   SQLite n'ont pas été modifiées. Ne supprimer `data/detection.sqlite` qu'après
   une période d'observation et une sauvegarde.

## Tests et CI

Les tests de contrat (`tests/detection-store-contract.test.ts`) exécutent le
même scénario sur SQLite et PostgreSQL : insert, update, déduplication, rollback,
rétention, réouverture, ingestions concurrentes, mises à jour concurrentes et
purge concurrente. `tests/detection-postgres.test.ts` couvre le schéma vierge,
la migration depuis v3, les démarrages simultanés, l'échec de migration,
le schéma futur/incompatible, les plans `EXPLAIN` et la parité de snapshot.
`tests/detection-migration-script.test.ts` vérifie la procédure volontaire.

Le job CI `postgres` démarre un service PostgreSQL 17 réel et exécute ces
fichiers avec `ORBITAL_TEST_DATABASE_URL`. Les schémas de test sont isolés
(`detection_test_*`, `detection_pg_*`, `detection_script_*`) : ils ne touchent
pas `public` et peuvent tourner en parallèle des tests de migration historiques.

## Performances

Requêtes critiques et index :

| Requête | Chemin attendu |
| --- | --- |
| `bySignal` | PK `detection_signals`, jointure PK `detection_events` |
| `candidates(kind,time,window)` | `detection_candidates` / `detection_matching_order` |
| `recent(limit)` | `detection_recent` (`last_received DESC, id`) |
| `purge(before)` | `detection_retention` (`anchor`) + `SKIP LOCKED` |
| `put` | UPSERT sur la PK |
| `remember` | UPSERT sur la PK |

`candidates` fait deux bornes indexées (avant et après `time`), chacune limitée à
64 lignes, puis trie en mémoire par distance et identifiant. Cela évite de perdre
les candidats les plus proches dans un intervalle dense, tout en bornant la
lecture.

Le pool du store est limité à 4 connexions : l'ingestion est séquentielle dans
une transaction, et les instantanés sont bornés à 200 événements. Les timeouts
sont de 30 s pour l'attente d'un verrou et 120 s pour un ordre. Les payloads JSONB
peuvent être volumineux (128 preuves) ; c'est le principal coût de `recent`.

## Risques résiduels

- Les verrous consultatifs ne protègent que les writers ORBITAL qui suivent ce
  protocole. Un script qui écrirait directement dans `detection_events` sans
  verrou pourrait créer un doublon de cluster.
- Le verrou par catégorie sérialise les ingestions d'une même catégorie pendant
  la durée du lot. Un lot de 500 signaux très lent peut retarder les autres
  instances de la même catégorie ; le timeout de verrou finit par échouer
  proprement plutôt que d'attendre indéfiniment.
- La garde `last_received` dépend de l'horloge applicative ; NTP est requis.
- Course étroite instantané/ingestion : si les deux écrivent le même événement
  avec un `last_received` égal à la milliseconde près, la garde `>=` laisse le
  dernier écrivain gagner. Une ingestion qui ajoute une preuve reste protégée par
  le verrou de catégorie ; seul un instantané calculé avant cette ingestion
  pourrait réécrire l'état avec la même preuve si son score change au même
  instant. La fenêtre est d'une milliseconde et se referme au snapshot suivant.
- Une purge sous forte contention peut laisser des lignes anciennes jusqu'au
  passage suivant. Aucune donnée n'est ressuscitée durablement.
- SQLite reste mono-instance : le backend ne rend pas un fichier local partagé
  sûr entre plusieurs hôtes.
- Aucun secret de connexion n'est journalisé, mais les erreurs PostgreSQL
  détaillées restent dans les logs serveur si un autre composant les imprime ;
  la route de détection ne renvoie qu'un statut générique.
