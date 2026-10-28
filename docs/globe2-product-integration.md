# Globe 2.0 — laboratoire produit cumulatif

Depuis la racine du dépôt, avec Node 22 ou 24 :

```bash
pnpm dev --port 3011
```

Ouvrir **http://localhost:3011/lab/globe2**. Ce laboratoire est distinct de `/`, qui conserve le globe de production actuel.

## Ce que montre la première intégration

- Le **Geo Core WGS84/ECEF**, le **Camera Engine**, l'**origine flottante** et le **Tile Engine cube-sphere** portent la navigation et la sélection LOD. Three.js ne sert qu'au rendu. Les limites de tuiles et les panneaux techniques sont cachés à l'ouverture ; le bouton `DEBUG +` les rend accessibles.
- Les presets `SPACE` à `DISTRICT`, les destinations Monde, Europe, France, Paris et Alpes, la rotation, le pan, la molette, le tactile, la vue oblique et le fly-to utilisent le nouveau moteur de caméra.
- Le rendu à distance réutilise les **shaders hologramme, atmosphère et points**, ainsi que la palette, les valeurs de halo, le graticule, les arcs et le fond spatial d'ORBITAL. Les continents, frontières et villes proviennent des assets Natural Earth locaux. Leurs positions 3D sont calculées par le Geo Core ; l'ancienne projection sphérique n'est pas utilisée pour les placer.
- À courte distance, une surface sombre Natural Earth et un repère tangent local prennent le relais. Les données locales sont à l'échelle 110m : elles ne décrivent **ni rues, ni bâtiments, ni terrain**. Le zoom CITY/DISTRICT est une validation de navigation et de précision, pas une carte urbaine détaillée.

Cette première étape n'intègre pas encore les signaux, le live feed ou les autres couches métier. Ils seront ajoutés sur **la même route** lors des itérations suivantes, sans remplacer le globe de production avant validation produit.
