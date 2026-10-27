# Globe 2.0 — décisions d'architecture, Phase 0

Base : `origin/main` `465747d4d2d44a8c12cbfa94fec8718b1dc5a1e1`. Portée : **ARCHITECTURE / DOCUMENTATION — NO PRODUCTION GLOBE CHANGE — NO DEPLOYMENT**. Ces décisions cadrent une future revue ; elles n'autorisent ni Phase 1 ni migration. Détails, audit et critères GO : [globe2-engine-spec.md](globe2-engine-spec.md).

## D01 — Moteur géospatial ORBITAL, rendu Three.js

- **DECISION** : ORBITAL possède coordonnées, caméra, visibilité, tuiles, LOD, semantic zoom, sélection et commandes ; Three.js reste la primitive de scène/GPU.
- **WHY** : contrôle de l'identité et des comportements métier sans déléguer l'expérience à un viewer.
- **ALTERNATIVES REJECTED** : CesiumJS comme moteur cible ; SDK qui impose caméra, runtime, style ou cloud.
- **CONSEQUENCES** : effort substantiel de géodésie, terrain, culling et outillage ; contrats testables requis.
- **REVERSIBILITY** : élevée tant que le moteur est isolé ; chaque module derrière adaptateur/flag.

## D02 — Géodésie canonique WGS84 en mètres

- **DECISION** : `GeoPoint` WGS84, ECEF double précision et ENU pour le local ; axes Three compatibles avec le globe courant par rotation explicite.
- **WHY** : zoom de l'espace au sol, altitudes et picking cohérents, sans utiliser le rayon graphique `1` comme unité réelle.
- **ALTERNATIVES REJECTED** : poursuivre les calculs sphériques `latlon.ts` jusqu'à STREET ; laisser une bibliothèque imposer l'API géographique.
- **CONSEQUENCES** : datums d'altitude inconnus restent inconnus ; conversions et cas limites à tester avant rendu.
- **REVERSIBILITY** : moyenne après création de données/tiles ; verrouiller convention et version dès Phase 1.

## D03 — Origine flottante unique et versionnée

- **DECISION** : ECEF global en double sur CPU, buffers GPU relatifs à une origine locale et `originEpoch` atomique.
- **WHY** : éviter tremblement/clipping en proximité du sol.
- **ALTERNATIVES REJECTED** : pousser des ECEF globaux directement en `Float32Array`, ou donner une origine indépendante à chaque couche.
- **CONSEQUENCES** : rebase coordonné de terrain, objets, caméra et picking ; seuil initial à calibrer.
- **REVERSIBILITY** : faible une fois les couches migrées ; tests d'invariance et d'epoch obligatoires.

## D04 — Caméra interne et commandes arbitrées

- **DECISION** : Camera Engine indépendant de Three, pose double précision et commandes typées ; l'utilisateur interrompt un fly-to/tracking automatisé.
- **WHY** : feed, AURA, sélection et gestes doivent piloter le même monde sans conflits.
- **ALTERNATIVES REJECTED** : exposer directement `THREE.PerspectiveCamera` à chaque panneau ; utiliser un contrôleur de viewer tiers.
- **CONSEQUENCES** : transition orbitale/oblique/sol, collision terrain et near/far à concevoir et tester.
- **REVERSIBILITY** : élevée avant branchement du globe de production ; ancien `GlobeCameraController` reste disponible.

## D05 — Quadtree cube-sphere et adaptateurs de terrain

- **DECISION** : index de tuiles interne `face/z/x/y`, sélection frustum+horizon+erreur écran ; données sources derrière des adaptateurs déclarant datum, licence et couverture.
- **WHY** : comportement stable aux pôles et contrôle du LOD/terrain sans fournisseur obligatoire.
- **ALTERNATIVES REJECTED** : imposer le découpage d'une API de tuiles ; dépendance à une source commerciale ; chargement de tout le DEM.
- **CONSEQUENCES** : coût de couture entre faces, reprojection et scheduler ; parent/ellipsoïde de secours.
- **REVERSIBILITY** : moyenne ; clé interne stable et adaptateurs rendent les fournisseurs remplaçables.

## D06 — Surface progressive sous style ORBITAL

- **DECISION** : conserver le globe holographique sombre et fondre vers relief/imagerie détaillée seulement selon échelle et disponibilité/licence.
- **WHY** : zoom profond sans rupture d'identité ni apparence touristique.
- **ALTERNATIVES REJECTED** : basemap photo/Google Earth permanente ; style par défaut d'un SDK.
- **CONSEQUENCES** : besoin de design et d'attribution par tuile, images urbaines encore non choisies.
- **REVERSIBILITY** : élevée via moteurs de style et imagery indépendants.

## D07 — Semantic zoom fondé sur l'empreinte visible

- **DECISION** : niveaux SPACE à STREET/SENSOR selon étendue au sol, hauteur, FOV, viewport et inclinaison, avec hystérésis ; seuils du document principal provisoires.
- **WHY** : l'altitude seule ne décrit ni l'oblique ni les différents écrans.
- **ALTERNATIVES REJECTED** : seuils fixes de distance de caméra ; réduction uniforme de pictogrammes.
- **CONSEQUENCES** : empreinte partielle/horizon à gérer, préchargement et stabilité de sélection.
- **REVERSIBILITY** : élevée : fonction pure et seuils versionnés, calibrables par essais visuels.

## D08 — Sélection stable et couche de priorité

- **DECISION** : clé typée persistante, détail résolu séparément, objet sélectionné épinglé hors quota et priorité de picking déclarative.
- **WHY** : un objet reste au centre de l'investigation pendant zoom, rafraîchissement et déplacement.
- **ALTERNATIVES REJECTED** : sélection indexée par position ou nœud de tuile ; dernier clic géré indépendamment dans chaque couche.
- **CONSEQUENCES** : gestion des objets expirés, réponses tardives, occlusion et conflits de commandes.
- **REVERSIBILITY** : moyenne après migration des panneaux ; adaptateur vers `useIntelStore` et `Inspector` requis.

## D09 — Rouge critique et feed prioritaires

- **DECISION** : hotspots rouges de conflit/alerte grave protégés dans les budgets, visibles à PLANET ; feed→géographie→sélection→fiche→sources→AURA constitue un parcours d'acceptation.
- **WHY** : fonctions et lecture stratégique centrales d'ORBITAL.
- **ALTERNATIVES REJECTED** : remplacer le feed par des labels de carte ; donner le rouge par défaut aux caméras/mobiles/satellites ; masquer les événements critiques en mode économique.
- **CONSEQUENCES** : budgets et couches doivent réserver une priorité aux signaux ; précision géographique et doublons restent explicites.
- **REVERSIBILITY** : invariant produit, non négociable ; une implémentation qui le casse est BLOQUANTE.

## D10 — Mobiles reconnaissables, observations honnêtes

- **DECISION** : réutiliser les silhouettes avion/navire/cargo et heading de `MobileLayer` à toute échelle ; pistes issues d'observations seulement.
- **WHY** : « moins de détail, jamais moins d'identité » et aucune extrapolation présentée comme donnée.
- **ALTERNATIVES REJECTED** : carrés/hexagones/cellules anonymes pour les mobiles ; prédiction tacite de position.
- **CONSEQUENCES** : rendu screen-space/instancing et pass sélection requis ; budgets par catégorie.
- **REVERSIBILITY** : invariant produit, non négociable.

## D11 — Capteurs agrégés, média à la demande

- **DECISION** : caméras et futurs satellites ont agrégats/densités à grande distance et objets individuels selon niveau ; aucun média caméra avant clic ; satellite propagé nommé comme calculé.
- **WHY** : performance et honnêteté des données.
- **ALTERNATIVES REJECTED** : charger le catalogue mondial/médias dans le client à PLANET ; qualifier snapshot de live ou TLE de radar.
- **CONSEQUENCES** : API bbox, index/cache serveur, séparation métadonnées/détail et provenance.
- **REVERSIBILITY** : élevée via adaptateurs, mais la sémantique honnête est permanente.

## D12 — AURA visuelle inchangée, capacités par interface

- **DECISION** : `AuraCore`/`AgentPanel` restent la référence visuelle ; AURA émet des commandes validées vers le moteur, sans accès direct à Three ou aux stores internes de couches.
- **WHY** : augmenter les capacités sans refaire l'identité AURA.
- **ALTERNATIVES REJECTED** : nouveau chat SaaS, automatisation qui prend le contrôle après un geste utilisateur.
- **CONSEQUENCES** : permissions, feedback de commande, annulation et journal de résultats à définir.
- **REVERSIBILITY** : élevée : l'interface de commande peut être ajoutée sans redessiner AURA.

## D13 — Budgets mesurés, fallback et sources indépendantes

- **DECISION** : budgets CPU/GPU/IO par profil, chargement paresseux, worker, abort, LRU et fallback ; une panne terrain ou fournisseur ne casse pas le feed/globe.
- **WHY** : dizaines de milliers de métadonnées et mobile exigent des limites prévisibles.
- **ALTERNATIVES REJECTED** : Mesh par objet, polling agressif, cache illimité, croire qu'un build vert prouve les FPS.
- **CONSEQUENCES** : instrumentation et benchmark hardware comparables obligatoires avant adoption.
- **REVERSIBILITY** : élevée, budgets ajustables après mesures ; préserver signaux critiques et sélection.

## D14 — Migration incrémentale et PR Cesium non fusionnée

- **DECISION** : Phase 1 commence seulement sur ordre explicite ; Geo Core pur d'abord, puis caméra lab, tuiles/terrain, semantic zoom et couches métier sous flag. Le globe actuel reste fonctionnel.
- **WHY** : limiter le risque d'un remplacement global et tester chaque invariant avant bascule.
- **ALTERNATIVES REJECTED** : big bang rewrite ; fusionner le POC Cesium #12 pour accélérer la migration.
- **CONSEQUENCES** : double chemin temporaire, protocoles de comparaison visuelle/functionalité et rollback.
- **REVERSIBILITY** : élevée tant que le flag et le rendu actuel demeurent ; chaque bascule a sa PR.

## Questions non tranchées

Le choix des fournisseurs/licences d'imagerie et DEM, des appareils mobiles de référence, de la définition produit de STREET/SENSOR, du modèle de corrélation d'articles et de la source d'éléments orbitaux reste ouvert. Aucun de ces choix n'est comblé par une donnée fictive ou un fournisseur implicite.
