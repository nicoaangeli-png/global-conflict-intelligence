# Globe 2.0 Phase 3A — ORBITAL Tile Engine + LOD

**Laboratoire isolé. Aucun terrain, DEM, imagerie externe ou changement du globe de production.** Three.js ne reçoit que des buffers de debug ; l'index et la sélection sont du TypeScript pur.

## Essai manuel principal

Depuis la racine du dépôt, avec Node 22 ou 24 et les dépendances installées :

```bash
pnpm dev --port 3011
```

Ouvrir **http://localhost:3011/lab/globe2-tiles**. La Terre et les 177 pays Natural Earth locaux restent visibles. Tourner, zoomer SPACE → DISTRICT, incliner, essayer France, Paris, Alpes, antiméridien et pôle Nord. Les boutons `CUBE-SPHERE` et `GEOGRAPHIC` changent l'index sous la même caméra. `MASQUER PATCHES` masque les limites ; `SURFACE +` ajoute des patches remplis translucides pour inspecter la couverture et les coutures. Le panneau Tile/LOD montre les tuiles conservées, profondeurs, culls, subdivisions, changements, dernière sélection CPU, erreur écran et saturation du budget. Les chiffres « visibles » sont des **candidats conservés par culling conservateur**, pas un comptage de pixels réellement rasterisés.

Les [captures de comparaison](globe2-tile-lab/) et le [journal de debug](globe2-tile-lab/measurements.json) sont des preuves secondaires ; l'essai dans le navigateur est le critère de validation.

## Architecture et conventions

`src/lib/globe2/tiles/indexing.ts` expose `TileId`, `rootTiles`, `parentTile`, `childTiles`, `tileAt`, `tilePoint`, `neighborTile`, `tileBound`. Les IDs sont `strategy/face/z/x/y`. Le cube possède six faces gnomoniques `px/nx/py/ny/pz/nz` ; l'index géographique possède deux racines hémisphériques `west/east`, avec wrap ±180° et absence explicite de voisin nord/sud au pôle. `tilePoint` produit latitude/longitude ; `toEcef` du Geo Core place les bornes et patches sur WGS84. Aucun fournisseur ne définit l'index interne.

`TileEngine` reçoit la `CameraPose` et le `ViewFootprint` existants. Il conserve un cache de sphères ECEF échantillonnées, écarte de manière conservative hors frustum/horizon, estime une erreur géométrique **abstraite** en pixels à partir de FOV, viewport, distance et taille angulaire, puis subdivise les candidats prioritaires. Le centre du footprint reçoit un léger bonus de priorité. Un footprint partiel ou trop large ne supprime aucune tuile : ceci évite un trou dû à la bbox mondiale conservative de Phase 2. Une tile est supprimée si ses quatre enfants sont tous écartés par le culling. L'hystérésis sépare les seuils d'entrée/sortie de 18 %.

Budget de labo : profondeur maximale 12, 256 candidats desktop / 128 mobile, SSE cible 2,5 px, cache de bounds élagué au-delà de 8 192 entrées et états lifecycle élagués au-delà de 4 096. Le lifecycle `idle → queued → loading → ready → visible → evictable` est explicite, mais les patches sont préparés **synchroniquement et localement** : aucune requête réseau ni prétendue donnée terrain. Le prochain chargeur asynchrone devra conserver un parent prêt pendant la préparation des enfants et implémenter abort, priorité et éviction GPU.

`TileDebugLayer.ts` fusionne toutes les limites dans **un `THREE.LineSegments`** et, sur demande, les surfaces dans **un mesh**. Les positions sont converties en coordonnées relatives à l'origine flottante ; la géométrie est reconstruite à un changement de sélection ou d'`originEpoch`, jamais via un Mesh React par tuile. Le labo publie le debug React environ toutes les 160 ms. Le rendu Natural Earth Phase 2 est conservé.

## Mesures comparatives

Un passage local déterministe le 28 octobre 2026 : `ORBITAL_TILE_BENCHMARK=1 ./node_modules/.bin/vitest run tests/globe2-tile-benchmark.test.ts --reporter=verbose`. Même Camera Engine, mêmes destinations, viewport 1440×900, 24 pas de déplacement `orbit(3,1)` par scénario. **Temps CPU réels de cette exécution Node 26 ; matériel et JIT non contrôlés.** Les nombres de tuiles, profondeurs et changements sont déterministes pour cette configuration ; les millisecondes ne le sont pas. `C/G` signifie cube-sphere / geographic.

| Vue | Tuiles C/G | LOD max C/G | Changements sur 24 pas C/G | CPU moyen par pas C/G | Observation |
| --- | ---: | ---: | ---: | ---: | --- |
| SPACE | 60 / 84 | 2 / 3 | 3 / 4 | 0,28 / 0,30 ms | Les deux couvrent le globe. |
| CONTINENT | 256 / 256 | 4 / 5 | 94 / 88 | 2,28 / 2,87 ms | Les deux saturent 256 ; SSE max 4,1 / 4,8 px. |
| COUNTRY | 102 / 100 | 5 / 6 | 8 / 9 | 0,92 / 0,81 ms | Très proches. |
| CITY | 13 / 12 | 8 / 9 | 0 / 0 | 0,19 / 0,21 ms | Aucun terrain détaillé. |
| DISTRICT | 12 / 12 | 10 / 11 | 0 / 0 | 0,14 / 0,15 ms | La limite visuelle vient de Natural Earth 110m. |
| ANTIMÉRIDIEN | 108 / 126 | 5 / 6 | 18 / 22 | 0,77 / 0,95 ms | Wrap géographique correct, cube plus parcimonieux. |
| PÔLE NORD | 100 / 256 | 5 / 5 | 486 / 984 | 0,72 / 2,21 ms | Géographique saturé, SSE max 14,8 px contre 2,9 px cube. |
| OBLIQUE | 81 / 94 | 6 / 7 | 4 / 1 | 0,36 / 0,48 ms | Les deux conservent des patches. |

Au niveau 3, le ratio **estimé** de surface locale maximale/minimale des patches vaut 3,88 cube et 4,97 geographic. C'est un proxy jacobien au centre, pas une mesure de surface géodésique intégrée. Les voisins traversant une face/racine représentent 192/1 536 arêtes cube et 32/480 geographic : le cube coûte davantage en logique de voisinage. Les tests d'arête au niveau 2 donnent un écart ECEF inférieur à 1 µm sur les points échantillonnés, y compris les faces cube ; la couture géographique ±180° passe la même borne. Les captures montrent les limites et les surfaces sans trou majeur observé ; elles ne prouvent ni étanchéité d'un futur DEM ni continuité GPU subpixel.

Les captures Playwright headless du labo donnent environ **18–30 FPS desktop** sur les vues photographiées et **48 FPS mobile** dans cette exécution locale. Ce sont des indications ponctuelles, sans mesure GPU ni comparaison matérielle contrôlée. Le mode surface rempli est optionnel, car sa transparence ajoute du fill rate. Objectifs provisoires pour l'étape suivante : sélection typique < 3 ms desktop, < 5 ms mobile, budget de candidats explicite, aucun trou lors d'un chargement asynchrone, aucune fuite de textures/buffers. Ces objectifs ne sont pas une garantie atteinte sur tous les scénarios.

## Décision et limites

**Recommandation Phase 3A : CUBE-SPHERE** pour l'index interne. Le gain le plus net et reproductible est polaire : 100 contre 256 candidats, erreur écran 2,9 contre 14,8 px et environ moitié moins de changements sur le même drag. Le cube consomme aussi moins de patches à SPACE et à l'antiméridien. Ses voisins inter-faces sont plus complexes ; cette complexité est testée au niveau géométrique mais restera à valider pour de vraies élévations. D05 est mise à jour pour l'index, sans prétendre que la couture terrain est résolue.

Avant Phase 3B, résoudre ou prouver : saturation continentale à 256 tuiles ; sélection très mobile près du pôle même pour le cube pendant un drag réellement étendu ; stratégie de parent prêt pendant le chargement d'enfants ; voisinage et couture avec différentes élévations/LOD ; décodage et annulation réseau ; budgets GPU/mobile mesurés ; source DEM, datum vertical et licence. Aucune de ces données n'est inventée ici.

## Validation

`tests/globe2-tile-engine.test.ts` vérifie racines, hiérarchie, couverture globale, voisins, continuité inter-faces, seam ±180°, pôles, bounds, culling, couverture de 25 rayons écran sur six vues pour chaque stratégie, SSE/viewport/FOV, oblique, origine flottante, hystérésis, déterminisme et entrées invalides. `tests/globe2-tile-benchmark.test.ts` conserve les scénarios comparables. `tests/e2e/globe2-tiles-lab.spec.ts` ouvre le vrai labo en Chromium desktop et mobile, manipule les deux stratégies, les presets, les destinations, le drag, le zoom, l'oblique et les overlays, puis vérifie l'absence d'erreur console critique. Le Camera Lab Phase 2 reste testé séparément.
