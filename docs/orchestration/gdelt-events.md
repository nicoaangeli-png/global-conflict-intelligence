# GDELT 2.0 Events — troubles sociaux (18/10/2026)

## Fait
- `src/server/connectors/gdeltEvents.ts` (nouveau) : connecteur GDELT 2.0 Events (id `gdelt`, jeu `gdelt`, provenance `media_monitoring`, confiance `MEDIA_SIGNAL`).
  - Lit `https://data.gdeltproject.org/gdeltv2/lastupdate.txt` (le HTTP simple répond 301 vers HTTPS : on utilise HTTPS), puis `<ts>.export.CSV.zip` et `<ts>.gkg.csv.zip`.
  - Rattrapage : 96 fichiers 15 min (24 h) par défaut, `GDELT_EVENTS_CATCHUP_FILES` (1..672). Téléchargement séquentiel, 250 ms entre requêtes, du plus récent au plus ancien, budget de 100 s par passage (`GDELT_EVENTS_BUDGET_MS`) : le reste est rattrapé aux passages suivants. Cache mémoire par fichier (sur `globalThis`) : un fichier traité n'est jamais retéléchargé ; un 404 récent n'est retenté qu'après 5 min ; le GKG n'est téléchargé que si l'export contient des lignes retenues.
  - Zip lu sans dépendance : répertoire central -> en-tête local -> `zlib.inflateRaw` (sortie plafonnée à 200 Mo, zip64 refusé).
  - `fetchSocialFeed(): Promise<LiveItem[]>` exporté (catégorie `social`, nature `press_article`, caveat « Signal presse GDELT, non confirmé »).
- `src/lib/geo/country.ts` : table `FIPS_TO_ISO3` complète (>240 codes FIPS 10-4), `fipsToIso3()`, et correction de `resolveCountryIdentity(code, "fips")` (avant : un code FIPS absent de la petite table d'alias, ex. `SP`, `GM`, `RS`, `UP`, retombait sur `null`).
- `src/types/conflict.ts` : ajouts optionnels `title?: string | null`, `geoPrecision?: "city" | "region" | "country"` (type `GeoPrecision`).
- `src/server/connectors/gdelt.ts` : ancien flux GKG v1 désactivé (`isConfigured()` = false, en-tête expliquant pourquoi), fichier conservé.
- `src/server/intel.ts` : import du nouveau connecteur à la place de l'ancien (alias `gdeltConnector`, donc `CONNECTORS` et `refreshStatuses` inchangés). `pickRepository` non touché.
- Tests : `tests/gdelt-events.test.ts` (31 tests), fixtures réelles réduites dans `tests/fixtures/gdelt/` (export, GKG, zips, lastupdate), aucun appel réseau.

## Colonnes (index base 0)
Export 2.0, 61 colonnes : 0 GLOBALEVENTID, 26 EventCode, 28 EventRootCode, 29 QuadClass, 30 GoldsteinScale, 31 NumMentions, 32 NumSources, 33 NumArticles, 51 ActionGeo_Type, 52 ActionGeo_FullName, 53 ActionGeo_CountryCode (FIPS), 56 ActionGeo_Lat, 57 ActionGeo_Long, 59 DATEADDED, 60 SOURCEURL. (SQLDATE, col. 1, n'est pas utilisé : peu fiable.)
GKG 2.1, 27 colonnes : 4 DocumentIdentifier (= SOURCEURL), 26 Extras (`<PAGE_TITLE>`). Vérifié sur un fichier réel du 18/10/2026 (677 lignes à 61 colonnes, 589 à 27).

## Règles appliquées
- CAMEO : 141 manifestation, 142 grève de la faim, 143 grève/boycott, 144 blocage -> `Protests` ; 145x -> `Riots`. 182/181/184/185/186 -> `Violence against civilians` ; 183 -> `Explosions/Remote violence` ; 190/193 -> `Battles` ; 194/195 -> `Explosions/Remote violence` ; 191/192/196 (blocus, occupation, violation de cessez-le-feu) et 201 (expulsion) -> `Strategic developments` ; 200/202/203 -> `Violence against civilians` ; 204 -> `Explosions/Remote violence`. Tout le reste est ignoré. (Les choix 18x/19x/20x détaillés sont les miens : à valider.)
- Filtre qualité : `NumSources >= 2 OU NumArticles >= 3`. Une ligne vue par un seul article d'un seul média est surtout du bruit de codage automatique ; le critère n'est pas une garantie de véracité. Constante `MIN_SOURCES`/`MIN_ARTICLES`.
- Géo : `ActionGeo_Type` 3/4 -> `geoPrecision: "city"` ; 2/5 -> `"region"` ; 1 -> `"country"` (centroïde) ; 0 ou coordonnées absentes/invalides -> rejeté. Pays FIPS -> ISO3 par la table ; `country` = nom canonique si connu du référentiel, sinon ISO3 ; code FIPS inconnu -> `country: ""` (jamais deviné).
- Dédoublonnage : clé URL + racine CAMEO + pays FIPS + lieu + coordonnées. Fusion = date la plus ancienne, compteurs au maximum (pas de somme). Lieux distincts d'un même article conservés ; un lieu pays/région est retiré si le même article a un lieu plus précis dans le même pays. Id stable `gdelt-ev-<sha256>` (le même article revu plus tard ne crée pas un nouvel événement).
- Titres : GKG du même horodatage, jointure URL exacte (fragment retiré). Sinon `title = null`, `source` = « GDELT · domaine (titre non fourni) ». Dans `fetchSocialFeed`, `LiveItem.title` étant obligatoire, un titre inconnu est remplacé par le DOMAINE du média (jamais un titre fabriqué) et le résumé précise « titre non fourni ».
- Nature : `fatalities: 0` = non applicable (profil `gdelt` : `fatalitiesApplicable: false`) ; `eventDate` = DATEADDED UTC, `updatedAt` = collecte.
- Flux social : racine 14, 24 h, un item par article (URL), pays = union des pays cités, `lat/lon` renseignés seulement si le lieu principal est une ville (sinon `null`), `severity`/`metric` = `null`.

## Vérifié
- `pnpm typecheck` : OK. `pnpm test` : 32 tests OK (31 nouveaux + existant).
- Passage réel (script hors dépôt `/tmp/gdelt-live/live.test.ts`, 18/10/2026 12:24) : 96/96 fichiers en 120 s, 1902 titres appris. 2502 événements sur 24 h : Battles 1205, Violence against civilians 498, Protests 455, Explosions/Remote violence 118, Strategic developments 172, Riots 54 ; précision : city 1751, country 492, region 259 ; 2498/2502 avec titre. Flux social : 443 éléments, dont 89 mentionnant la France.
- France, 24 h : 193 événements (Protests 69, Riots 22, Battles 46, Violence against civilians 49, Strategic developments 7). Échantillon avec titres et URL réels (extrait) :
  - 10:00Z Paris, « Nearly 300 arrested as Yellow Vests join mass protests in France » — https://article.wn.com/view/2026/10/18/Nearly_300_arrested_as_Yellow_Vests_join_mass_protests_in_Fr/
  - 09:30Z Paris (Riots), « 'Never seen anything like it': Mass looting grips Paris » — https://www.ewn.co.za/2026/10/18/never-seen-anything-like-it-mass-looting-grips-paris
  - 07:00Z Rennes, « Violent clashes, looting and buildings ablaze in France as over 1,200 arrested after protests » — https://thefrontierpost.com/violent-clashes-looting-and-buildings-ablaze-in-france-as-over-1200-arrested-after-protests/
  - 08:15Z « Spire collapses at historic Limoges town hall amid violent protests across France » — https://www.euronews.com/2026/10/18/spire-collapses-at-historic-limoges-town-hall-amid-violent-protests-across-france

## Non vérifié
- Le comportement au sein de `ingest()` / SSE / UI avec ces événements (non lancé : serveur non redémarré, pas d'ingestion manuelle).
- Persistance Postgres de `title` et `geoPrecision` (le dépôt local JSON les conserve ; les colonnes SQL, hors périmètre, non).
- Le rendu des types `Protests`/`Riots`/violents côté globe et filtres.

## Limites
- Codage CAMEO automatique et bruité : faux positifs (ex. un article sur SpaceX codé « manifestation » en Espagne ; « Man dies jumping off the Arc de Triomphe » codé manifestation à Paris), lieux erronés (« Margaux » pour un article sur la France), pays-article ≠ pays des faits possibles. L'ensemble est un signal presse, jamais confirmé ni quantifié (aucun bilan).
- `190` (usage générique de la force) domine : 1205 « Battles » en 24 h ; ils sont très supérieurs en nombre aux autres sources et peuvent saturer le globe.
- 492 événements 24 h sont au niveau pays (centroïde) et 259 au niveau région : à ne pas dessiner comme des points précis.
- Un premier passage dure ~2 min (≈230 Mo téléchargés, GKG ~2,4 Mo/fichier) et bloque la boucle `ingest()` séquentielle ; le budget (100 s) borne ce temps, la suite est rattrapée 15 min plus tard. Pas de persistance du cache disque : un redémarrage re-télécharge 24 h.
- Les anciens enregistrements GDELT v1 déjà présents dans le magasin (~5 960, type `Media signal`) y restent (le flux est désactivé, pas purgé).
- `Connector.id` est partagé `gdelt` : le statut UI et `sourceDataset` restent `gdelt`.

## Demandes hors périmètre
1. Brancher `fetchSocialFeed` dans le registre `/api/feeds` (`sourceId: "gdelt-events"`, homepage `https://www.gdeltproject.org/`, licence : GDELT libre avec citation).
2. Côté globe/clusters : ne pas placer comme points précis les événements `geoPrecision` `country`/`region` ; envisager un filtre par défaut sur `Battles` GDELT (très volumineux).
3. Postgres : colonnes optionnelles `title` et `geo_precision` dans `repository.ts` ; purge des anciens `gdelt-<hash>` GKG v1 si souhaité.
4. `SourceProfile` `gdelt` : `unit: "media_mention"` et `dateBasis: "publication"` restent corrects (DATEADDED = vue par GDELT) ; libellé UI « date de première observation par GDELT » conseillé.
5. Aucune dépendance ajoutée.
