# Globe 2.0 Phase 2 — ORBITAL Camera Engine

**Laboratoire isolé, sans changement du globe de production.** Le moteur est interne à ORBITAL. Three.js ne sert qu'au rendu ; ni Cesium ni viewer cartographique tiers, terrain, imagerie externe ou clé API ne sont utilisés.

## Tester localement

Depuis la racine du dépôt, avec Node 22 ou 24 et les dépendances installées :

```bash
pnpm dev --port 3011
```

Ouvrir **http://localhost:3011/lab/globe2-camera**. Le globe apparaît sans réseau externe. Glisser pour tourner, `Maj` + glisser pour déplacer la cible, molette ou pincement pour zoomer, `Maj` + molette ou deux doigts verticaux pour incliner. Les boutons permettent SPACE → DISTRICT, des destinations, north-up, suivi synthétique et reset. Une interaction utilisateur annule le fly-to en cours. `prefers-reduced-motion` supprime l'inertie et termine les déplacements commandés immédiatement.

La capture reproductible utilise `node scripts/capture-globe2-camera.mjs` pendant que le laboratoire tourne. Les [six captures et la vidéo](globe2-camera-lab/) sont des sorties Playwright Chromium locales. Le [journal de mesures](globe2-camera-lab/measurements.json) conserve les valeurs du panneau debug au moment de chaque capture.

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

`CameraThreeAdapter.ts` convertit la pose et l'origine ECEF en axes de rendu, met à jour `THREE.PerspectiveCamera` et déplace le groupe du globe en une étape de frame. `originEpoch` augmente lors d'un rebase ; les positions et le picking devront partager cet epoch lors de l'intégration future. Le seuil provisoire est `max(500 m, 15 % de la hauteur de l'œil)`. Le labo utilise `logarithmicDepthBuffer` de Three.js, near/far adaptatifs, collision avec **l'ellipsoïde uniquement** et une grille locale de repérage. Aucune collision terrain n'est revendiquée.

`ViewFootprint` échantillonne neuf rayons écran contre l'ellipsoïde : centre si visible, bboxes découpées à l'antiméridien, étendue de sol estimée, horizon/partiel et `revision`. Si l'espace ou l'horizon rendent l'empreinte partielle, la bbox est volontairement mondiale afin d'éviter une sous-couverture silencieuse ; le futur Tile Engine devra produire une enveloppe plus serrée et conservative. Aucun Semantic Zoom n'est implémenté.

## Mesures et limites constatées

Les captures locales Chromium headless du 28 octobre 2026 indiquent **30–36 FPS desktop** à 1440×900 et **60 FPS** au viewport mobile 390×844 dans les états fixes photographiés. Ce sont des indications sur cette machine, pas un benchmark matériel contrôlé ni une garantie produit. Le temps `step()` du moteur est instrumenté ; sa valeur affichée au repos est inférieure à la résolution pratique de l'horloge du navigateur. Les captures montrent 66 rebases cumulés après plusieurs fly-to et inclinaisons, et non 66 rebases par frame. Le labo n'utilise aucun `setState` React à chaque RAF : le debug est publié environ toutes les 160 ms.

Au niveau CITY/DISTRICT, la surface est un ellipsoïde sombre avec grille, **sans bâtiments, routes, terrain, DEM ni imagerie**. Les repères locaux et l'horizon oblique permettent de tester la caméra, mais ne préfigurent pas le rendu final. Le zoom au pointeur utilise une correction tangentielle approximative ; près de l'horizon, il revient au zoom central si le rayon ne touche pas le sol. Le mode `surface` existe dans l'état mais n'a pas encore de locomotion distincte ; le mode `track` est démontré uniquement sur une cible synthétique. Les bboxes partielles sont larges, et la précision visuelle au sol avec géométrie GPU float n'est pas encore qualifiée. Aucune de ces limites n'autorise une migration du globe de production.
