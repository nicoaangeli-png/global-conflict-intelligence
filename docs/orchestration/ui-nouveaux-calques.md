# Interface — nouveaux calques (19/10/2026)

Mission : équipe « INTERFACE — NOUVEAUX CALQUES ». Intégrer les flux `military`, `weather`, `infrastructure` et les calques de référence `/api/layers` sans alourdir le design. Terre, étoiles, orbites inchangées (`HolographicEarth.ts`, `Starfield.ts`, `OrbitLayer.ts` non touchés). Travail commité par le coordinateur (24109b9f).

## Ajouté

- **Correction du plantage** : `feedModel.ts` n'avait pas de libellé/couleur pour les 3 nouvelles catégories → erreur de type et plantage du fil dès que les éléments arrivaient (capture `avant-1440.png`).
- **Barre des thèmes (12 onglets max)** : `Militaire` (après Conflits), `Catastrophes & météo` (météo regroupée, `THEME_CATEGORIES`), `Réseaux` (pannes IODA + ports/détroits PortWatch). La recherche de pays passe au centre de l'en-tête pour libérer la barre (tout tient à 1280 px). Couleurs désaturées : olive (militaire), bleu ciel pâle (météo), argent (réseaux).
- **« Tout » = l'actualité** : exclut positions d'aéronefs, mesures de connectivité, alertes météo mineures/modérées (détail au survol du sous-titre).
- **Météo** : par défaut seulement sévère/extrême (ou sévérité non publiée, ex. NHC) ; bascule « Sévères · n / Toutes · n » partagée par le fil et le globe (`weatherAll`).
- **Avertissements répétés** (ADS-B, IODA, OMM…) affichés une fois en tête du fil (repliés s'il y en a plusieurs).
- Variation d'une mesure non boursière affichée sans signe ni couleur (« 1,4 % » de baisse IODA n'est plus un « +1,4 % » vert).
- **Menu « Calques »** dans le dock du globe : cases à cocher, tous éteints par défaut, chargement à l'allumage ; pour chacun : source, date de la donnée (ou « non publiée par la source »), collecte, nombre d'éléments, état (chargement / indisponible + Réessayer), avertissement et licence repliés.
- **Rendu globe** (`globe/ReferenceLayers.ts`) : un `THREE.Points` par calque d'installations (anneau = centrale, carré = base), un seul `LineSegments` pour les ~20 000 segments de câbles (subdivision en grand cercle), sanctions = teinte très légère des pays (texture canevas, uniforme : pas une échelle de risque). Survol = info-bulle, clic = détail sourcé (`layers/LayerFeatureDetail.tsx` : nom, pays, attributs bruts, source/date/licence/avertissement, lien).
- **Fiche pays** : Activité militaire observée (dernière heure), Alertes météo officielles, Pannes internet et ports, Sanctions OFAC (entités, programmes, date de la liste), Installations connues (centrales / bases, listes repliables qui ouvrent le détail). Sections vides : « Rien dans nos sources… ».

## Vérifié

- `pnpm typecheck` : 0 erreur. `pnpm test` : tout passe (dont `tests/ui-layers.test.ts`, 16 tests sur fixture réelle réduite `tests/fixtures/ui-layers-sample.json`, et `tests/ui-feeds.test.ts` mis à jour).
- Captures 1280×800 et 1440×900 relues (`captures-nouveaux-calques/apres-*`) : aucun chevauchement (popover Calques au-dessus du lanceur AURA et hors colonne droite), aucun texte coupé, console sans erreur ni violation CSP. Aucune ressource tierce (tout via `/api/*`).
- Serveur de dev :3011 lancé depuis un **miroir** (`/tmp/orbital-3011-mirror`, `.next` distinct) pour ne pas écraser le build de :3005 ; `node_modules`, `data` et `.env.local` liés (jamais lus).

## Non vérifié / limites

- Clic direct sur un point de calque : testé au centre de l'écran après recentrage, mais un foyer de conflit (Paris) était au même endroit et a la priorité ; clic via la fiche pays vérifié.
- Rendu mobile non capturé.

## Demandes hors périmètre (signalées à l'époque)

- Erreurs de calque mises en cache 24 h (corrigé depuis : 1f013380). Bases militaires : 89 éléments seulement, dont des « anciennes casernes ». Biblis « en service » alors que fermée en 2011 (statut Wikidata). `landingPoint` des câbles = repère d'étiquette TeleGeography, pas un atterrissement (affiché comme tel). Alertes OMM sans pays (le code pays numérique figure dans l'identifiant CAP).
