# Calques de référence du globe

Date : 19 octobre 2026 · périmètre : `src/server/layers/**`, `src/app/api/layers/route.ts`, tests/fixtures associés et `.gitignore`.

## Fait

- API Node `GET /api/layers?id=<LayerId>` : retourne un `LayerResponse` complet.
- API `GET /api/layers` : retourne `{ layers }` avec les métadonnées, le statut et `itemCount`, sans `features`.
- Les quatre calques sont des références (installations, tracés ou liste administrative), jamais des événements.
- Cache mémoire et disque `data/layers/<id>.json`, durée maximale de 24 h. Un échec source conserve le dernier cache valide avec `status: "stale"`; sans cache, la réponse est `status: "error"` et reste lisible.
- Requêtes, taille et délais bornés via `fetchBytes` / `fetchJson` de `src/server/feeds/util.ts`. Les CSV OFAC sont plafonnés à 8 Mio chacun : aucun XML SDN de 127 Mo n'est téléchargé.

## Sources et règles de données

| Calque | Source | Données retenues | Licence / caveat |
|---|---|---|---|
| `nuclear_plants` | Wikidata SPARQL, P31/P279 Q134447, P625, P17/P298, P137, P729, P576/P3999, P2109 | Point, pays ISO3, exploitant, dates et statut uniquement lorsqu'il est déterminable (`en service`, `fermée`, `en construction`, sinon `null`) | CC0 1.0 Universal. Couverture collaborative non exhaustive, pas une source officielle ; PRIS/AIEA n'est pas interrogé (robots). |
| `military_bases` | Wikidata SPARQL, Q18691599 et sous-classes | Point, ISO3, exploitant et type P31. Les fermetures P576/P3999 et états fermé/détruit/abandonné sont exclus ; un filtre de type explicite militaire écarte les faux positifs civils observés. | CC0 1.0 Universal. Couverture inégale, déploiements temporaires absents et dates de fermeture Wikidata incomplètes. Requête bornée à `LIMIT 500`. |
| `submarine_cables` | TeleGeography `cable-geo.json` (+ `all.json` facultatif) | Lignes GeoJSON et noms. Les pays restent `[]` lorsque les atterrissements ne sont pas publiés. | **Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)**, vérifiée dans le bundle public de Submarine Cable Map (`/assets/index-DQqjuvIf.js`). Attribution et partage à l'identique requis. Le brief mentionnait une licence non commerciale : cette affirmation n'est pas reprise car elle ne correspond pas à la licence affichée par le site le 19/10. |
| `sanctions` | OFAC SDN CSV et `add.csv` | Une feature sans géométrie par ISO3 : personnes/entités distinctes ayant une adresse dans le pays, avec répartition brute des programmes OFAC. | Source US seulement, pas UE/ONU. Une entité est comptée dans chaque pays d'adresse ; ce n'est pas une mesure de risque. Date de publication extraite de la redirection officielle OFAC. |

Les noms OFAC sont résolus vers ISO3 par `src/lib/geo/country.ts`, avec le référentiel Natural Earth déjà fourni par le projet comme complément explicite pour les noms anglais hors de la petite table d'alias. Un nom non résolu est écarté plutôt que deviné.

## Contrôle réel (cache isolé `/tmp`, 19/10/2026)

| Calque | Statut | Éléments | `asOf` | Exemples |
|---|---:|---:|---|---|
| Centrales | `ok` | 374 | `null` (Wikidata ne fournit pas une date globale de publication) | Chashma (PAK), Biblis (DEU), **Phénix (FRA)**. Le total constaté diffère des 382 signalés dans le brief : le résultat Wikidata est une photographie changeante. |
| Bases | `ok` | 370 | `null` | Starhemberg barracks (AUT), Brückberg-Kaserne (DEU), **caserne Bridoux (FRA)**. |
| Câbles | `ok` | 712 | `null` | APX West, APX North, APX East 2. Les trois n'ont pas de pays d'atterrissement publié dans ce GeoJSON. |
| Sanctions | `ok` | 145 | `2026-10-16` | AFG (80), AGO (11), ALB (8), **FRA (48)**. Pour la France, les programmes dominants observés sont `RUSSIA-EO14024` (21), `SDGT` (14) et les autres programmes bruts OFAC. |

La première requête bases a révélé « tour Eiffel » comme faux positif de la hiérarchie Wikidata ; le filtre P31 explicite militaire a été ajouté, puis le contrôle réel a été refait. Cela ne transforme pas Wikidata en inventaire officiel des bases actives : la caveat reste affichée.

## Vérifications

- `pnpm exec vitest run tests/layers-loaders.test.ts tests/layers-route.test.ts --reporter=dot` : **9 tests verts**. Fixtures locales seulement, aucun réseau.
- Contrôle réel : scripts temporaires `/tmp/orbital-layers-real.test.ts` et `/tmp/orbital-layers-r3.test.ts`, avec cache séparé sous `/tmp/orbital-layers-real-cache-20261019-*` ; résultats ci-dessus.
- `pnpm test` : **236 tests verts, 2 ignorés, 1 échec hors périmètre**. `tests/ui-feeds.test.ts` attend l'ancienne liste de thèmes tandis que les thèmes `military` et `infrastructure` ont été ajoutés par un travail parallèle.
- `pnpm typecheck` : **succès** après intégration du travail parallèle. Aucun fichier `src/components/**` n'a été modifié ici.
- `next build` non lancé, conformément aux règles communes ; aucun serveur n'a été démarré, arrêté ou redémarré.

## Fichiers ajoutés ou modifiés

- `src/server/layers/common.ts`, `wikidata.ts`, `cables.ts`, `country.ts`, `sanctions.ts`, `index.ts`
- `src/app/api/layers/route.ts`
- `tests/layers-loaders.test.ts`, `tests/layers-route.test.ts`, `tests/fixtures/layers/*`
- `.gitignore` (cache `data/layers/`)
- ce rapport
