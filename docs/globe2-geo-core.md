# Globe 2.0 Phase 1 — Geo Core ORBITAL

Module autonome `src/lib/globe2/geo`, sans Three.js, WebGL, Cesium ni appel réseau. Il n'est pas connecté au globe de production. La projection sphérique de `src/lib/geo/latlon.ts` reste inchangée et utilisée par l'application actuelle.

## Contrat public

L'entrée source `SourceGeoPoint` conserve `heightM: number | null` et `verticalDatum`. `resolveSourcePosition(source, provenance)` produit un `GeoPoint` canonique uniquement pour une altitude finie déclarée `WGS84_ELLIPSOID` avec une provenance non vide. MSL et AGL exigent un futur modèle vérifié ; `UNKNOWN` et `null` restent non résolus. `clampToTerrain` sera une politique de rendu explicite dans une phase future, jamais une conversion géodésique cachée.

Toutes les fonctions publiques sont exportées par `src/lib/globe2/geo/index.ts` :

| Domaine | API |
| --- | --- |
| Validation / WGS84 | `normalizeLongitude`, `assertGeoPoint`, `assertEcef`, `resolveSourcePosition`, `toEcef`, `fromEcef` ; constantes `WGS84_A_M`, `WGS84_B_M`, `WGS84_INV_F`, `WGS84_F`, `WGS84_E2` |
| Local ENU | `enuFrame`, `ecefToEnu`, `enuToEcef` |
| Emprises | `assertBBox`, `normalizeBBox`, `splitBBox`, `bboxIntersects`, `bboxContains` |
| Distances | `chordDistanceMeters`, `geodesicDistance` |
| Origine flottante | `createFloatingOrigin`, `rebaseFloatingOrigin`, `ecefToRender`, `renderToEcef` |
| Horizon | `rayEllipsoidIntersection`, `isOccludedByEllipsoid` |

`GeoPoint` utilise latitude `[-90,90]`, longitude normalisée `[-180,180)` et hauteur ellipsoïdale WGS84 en mètres. Les calculs CPU utilisent `number` double précision. ECEF suit X = équateur/Greenwich, Y = équateur/90° E, Z = pôle Nord. ENU est un repère tangent droitier. L'axe de rendu explicite est `(ECEF.X, ECEF.Z, -ECEF.Y)` après soustraction de l'origine en double ; `originEpoch` invalide les positions relatives d'une ancienne origine. Aucune conversion `Float32Array` n'est réalisée dans ce module.

Constantes de l'ellipsoïde : demi-grand axe `6 378 137 m`, aplatissement inverse `298.257223563`, conformément à la [définition WGS 84 de la NGA](https://earth-info.nga.mil/index.php?action=wgs84&dir=wgs84). `toEcef` applique la formule du rayon de courbure prime vertical. `fromEcef` utilise une itération bornée (20 passes max), avec branches explicites pour les pôles et le centre terrestre. `geodesicDistance` utilise l'inverse de Vincenty sur l'ellipsoïde ; près des antipodes, il retourne `non-convergent` après 200 itérations au lieu d'inventer une distance sphérique. La hauteur est ignorée pour cette distance de surface ; la distance corde ECEF est distincte.

## Précision mesurée

Sur 10 000 points déterministes (latitude de -85° à 85°, longitude sur toute la Terre, hauteur de -500 à 12 500 m), sous Node 26.12.0 local : erreur maximale **de re-projection ECEF** après aller-retour `GeoPoint → ECEF → GeoPoint → ECEF` : `5.4506004577692305e-9 m` ; erreur maximale de hauteur : `2.306478563696146e-9 m`. Les tests imposent chacun `≤ 0,01 m`. Ces mesures montrent la cohérence interne des deux fonctions sur cet échantillon, **pas** la précision absolue d'une position source, d'un datum vertical, ni une comparaison indépendante à une bibliothèque géodésique de référence. La précision réelle à l'écran après quantification GPU reste à mesurer dans une autre phase.

## Cas limites et limites de portée

- Le centre de la Terre est rejeté, car latitude et longitude y sont indéfinies. Au pôle exact, la longitude retournée est conventionnellement `0°` ; toutes les longitudes décrivent ce même point physique.
- `normalizeBBox` conserve la couverture mondiale `[-180,180]`. `splitBBox` découpe une emprise traversant l'antiméridien en deux intervalles. Aux pôles exacts, les longitudes se rejoignent. Les bboxes restent des enveloppes ; elles ne représentent pas exactement une empreinte oblique.
- `rayEllipsoidIntersection` intersecte **l'ellipsoïde WGS84**, pas le terrain ; `t` est exprimé dans l'unité du vecteur direction fourni. `isOccludedByEllipsoid` ne doit pas être utilisé seul pour éliminer des tuiles dont le terrain peut dépasser ou descendre sous cet ellipsoïde. Une future culling de terrain devra utiliser des bornes d'altitude vérifiées et garder les cas incertains visibles.
- La Phase 1 n'embarque aucun géoïde, DEM, format de tuile, SDK cartographique, moteur caméra ou adaptation du globe de production. Le raccordement, la validation de référence indépendante et le budget GPU appartiennent aux phases suivantes.
