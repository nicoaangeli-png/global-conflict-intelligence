# Globe 2.0 Phase 2 — ORBITAL Camera Engine

**Laboratoire isolé, sans changement du globe de production.** Le moteur est interne à ORBITAL. Three.js ne sert qu'au rendu ; ni Cesium ni viewer cartographique tiers, terrain, imagerie externe ou clé API ne sont utilisés.

## Tester localement

Depuis la racine du dépôt, avec Node 22 ou 24 et les dépendances installées :

```bash
pnpm dev --port 3011
```

Ouvrir **http://localhost:3011/lab/globe2-camera**. C'est le livrable principal : le globe interactif charge automatiquement les 177 pays Natural Earth déjà présents dans `public/data/ne_110m_countries.geojson`, sans fournisseur ni commande de génération d'assets. Les continents, les côtes et les frontières sont visibles ; la France est distinguée dans le rendu et peut être atteinte par le preset COUNTRY ou la destination FRANCE. Le statut Natural Earth en bas de page confirme le chargement réel et signale explicitement une erreur éventuelle. Glisser pour tourner, `Maj` + glisser pour déplacer la cible, molette ou pincement pour zoomer, `Maj` + molette ou deux doigts verticaux pour incliner. Les boutons permettent SPACE → DISTRICT, Europe, France, Paris, Alpes, antiméridien, pôle Nord, north-up, suivi synthétique et reset. Une interaction utilisateur annule le fly-to en cours. `prefers-reduced-motion` supprime l'inertie et termine les déplacements commandés immédiatement.

Les captures sont une preuve secondaire. La capture reproductible utilise `node scripts/capture-globe2-camera.mjs` pendant que le laboratoire tourne et attend explicitement le chargement des pays. Les [six captures et la vidéo](globe2-camera-lab/) sont des sorties Playwright Chromium locales. Le [journal de mesures](globe2-camera-lab/measurements.json) conserve les valeurs du panneau debug au moment de chaque capture.

| Vue | Capture |
| --- | --- |
| SPACE 1440×900 | [01-space.png](globe2-camera-lab/01-space.png) |
| COUNTRY 1440×900 | [02-country.png](globe2-camera-lab/02-country.png) |
| CITY 1440×900 | [03-city.png](globe2-camera-lab/03-city.png) |
| DISTRICT 1440×900 | [04-district.png](globe2-camera-lab/04-district.png) |
| Oblique 1440×900 | [05-oblique.png](globe2-camera-lab/05-oblique.png) |
| Mobile 390×844 | [06-mobile-390x844.png](globe2-camera-lab/06-mobile-390x844.png) |
| Rotation → zoom → fly-to → interruption | [07-rotation-zoom-fly-interrupt.webm](globe2-camera-lab/07-rotation-zoom-fly-interrupt.webm) (8 s) |

## Architecture et API

`src/lib/globe2/camera/CameraEngine.ts` détient la pose canonique, la cible, le mode `orbit`/`surface`/`track`, les vitesses, l'animation, la révision et l'origine flottante. Il n'importe pas Three.js. Les types et commandes discriminées sont dans `types.ts`, les opérations de vecteurs/géographie dans `math.ts`, et le calcul de l'empreinte dans `footprint.ts`. Les exports publics sont regroupés dans `index.ts` : `CameraEngine`, `computeViewFootprint`, `groundAtNdc`, `rayAtNdc`, `slerpAnchor`, `moveAnchor` et leurs types.

Le moteur expose `getState()`, `getPose()`, `getViewFootprint()`, `getFloatingOrigin()`, `setViewport()`, `setVerticalFov()`, `beginGesture()`/`endGesture()`, `orbit()`, `pan()`, `zoomBy()`/`zoomAtPointer()`, `tilt()`, `northUp()`, `reset()`, `setMode()`, `flyTo()`, `dispatch()`, `updateTrackedTarget()`, `stop()`, `step()` et `dispose()`. `dispatch()` accepte uniquement `flyTo`, `focus` et `track` typés. Les émetteurs `user`, `feed`, `aura` et `timeline` sont distincts ; une commande automatisée plus ancienne qu'une interaction utilisateur est refusée. Le labo n'est relié à aucun émetteur métier réel.

La pose est calculée en ECEF double précision à partir de la cible WGS84 et du repère ENU. Le `flyTo` interpole les normales géodésiques par grand cercle sphérique (`slerp`), avec plan déterministe aux antipodes ; il ne dépend pas de Vincenty, qui peut ne pas converger près des antipodes. La distance œil/cible suit une interpolation logarithmique, l'orientation suit le plus court angle et la durée est bornée à 8 s. `framing: fit` utilise un rayon de cible déclaré et le FOV ; sans rayon, la commande échoue explicitement. Cette interpolation guide une caméra, elle n'est pas une mesure géodésique de distance.

`CameraThreeAdapter.ts` convertit la pose et l'origine ECEF en axes de rendu, met à jour `THREE.PerspectiveCamera` et déplace le groupe du globe en une étape de frame. `CameraLabLand.ts` construit les sommets de l'ellipsoïde et les contours géographiques via `Geo Core Phase 1 → WGS84/ECEF → axes Three.js`. Il rasterise les polygones Natural Earth locaux comme texture de surface ; le positionnement 3D reste fixé par les sommets WGS84 du Geo Core. Les contours sont regroupés en deux draw calls, dont un pour distinguer la France. L'antiméridien est déplié avant dessin pour éviter les traits transmondiaux. Aucun ancien helper de projection sphérique n'est utilisé. `originEpoch` augmente lors d'un rebase ; les positions et le picking devront partager cet epoch lors de l'intégration future. Le seuil provisoire est `max(500 m, 15 % de la hauteur de l'œil)`. Le labo utilise `logarithmicDepthBuffer` de Three.js, near/far adaptatifs, collision avec **l'ellipsoïde uniquement** et une grille locale de repérage. Aucune collision terrain n'est revendiquée.

`ViewFootprint` échantillonne neuf rayons écran contre l'ellipsoïde : centre si visible, bboxes découpées à l'antiméridien, étendue de sol estimée, horizon/partiel et `revision`. Si l'espace ou l'horizon rendent l'empreinte partielle, la bbox est volontairement mondiale afin d'éviter une sous-couverture silencieuse ; le futur Tile Engine devra produire une enveloppe plus serrée et conservative. Aucun Semantic Zoom n'est implémenté.

## Mesures et limites constatées

Les FPS du panneau debug et du journal de mesures sont des indications sur cette machine, pas un benchmark matériel contrôlé ni une garantie produit. Le temps `step()` du moteur est instrumenté ; sa valeur affichée au repos est inférieure à la résolution pratique de l'horloge du navigateur. Les rebases affichés sont cumulés pendant la navigation, et non un nombre par frame. Le labo n'utilise aucun `setState` React à chaque RAF : le debug est publié environ toutes les 160 ms.

Au niveau CITY/DISTRICT, la surface reste un ellipsoïde avec une texture Natural Earth 110m **très généralisée**, sans bâtiments, routes, terrain, DEM ni imagerie proche. Les repères locaux et l'horizon oblique permettent de tester la caméra, mais ne préfigurent pas le rendu final. Le zoom au pointeur utilise une correction tangentielle approximative ; près de l'horizon, il revient au zoom central si le rayon ne touche pas le sol. Le mode `surface` existe dans l'état mais n'a pas encore de locomotion distincte ; le mode `track` est démontré uniquement sur une cible synthétique. Les bboxes partielles sont larges, et la précision visuelle au sol avec géométrie GPU float n'est pas encore qualifiée. Aucune de ces limites n'autorise une migration du globe de production.
