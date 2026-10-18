# ORBITAL — Correctifs SQLite

Date : 18 octobre 2026  
Périmètre : dépôt SQLite, contrat `Repository`, migration JSON, tests dédiés.  
Contraintes respectées : aucun commit, aucun `next build`, aucune lecture de `.env.local`, aucune dépendance ajoutée, aucune action sur le serveur `:3005`, aucune migration exécutée sur `data/`.

## Constats revérifiés

- **Dates** : confirmé. `LocalRepository` compare `Date.parse(eventDate)` aux deux bornes inclusives. SQLite comparait les chaînes brutes, ce qui excluait une borne écrite avec `Z` sans millisecondes et classait mal les décalages comme `-05:00`.
- **Premier démarrage** : confirmé. `SqliteRepository.init()` créait une base vide sans consulter le JSON historique.
- **Migration** : confirmé. `COMMIT` précédait `integrity_check`, le contrôle des payloads et le hash final du JSON.
- **P2 ciblés** : confirmé. `close()` n'était pas dans `Repository` et un gros upsert exécutait toute sa boucle synchrone sous une transaction unique.

## Correctifs appliqués

### Temps exact et schéma idempotent

- Ajout de `event_ts INTEGER`, égal à `Date.parse(eventDate)` en millisecondes UTC ; une date invalide produit `NULL`.
- Ajout d'index sur `event_ts` seul et combiné avec dataset, type, pays et ISO3.
- Mise à niveau automatique des bases existantes : détection de colonne, `ALTER TABLE`, rétroremplissage depuis `payload`, création idempotente des index.
- `query()` utilise `event_ts >= from` et `event_ts <= to`, comme `LocalRepository`.
- `purgeExpired()` utilise `event_ts < cutoff` et exige `event_ts IS NOT NULL`. Une date invalide ne peut donc pas être purgée accidentellement.
- Le texte `event_date` et le payload restent inchangés. `updated_ts` n'a pas été ajouté : aucune comparaison temporelle sur `updated_at` n'est nécessaire dans ce périmètre.

### Premier démarrage

- Si la table est vide, le dépôt cherche `intel-events.json` à côté de la base (donc `data/intel-events.json` avec les chemins par défaut).
- Le JSON est validé avec les mêmes règles que le migrateur, sans le modifier.
- L'import complet se fait dans une transaction. Toute validation ou écriture en échec laisse zéro événement importé, ferme la base et remonte une erreur explicite.
- Après succès : journal exact `import initial N événements depuis le JSON`.

### Migration sûre

- Création/mise à niveau du schéma, upserts, comparaison des payloads, `PRAGMA integrity_check` et vérification du hash source ont lieu avant `COMMIT`.
- Le `catch` exécute `ROLLBACK`.
- Un test installe un trigger de sabotage qui altère le payload pendant la migration : le contrôle échoue et l'ancien payload de la cible est retrouvé intact après rollback.

### P2

- `Repository` accepte `close?(): void | Promise<void>` ; `SqliteRepository.close()` était déjà implémenté.
- Les upserts sont validés avant écriture puis sérialisés et écrits par transactions de **500 événements**. La boucle Node.js reprend entre les lots via `setImmediate`.
- Chaque lot reste atomique. Pour un appel supérieur à 500 éléments, les lots déjà validés restent commis si une erreur SQLite imprévisible survient dans un lot ultérieur ; les erreurs ordinaires de forme sont éliminées par la validation préalable.

## Tests automatisés

- `pnpm typecheck` : **réussi**.
- `pnpm vitest run tests/sqlite-repository.test.ts` : **12/12 réussis**.
- `pnpm test` : **205 réussis, 2 ignorés, 1 échec hors périmètre**.
  - Échec concurrent : `tests/aura-live-feeds.test.ts:101`, attente `/texte retiré/` contre message reçu `"[texte retiré : tentative d'instruction]s."`.
  - Aucun échec SQLite.

Les cas ajoutés couvrent `Z` sans millisecondes, `-05:00`, borne exacte inclusive, date invalide, non-purge d'une date invalide, rétroremplissage d'une ancienne base, import initial, échec d'import sans ligne partielle, cession entre lots et rollback de migration avant commit.

## Preuves sur copie `/tmp`

Copie utilisée : `/tmp/orbital-sqlite-correctifs.ovbgea/intel-events.json`. Aucune commande de migration n'a ciblé `data/`.

### Migration

- Source : **22 887** enregistrements ; distincts : **22 887**.
- Cible : **22 887** lignes ; `inserted=22887`, `updated=0`.
- `missing=0`, `payloadMismatches=0`, `sqliteIntegrity=ok`, `verified=true`.
- JSON source inchangé : `sourceUnchanged=true`.
- SHA-256 : `c9b3026b6ae4df9307df753a2d71c44f2eb40978264a7eb4a1d453a26450434d`.
- Dates invalides trouvées dans cette copie : **0**.

### Import initial et équivalence

- Journal observé : `import initial 22887 événements depuis le JSON`.
- Compte `LocalRepository` / source : **22 887** ; compte SQLite : **22 887**.
- Borne haute commune : `2026-10-18T13:45:00.000Z`, dernier événement daté de la copie.

| Fenêtre inclusive | LocalRepository | SqliteRepository |
|---|---:|---:|
| 24 h | 5 668 | 5 668 |
| 7 jours | 9 228 | 9 228 |
| 30 jours | 9 228 | 9 228 |

## Fichiers modifiés

- `src/server/sqliteRepository.ts` : timestamps entiers, migration de schéma, import initial, lots et rétention sûre.
- `src/server/repository.ts` : contrat `close()` optionnel.
- `scripts/migrate-json-to-sqlite.cjs` : `event_ts` et contrôles avant commit.
- `tests/sqlite-repository.test.ts` : régressions et preuve conditionnelle sur copie explicite.
- `docs/orchestration/stockage-sqlite.md` : état et preuves actualisés.
- `docs/orchestration/correctifs-sqlite.md` : présent rapport.

## Limites et non vérifié

- Pas de benchmark de concurrence multi-processus ni de simulation de crash du processus au milieu d'un lot.
- PostgreSQL n'a pas été testé en direct et n'a pas été modifié.
- La suite globale reste rouge à cause du test AURA hors périmètre indiqué ci-dessus.
- Aucun serveur et aucune base sous `data/` n'ont été ouverts, arrêtés ou modifiés par les commandes de preuve.
