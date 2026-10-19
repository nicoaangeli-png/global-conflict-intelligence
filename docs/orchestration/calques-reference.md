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
| `military_bases` | Wikidata SPARQL, classes `Q695850` (base aérienne militaire), `Q1324633` (base navale), `Q245016` (base militaire), `Q18691599` (installation militaire), `Q131263` (caserne) et `Q88556` (garnison) | Point, pays hôte ISO3 (`P17`), exploitant/forces (`P137`), sitelinks et type `aérienne` / `navale` / `terrestre` / `autre` dérivé de la classe `P31` interrogée. Les fermetures `P576`/`P3999` et états fermé/détruit/abandonné sont exclus ; le filtre de type explicite militaire conserve la protection contre les faux positifs. | CC0 1.0 Universal. Couverture inégale, déploiements temporaires absents et dates de fermeture Wikidata incomplètes. Quatre pages de 250 candidats par classe (maximum 1 000), puis dédoublonnage, tri global par sitelinks décroissants et borne finale de 4 000. Casernes et garnisons exigent au moins cinq sitelinks. |
| `submarine_cables` | TeleGeography `cable-geo.json` (+ `all.json` facultatif) | Lignes GeoJSON et noms. Les pays restent `[]` lorsque les atterrissements ne sont pas publiés. | **Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)**, vérifiée dans le bundle public de Submarine Cable Map (`/assets/index-DQqjuvIf.js`). Attribution et partage à l'identique requis. Le brief mentionnait une licence non commerciale : cette affirmation n'est pas reprise car elle ne correspond pas à la licence affichée par le site le 19/10. |
| `sanctions` | OFAC SDN CSV et `add.csv` | Une feature sans géométrie par ISO3 : personnes/entités distinctes ayant une adresse dans le pays, avec répartition brute des programmes OFAC. | Source US seulement, pas UE/ONU. Une entité est comptée dans chaque pays d'adresse ; ce n'est pas une mesure de risque. Date de publication extraite de la redirection officielle OFAC. |

Les noms OFAC sont résolus vers ISO3 par `src/lib/geo/country.ts`, avec le référentiel Natural Earth déjà fourni par le projet comme complément explicite pour les noms anglais hors de la petite table d'alias. Un nom non résolu est écarté plutôt que deviné.

## Contrôle réel (cache isolé `/tmp`, 19/10/2026)

| Calque | Statut | Éléments | `asOf` | Exemples |
|---|---:|---:|---|---|
| Centrales | `ok` | 374 | `null` (Wikidata ne fournit pas une date globale de publication) | Chashma (PAK), Biblis (DEU), **Phénix (FRA)**. Le total constaté diffère des 382 signalés dans le brief : le résultat Wikidata est une photographie changeante. |
| Bases | remplacé par le contrôle ci-dessous | 370 | `null` | Ancien échantillon arbitraire limité à 500 : il ne représente plus l'implémentation. |
| Câbles | `ok` | 712 | `null` | APX West, APX North, APX East 2. Les trois n'ont pas de pays d'atterrissement publié dans ce GeoJSON. |
| Sanctions | `ok` | 145 | `2026-10-16` | AFG (80), AGO (11), ALB (8), **FRA (48)**. Pour la France, les programmes dominants observés sont `RUSSIA-EO14024` (21), `SDGT` (14) et les autres programmes bruts OFAC. |

La première requête bases a révélé « tour Eiffel » comme faux positif de la hiérarchie Wikidata ; le filtre P31 explicite militaire a été ajouté, puis le contrôle réel a été refait. Cela ne transforme pas Wikidata en inventaire officiel des bases actives : la caveat reste affichée.

## Seconde passe — sélection des bases par notabilité (19/10/2026)

### Implémentation vérifiée

- Le `LIMIT 500` global, sans ordre, est supprimé. Les six classes militaires Wikidata sont interrogées séparément, au plus quatre fois par classe avec `LIMIT 250` et `OFFSET` : chaque requête reste limitée et a un délai client de 30 s, inférieur au plafond Wikidata de 60 s.
- `wikibase:sitelinks` est obligatoire pour les installations usuelles (au moins 1) et vaut au moins 5 pour les casernes/garnisons. Après agrégation et dédoublonnage des intersections de classes, les features sont triées par sitelinks décroissants, puis nom, et plafonnées à 4 000. Cette borne empêche de transformer le calque en inventaire historique massif ; le contrôle ci-dessous s'arrête à 2 349, donc sans troncature finale.
- `properties.type` est la catégorie de la classe `P31` sélectionnée, jamais une inférence depuis le nom : `aérienne`, `navale`, `terrestre` ou `autre`. `properties.sitelinks`, `operator` (`P137`) et les pays `P17` ISO3 restent visibles et vérifiables. Plusieurs valeurs de pays/opérateurs sont conservées lorsqu'elles sont publiées.
- Les tests sur fixture couvrent l'ordre par sitelinks, le type dérivé, les fermetures/abandons, le seuil de notabilité des casernes et la pagination. Ils n'appellent pas le réseau.

### Contrôle réel isolé (Wikidata, 19/10/2026)

Collecte sans cache applicatif : **2 349** features, en 67 s (14 pages réellement nécessaires) : **789 aériennes**, **205 navales**, **897 terrestres**, **458 autres**. Ce contrôle réseau ne fait pas partie des tests automatisés.

| Référence demandée | Résultat | Évidence observée |
|---|---|---|
| Ramstein Air Base | Présente | `DEU`, `United States Air Force`, aérienne, 37 sitelinks. |
| Diego Garcia — Naval Support Facility | Présente | `GBR` et `MUS` publiés par Wikidata, `United States Navy`, terrestre, 11 sitelinks. |
| Camp Lemonnier | Absente | `Q2935221` a une coordonnée et 11 sitelinks, mais son `P31` est `Q1198413`, hors des six classes directes retenues ; aucune insertion manuelle. |
| Base navale de Toulon | Absente | La fiche pertinente est l'arsenal de Toulon `Q1564994`, avec coordonnée et 10 sitelinks, mais `P31 Q1745026` (arsenal), hors des classes directes ; aucune insertion manuelle. |
| Al Udeid Air Base | Présente | `Q542588`, `P31 Q695850`, coordonnée et 26 sitelinks ; libellé de sortie Wikidata : « base aérienne Al Oudeid ». |
| Base navale de Sébastopol | Présente | `RUS`, navale, 18 sitelinks (un aéroport homonyme est aussi publié séparément). |
| Installation navale russe à Tartous | Présente | `SYR`, `Russian Navy · Soviet Navy`, navale, 20 sitelinks. |
| Yokosuka | Présente | Base navale de Yokosuka : `JPN`, `United States Navy`, navale, 11 sitelinks (une seconde fiche Wikidata homonyme, 4 sitelinks, est aussi publiée). |
| Guantánamo Bay Naval Base | Présente | `Q762570`, `P31 Q1324633`, coordonnée et 44 sitelinks ; libellé de sortie : « base navale de la baie de Guantánamo ». |
| Hmeimim | Présente | `SYR`, `Russian Air Force`, aérienne, 25 sitelinks. |
| Base chinoise à Djibouti | Présente | `Q30693574`, `P31 Q1324633`, coordonnée, 12 sitelinks ; pays hôte `DJI`, exploitant `Q755179` (PLA Navy). |

Les deux absences sont des limites de classification P31 explicites, non des ajouts silencieux ni une absence géographique. Le type de Diego Garcia est `terrestre` car la classe P31 retournée relève de la base militaire, même si son exploitant est la marine américaine : aucune requalification par le nom ou l'exploitant n'est faite.

## Vérifications

- `pnpm exec vitest run tests/layers-loaders.test.ts tests/layers-route.test.ts --reporter=dot` : **10 tests verts**. Fixtures locales seulement, aucun réseau.
- `pnpm test --exclude tests/ui-feeds.test.ts` : **234 tests verts, 2 ignorés**, aucun échec. `tests/ui-feeds.test.ts` est volontairement exclu car une autre équipe le modifie.
- Contrôle réel : scripts temporaires `/tmp/orbital-layers-real.test.ts` et `/tmp/orbital-layers-r3.test.ts`, avec cache séparé sous `/tmp/orbital-layers-real-cache-20261019-*` ; résultats ci-dessus.
- `pnpm typecheck` : **succès** après intégration du travail parallèle. Aucun fichier `src/components/**` n'a été modifié ici.
- `next build` non lancé, conformément aux règles communes ; aucun serveur n'a été démarré, arrêté ou redémarré.

## Fichiers ajoutés ou modifiés

- Seconde passe : `src/server/layers/wikidata.ts`, `src/server/layers/index.ts`, `tests/layers-loaders.test.ts`, `tests/fixtures/layers/wikidata-military.json`, ce rapport
- Première passe : `src/server/layers/common.ts`, `wikidata.ts`, `cables.ts`, `country.ts`, `sanctions.ts`, `index.ts`
- `src/app/api/layers/route.ts`
- `tests/layers-loaders.test.ts`, `tests/layers-route.test.ts`, `tests/fixtures/layers/*`
- `.gitignore` (cache `data/layers/`)
- ce rapport
