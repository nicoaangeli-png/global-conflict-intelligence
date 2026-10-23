# Reprise officielle du stockage principal SQLite vers PostgreSQL 17

Cette procédure est **hors ligne** : elle ne doit pas être lancée sur une
application encore en train d'écrire. Elle accompagne le script versionné
`scripts/migrate-intel-sqlite-to-postgres.cjs` et le script existant de détection.
Les commandes n'activent jamais une migration automatiquement à la présence de
`DATABASE_URL`. Tester intégralement sur une copie et PostgreSQL jetable avant
la première production. Aucun secret ne doit apparaître dans l'historique shell.

## Contrat et mapping

Le stockage principal comporte une seule table `conflict_events`, clé primaire
`id`. Aucun lien FK ne relie ses IDs aux tables `detection_*`. Les colonnes
SQLite sont des index dérivés ; le `payload` JSON complet est la source canonique.

| SQLite | PostgreSQL | Règle |
| --- | --- | --- |
| `id`, `source_dataset`, `event_type`, `country`, `country_iso3`, `confidence`, `fatalities` | mêmes noms | Valeurs identiques, contrôlées contre le payload |
| `lat`, `lon` | `latitude`, `longitude` | Nombres finis identiques |
| `event_date`, `updated_at` TEXT | mêmes noms TIMESTAMPTZ | UTC ISO à la milliseconde, instant préservé |
| `event_ts` INTEGER | aucun | Index dérivé de `event_date` ; égalité vérifiée lorsqu'il est présent |
| `payload` TEXT JSON | `payload` JSONB | Objet entier préservé logiquement, y compris champs additifs et valeurs nulles |
| payload `region`, `locality`, `subEventType`, `actors`, `source`, `sourceUrl` | `region`, `locality`, `sub_event_type`, `actors`, `source`, `source_url` | Colonnes matérialisées sans perdre le JSON complet |

Les différences d'ordre des clés JSON ne comptent pas ; l'ordre des tableaux,
les valeurs, les IDs et les timestamps comptent. Le script compare **chaque
ligne et chaque champ**, calcule un SHA-256 canonique, puis vérifie les comptes
par source, catégorie et mois. Un ID PostgreSQL préexistant n'est accepté que si
son contenu est identique. Une collision différente ou une ligne supplémentaire
fait échouer l'opération, sans écrasement. Aucun événement invalide n'est ignoré.

La source doit être au schéma SQLite v1 et la destination au schéma PostgreSQL
v5 de cette release. La destination recommandée est une base ORBITAL dédiée,
initialement vide. Le script n'applique pas la rétention et ne change aucun ID.
Il refuse les horodatages non canoniques plutôt que de les reformater en silence.
`--apply` refuse une source accompagnée de fichiers `-wal` ou `-shm` : utiliser
une copie produite par l'API SQLite de backup, puis arrêter les écritures pour
capturer le snapshot final. Cette garde ne remplace pas l'arrêt de l'application.

## Préparation et simulation sur un environnement jetable

Installer les dépendances du SHA de release avec `pnpm install --frozen-lockfile`.
Créer une base PostgreSQL 17 **jetable et dédiée**. Fournir son URL dans la
variable `ORBITAL_MIGRATION_DATABASE_URL`, depuis un fichier privé mode `600`
hors dépôt ; ne pas passer l'URL en argument de commande. Définir séparément
`MIGRATION_DB_NAME` avec le nom de base attendu. Les exemples supposent que ces
deux variables sont déjà chargées depuis ce fichier protégé.

```sh
node scripts/prepare-orbital-postgres-schema.cjs --expect-database "$MIGRATION_DB_NAME"
node scripts/prepare-orbital-postgres-schema.cjs --expect-database "$MIGRATION_DB_NAME" --apply
sqlite3 /chemin/snapshot/intel-events.sqlite 'PRAGMA integrity_check;'
node scripts/migrate-intel-sqlite-to-postgres.cjs --source /chemin/snapshot/intel-events.sqlite --expect-database "$MIGRATION_DB_NAME"
node scripts/migrate-intel-sqlite-to-postgres.cjs --source /chemin/snapshot/intel-events.sqlite --expect-database "$MIGRATION_DB_NAME" --apply
node scripts/migrate-intel-sqlite-to-postgres.cjs --source /chemin/snapshot/intel-events.sqlite --expect-database "$MIGRATION_DB_NAME" --apply
```

Les commandes sans `--apply` sont en lecture seule. Le premier `--apply`
prépare le schéma versionné ; celui du stockage copie sous une transaction
PostgreSQL, verrou consultatif de migration et verrou de table. Le second passage
doit signaler `migrated: 0`, `alreadyPresent: sqliteCount` et un checksum identique.
La sortie JSON contient un identifiant de destination hashé, jamais l'URL. Un
échec SQL renvoie un code générique, sans mot de passe ni texte de requête.

La migration de détection reste distincte :

```sh
# DATABASE_URL désigne la même base jetable ; ne pas afficher sa valeur.
node scripts/migrate-detection-sqlite-to-postgres.cjs --sqlite /chemin/snapshot/detection.sqlite
node scripts/migrate-detection-sqlite-to-postgres.cjs --sqlite /chemin/snapshot/detection.sqlite --apply
```

Contrôler les comptes `conflict_events`, `detection_events` et
`detection_signals`, les FK/mappings, les résultats des deux scripts et les
échantillons. Ne pas faire démarrer ORBITAL sur une destination partiellement
migrée. Un test de lecture via `/api/events`, `/api/latest`, `/api/stats` et
`/api/health/ready`, puis une ingestion de test, est requis avant la production.

## Ordre de la future bascule production

1. Vérifier le SHA, la CI, l'espace disque, les droits et la base PostgreSQL 17
   dédiée. Préparer le schéma sur cette base vide, sans démarrer l'application
   avec `DATABASE_URL` ; tester une restauration de sauvegarde PostgreSQL.
2. Définir une fenêtre de maintenance. **Arrêter ORBITAL** et empêcher toute
   ingestion/écriture. Confirmer l'arrêt effectif du processus et des WAL.
3. Faire un backup frais du code, de `.env.local`, `data/`, systemd, proxy et
   PostgreSQL. Capturer les deux SQLite par l'API de backup SQLite ou, service
   arrêté, par copie cohérente. Exécuter `PRAGMA integrity_check` sur les copies
   et tester leur restauration dans un chemin distinct.
4. Exécuter le dry-run du stockage principal sur le **snapshot final**. Exiger
   zéro rejet/collision/ligne supplémentaire. Exécuter `--apply`, comparer
   comptes, dimensions et checksum ; refaire `--apply` pour l'idempotence.
5. Exécuter le dry-run puis `--apply` de la détection sur son snapshot final.
   Vérifier événements, signaux, preuves, mappings et absence d'orphelins.
6. Configurer hors dépôt `DATABASE_URL`, `ORBITAL_DETECTION_STORAGE=postgres`
   et `AURA_RATE_LIMIT_BACKEND=postgres`. Vérifier le nom de base sans afficher
   le secret. Installer/build le SHA exact, puis démarrer ORBITAL localement
   derrière le proxy. Les migrations au démarrage doivent être idempotentes.
7. Exiger readiness 200 et valider API, globe, SSE, AURA selon configuration,
   sources, logs et metrics. Ouvrir le trafic seulement après ces contrôles.

Un passage local sur 20 606 lignes a pris ~2,3 s ; un lot **synthétique** de
55 373 lignes a pris ~6,0 s et ~81 Mo de hausse RSS sous Node 22. Ces mesures
**ne prédisent pas** le temps total du VPS. Prévoir plusieurs minutes
de maintenance pour snapshots, vérifications, démarrage et smoke tests. Pas de
double-write ; ne pas copier une SQLite vivante pendant l'ingestion.

## Retour arrière et limite de perte de données

Avant toute nouvelle écriture PostgreSQL : arrêter le nouveau service, remettre
l'ancien code/configuration et les snapshots SQLite testés, puis redémarrer et
contrôler les endpoints. Ne jamais effacer la base PostgreSQL pendant le rollback.

**Après la première écriture PostgreSQL**, les snapshots SQLite n'incluent plus
les nouveaux événements. Revenir simplement à SQLite créerait une perte. Geler
d'abord les écritures et décider explicitement entre une reprise des deltas vers
SQLite (à développer et tester séparément), un maintien en PostgreSQL avec
correctif avant, ou une perte acceptée par l'exploitant. Aucun rollback sans
perte n'est promis après cette frontière. L'ingestion automatique peut démarrer
très vite après le lancement : la fenêtre de validation sans nouvelles écritures
doit être organisée au niveau du service et des connecteurs, pas supposée.

Conserver les sauvegardes hors de l'installation active, en permissions privées.
Ne jamais lancer `DROP DATABASE` ni supprimer les anciens SQLite pour « finir »
la migration. Aucun des scripts ci-dessus ne touche à la production sans choix
explicite de la destination et `--apply`.
