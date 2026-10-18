# ORBITAL — Audit d'architecture et de « vérité des données »

Date : 2026-10-18 · Périmètre : lecture seule du dépôt + GET sur `localhost:3005` (`/api/events`, `/api/stats`, `/api/latest`, `/api/country`, `/api/ingest`) + analyse de `data/intel-events.json` (23 792 événements). Aucun fichier du dépôt modifié. Les chemins sont relatifs à la racine du projet.

---

## 0. Diagnostic racine (à lire en premier)

L'incompréhension des utilisateurs vient de **cinq défauts structurels**, pas de détails d'UI :

1. **Le modèle de données n'a qu'un seul type d'objet, `ConflictEvent`**, utilisé pour trois réalités différentes : un incident documenté (UCDP/ACLED), une *mention d'un lieu dans un article* (GDELT) et une *anomalie thermique* (FIRMS). Tous sont comptés, regroupés et classés ensemble, puis présentés sous des étiquettes qui n'en désignent qu'une seule (« Incidents », « Foyers d'affrontements », « Théâtres majeurs »). Sur la fenêtre par défaut (30 j), **98,4 % des « événements » sont des mentions presse** (5 752 / 5 848) et **0 est documenté** (`coverage.documented = 0`).
2. **La fraîcheur affichée est fictive.** `updatedAt` vaut l'heure d'ingestion pour GDELT, UCDP et FIRMS. Le « Dernière mise à jour : à l'instant » et le « SYNC » de la bannière ne disent donc rien sur l'âge réel des données (UCDP s'arrête au 2026-08-31).
3. **Les fenêtres temporelles ne signifient pas la même chose selon la source.** GDELT n'a que ~23 h d'historique, car aucun backfill n'est fait. UCDP commence au 2026-01-01 et finit au 2026-08-31. FIRMS couvre 2 jours. « 30 J », « 6 MOIS » et « 1 AN » mélangent donc trois profondeurs différentes sans l'indiquer.
4. **Il n'y a pas d'identité pays canonique.** Chaque source nomme les pays à sa façon (`Russia (Soviet Union)`, `DR Congo (Zaire)`, `United States`, `Republic Of`, `Oceans`…), et chaque écran apparie par chaîne exacte ou par alias partiels. ~9 % des événements (1 918 / 20 602 hors démo) ont un nom de pays absent du référentiel de la carte.
5. **Plusieurs états de sélection concurrents**, sans coordination : `country` (store), `chosenCountry` (état local du panneau gauche), `selected` (foyer), `reconTarget`, `agentOpen`, `view`.

---

## 1. P0 — Faux ou trompeur pour l'utilisateur

### P0-1 · `<html lang="en">` sur une UI française → traduction Chrome qui défigure tout
- `src/app/layout.tsx:15` : `lang="en"`. Le contenu est français, donc Chrome propose/applique la traduction FR←EN et produit « PERTES A DÉCLARÉ », « SIGNALISATION DE PREMIER ORDRE », PIB « 3,37 milliards » au lieu de billions.
- Le contenu est aussi dynamique et bilingue : un `lang` statique est faux dans les deux cas. Le défaut du store est `locale: "fr"` (`src/store/useIntelStore.ts:152`).
- **Fix (30 min)** :
  - Dans `layout.tsx`, mettre `<html lang="fr" translate="no">` et ajouter `<meta name="google" content="notranslate">` (l'app a son propre sélecteur FR/EN).
  - Dans un effet client, synchroniser `document.documentElement.lang = locale`.
  - Mettre `translate="no"` sur les noms propres et valeurs brutes (`country`, `locality`, `source`).
  - Corriger aussi `metadata.description` (en anglais, `layout.tsx:6`).

### P0-2 · Les trois compteurs de tête ne mesurent pas ce que disent leurs libellés
Preuves (API à 30 j, `degrees=2.4`) : `activeZones=532`, `majorZones=16`, `events24h=5832`, `events7d=5848`, `coverage={documented:0, media:5752, demo:0, thermal:96}`.

| Libellé (écran) | Calcul réel | Pourquoi c'est faux |
|---|---|---|
| **« Foyers d'affrontements »** `GlobalSituationPanel.tsx:236`, `i18n.ts:33` | `aggregateClusters(events).length` avec clé `(cellule(degrees) × pays × catégorie)`, `minEvents = 1` (`visual.ts:133`, `cluster.ts:69-72`) | 512 des 532 « foyers » sont des **clusters de presse** et 222 ne contiennent **qu'un seul** événement. Le nombre **dépend du zoom** : 213 (22°), 307 (8°), 400 (4,5°), 532 (2,4°), 671 (1,2°). Le chiffre change quand on tourne le globe (`setDegrees` → `refresh`, `useIntelStore.ts:221-225`), et l'utilisateur voit 524 puis 532. |
| **« dont N théâtres majeurs »** `GlobalSituationPanel.tsx:220,238`, `intel.ts:440` | `clusters.filter(intensity >= 0.5)` | Les 16 « majeurs » à 30 j sont **tous MEDIA_SIGNAL** (Iran, Moscou, « White House », Paris, Albanie…). Pour un cluster presse, `lethality=0` et `density` sature à 90 mentions, d'où une intensité plafonnée à (0,42+0,22)^1,35 ≈ **0,55 pour tous**. Le seuil 0,5 est franchi par le simple volume de dépêches. Le dictionnaire annonce « intensité > 65 % » (`i18n.ts:35`) alors que le code utilise 50 %. |
| **« Incidents (24h) »** `GlobalSituationPanel.tsx:243`, `i18n.ts:36` | `events.filter(date ≥ to−24h).length` (`intel.ts:433`) | Ce sont des **mentions de lieux dans des articles** (GDELT) plus des détections FIRMS. **Moyenne de 2,95 lieux par article** : 5 752 « événements » pour **1 950 URL distinctes**, dont 2 559 viennent d'articles qui citent ≥ 5 lieux (un article sur la visite de Merz à Kiev produit 19 « incidents »). Le libellé EN dit « Incidents », le FR de la ligne suivante « Événements » : incohérent. |
| **« Événements (7 jours) »** `GlobalSituationPanel.tsx:249` (EN : « Incidents (7 days) ») | `events7d` calculé sur les événements **déjà bornés par la fenêtre sélectionnée** (`intel.ts:428-435`) | 5 719 (24 h) ≈ 5 735 (7 j) car GDELT n'a que 23 h d'historique. Et si l'on choisit `24h`, **« 7 jours » affiche la valeur 24 h** (vérifié : `range=24h` → `events7d=5832`). `events30d` est calculé mais jamais affiché. |
| **« Pertes humaines déclarées »** `:255` | `fatalitiesRange`, « N/A » si `documented+demo === 0` | OK en 30 j (N/A), mais en 1 an affiche 125 294 : meilleure estimation UCDP (`best`), pas des pertes « déclarées ». |
| **« Dynamique temporelle (30 jours) »** `i18n.ts:40` | libellé figé | Le graphique suit la fenêtre choisie (24 h/7 j/6 m/1 an). |

**Fix** :
- Séparer en trois familles : *Incidents documentés* (UCDP/ACLED), *Articles de presse* (comptés **par URL distincte**, pas par lieu), *Détections satellite*. Afficher les trois sur des lignes distinctes, jamais sommées.
- Remplacer « Foyers » par un compte **indépendant du zoom** (par pays ou par grille fixe 2,4°), ou rebaptiser « Marqueurs visibles ».
- Calculer `events24h/7d/30d` sur des bornes absolues, indépendamment de `range`.
- Plafonner l'intensité presse dans une échelle distincte (« activité médiatique »), jamais mélangée à « théâtre majeur ».

### P0-3 · La fraîcheur et le volume affichés mentent
- **`updatedAt` = date d'ingestion** : `gdelt.ts:180`, `ucdp.ts:72` (`new Date().toISOString()`), `firms.ts:89`. Conséquences :
  - `LiveConflictPanel.tsx:182-185` (« Dernière mise à jour ») affiche « à l'instant » pour un événement UCDP du 2026-08-10.
  - `counts.lastUpdated = max(updatedAt)` (`repository.ts:67,334`) alimente `lastDataUpdate`, donc « Dernière mise à jour » du panneau gauche (`GlobalSituationPanel.tsx:314-317`) et « SYNC … » de la bannière (`Overlays.tsx:365`). Ces deux valeurs sont **toujours ≈ maintenant**.
  - **Fix** : stocker `sourceUpdatedAt` (null si inconnu) et exposer par source `asOf = max(eventDate)` + `fetchedAt`. Dans l'UI : « UCDP : données jusqu'au 31/08/2026 (publication mensuelle) ».
- **L'en-tête compte la démo** : `Header.tsx:129-131` affiche `stats.totalInStore` = 23 792 « événements indexés ». Ce total inclut les **3 190 événements fictifs** (`demo:seed`, masqués par défaut) et les 13 659 UCDP hors de la fenêtre. La démo vit dans le même fichier que les données réelles (`intel.ts:93-100`).
- **Fenêtres hétérogènes non signalées** (voir §0.3). `TIME_RANGES` (`types/conflict.ts:156-162`) ne dit pas que « 1 AN » = 8 mois d'UCDP + 1 jour de presse. La **timeline d'archive** (`setAt`) reconstruit « la situation telle qu'elle était » mais n'a **aucune presse avant le 17/10** : tout recul de plus de 24 h montre un monde sans presse.
- **Le bandeau** `DataProvenanceBanner` (`Overlays.tsx:343-345,371`) affiche « Sources disponibles : GDELT 2.0 · NASA FIRMS » et « 0 documentés · 5752 presse · 0 démo · 96 anomalies thermiques ». C'est honnête mais illisible, et UCDP en est absent parce que sa dernière donnée a 48 jours.
- **Fix** : afficher par source `asOf`, retard attendu et profondeur (« GDELT : 23 h · FIRMS : 2 j · UCDP : jusqu'au 31/08 »). Griser/avertir les fenêtres qui dépassent la profondeur d'une source. Définir un défaut intelligent : **« Dernières données disponibles »** par source (UCDP = dernier mois publié), plutôt que 30 j glissants.

### P0-4 · GDELT : mauvaise requête, mauvais filtres, aucun titre, aucun trouble social
`src/server/connectors/gdelt.ts`
- **Requête militaire uniquement** (l.19-31) : `armed clash`, `shelling`, `air strike`… Aucune manifestation, émeute, grève ni attentat civil. **Les 177 types « Riots/Protests » du store sont tous des données de démo**, aucun n'est réel. ACLED, seule source de protestations structurées, n'est pas configurée (`stats.connectors[0].configured=false`).
- **Allowlist `CONFLICT_ZONES`** (l.37-45, 133-135) : un pays hors liste ne passe que si les thèmes contiennent `WAR|MILITARY|ARMEDCONFLICT|AIRSTRIKE|TERROR` (l.126-131) :
  - Ce sont des **sous-chaînes** : `"WAR"` matche `AWARD`, `WARNING`, `SOFTWARE`…
  - `rawName.includes(z)` (l.135) : **`"iran"` ⊂ `"Tirana"`**. C'est pour cela que l'Albanie (71 événements, Tirana 34) apparaît parmi les « zones de conflit ». `"niger"` ⊂ `"Nigeria"`, `"mali"` ⊂ `"Somalia"`/`"Malibu"`, `"chad"` ⊂ `"Chadron"`.
  - La seule vraie émeute captée (jeunesse albanaise en révolte, URL `botasot.info…rinia-shqiptare-ne-revolte`) passe **par accident** de ce bug. À l'inverse, « Les gilets jaunes reviennent… 17 octobre » (`larazon.es`, France) est capté mais **sans titre ni catégorie**, noyé parmi 192 « mentions France ». À côté : un article sur un détective de fiction (`actualno.com`, ×2) et un match de basket (`lavozdegalicia.es`) sont comptés comme « signal de conflit en France ».
- **Pas de titre / pas de contenu** : l'API `gkg_geojson` ne renvoie que `name, url, urltone, urlpubtimedate, mentionedthemes` ; le connecteur jette même les thèmes. D'où « Media signal · N/A · 1 dépêche · brudirect.com ». Aucun moyen de savoir ce qui s'est passé. Le libellé `1 dépêche` (l.154,175) est **toujours « 1 »** (5752/5752) : `count` n'incrémente que pour des doublons exacts (même URL+date+coordonnées).
- **Un article → N événements** : la clé de dédup (l.147) est `url|date|lat|lon`. Les lieux cités (Moscou, Washington, « Kremlin », « White House ») sont des lieux de *protagonistes*, pas de faits. Une partie des « foyers de tension » sont des capitales : Moscow 229, Kiev 208, Washington 115, Paris 116, Kremlin 70.
- **Géocodage de précision inconnue** : beaucoup de points sont des **centroïdes de pays** (`35,38` Syrie ; `31.5,34.75` Israël). Ils sont affichés comme des lieux précis. Il manque un champ `geoPrecision`.
- **Pays dérivé du dernier jeton après virgule** (l.119-120) : `"Republic Of"` (Congo, Republic Of), `"Oc"`, `"Oceans"` (44 événements en mer), `"Reunion"`, `"Gaza Strip"` ≠ `"West Bank"` ≠ `"Palestine"`.
- **Pas de backfill** : l'appel (l.86) n'a aucun `TIMESPAN`/date ; le paramètre `days` n'agit que comme filtre post-hoc. L'historique de presse n'existe que depuis le démarrage du serveur.
- **`TONE_MAX = -2.5`** (l.34) élimine les articles « neutres/positifs » : les manifestations pacifiques et les négociations sont exclues par construction.
- **Fix (ordre d'impact)** :
  - Remplacer `gkg_geojson` par **GDELT Events 2.0** (`data.gdeltproject.org/gdeltv2/lastupdate.txt`, export 15 min) : code CAMEO racine (14 = protestation ; 17 = coercition ; 18 = agression ; 19 = combat ; 20 = violence de masse), `ActionGeo_Type` (précision), `NumMentions/NumSources`, `GoldsteinScale`, `SOURCEURL`. Ainsi catégorie + précision + importance viennent de la donnée, pas d'un filtre lexical.
  - Pour les titres : GKG 2.x `V2EXTRASXML <PAGE_TITLE>` (à confirmer sur un fichier réel) ou l'API DOC 2.0 `mode=artlist&format=json` (`title`, `domain`, `sourcecountry`, `seendate`).
  - Supprimer l'allowlist. Filtrer par **code pays FIPS→ISO3** et par `QuadClass`, pas par sous-chaîne.
  - Dédupliquer par article (`SOURCEURL`) et garder une table `event_places` si besoin.
  - Brancher une source de troubles sociaux structurée : **ACLED** (demander l'accès) et/ou CAMEO 14 + `ProtestCount` GDELT, avec libellé explicite « Mouvements sociaux (presse) ».

### P0-5 · Pas d'identité pays canonique → décomptes faux pour des pays majeurs
- `CountryCard` (`Overlays.tsx:200`) : `clusters.filter(c => c.country === country.name)` en **égalité stricte**, alors que `country.name` vient de Natural Earth `NAME` en premier (`world.ts:78`). La liste du panneau gauche utilise `ADMIN || NAME` (`GlobalSituationPanel.tsx:163`). **Le même pays porte deux noms selon le point d'entrée** (« Dem. Rep. Congo » / « Democratic Republic of the Congo »).
- Écarts mesurés entre noms d'événements et référentiel : `United States` (GDELT 380) vs `United States of America` → **la fiche USA affiche 0 événement** ; `DR Congo (Zaire)` (UCDP 436), `Myanmar (Burma)` (366), `Yemen (North Yemen)` (339), `Russia (Soviet Union)` (157), `Gaza Strip`, `West Bank`, `Reunion`, `Czech Republic`, `Bosnia-Herzegovina`, `Serbia (General)`.
- `GlobalSituationPanel.countryKey` (l.98-101) utilise `getCountryGeopolitics`, qui ne connaît que 12 alias (`geopolitics.ts:622`). Hors des 13 pays profilés, la clé est le nom brut, donc **« Russia » (GDELT) et « Russia (Soviet Union) » (UCDP) sont deux lignes** dans le « Top 6 » dès qu'on passe en 6 mois.
- `RegionsView` (`ViewPanel.tsx:132`) regroupe par `c.country` brut (autre règle encore). Natural Earth donne `ISO_A3 = "-99"` pour France, Norvège, Kosovo ; `world.ts:80-81` et `GlobalSituationPanel.tsx:164` repassent bien par `ADM0_A3` (OK), mais la règle est dupliquée à trois endroits (+ `countryIndicators.ts`).
- **AURA** : `get_country_activity` (`agent.ts:186-187`) retombe sur `normalize(c.country).includes(wanted)` → **« Niger » → « Nigeria »**, « Guinea » → « Papua New Guinea », « Sudan » → « South Sudan », si l'exact n'existe pas dans la fenêtre. Réponse fausse présentée comme factuelle.
- **Fix** : table `countries` unique (iso3, nom FR/EN, alias UCDP/GDELT/ACLED/FIPS/Natural Earth/Wikidata). Résoudre l'`iso3` **à l'ingestion** (point-in-polygon `countryAt` déjà utilisé pour FIRMS, `firms.ts:72`) et stocker `country_iso3` + `country_name` normalisé. Tous les regroupements/filtres/outils AURA passent par `iso3`. Supprimer les `===` sur noms.

### P0-6 · Panneaux pays concurrents et contradictoires
- **Trois écrans « pays/foyer » peuvent coexister** :
  1. `CountryCard` centrale (`Overlays.tsx:188`, état `store.country`, ouverte au clic sur un pays `GlobeScene.tsx:231`) ;
  2. `CountryProfile` imbriquée dans le panneau gauche (`GlobalSituationPanel.tsx:310`, état **local** `chosenCountry`) ;
  3. `LiveConflictPanel` « Données du foyer sélectionné » (`selected`, ouverte au clic sur un marqueur `GlobeScene.tsx:223`).
- Aucun ne ferme les autres : un clic marqueur ne fait pas `setCountry(null)` (`:223`), un clic pays ne fait pas `select(null)` (`:231`), et `chooseCountry` (panneau gauche) ne touche ni l'un ni l'autre. Résultat : **« France » deux fois** avec des chiffres calculés différemment.
- **AURA ne voit pas le pays du panneau gauche** : `AgentPanel.tsx:46,124` lit `store.country`, jamais `chosenCountry`. « Analyse la situation de … » peut viser un autre pays que celui affiché.
- `Esc` (`IntelApp.tsx:78-98`) ne ferme pas `chosenCountry`.
- **Fix** : un seul état `focus: { kind: 'country'|'cluster', iso3?, clusterId? }` dans le store et **une seule** fiche (voir §7). Le clic sur un marqueur affiche cette fiche pays *avec* le foyer en sous-section.

---

## 2. P1 — Incohérences visibles et dette de sens

### P1-1 · Fiches pays : statique non daté + live = contradictions
- `geopolitics.ts` : **13 fiches** (`Ukraine, Russia, Israel, Palestine, United States, China, Taiwan, Iran, Lebanon, Sudan, Myanmar, Syria, Laos`), `provenance: {kind:"static-unverified", source:null, asOf:null}` (l.606-615). Parmi les 25 pays les plus actifs dans la base, 17 n'ont **pas** de fiche (Mexique, Nigeria, Pakistan, Colombie, Éthiopie, Mali, Burkina, RDC, France, Inde, Afghanistan…).
- Pour eux, `getGenericFallback` (l.640-661) renvoie « Régime : Inconnu / Dissuasion : Inconnu / PIB N/A / Forces armées N/A / Inflation N/A ». Affiché **à côté** des valeurs live Banque mondiale de la même carte (`Overlays.tsx:220-221,224-271`).
- Même pour les 13 pays profilés, la carte affiche **deux PIB** : Banque mondiale (daté, `CountryIndicators.tsx`) et `geo.economy.gdpNominal` (statique non daté, `Overlays.tsx:262-271`). Le dirigeant statique (`regime.leader`, l.236) coexiste avec Wikidata.
- « Indice interne ORBITAL / pentagonAlert » (`geopolitics.ts:609-615`, `Overlays.tsx:240-259`) est un indice inventé nommé « Pentagone ». Le préfixe « Non officiel » ne suffit pas : le vocabulaire (« ORBITAL 2 · Théâtre de haute intensité ») suggère un classement.
- **Fix** : supprimer la fiche statique de l'UI ou la reléguer à un onglet « Contexte éditorial (non daté) » *uniquement* si `asOf`/`source` sont renseignés ; masquer les lignes N/A au lieu de les afficher ; une seule ligne par concept (PIB, dirigeant), avec source et année.

### P1-2 · Wikidata ne renvoie pas toujours le chef d'État (France : Premier ministre seul)
- Requête SPARQL `leaders.ts:36-47` : `FILTER NOT EXISTS { ?st pq:P582 ?end }` exclut tout statement ayant une date de fin, **sans considérer le rang** (`wikibase:rank`) ; pour France, `/api/country?iso=FRA` ne renvoie que `head_of_government` (Lecornu). Hypothèse non vérifiée côté Wikidata : le statement P35 de Macron porte un qualificatif `P582` ou un rang qui n'est pas « normal ».
- **Fix** : ne filtrer que `wikibase:rank != wikibase:DeprecatedRank` ; privilégier les statements `PreferredRank` ; fallback P35 via `?country wdt:P35`. Afficher la date de récupération (`fetchedAt` existe dans la réponse mais n'est pas affiché, `CountryIndicators.tsx`). Ajouter un test de non-régression sur FRA, USA, GBR, DEU.

### P1-3 · « N/A » et « 0 † » ne sont pas sémantiques
- `fatalities` est un `number` non nul pour tous les types. L'UI émet « N/A » seulement si `confidence === "MEDIA_SIGNAL"` (`LiveConflictPanel.tsx:53,170,234`, `ViewPanel.tsx:106,237`, `Overlays.tsx:127`). **Anomalie thermique (confidence REPORTED) → « 0 † »** : l'UI affirme zéro mort pour un feu détecté par satellite.
- `CountryCard` (`Overlays.tsx:289`) montre « N/A » dès qu'**aucun cluster non-presse** n'existe ; ailleurs un cluster mixte additionne des types.
- **Fix** : `fatalities: number | null` dans le modèle ; `null` pour GDELT et FIRMS ; afficher « — » (non applicable) vs « 0 » (rapporté zéro).

### P1-4 · Libellés qui promettent plus que la donnée (i18n et vues)
| Écran | Libellé | Réalité |
|---|---|---|
| `i18n.ts:174` (EN) | « Media signals / **Verified alerts** » | GDELT n'est pas vérifié ; contredit `README` et `SettingsPanel`. |
| `i18n.ts:68,185` | « Dernier engagement » / « Latest active engagement » | Pour un signal presse, c'est la date de **publication** (`urlpubtimedate`), arrondie au quart d'heure. |
| `i18n.ts:55-58` vs `FiltersPanel.tsx:185-205` | Deux jeux de libellés de types ; celui du dictionnaire n'est **jamais utilisé** (`dict.filters.types`, `criticalTheaters`, `activeHotspotsHint`, `recorded24hHint`, `geopoliticsButton`, `selectedTheater`, `feedStatus` : 0 usage hors i18n). | Dette ; risque de désynchronisation. |
| `LiveConflictPanel.tsx:52,172`, `ViewPanel.tsx:111,237`, `Overlays.tsx:122` | `eventType`/`topType` bruts en **anglais** (« Media signal », « Violence against civilians ») dans une UI française ; `subEventType` GDELT en français, ACLED en anglais. | Mélange FR/EN dans la même ligne. |
| `ViewPanel.tsx:112` | `MEDIA_SIGNAL · gdelt · GDELT · 1 dépêche · brudirect.com` | Jargon technique brut (code de confiance + dataset + source). |
| `Nav` `conflicts` → « Théâtres de Guerre » (`ViewPanel.tsx:216,221`) | Liste les 40 clusters les plus intenses = **tous presse** à 30 j (Paris, « White House »). | Un « théâtre de guerre » à Paris. |
| `Nav` `regions` « GÉOPOLITIQUE » → « Géopolitique Régionale » (`ViewPanel.tsx:160`) | Liste des **pays** triés par morts puis événements. | Ni régional ni géopolitique. |
| `Nav` `timeline` « CHRONOLOGIE » (`IntelApp.tsx:105,117`) | `openView = view==="TIMELINE" ? "OVERVIEW" : view` : le bouton **ne fait rien** d'autre que se surligner. | Faux contrôle. |
| `ViewPanel.tsx:99` | « N incidents récents indexés » | Les N plus récents d'une même tranche GDELT de 15 min. |
| `ViewPanel.tsx:259-262` | Bouton « actualiser l'état des sources » | Appelle `GET /api/ingest` (lecture d'état) : n'actualise rien. |
| `ViewPanel.tsx:291`, `Header.tsx:129` | « 13 659 événements » (UCDP) alors qu'aucun n'est dans la fenêtre. | Total historique de la base, pas de la vue. |
| `LiveConflictPanel.tsx:234-235` | Sous-ligne `† 272 év.` | Le « † » est collé au nombre d'événements : lecture « 272 morts ». |
| Boutons `RECON SATELLITE`, `Pentagone`, « balise temps réel des personnels » | Vocabulaire martial/militaire sans objet pour des données OSINT. | Ton et crédibilité. |

### P1-5 · Cluster = étiquette arbitraire, position approximative
- `cluster.ts:129-130` : le « foyer » prend la localité de l'événement **le plus mortel, et à égalité (tous 0 pour la presse) le premier de la liste**. Ordre = ordre d'insertion → « White House » pour 149 mentions aux États-Unis, « Iran » vs « Tehran » arbitraire.
- `cellKey` (`latlon.ts:57-61`) calcule `dLon` par événement avec son propre `cos(lat)` : deux événements de la même rangée de latitude mais de latitudes différentes n'ont pas la même grille en longitude. Les clusters sont donc spatialement instables (`encodeURIComponent(country)` ajoute une coupure supplémentaire à chaque frontière).
- **Fix** : label = lieu modal pondéré (ou « N articles · pays ») ; cellule de longitude calculée sur le centre de rangée.

### P1-6 · Sélection de foyer instable au zoom
- `resolveSelection` (`useIntelStore.ts:132-149`) : à chaque changement de `degrees`, l'ID du foyer change (il embarque la cellule). On recherche le voisin même pays/confiance dans 4° ; sinon **`null`** → le panneau se ferme sans raison (le commentaire dit « conserver tel quel »). Sinon il bascule silencieusement sur un autre foyer, avec d'autres chiffres.
- `loadClusterDetail` (`:276-297`) ne remet pas `selecting` à `false` quand la sélection change entre-temps (reste « CHARGEMENT… »).

### P1-7 · FIRMS filtré par la presse (circularité) et non sélectionnable seul
- `intel.ts:303-317` : une anomalie thermique n'est affichée que si une cellule de 0,25° voisine contient un événement UCDP/ACLED sur 1 an **ou une mention GDELT sur 30 j**. Or les mentions GDELT sont des capitales/lieux de protagonistes (Paris, Moscou…) : les feux de Paris ou de torchères « se qualifient » parce qu'un article les cite. À l'inverse, des incendies pertinents hors de ces cellules (catastrophes naturelles) sont supprimés.
- Le preset « Sources documentées » (`FiltersPanel.tsx:84`) exclut FIRMS (`["acled","ucdp","import:csv"]`), « Sources + presse » inclut tout, et il n'y a **aucun moyen d'isoler FIRMS**.
- **Fix** : traiter FIRMS comme une **couche** (catastrophes/feux) avec son propre toggle, agrégée par pays ; la corrélation conflit devient un *badge* optionnel (« à proximité d'un incident documenté ≤ X km »), pas un filtre silencieux.

### P1-8 · UCDP : lag et métadonnées
- Fichiers « Candidate » : événements du 2026-01-01 au 2026-08-31 (note du connecteur correcte mais **non visible** hors du panneau Sources). Par défaut (30 j), UCDP est **invisible** (0 événement).
- `sourceUrl` = `https://ucdp.uu.se/downloads/#candidate` (`ucdp.ts:96`) : le lien « source » de chaque événement mène à une page de téléchargement, pas à l'article. `source_original`/`source_article` ne sont lus qu'en mode API (`ucdp.ts:150`).
- `Math.max(days, 365)` (l.105) est écrit en dur : l'ingestion ignore `days`.
- `SettingsPanel.tsx` suggère `UCDP_VERSION=26.1` quand le code utilise `25.1` par défaut (`ucdp.ts:21`).
- **Fix** : afficher « Dernières données UCDP : 31/08/2026 » dans l'en-tête de la vue et présélectionner une fenêtre qui contient des données documentées quand la fenêtre courante en est vide (« Aucun incident documenté sur 30 j — dernier relevé UCDP : 31/08 »).

### P1-9 · Performance et croissance du stockage
- `LocalRepository` (`repository.ts:97-168`) : **chaque requête relit et re-parse tout le fichier** (`read()` l.107, `query` l.160, `counts` l.162-166). `data/intel-events.json` = **12,7 Mo / 23 792 événements** (~534 o/événement). Une page = `/api/events` + `/api/stats` + timeline 1 an + détail, soit 4 à 5 parses de 12,7 Mo, ×N clients à chaque événement SSE `ingest` (`IntelApp.tsx:49-52`). Mesuré : 50-100 ms aujourd'hui.
- **Aucune rétention**. GDELT ajoute ~6,3 k événements/jour (≈ 3,4 Mo/j). `JSON.parse` / `readFile(…, "utf8")` échoue au-delà de ~512 Mo (limite de chaîne V8) : **rupture estimée dans ~5 mois** (≈ 2,3 M événements/an, ~1,2 Go). Chaque ingestion (15 min) réécrit le fichier complet (`mutate`, l.118-157).
- **Fix** : SQLite/Postgres (le `PgRepository` existe) avec index `(event_date)`, `(country_iso3, category, event_date)` ; politique de rétention (GDELT brut 30-60 j, agrégats journaliers 2 ans) ; **agrégation SQL** (`GROUP BY` pays/jour/catégorie) au lieu de charger tous les événements.
- `ingest` re-`upsert` à chaque cycle l'intégralité du cache UCDP (13,6 k) + FIRMS (1,2 k) avec `updatedAt` neuf, puis diffuse un SSE `ingest` même sans nouveauté : tous les clients rechargent pour rien. Les compteurs `inserted/updated` du SSE sont inutilisables.
- **Verrou périmé** : `mutate` (l.119-131) crée `intel-events.json.lock` en `wx` et le supprime en `finally`. Un `kill -9`/crash laisse un `.lock` : toute ingestion échoue ensuite (« Local event store is not writable or is locked ») et est avalée par `startAutoRefresh` (`intel.ts:131-133`, simple `console.warn`) : **la base se fige sans alerte UI**. Il faut une détection de verrou périmé (mtime > 30 s) ou un store transactionnel.
- Plusieurs processus `next start -p 3005` visibles (`ps`) : à nettoyer ; deux serveurs partageant le même JSON se disputeraient le verrou.

### P1-10 · Page publique inutile
- `public/data/events.json` (1,3 Mo) = copie du jeu de démo, **servi publiquement** mais référencé nulle part dans `src/`. Même contenu que `data/demo-seed.json`. À supprimer (et à ne pas versionner deux fois).

---

## 3. P2 — Robustesse, hygiène, cohérence

- **Sources panel / Settings exposent du jargon développeur** : `acled.ts:92` renvoie « Non configuré. Renseignez ACLED_EMAIL / ACLED_PASSWORD dans .env.local. » (affiché tel quel par `ViewPanel.tsx:294`, `/api/stats`, `/api/ingest`). `SettingsPanel.tsx` affiche un bloc `.env.local` complet (variables, `INGEST_TOKEN`…). `.env.example` omet `FIRMS_MAP_KEY`/`FIRMS_DISABLED`/`ACLED_DISABLED`, pourtant lus par les connecteurs. **Fix** : côté utilisateur « Source non connectée — nécessite une clé d'accès (voir documentation) » et un état `connecté / retard / indisponible / non configuré`; la procédure d'installation va dans le README ou un panneau « Administration » protégé.
- **`GET /api/ingest`** (`ingest/route.ts:49-51`) est public et duplique `/api/stats.connectors` : expose `repository.kind`, `report`, notes avec noms de variables. Réduire ou protéger.
- **`/api/latest`** (`latest/route.ts:12`) : `Number("abc")` → `NaN` → `slice(0, NaN)` renvoie `[]` sans erreur. `/api/stats` et `/api/latest` n'ont pas de `try/catch` (500 avec trace en dev). `/api/events` renvoie `err.message` brut.
- **`datasets=` vide** : `filtersFromSearchParams` (`filters.ts:28`) traite `params.has("datasets")` avec liste vide comme « tout, démo comprise » (cf. commentaire `setDatasets`, store l.84-87) ; `Timeline.tsx:28` envoie `datasets=${filters.datasets.join(",")}`, qui produirait ce cas si le tableau était vide. Rendre le défaut explicite côté serveur (`datasets` vide ⇒ réel uniquement).
- **Timeline** (`Timeline.tsx`) : frise 12 mois via `/api/stats?range=1y` sans `countries` ni `at` (cohérent) mais *les mêmes seaux hebdo* masquent le fait qu'il n'y a de la presse que sur la dernière barre ; `span.end = dernière_barre + 7 j`. Le survol affiche « N événements · M † » sans dire de quelle source. `inWindow` surligne tout ce qui suit le curseur, pas la fenêtre.
- **Fuseaux** : `relative()` et `dateTimeUTC()` mélangent « il y a 3 h » (local) et « 04:37Z » (UTC) sans le dire.
- **`server.log` versionné** (`git ls-files` → `server.log`, `next-env.d.ts`) alors que `*.log` est ignoré : retirer de l'index. Le log contient des lignes `UCDP GED : non configuré` obsolètes qui contredisent l'état actuel.
- **Code mort** : `windowFor`, `nearestClusterKm`, `dedupeKey` (seulement si `id` absent), `MemoryRepository` en prod, `byIds`, clés i18n listées plus haut.
- **`next.config.mjs`** : aucun en-tête de sécurité (CSP, `X-Frame-Options`, `Referrer-Policy`), `poweredByHeader` actif. `TacticalReconModal` embarque des `iframe` Google Maps (`TacticalReconModal.tsx:26-27,95,113`) : autoriser uniquement `maps.google.com` en `frame-src`.
- **Géométrie / ISO** : `ISO_A3 = "-99"` (France, Norvège, Kosovo, Chypre Nord, Somaliland) dans Natural Earth 110m ; chaque appelant doit répéter le repli `ADM0_A3`. Centraliser dans `world.ts`.
- **Mêmes mots, deux sens** : « Foyers » désigne (a) la liste du panneau droit (`LiveConflictPanel.tsx:214`, `detectedClusters`), (b) le compteur de tête, (c) `countryCard.associatedHotspots` ; (a) et (b) ne portent pas le même nombre (14 affichés / `clusters.length`).

---

## 4. Carte des métriques visibles → calcul réel

| Écran / libellé | Fichier:ligne | Source du chiffre | Verdict |
|---|---|---|---|
| Header « N événements indexés » | `Header.tsx:129-131` | `counts.total` (tout le store, démo comprise) | ✗ P0-3 |
| Header « flux actif / synchronisé » | `Header.tsx:112-125` | état SSE + `loading` | ✓ (état réseau, pas fraîcheur des données) |
| Bannière « SYNC … » | `Overlays.tsx:365` | `max(updatedAt)` ≈ heure d'ingestion | ✗ P0-3 |
| Bannière « X documentés · Y presse · Z démo · W thermiques » | `Overlays.tsx:371` | `coverage()` `intel.ts:379-384` | ✓ calcul ; ✗ lisibilité |
| Bannière « Sources disponibles : GDELT · FIRMS » | `Overlays.tsx:343` | `distinctDatasets(events)` (jeux **présents dans la fenêtre**) | ~ trompeur : UCDP « disparaît » |
| Panneau gauche « Foyers d'affrontements » | `GlobalSituationPanel.tsx:236` | `clusters.length` serveur, dépend de `degrees` | ✗ P0-2 |
| « dont N théâtres majeurs » | `:220,238` | `intensity ≥ 0,5` (recalculé client, ≠ `majorZones`) | ✗ P0-2 |
| « Incidents (24h) » | `:243` | mentions + détections | ✗ P0-2 |
| « Événements (7 jours) » | `:249` | idem, borné par la fenêtre | ✗ P0-2 |
| « Pertes humaines déclarées » | `:255` | Σ `fatalities` (UCDP `best`) ; N/A si pas de documenté | ~ libellé |
| Sparkline « Dynamique temporelle (30 jours) » | `:262`, `i18n.ts:40` | `daily` = seaux sur la fenêtre | ✗ libellé figé |
| « Pays · Top 6 » (n événements, « † ») | `:186-200,274-285` | Σ `eventCount` par `countryKey` | ✗ presse = événements ; clés pays incohérentes |
| « Dernière mise à jour » | `:314-317` | `lastDataUpdate` | ✗ P0-3 |
| « Explorer les pays » : « N événements » | `:303` | `ranking` (fenêtre + filtres) | ~ libellé incomplet |
| Fiche pays (`CountryCard`) : foyers/événements/victimes | `Overlays.tsx:200-203,278-291` | `c.country === country.name` | ✗ P0-5 |
| Fiche pays : population, PIB (BM) | `CountryIndicators.tsx` | World Bank `mrnev=1`, cache 24 h | ✓ (daté) |
| Fiche pays : dirigeants | idem | Wikidata, cache 6 h | ~ P1-2 |
| Fiche pays : régime, budget, PIB, inflation, dissuasion | `Overlays.tsx:224-271` | `STATIC_PROFILES` non datés | ✗ P1-1 |
| `LiveConflictPanel` « Événements recensés / Pertes déclarées / Mode dominant / Premier / Dernier / Forces / Sources / MAJ » | `:168-186` | agrégat cluster + événements | ✗ libellés martiaux ; MAJ = ingestion |
| `LiveConflictPanel` « Régime politique » | `:136-141` | `getCountryGeopolitics(selected.country)` | ✗ « Inconnu » hors 13 pays |
| Live Events | `ViewPanel.tsx:63-122` | `/api/latest` trié par `eventDate` (égalités au quart d'heure) | ✗ aucun titre ; ordre quasi arbitraire |
| Théâtres de guerre | `ViewPanel.tsx:209-245` | top 40 clusters par intensité | ✗ presse = guerre |
| Sources & audit : « N événements » | `ViewPanel.tsx:289-293` | `counts.byDataset` (historique, hors fenêtre) | ✗ P1-4 |
| Filtres : compteurs de types | `FiltersPanel.tsx:67-72,115-119` | Σ `typeCounts` des clusters | ✓ ; « émeutes/manif./stratégique » = 0 avec des données réelles |
| Timeline | `Timeline.tsx:28-46` | `daily` 1 an | ~ P2 |
| Rendu `N foyers · X°` | `Overlays.tsx:71` | `clusters.length`, `degrees` | ✓ technique |
| AURA `get_platform_overview` | `agent.ts:153-179` | mêmes agrégats | ✗ hérite des biais ci-dessus |

---

## 5. Pipeline de données — recommandations structurantes

1. **Modèle d'événement enrichi** (migration de `ConflictEvent`) :
   - `category` ∈ `armed_conflict | unrest | terrorism | disaster | political | economic | humanitarian | media | thermal`, séparée de `eventType` (taxonomie ACLED) ;
   - `kind` ∈ `incident | article | detection` ;
   - `country_iso3`, `admin1`, `geo_precision` ∈ `point | city | admin1 | country_centroid` ;
   - `title`, `url`, `domain`, `language` ;
   - `fatalities: number | null`, `fatalities_basis` (best/low/high, null si presse) ;
   - `source_updated_at` (nul si inconnu), `ingested_at`, `n_sources`, `n_mentions`.
2. **Un connecteur = une chronologie déclarée** : `{ latency, depth, cadence, license }` exposé dans `/api/sources` et affiché dans l'UI (cf. P0-3).
3. **Agrégation côté base** : stats par `(iso3, category, jour)` précalculées ; les « foyers » de la carte restent une vue de rendu, calculée sur la fenêtre sans toucher aux compteurs.
4. **Dédup** : par article (`SOURCEURL` normalisée) pour la presse ; par `(dataset, id)` pour les incidents ; **déduplication inter-sources UCDP↔ACLED** (même date ± 1 j, ≤ 10 km, acteurs proches) avec lien `duplicate_of`.
5. **Fenêtres** : séparer « période d'observation » (`from/to`) de « fraîcheur par source ». Défaut = « Dernières données disponibles » ; présenter 24 h/7 j/30 j pour les sources temps réel (presse, satellite) et mensuel pour UCDP.
6. **Intensité** : trois échelles non comparables — *Violence documentée* (morts, nombre, récence), *Attention médiatique* (mentions normalisées par pays et par jour, z-score), *Anomalie thermique* — jamais additionnées. « Théâtre majeur » ne dérive que de la première.
7. **Autres sources à prévoir** (gratuites, sans clé ou clé simple) : GDACS + USGS + NASA EONET (catastrophes), ReliefWeb/UNHCR (humanitaire), World Bank (FP.CPI.TOTL.ZG inflation, SL.UEM.TOTL.ZS chômage), IMF DataMapper, ECB/Stooq (taux de change, indices), ACLED (manifestations/émeutes, accès sur demande).

---

## 6. État et UX — couplage et corrections

- **Un seul état de focus** (voir P0-6). Proposition :
  ```ts
  focus: { iso3: string | null; clusterId: string | null; source: 'globe'|'list'|'aura' }
  setFocus(next) // ferme/ouvre tout le reste, centre la caméra, alimente AURA
  ```
  - `CountryCard`, `CountryProfile`, `LiveConflictPanel` deviennent **un** composant `CountryBrief` (section « foyers » en bas).
  - `Esc` ferme dans l'ordre : modal recon → AURA → vue secondaire → focus.
  - Le contexte AURA vient *toujours* de `focus`.
- **Re-fetch** : `refresh()` annule seulement `inFlight` (events+stats), pas le détail. Ajouter un `AbortController` par panneau et un `requestId` anti-race ; déduire `selecting` d'un compteur plutôt que d'un booléen.
- **Zoom ↔ compteurs** : le niveau d'agrégation (`degrees`) ne doit pas changer les statistiques de tête (`/api/stats` doit ignorer `degrees` ou le compte doit être fixe).
- **SSE** : n'émettre `ingest` que si `inserted > 0` ; inclure `{ changedCountries }` pour recharger sélectivement.
- **Navigation** : supprimer le faux onglet « CHRONOLOGIE », renommer « GÉOPOLITIQUE » → « PAYS » et « CONFLITS ARMÉS » → « INCIDENTS & PRESSE » (ou séparer en deux listes), puis retirer les 40 clusters presse de la liste « guerre ».
- **Vocabulaire** : un glossaire unique (FR/EN) avec définitions de *Incident documenté*, *Article / mention presse*, *Détection satellite*, *Foyer (marqueur)*, *Intensité*. Un `?` à côté de chaque compteur de tête qui l'ouvre.

---

## 7. Sécurité et robustesse des routes `src/app/api/*`

| Route | Constat | Gravité | Correctif |
|---|---|---|---|
| `POST /api/agent` (`agent/route.ts`) | Aucune authentification ni contrôle d'origine. Le corps est lu via `request.json()` **quelle que soit** l'entête `Content-Type` : une page tierce peut envoyer un POST « simple » (`text/plain`, sans préflight CORS) vers `http://localhost:3005/api/agent` et **consommer le quota OpenAI** (jusqu'à 20 req/min, 6 manches de recherche web chacune). Serveur lancé par `next start -p 3005` (écoute sur toutes les interfaces par défaut) : exposé au LAN. | **P1** | Exiger `Content-Type: application/json` ; vérifier `Origin`/`Host` ; token de session ou cookie `SameSite=Strict` ; `-H 127.0.0.1` ou reverse proxy ; limite par IP en plus de la limite globale ; plafond de dépense. |
| `POST /api/agent` — limite globale | Compteur unique pour toute l'instance : un seul client peut priver les autres. Aucune limite de concurrence ni de taille totale (24 × 6 000 car.). | P2 | Limite par IP/session + concurrence max. |
| `POST /api/agent` — modèle | `OPENAI_MODEL` par défaut `"gpt-5.6-terra"` (`agent.ts`) : nom non vérifié ; en cas d'inexistence, l'erreur est renvoyée comme « Service d'analyse indisponible ». | P2 | Valider au démarrage / message d'erreur de configuration. |
| `get_country_activity` (agent) | Appariement par sous-chaîne (cf. P0-5) ; contenu des tools (`source`, `url`) issu du web non assaini → surface d'injection de prompt (faible : pas d'outil d'écriture). | P1 / P2 | Résolution `iso3`; borner et échapper les champs repris. |
| `POST /api/ingest` | Bien protégé : jeton `INGEST_TOKEN`, comparaison `timingSafeEqual` sur hachés, limite 60 s, 503 si pas de jeton. | ✓ | — |
| `GET /api/ingest` | Public, expose type de dépôt, rapport d'ingestion, noms de variables d'environnement. | P2 | Réduire à un code d'état ; fusionner avec `/api/stats`. |
| `POST /api/cluster` | Validation soignée (types, bornes, `limit ≤ 300`) mais même problème de requête « simple » ; sans effet de bord. | P2 | `Content-Type` strict. |
| `GET /api/events|stats|latest` | Pas de limite sur `countries`/`types`/`datasets` (longueur de liste) ; `/stats` et `/latest` sans `try/catch`. `latest` : `limit` NaN. | P2 | Zod/validation ; limite 20 valeurs ; gestion d'erreurs. |
| `GET /api/stream` | Aucun plafond de connexions SSE ; chaque ouverture appelle `ensureReady()`. | P2 | Plafond par IP ; en-tête `retry`. |
| `GET /api/country` | Bonne validation (`^[A-Z]{3}$` + référentiel), réponses bornées à 64 Ko, `redirect:"error"`, TTL. | ✓ | Retourner aussi `asOf`, `fetchedAt` côté UI. |
| Secrets | `.env.local` en `0600` et ignoré ; aucun `NEXT_PUBLIC_*`. `.env.example` ne contient que des noms. | ✓ | Ajouter `FIRMS_MAP_KEY`. |
| Fichier de données | `data/intel-events.json` en `0600`, ignoré par git ; mais verrou périmé possible (P1-9). | P1 | Cf. P1-9. |

---

## 8. Modèle cible : `CountryBrief` — « tout sur un pays, en direct »

### 8.1 Principes
1. **Une clé : `iso3`** (référentiel pays unique avec alias). Aucun filtre/regroupement par nom.
2. **Chaque bloc est autonome** et porte sa propre provenance et sa fraîcheur : un bloc en échec ne casse pas les autres.
3. **Jamais de chaîne « N/A »** dans l'API : `value: null` + `reason` (`not_covered | no_data | stale | error | not_configured`). L'UI localise.
4. **Séparer incident, article, détection** : trois `kind`, trois échelles, jamais additionnés.
5. **Chaque nombre est expliqué** : `definition` (clé de glossaire), `window`, `asOf`, `n`, `method`.

### 8.2 Contrat

```ts
// GET /api/country/{iso3}/brief?window=7d|30d|90d|1y&locale=fr|en
type Provenance = {
  source: string;          // "UCDP GED Candidate", "GDELT Events 2.0"…
  sourceUrl: string;
  license?: string;
  fetchedAt: string;       // moment de la collecte
  asOf: string | null;     // date du dernier fait présent (≠ fetchedAt)
  expectedLagDays: number; // 0 (temps réel) … 60 (UCDP)
  coverage: 'global'|'regional'|'partial';
  confidence: 'confirmed'|'reported'|'media'|'modeled'|'demo';
};
type Block<T> = {
  status: 'ok' | 'stale' | 'empty' | 'unavailable' | 'not_covered';
  reason?: string;         // code machine
  provenance: Provenance[];
  data: T | null;
};
type Trend = { current: number; previous: number; deltaPct: number | null };

type CountryBrief = {
  country: { iso3: string; nameFr: string; nameEn: string; flag?: string; centroid: [number, number]; regionCode?: string };
  window: { from: string; to: string; key: string };
  generatedAt: string;

  armedConflict: Block<{            // UCDP, ACLED (Battles, Explosions, VAC)
    incidents: number; fatalities: number | null; trend: Trend;
    lastIncidentAt: string | null;
    topLocations: { name: string; admin1?: string; lat: number; lon: number; incidents: number; fatalities: number | null }[];
    actors: { name: string; incidents: number }[];
  }>;
  unrest: Block<{                   // ACLED Protests/Riots; GDELT CAMEO 14x (marqué « presse »)
    protests: number; riots: number; trend: Trend; sizeEstimate?: string;
    stories: Story[];               // 5 plus saillants
  }>;
  terrorism: Block<{ incidents: number; fatalities: number | null; stories: Story[] }>;
  disasters: Block<{                // GDACS, USGS, EONET, FIRMS (pays, non filtré)
    active: { type: 'earthquake'|'flood'|'cyclone'|'fire'|'volcano'|string; title: string; severity?: string; startedAt: string; url: string }[];
    thermalDetections: number;
  }>;
  humanitarian: Block<{ displaced?: number; needs?: string; reports: Story[] }>;   // ReliefWeb/UNHCR
  politics: Block<{
    headOfState: Person | null; headOfGovernment: Person | null;   // Wikidata (rang), date de récupération
    regime?: { label: string; source: string; asOf: string };       // V-Dem/Freedom House si importés
    upcomingElections?: { type: string; date: string; source: string }[];
    stories: Story[];
  }>;
  economy: Block<{
    population: Indicator; gdpUsd: Indicator; gdpGrowth?: Indicator;
    inflation?: Indicator; unemployment?: Indicator;      // Banque mondiale / FMI, avec année
    currency?: { code: string; vsUsd: number; change30d?: number; asOf: string };
    marketIndex?: { name: string; level: number; change30d: number; asOf: string };
    sanctions?: { regime: string; since?: string; sourceUrl: string }[];
  }>;
  media: Block<{                   // attention médiatique : jamais un incident
    articles24h: number; articles7d: number; toneAvg: number; baselineZ: number;
    timeline: { day: string; articles: number; tone: number }[];
  }>;

  hotspots: Block<Cluster[]>;     // pour le globe uniquement ; chaque cluster déclare kind + précision
  audit: { sources: Provenance[]; warnings: string[] };   // « UCDP finit au 31/08 », etc.
};

type Story = { title: string; url: string; domain: string; lang: string; publishedAt: string;
               category: string; geoPrecision: 'point'|'city'|'admin1'|'country'; nMentions: number; tone?: number };
type Indicator = { value: number | null; unit: string; year: number | null; sourceUrl: string; status: 'available'|'unavailable'|'error' };
type Person = { name: string; wikidataId: string; since: string | null; rank: 'preferred'|'normal'; fetchedAt: string; sourceUrl: string };
```

### 8.3 Mise en œuvre
- **Stockage** : table `events(id, kind, category, event_type, country_iso3, admin1, lat, lon, geo_precision, title, url, domain, fatalities, source_dataset, event_date, source_updated_at, ingested_at, n_mentions, tone)` ; table `country_alias`; vue matérialisée `country_daily(iso3, day, category, kind, n, fatalities)`.
- **API** : `/api/country/[iso3]/brief` (composition de blocs, `Promise.allSettled`, cache 5 min par bloc), `/api/sources` (profondeur/latence), `/api/glossary`.
- **UI** : une fiche unique, sections repliables par catégorie ; chaque section avec `asOf`, source, et un « ? » de définition ; états `stale/empty/not_covered` rendus explicitement (« Aucun incident documenté sur 30 j. Dernier relevé UCDP : 31/08 »).
- **AURA** : outils `get_country_brief(iso3)` (remplace `get_country_activity` + `get_country_indicators` + `get_country_leaders`), réponse déjà structurée avec provenance ; plus de correspondance par nom.
- **Tests de vérité** (fixtures figées) : (1) USA → ≥ 1 événement non nul ; (2) « Niger » ne renvoie jamais Nigeria ; (3) `events7d ≥ events24h` quelle que soit la fenêtre ; (4) aucun total ne mélange `kind` ; (5) aucune chaîne « N/A » dans le JSON ; (6) `lang` du document = locale.

---

## 9. Plan d'action recommandé (ordre de valeur / coût)

| # | Action | Effort | Gain |
|---|---|---|---|
| 1 | P0-1 : `lang`/`translate="no"` + sync locale | 0,5 h | Supprime la traduction cassée |
| 2 | Renommer/recomposer les 4 compteurs de tête (P0-2) : presse ≠ incidents ; `events24h/7d/30d` en bornes absolues ; compter par URL | 0,5 j | Compréhension immédiate |
| 3 | Fraîcheur honnête (P0-3) : `asOf` par source, retirer `updatedAt` d'ingestion, total d'en-tête hors démo, défaut « dernières données disponibles » | 1 j | Confiance |
| 4 | Un seul état `focus` + une seule fiche pays (P0-6) ; AURA lit `focus` | 1 j | Fin des deux « France » |
| 5 | Référentiel pays `iso3` à l'ingestion + alias (P0-5), corriger `get_country_activity` | 1-2 j | Chiffres pays justes |
| 6 | GDELT : Events 2.0 + titres, suppression de l'allowlist, dédup par article (P0-4) | 2-3 j | Voir les troubles sociaux, savoir « ce qui s'est passé » |
| 7 | Brancher ACLED (ou CAMEO 14) pour manifestations/émeutes | 0,5 j + accès | Couverture « troubles » |
| 8 | Stockage SQL + rétention + agrégation SQL (P1-9) | 3-4 j | Évite la panne à ~5 mois |
| 9 | Sécuriser `/api/agent` (Origin/Content-Type/session, limite par IP) | 0,5 j | Coût OpenAI maîtrisé |
| 10 | `CountryBrief` (§8) + catégories catastrophes/économie/politique | 1-2 sem. | Cible produit |
