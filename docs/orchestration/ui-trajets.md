# Interface — avions, navires et trajets (19/10/2026)

Retour du propriétaire : « je ne vois pas les avions militaires, les bateaux sur ma carte, et le trajet ». Même périmètre et mêmes règles que `ui-nouveaux-calques.md`. Rien n'a été commité.

## Ajouté

- **Mobiles visibles par défaut, sur tous les thèmes** : menu « Calques » → nouvelle section « En direct » avec « Avions militaires » et « Navires militaires », **cochés par défaut** (store `mobilesOn`) ; les calques de référence restent éteints. Chaque ligne : nombre reçu, source, rythme (30 s), nombre de trajets observés, état réel de la source (ex. « AISStream.io : Non branchée — clé absente », puis « aucune position reçue pour l'instant »), avertissement replié. L'onglet « Militaire » affiche toujours les mobiles, même décochés.
- **Calque globe dédié** `globe/MobileLayer.ts` : un seul `THREE.Points` pour tous les mobiles + un seul `THREE.LineSegments` pour tous les trajets, reconstruits à chaque rafraîchissement.
  - Avion : silhouette vue de dessus (fuselage, ailes en flèche, empennage), ≈ 14 px fixes à l'écran, olive `#c3d494`.
  - Navire : mini bateau (coque à étrave pointue, poupe droite, passerelle plus sombre), ≈ 18 px fixes, sable `#e6c88f`, halo plus marqué pour les repérer.
  - Orientation : cap publié par la source ; à défaut, direction des deux dernières positions observées (calcul, signalé « déduit » dans le détail) ; sinon symbole non orienté (losange / rond). Liseré sombre + halo léger pour rester lisibles sur les terres.
  - `FeedLayer.ts` revient à ses seuls points de flux (les mobiles n'y sont plus dessinés deux fois).
- **Trajets** (`LiveItem.track`, positions réellement observées) : ligne fine additive légèrement au-dessus de la surface (avion 1,011 R, navire 1,006 R), subdivisée en grand cercle, **dégradé d'opacité vers le passé** ; au survol ou à la sélection, le trajet du mobile est surligné et les autres atténués. Sans `track` ou avec une seule position : rien n'est dessiné, aucune erreur.
- **Rafraîchissement** : catégorie `military` toutes les 30 s dès qu'un des deux calques est coché (ou onglet Militaire ouvert), requête silencieuse qui conserve la sélection (même identifiant, nouvelle position).
- **Détail d'un mobile** (clic sur le globe ou dans le fil) : nature (Avion/Navire), indicatif, type (code source), immatriculation, altitude / vitesse, cap, heure de la dernière position, **durée du trajet observé** et nombre de positions, avertissement de la source. Info-bulle au survol : titre, résumé, « trajet observé 7 min ».
- **Thème Militaire** : filtre « Tous · Avions · Navires » avec compteurs ; étiquette Avion/Navire sur chaque ligne ; plus de pastille « DIRECT » répétée sur chaque position.
- **Fiche pays** : « Activité militaire observée » séparée en Avions / Navires (dernière heure), message honnête quand vide.
- Logique pure `feeds/vehicleModel.ts` (nature, trajet, cap, champs du détail, durée).

## Vérifié

- `pnpm typecheck` : 0 erreur. `pnpm test` : 27 fichiers réussis, 1 ignoré ; 274 tests réussis (dont `tests/ui-trajets.test.ts`, 9 tests sur extrait réel `tests/fixtures/ui-trajets-sample.json` : ordre et durée du trajet, absence de trajet sans `track`, cap source / déduit cohérent à < 10°, indicatif/type/immatriculation/altitude/vitesse, mobiles allumés par défaut et calques de référence éteints).
- Bug trouvé et corrigé pendant la vérification : `half` est un mot réservé GLSL, le shader des mobiles ne compilait pas (rien ne s'affichait) — détecté via la console WebGL non filtrée.
- Captures 1440×900 relues (`docs/orchestration/captures-trajets/`) :
  - `apres-1440-tout.png` (vue par défaut, centrée sur l'Inde : à 21 h UTC 170 des ~220 avions sont au-dessus des États-Unis, hors champ) et `apres-1440-tout-amerique.png` (thème **Tout**, globe recentré : les avions se voient nettement) ;
  - `apres-1440-menu-calques.png` (section En direct, cochée par défaut) ;
  - `apres-1440-militaire.png`, `apres-1440-trajet-survol.png` (filtre Avions/Navires, survol + détail : « Trajet observé 4 min · 4 positions ») ;
  - `apres-1440-trajet-selection.png`, `apres-1440-trajet-survol-zoom.png` (zoom : C-17 sélectionné, cercle de sélection, trajet visible en ligne fine derrière l'appareil, du côté opposé au cap 198°).
- Aucune ressource tierce : symboles dessinés dans le shader.

## Non vérifié / limites

- **Navires sur données réelles** : la source `aisstream-military` est passée de « Non branchée » à « ok » après redémarrage de :3011 (clé ajoutée après le démarrage), mais **aucun navire militaire reçu** en ~5 min d'écoute ; la silhouette de navire n'a donc pas été vue sur une capture réelle (code partagé avec l'avion, testé en logique). À recapturer quand des navires arrivent.
- Trajets encore courts (le serveur accumule les positions depuis son démarrage : 4–7 min observés) : visibles seulement en zoom ; ils s'allongeront d'eux-mêmes.
- La vue par défaut de la caméra (non modifiée, hors périmètre) est centrée sur l'Inde : selon l'heure, la plupart des avions publiés peuvent être de l'autre côté du globe.

## Hors périmètre / pour Codex

- Le titre des navires (nom, type) et les champs vitesse/cap AIS : le détail lit `vitesse … kt|nd` et `cap|route|course N°` dans `summary` ; un champ structuré (ex. `heading`, `speedKt`) serait plus robuste.
- `track` repart de zéro à chaque redémarrage du serveur (mémoire) : normal, mais à savoir pour la durée affichée.
