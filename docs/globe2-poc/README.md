# Globe 2.0 — POC CesiumJS (revue uniquement)

**POC / NE PAS MERGER EN PRODUCTION.** Route isolée : `/lab/globe2`. Base Git : `465747d4d2d44a8c12cbfa94fec8718b1dc5a1e1` (PR caméras worldwide fusionnée). Le globe Three.js, les feeds, les caméras et les pipelines de production n'ont pas été modifiés.

## Ce qui est effectivement prouvé

- CesiumJS 1.146.0 (Apache-2.0) fonctionne avec Next.js 15 et React 19 dans une route client isolée. Le Viewer, les listeners, le gestionnaire de sélection et le contexte WebGL sont détruits à la sortie.
- Navigation continue espace → continent → pays → région → ville → quartier. Les vues proches deviennent obliques avec horizon et commandes Cesium. L'état sémantique combine hauteur, FOV, taille du viewport et étendue visible avec hystérésis.
- Fond ORBITAL sombre : géographie Natural Earth déjà embarquée, dessinée localement en texture, couleur/saturation du globe, atmosphère atténuée. Aucun fond touristique ni jeton ion. La texture 2048×1024 ne fournit **pas** de détail géographique urbain ; les captures ville/quartier montrent honnêtement cette limite.
- Terrain local de secours (`EllipsoidTerrainProvider`) sans réseau. Terrain quantized mesh ouvert Re:Earth / Mapterhorn, activé manuellement ; dans le benchmark final Alpes, 127 requêtes de terrain, aucune erreur HTTP observée. Des courbes d'altitude cyan montrent le relief réel. Le code source de ce service est [MIT](https://github.com/reearth/reearth-terrain), les données DEM Mapterhorn sont [CC BY 4.0](https://github.com/reearth/reearth-terrain#data-sources). La disponibilité du service hébergé n'est pas garantie. Une production devrait évaluer un miroir ou une instance auto-hébergée.
- Serveur de laboratoire : 20 000 caméras et 15 000 satellites **synthétiques déterministes**, sans média. Le client demande une bbox, reçoit des cellules de densité à vue planète et des individus à vue ville, avec plafond de 1 200 objets. Les 35 000 positions ne résident jamais côté navigateur. Une marge de bbox et un debounce limitent les trous et les requêtes. La sélection reste visible après dézoom.
- Avion, navire militaire et cargo restent des silhouettes distinctes, à taille écran fixe et orientées selon leur cap projeté. Les éléments normaux respectent l'occlusion du globe ; la sélection a un rendu séparé. Un satellite individuel au niveau pays affiche une orbite illustrative synthétique. Test Playwright : clic avion, clic caméra, clic satellite, orbite, sélection persistante, zéro JPEG/HLS chargé, navigation et destruction.

## Architecture de laboratoire

`/lab/globe2` charge un composant client Cesium. L'API `/api/lab/globe2/catalog` fabrique les données de charge sur le serveur et répond selon bbox + état sémantique. Le navigateur maintient au maximum une collection Cesium de points et deux collections de billboards ; aucun Mesh React par objet. Les données métier de `useIntelStore`, les routes `/api/cameras` et le globe Three.js restent indépendants. Le terrain est un provider interchangeable : ellipsoïde local ou URL quantized mesh ouverte, avec repli en cas d'échec d'initialisation.

La bbox vient de `Camera.computeViewRectangle()` puis, si nécessaire en vue oblique, d'intersections échantillonnées sur l'ellipsoïde. L'antiméridien est pris en charge. Ce POC ne résout pas encore l'agrégation des compteurs sur une vraie base géospatiale mondiale, ni le cache CDN par tuile, ni l'actualisation des objets mobiles.

## Intégration Next / CSP / coût

L'import ESM direct de Cesium 1.146.0 compile, mais le chunk Next généré pour `@spz-loader/core` contient une séquence octale interdite dans un template string ; Chromium refuse ce chunk. Le POC charge donc le bundle officiel Cesium comme script **uniquement sur cette route**, depuis `public/lab/cesium`. `predev`/`prebuild` copient ses assets depuis le paquet npm ; les 14 Mo générés sont ignorés par Git. `Cesium.js` pèse 6,08 Mo brut, environ 1,78 Mo gzip. La page principale garde un premier chargement JS de ~104 Ko selon `next build` ; ce poids Cesium n'est demandé que sur la route lab.

Le bundle officiel utilise `eval`, WebAssembly et des workers blob. La CSP du laboratoire doit autoriser `blob:`, `unsafe-eval` et `wasm-unsafe-eval` dans `script-src`, plus `terrain.reearth.land` dans `connect-src`. Ces exceptions sont **strictement limitées à `/lab/globe2`** ; la CSP ORBITAL de `/` ne change pas. C'est un obstacle sérieux pour une intégration du Viewer à la page principale. Une version produit devrait résoudre le packaging Cesium/Next ou isoler le moteur dans une surface dédiée avant toute migration.

## Benchmark reproductible

Commande : `node scripts/benchmark-globe2.cjs` contre `pnpm start -p 3011 -H 127.0.0.1`. Chromium 156 headless utilise **ANGLE SwiftShader logiciel** sur cette machine. Node local 26.12 est hors matrice CI 22/24. Une seule passe par scénario ; FPS et frame time sont des moyennes glissantes Cesium après ~2,2 s, **non représentatifs d'un GPU utilisateur**. `benchmark.json` conserve les valeurs brutes, les captures sont dans ce dossier.

| Vue | Scénario | FPS | Frame ms | Objets rendus | Candidats bbox | Heap JS |
|---|---|---:|---:|---:|---:|---:|
| 2560×1440 | Globe seul | 7 | 136,4 | 0 | 0 | ~33 Mo |
| 2560×1440 | + 3 mobiles | 7 | 150,1 | 3 | 0 | ~33 Mo |
| 2560×1440 | 20k caméras | 6 | 156,0 | 120 | 20 000 | ~33 Mo |
| 2560×1440 | 15k satellites | 6 | 155,9 | 120 | 15 000 | ~33 Mo |
| 2560×1440 | Tout | 6 | 156,6 | 243 | 35 000 | ~33 Mo |
| 390×844 | Globe seul | 22 | 44,5 | 0 | 0 | ~33 Mo |
| 390×844 | + 3 mobiles | 19 | 51,3 | 3 | 0 | ~33 Mo |
| 390×844 | 20k caméras | 19 | 53,0 | 120 | 20 000 | ~33 Mo |
| 390×844 | 15k satellites | 19 | 53,1 | 120 | 15 000 | ~33 Mo |
| 390×844 | Tout | 20 | 50,4 | 243 | 35 000 | ~33 Mo |

Les nombres 20k/15k sont des candidats **serveur**, pas des primitives GPU. 243 objets seulement sont rendus à vue planète. Le navigateur a fait trois requêtes catalogue en passant successivement par caméras, satellites et tout, aucune en globe seul/mobiles. Le temps de mise en route Cesium a été de 1,72 s en 1440p et 0,83 s sur viewport mobile, après serveur prêt. Le baseline Three actuel a montré un canvas en 4,88 s et ~21 Mo de heap, mais il charge une application et des feeds différents (indisponibles pendant le test) : ces temps **ne sont pas une comparaison de moteur contrôlée**. Une autre passe SwiftShader donnait 4 FPS en 1440p et environ 16 FPS mobile : la variation entre passes confirme la nécessité de mesures matérielles répétées. Les draw calls et la mémoire GPU ne sont pas exposés par l'API publique utilisée ici ; ils restent non mesurés.

### Captures

- [Globe Three.js actuel](three-current-1440p.png), avec feeds indisponibles pendant la capture.
- [Cesium planète](cesium-planet-1440p.png), [réseau planète](cesium-combined-desktop-1440p.png).
- [Cesium ville](cesium-city-1440p.png), [quartier](cesium-district-1440p.png), [relief Alpes](cesium-alps-terrain-1440p.png), [mobile](cesium-combined-mobile-390x844.png).

## Comparaison de fondation

| Critère | Three.js actuel | CesiumJS 1.146 POC |
|---|---|---|
| Terre ORBITAL | Identité holographique déjà aboutie | Reproduction partielle ; atmosphère et basemap à retravailler |
| Coordonnées / terrain | Géométrie sphérique maison ; relief à construire | WGS84, quantized mesh et terrain interchangeable déjà présents |
| Zoom proche / oblique | Limité par la caméra et le maillage actuels | Navigation et profondeur de zoom démontrées, mais carte urbaine absente |
| 3D Tiles / LOD | Infrastructure à développer | Écosystème Cesium natif ; 3D Tiles non testé ici |
| Couches mobiles | Shader ORBITAL très efficace, silhouettes contrôlées | Billboards silhouettes et picking démontrés ; adaptation de toutes les couches à faire |
| Caméras / satellites | Clustering actuel limité | Bbox et cellules serveur démontrées sur données synthétiques ; vrai stockage à créer |
| Performance | Optimisée pour la scène actuelle | 4–7 FPS en 1440p SwiftShader selon la passe ; GPU réel non mesuré |
| Bundle / CSP | Build et CSP actuels | +6,08 Mo de script lab ; exception CSP lab pour eval/wasm/blob |
| Dépendance | Three.js et assets locaux | CesiumJS libre ; relief ouvert optionnel et auto-hébergeable |

## Recommandation : **HYBRIDE, conditionnelle**

Cesium est une fondation géospatiale crédible pour le zoom, le terrain et les 3D Tiles, mais le POC **ne justifie pas** de remplacer maintenant le globe Three.js. L'identité visuelle à l'échelle ville, la CSP, le poids et les performances matérielles sont non résolus. Conserver le globe Three.js actuel ; poursuivre un laboratoire Cesium pour la vue région/ville et une stratégie de basemap/terrain sombre, puis refaire un benchmark sur GPU desktop et téléphone physiques avec les mêmes données et effets.

Si Cesium est retenu plus tard : (1) unifier les contrats de caméra/viewport et la sélection Zustand ; (2) convertir les couches événements, mobiles, caméras, satellites en collections Cesium avec budgets et occlusion ; (3) créer des tuiles géospatiales et compteurs serveur réels, cache et pagination ; (4) choisir une basemap légale détaillée et un terrain auto-hébergé ou contractuellement fiable ; (5) résoudre le bundle ESM et la CSP sans `unsafe-eval` sur la page principale ; (6) vérifier WebGL, mémoire GPU, draw calls, FPS et batteries sur appareils réels ; (7) prévoir attribution, fallback, accessibilité et tests de navigation de route. Aucune de ces migrations n'a commencé dans ce POC.

Sources techniques : [CesiumJS quickstart et assets](https://cesium.com/learn/cesiumjs-learn/cesiumjs-quickstart/), [Viewer](https://cesium.com/learn/cesiumjs/ref-doc/Viewer.html), [BillboardCollection](https://cesium.com/learn/cesiumjs/ref-doc/BillboardCollection.html), [terrain](https://cesium.com/learn/cesiumjs/ref-doc/CesiumTerrainProvider.html), [Re:Earth terrain](https://github.com/reearth/reearth-terrain).
