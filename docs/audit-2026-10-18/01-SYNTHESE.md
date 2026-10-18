# ORBITAL — Audit complet · synthèse (18 octobre 2026)

Audit croisé par quatre analyses indépendantes :

| Rapport | Auteur | Fichier |
|---|---|---|
| Constats directs (captures, code, tests d'API) | Claude Opus 5.5 (coordination) | ce document |
| Code et vérité des données | Claude Sonnet 5.5 | `02-code-et-verite-des-donnees.md` |
| UX/UI et architecture de l'information | Gemini 3.8 | `03-ux-ui.md` |
| Sources en direct (tests réels) | DeepSeek V4.1 | `04-sources-en-direct.md` |

Codex devait mener l'audit du code : OpenAI a refusé l'accès (erreur 403) sur deux modèles, la mission a été réaffectée.

---

## 1. Le diagnostic en une phrase

**L'application mélange trois choses très différentes — des incidents vérifiés, des mentions dans la presse et des détections satellite — puis les présente toutes sous des mots de guerre (« incidents », « foyers d'affrontements », « théâtres »). Elle ne voit pas les troubles sociaux, ne donne pas les titres, et ses dates de « mise à jour » sont fausses.** D'où l'impression d'incohérence.

Chiffres mesurés sur la vue par défaut (30 jours) :
- **98,4 %** des « événements » sont des mentions presse ; **0** incident vérifié.
- Les 5 752 « incidents » ne sont que **1 950 articles** : un article qui cite 19 lieux compte 19 fois.
- Le nombre de « foyers d'affrontements » **change avec le zoom** (213 → 671).
- **0** manifestation ou émeute réelle dans la base (les 177 présentes sont des données de démo).

---

## 2. Constats classés

### P0 — Faux ou trompeur (à corriger d'abord)

| # | Problème | Preuve | Correctif |
|---|---|---|---|
| 1 | Chrome « traduit » l'interface française et la défigure (« PERTES A DÉCLARÉ », PIB « 3,37 milliards ») | `src/app/layout.tsx:15` déclare `lang="en"` | `lang="fr"`, `translate="no"`, synchronisation avec le sélecteur FR/EN |
| 2 | Compteurs de tête faux : « Incidents 24 h » = mentions de lieux, « Foyers » dépend du zoom, « 7 jours » = « 24 h » | `GlobalSituationPanel.tsx:236-255`, `intel.ts:428-440` | Trois familles jamais additionnées : incidents vérifiés · articles (comptés par article) · détections satellite. Bornes temporelles absolues |
| 3 | Fraîcheur fictive : « mis à jour à l'instant » pour un événement du 10 août | `updatedAt` = heure d'ingestion (`gdelt.ts`, `ucdp.ts`, `firms.ts`) | Date réelle de la donnée par source : « UCDP : jusqu'au 31/08 » |
| 4 | GDELT ne cherche que du vocabulaire militaire → aucune manifestation ; filtre par sous-chaîne (« iran » ⊂ « Tirana », « war » ⊂ « software ») ; aucun titre d'article | `connectors/gdelt.ts:19-45,126-135` | Passer au flux d'événements GDELT 2.0 (catégories CAMEO : 14 manifestation, 18-20 violence) + titres via l'API d'articles GDELT |
| 5 | Pas d'identifiant pays unique : la fiche « États-Unis » affiche 0 événement, AURA peut confondre Niger et Nigeria | égalités de noms `Overlays.tsx:200`, `agent.ts:186` | Code ISO3 attribué à l'ingestion (fonction `countryAt` existante), tout filtrer par ISO3 |
| 6 | Deux ou trois panneaux « France » ouverts en même temps, aux chiffres différents ; AURA ne voit pas le pays du panneau gauche | `country` / `chosenCountry` / `selected` concurrents | Un seul état de sélection et **une seule fiche pays** |

### P1 — Incohérences visibles

- Fiche statique (13 pays seulement, non datée) affichée à côté des données vivantes → « Régime : Inconnu » sous le vrai PIB de la France ; indice « Pentagone » inventé.
- Wikidata omet parfois le chef de l'État (France : seul le Premier ministre apparaît).
- « 0 mort » affiché pour un feu détecté par satellite ; « † » collé au nombre d'événements.
- Libellés trompeurs : « Théâtres de guerre » qui listent Paris et « White House » ; onglet « Chronologie » qui ne fait rien ; bouton « actualiser » qui n'actualise rien ; mélange français/anglais dans une même ligne.
- Chevauchements : bandeau sur les titres de panneaux, « Fiabilité » caché sous AURA et le zoom.
- Cinq listes de pays redondantes (Top 6, explorateur, panneau droit, onglets Conflits et Géopolitique).
- Le filtre FIRMS dépend des mentions presse (circularité) ; impossible d'afficher les feux seuls.
- **Stockage** : tout le fichier de 12,7 Mo est relu à chaque requête ; +3,4 Mo par jour sans purge → **panne estimée dans ~5 mois** ; un verrou orphelin peut figer l'ingestion sans alerte.
- **Sécurité** : `/api/agent` accepte des requêtes de n'importe quelle page web et le serveur écoute sur le réseau local → quota OpenAI exposé.

### P2 — Hygiène

Jargon développeur affiché (« Renseignez ACLED_EMAIL dans .env.local »), `server.log` versionné, fichier de démo servi publiquement, en-têtes de sécurité absents, code mort, deux processus serveur sur le port 3005.

---

## 3. Ce que l'utilisateur doit pouvoir faire (cible)

### Trois niveaux, une seule sélection
**Monde** (globe + bilan) → **Pays** (clic : fiche unique) → **Événement** (clic sur un point : détail dans la fiche du pays). Sélectionner l'un ferme l'autre. AURA lit toujours la sélection active.

### La fiche pays en direct (au clic)
1. **En-tête** : nom, drapeau, heure locale, niveau d'activité, « données à jour il y a X min ».
2. **Synthèse AURA** (2-3 phrases, écoutable) avec sources.
3. **En direct, par thème, avec titres** : conflit armé · manifestations / émeutes / grèves · terrorisme et crime organisé · catastrophes · décisions politiques. Chaque ligne : titre, média, heure, niveau de fiabilité.
4. **Économie et marchés** : indice boursier national et variation, devise, inflation, PIB (avec année).
5. **Pouvoir et défense** : chef de l'État, chef du gouvernement, statut nucléaire, alliances (sources datées).
6. **Approfondir avec AURA** : questions pré-remplies sur ce pays.
7. **États vides honnêtes** : jamais « Inconnu » seul, mais « Aucun incident vérifié sur 30 jours · dernier relevé UCDP : 31/08 ».

### Le globe
- Calques à cocher : conflits · troubles sociaux · catastrophes / feux · trafic aérien.
- « Direct » visible : halo pulsant < 2 h, éclat décroissant ensuite.
- Fenêtre par défaut : **24 h** pour la presse et les catastrophes ; données vérifiées affichées avec leur date réelle.

### Le bilan vocal du jour
- Bouton « 🎙️ Bilan du jour » dans l'en-tête.
- Collecte automatique chaque matin, puis AURA rédige et lit **8 chapitres** : conflits · décisions politiques · catastrophes et climat · économie et marchés · espace · nucléaire · société · santé.
- Le globe se déplace vers chaque sujet pendant la lecture ; on peut interrompre et poser une question.
- Garde-fous : un fait n'entre que s'il a 2 sources indépendantes ou 1 source officielle ; aucun bilan chiffré tiré d'un simple article ; chaque phrase rattachée à sa source.

### Vocabulaire (exemples)
| Avant | Après |
|---|---|
| Incidents (24 h) | Articles de presse (24 h) — ou Incidents vérifiés, selon la donnée |
| Foyers d'affrontements | Zones signalées |
| MEDIA_SIGNAL | Article de presse (non confirmé) |
| Théâtres majeurs | Zones de crise (sur données vérifiées uniquement) |
| N/A / Inconnu | Non couvert par nos sources · Pas de donnée récente (date) |

Un « ? » à côté de chaque compteur ouvre sa définition.

---

## 4. Sources à brancher (testées le 18/10/2026)

| Thème | Source retenue | Clé | Statut du test |
|---|---|---|---|
| Manifestations, émeutes | GDELT 2.0 événements (CAMEO 14) + API d'articles GDELT (titres) | non | OK (API d'articles limitée : 1 requête / 10 s, cache obligatoire) |
| Catastrophes | GDACS (ONU/UE), USGS séismes, NASA EONET, NOAA tsunamis | non | OK |
| Santé | OMS Disease Outbreak News (API), ECDC | non | OK |
| Espace | Launch Library 2 (The Space Devs) | non | OK |
| Nucléaire | World Nuclear News (RSS) ; AIEA bloquée par Cloudflare | non | OK |
| Décisions politiques | ONU (presse + News), GOV.UK, Wikipédia « événements du jour » | non | OK |
| Devises | BCE / Frankfurter, open.er-api | non | OK |
| Bourse par pays | Yahoo Finance (non officiel, risque juridique) ou Twelve Data / Finnhub / Alpha Vantage (clé gratuite) | selon | Yahoo OK ; les autres demandent une clé |
| Macro | Banque mondiale (inflation, chômage), Eurostat ; FRED (clé gratuite) | selon | OK |
| Sanctions | OpenSanctions | clé gratuite | à obtenir |
| Maritime | AISStream | clé gratuite (GitHub) | à obtenir |

Écartées : ACLED (compte Gmail refusé), ReliefWeb (blocage anti-robot, à ne pas contourner), IAEA, ProMED, Stooq, GDELT GEO 2.0 (service mort).

**Piège technique** : GDELT utilise les codes pays FIPS (Royaume-Uni = `UK`, Allemagne = `GM`), pas l'ISO. Une table de correspondance est indispensable.

---

## 5. Plan d'action

### Phase 1 — Rendre l'existant honnête et lisible (≈ 2 jours)
1. `lang="fr"` + anti-traduction Chrome.
2. Compteurs de tête séparés (vérifié / presse / satellite), bornes temporelles absolues, articles comptés une fois.
3. Dates réelles par source (« données jusqu'au… »), total d'en-tête sans la démo.
4. Une seule sélection, une seule fiche pays ; AURA branchée dessus ; Échap cohérent.
5. Vocabulaire et glossaire ; suppression du faux onglet Chronologie ; chevauchements corrigés.
6. Fiche statique retirée de l'affichage ; lignes « N/A » remplacées par des états explicites.
7. Sécuriser `/api/agent` (origine, type de contenu, limite par IP) et écouter en local uniquement.

### Phase 2 — Voir le monde réel, pays par pays (≈ 1 semaine)
1. Référentiel pays unique (ISO3 ↔ FIPS ↔ noms des sources).
2. GDELT refait : flux d'événements par catégorie + titres d'articles + dédoublonnage par article.
3. Nouvelles sources : catastrophes (GDACS, USGS, EONET), santé (OMS), devises et bourse.
4. API « fiche pays » unique (blocs indépendants, chacun avec sa source et sa fraîcheur) + nouvelle fiche à l'écran.
5. Calques du globe par thème + effet « direct ».
6. Stockage SQLite avec purge automatique (fin du risque de panne).

### Phase 3 — Le bilan vocal du jour (≈ 1 semaine)
1. Collecte matinale, dédoublonnage et classement des faits.
2. Rédaction par AURA en 8 chapitres avec sources, garde-fous anti-désinformation.
3. Lecteur vocal avec chapitres, sous-titres et déplacement du globe.
4. Espace et nucléaire en sources dédiées.

### Décisions à prendre par le propriétaire
- **Bourse** : Yahoo (gratuit, sans clé, non officiel) ou une clé gratuite Twelve Data / Finnhub (officiel, quotas).
- **Clés gratuites à créer** : OpenSanctions, AISStream, éventuellement FRED.
