# ORBITAL — Audit des sources LIVE (sous-agent de recherche)

Date : 2026-10-18 · Méthode : lecture seule du dépôt (aucune écriture, aucun git, aucun redémarrage) + tests `curl` one-shot
Preuve brute : `/tmp/orbital-audit/r{a,b,c,d,e,f,g}.txt` (commandes exactes + statuts HTTP + extraits).
Périmètre lu : `src/server/connectors/*.ts`, `src/server/{agent,airspace,intel,countryIndicators,leaders,world}.ts`, `src/types/conflict.ts`, `src/app/api/*`.
`.env.local` **non lu**. Résultats ci-dessous = tests du jour ; statut `TESTED-OK` = HTTP 200 avec données réelles.

---

## 0. Résumé exécutif

1. **Le socle teste bien** : GDELT GKG v1 geojson, UCDP GED Candidate, GDACS, USGS, EONET, tsunami.gov, WHO DON (API OData), ECDC (feeds taxonomy), Launch Library 2 (v2.2.0), UN News/Press, Wikipedia Current Events, Le Monde/DW/Al Jazeera/ToI/Pravda/RSS régionaux, ECB (SDMX + RSS), Frankfurter, open.er-api, World Bank, OpenSky, Alpha Vantage (clé démo), Yahoo Finance. Environnement déjà branché : UCDP, GDELT GKG, FIRMS, OpenSky, Wikidata, World Bank, web_search.
2. **GDELT DOC 2.0 est fragile depuis notre IP** : `mode=artlist` a renvoyé **HTTP 429** à 4 reprises même après 25 s d'attente (limiteur par IP partagé avec l'ingestion serveur qui interroge GDELT toutes les 15 min). Le **GKG v1 geojson** a répondu 200 pendant ce temps. → Espacer à **≥ 10 s**, mettre un cache, prévoir repli GKG.
3. **GDELT GEO 2.0 (`/api/v2/geo/geo`) est mort** : HTTP 404 pour tous les modes/formats, y compris les exemples officiels GDELT (confirmé par une source externe). Ne pas l'intégrer.
4. **Trous actuels** : manifestations/émeutes/grèves absentes (GKG v1 filtré militaire), **ProMED sans flux** (site Next.js, `/feed/` = 404), **IAEA bloqué Cloudflare** (403 « Just a moment… »), ReliefWeb RSS bloqué côté serveur (à ne pas contourner), ACLED inaccessible (403 + OAuth 400 sans comptes institutionnels), Stooq HS (404), FMP démo invalide, IMF Datamapper 403 (WAF), OECD SDMX 403 (paramétrage).
5. **Comblement recommandé** (0 €, légal) : GDELT DOC 2.0 (protestations, pays FIPS) espacé + repli GDELT 2.0 **events export** 15 min (`*.export.CSV.zip`) ; RSS presse nationale/régionale ; Wikipedia Current Events ; UN/OCHA ; ECDC + WHO OData ; World Nuclear News (à défaut d'IAEA) ; FRED/Twelve Data/Finnhub clés gratuites ; Yahoo Finance (indices/énergie, **ToS non officielles à signaler**) + ECB/Frankfurter pour le FX.
6. **Aléa #1 à traiter** : le géocodage (GDELT géolocalise des **noms**, pas des entités) et l'absence de bilan sur les signaux presse. Voir §5.

---

## 1. Matrice des sources par thème

Légende fiabilité : **V** = vérifié (jeu curé/recherche) · **O** = officiel institutionnel · **S** = satellite/télédétection · **P** = signal presse · **M** = marché (données financières). Tous gratuits sauf mention « clé gratuite ».

### 1.1 Conflits armés (batailles, frappes, violences ciblées)

| Source (endpoint) | Clé | Refresh | Pays / Géo | Fiab. | Test (résultat exact) |
|---|---|---|---|---|---|
| UCDP GED Candidate — `https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_0_8.csv` | non | **mensuel** (lag 1–2 mois) | oui, lat/lon précis, code pays G-W | V | `curl -r 0-500` → **HTTP 206** `text/csv` ; fichiers listés : `v26_0_8`, `v26_01_26_06` |
| UCDP API GED — `https://ucdpapi.pcr.uu.se/api/gedevents/26.1` | oui (`x-ucdp-access-token`) | temps quasi réel | oui | V | `curl` sans jeton → **HTTP 401** « API token required » |
| GDELT GKG geojson (en place) — `https://api.gdeltproject.org/api/v1/gkg_geojson?query=…` | non | 15 min | oui (nom géocodé) | P | **HTTP 200**, FeatureCollection (`Chinameca, Veracruz, Mexico`, tone -3.10) |
| GDELT 2.0 events export — `https://data.gdeltproject.org/gdeltv2/lastupdate.txt` → `…20261018044500.export.CSV.zip` | non | 15 min | oui, FIPS pays + lat/lon 1 km | P (CAMEO) | lastupdate **200** (`export/mentions/gkg` datés `20261018044500`) ; zip **206** `application/zip` |
| GDELT DOC 2.0 — `…/api/v2/doc/doc?query=…&mode=artlist&format=json` | non | 15 min | oui (`sourcecountry:` FIPS) | P | **HTTP 429 ×4** (même à 25 s) → fragile depuis notre IP ; OK selon l'équipe plus tôt aujourd'hui |
| GDELT GEO 2.0 — `…/api/v2/geo/geo` | non | — | — | — | **HTTP 404** (endpoint **défunt**) |
| ACLED (OAuth password) — `https://acleddata.com/api/acled/read` | oui | quotidien | oui, admin1 | V | `curl` sans auth → **403** ; `POST /oauth/token` → **400** |
| ReliefWeb — `https://reliefweb.int/updates/rss.xml` | non | temps réel | oui | O | `curl` → **200**, mais **bloqué (406) pour les clients serveur** → **ne pas contourner** |

### 1.2 Protestations / émeutes / grèves (le trou actuel)

| Source | Clé | Refresh | Pays / Géo | Fiab. | Test |
|---|---|---|---|---|---|
| GDELT DOC 2.0 — `query=(manifestation OR protest OR casseurs) sourcecountry:FR&mode=artlist` | non | 15 min | oui (FIPS) | P | **429** ce jour ; requête validée par l'équipe (titres FR du 17/10/2026) → à espacer ≥10 s + cache |
| GDELT 2.0 events export, **CAMEO racine 14** (`EventRootCode=14`) | non | 15 min | oui | P | zip accessible **206** (CODAGE à faire côté connecteur) |
| RSS presse nationale — `https://www.lemonde.fr/rss/une.xml`, `https://rss.dw.com/rdf/rss-en-all`, `https://www.aljazeera.com/xml/rss/all.xml`, `https://www.nicematin.com/rss` | non | 5–30 min | par média/zone | P | **200** pour les 4 ; `corsematin.com/rss` **404** |
| Wikipedia Current Events (MediaWiki) — `https://en.wikipedia.org/w/api.php?action=parse&page=Portal:Current_events&prop=wikitext&format=json` | non | quotidien | monde, listé par pays | P (curé) | **200**, wikitext complet |
| GDELT DOC `mode=timelinevol` (courbe de tension par pays) | non | 15 min | oui | P | **429** ce jour |

### 1.3 Terrorisme & crime organisé (dont mafias locales : Corse, Marseille…)

| Source | Clé | Refresh | Pays / Géo | Fiab. | Test |
|---|---|---|---|---|---|
| GDELT DOC 2.0 — requêtes locales (`Corse AND (mafia OR règlement)`, `Marseille AND narcotrafic`) + `sourcecountry` | non | 15 min | oui, ville | P | **429** ce jour (même limiteur) |
| GDELT GKG v1 geojson (thèmes `TERROR`, `TAX_FNCACT_TERRORIST`) | non | 15 min | oui | P | **200** |
| Presse locale/régionale RSS (Nice-Matin, Corse-Matin, Ouest-France…) | non | 5–30 min | oui | P | Nice-Matin **200** ; Corse-Matin **404** (pas de flux) |
| UCDP « one-sided violence » (`type_of_violence=3`) | non | mensuel | oui | V | inclus dans le CSV Candidate (**206**) |
| OpenSanctions (entités sanctionnées/criminelles) | clé gratuite | quotidien | monde | O | API **401** sans clé ; index public `…/datasets/latest/index.json` **200** |

### 1.4 Décisions politiques / diplomatie

| Source | Clé | Refresh | Pays / Géo | Fiab. | Test |
|---|---|---|---|---|---|
| UN Meetings Coverage & Press — `https://press.un.org/en/rss.xml` | non | quotidien | monde (Conseil de sécurité) | O | **200** |
| UN News — `https://news.un.org/feed/subscribe/en/news/all/rss.xml` | non | plusieurs/jour | monde | O | **200** |
| GOV.UK — `https://www.gov.uk/search/news-and-communications.atom` | non | temps réel | UK | O | **200** |
| Élysée / gouvernement FR | non | — | FR | O | `elysee.fr/rss.xml` **404**, `info.gouv.fr/rss` **403 Cloudflare**, `interieur.gouv.fr/rss.xml` **403** → passer par presse + GDELT |
| Wikipedia Current Events | non | quotidien | monde | P | **200** |
| Le Monde / DW / Al Jazeera RSS | non | 5–30 min | FR/DE/Qatar | P | **200** |
| Guardian Open Platform — `https://content.guardianapis.com/search?...` | clé gratuite | temps réel | monde/UK | P | `api-key=test` → **401** (clé requise) |

### 1.5 Mouvements militaires & espace aérien

| Source | Clé | Refresh | Pays / Géo | Fiab. | Test |
|---|---|---|---|---|---|
| OpenSky `states/all?lamin=…&lomin=…` (AURA) | non (anonyme, ~400 crédits/j) | 10–60 s | bbox pays | S | **200**, `states[]` live (France/Estonie…) |
| NASA FIRMS — `…/api/area/csv/{KEY}/VIIRS_SNPP_NRT/world/2` | clé gratuite (en place) | 3 h (near real-time) | oui, lat/lon | S | clé bidon → **400 « Invalid MAP_KEY »** ⇒ service joignable, clé requise |
| AISStream (maritime, chatter naval) | clé gratuite | WebSocket temps réel | mondial | S | site **200** ; pas d'endpoint HTTP (WebSocket + clé obligatoires) |
| GDELT GKG thèmes `MILITARY`, `ARMEDCONFLICT` | non | 15 min | oui | P | **200** |

### 1.6 Économie, indices boursiers & devise

| Source | Clé | Refresh | Pays / Géo | Fiab. | Test |
|---|---|---|---|---|---|
| World Bank API — `…/country/{ISO3}/indicator/{IND}?format=json` (en place) | non | annuel | par pays (ISO3) | O | **200** (`USA NY.GDP.MKTP.CD` = 2025) |
| FRED — `https://api.stlouisfed.org/fred/series/observations?series_id=SP500` | **clé gratuite** | quotidien | US surtout | O | **400 « api_key is not set »** ⇒ clé requise |
| ECB Data Portal (SDMX) — `https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?format=json` | non | quotidien | zone euro | O | **200** (JSON SDMX) |
| ECB RSS — `https://www.ecb.europa.eu/rss/press.html` | non | plusieurs/jour | zone euro | O | **200** |
| Frankfurter (FX, données BCE) — `https://api.frankfurter.dev/v1/latest?base=USD` | non | quotidien (J-1) | 30+ devises | O | **200** (`USD→EUR 0.88865`, `JPY 158.02`) |
| open.er-api — `https://open.er-api.com/v6/latest/USD` (en place) | non | quotidien | mondial | M | **200** |
| Alpha Vantage — `…/query?function=GLOBAL_QUOTE&symbol=IBM&apikey=demo` | clé gratuite | temps réel | indices/actions | M | **200** (clé `demo`) ; `function=WTI` **200** |
| Twelve Data — `https://api.twelvedata.com/quote?symbol=…` | clé gratuite (800/j) | temps réel | indices mondiaux | M | **401** sans clé |
| Finnhub — `https://finnhub.io/api/v1/quote?symbol=…` | clé gratuite (60/min) | temps réel | monde | M | **401** sans clé |
| Yahoo Finance (non officiel) — `https://query1.finance.yahoo.com/v8/finance/chart/{SYM}` | non | temps réel (~15 min) | indices par pays | M | **200** : `^GSPC`, `^GDAXI`, `^N225`, `^FCHI`, `CL=F`, `NG=F`, `ZW=F` — **ToS non officielles** |
| Stooq CSV | non | temps réel | monde | M | `https://stooq.com/q/l/?s=aapl.us&…&e=csv` → **404** (confirmé HS) |
| FMP démo | clé | temps réel | monde | M | `apikey=demo` → **401** (clé invalide) |
| World Bank (même socle) — CPI/inflation `FP.CPI.TOTL.ZG` | non | annuel | par pays | O | **200** (`country/all`, 266 lignes) |
| Eurostat — `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_manr?...` | non | mensuel | UE | O | **200** |
| IMF DataMapper | non | — | monde | O | **403** (WAF AWS, bloqué) |
| OECD SDMX | non | — | OCDE | O | **403** (paramétrage clé-values incomplet) |
| EIA (pétrole/gaz) | clé gratuite | quotidien | US/monde | O | **403 « API_KEY_MISSING »** ⇒ clé requise |
| CoinGecko (crypto) | non | temps réel | monde | M | **200** |

### 1.7 Catastrophes & climat

| Source | Clé | Refresh | Pays / Géo | Fiab. | Test |
|---|---|---|---|---|---|
| GDACS `SEARCH` — `…/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF&fromDate=…&toDate=…` | non | temps réel | oui, lat/lon + bbox | O | **200** (cyclone CHAMPI-26, Guam) |
| GDACS `MAP?eventtype=EQ` (un seul type) | non | temps réel | oui | O | **200** (séisme US) ; plusieurs types → **400** |
| GDACS géométries — `…/polygons/getgeometry?eventid=…&eventtype=…&episodeid=…` | non | temps réel | oui (polygones) | O | **200** |
| GDACS RSS — `https://www.gdacs.org/xml/rss.xml` | non | temps réel | oui | O | **200** mais **uniquement** avec `Accept: */*` ; `Accept: application/rss+xml` → **406** |
| USGS — `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson` | non | 1 min | oui, lat/lon | O | **200** (38 séismes M2.5+ / 24 h) |
| USGS — `…/summary/significant_month.geojson` | non | 1 min | oui | O | **200** (15 événements) |
| NASA EONET v3 — `https://eonet.gsfc.nasa.gov/api/v3/events?status=open` | non | ~3 h | oui, lat/lon | S/O | **200** |
| NOAA Tsunami — `https://www.tsunami.gov/events/xml/PAAQAtom.xml` | non | temps réel | bassins océaniques | O | **200** (Atom) |
| OCHA — `https://www.unocha.org/rss.xml` | non | quotidien | mondial/humanitaire | O | **200** |
| Smithsonian GVP volcans | non | hebdo | oui | O | **403** (site temporairement indisponible) |
| FEWS NET / ACAPS / IPC | non | — | — | O | `fews.net/rss.xml` **404**, `acaps.org/rss.xml` **404**, `ipcinfo.org` **403 Cloudflare** |

### 1.8 Santé & pandémies

| Source | Clé | Refresh | Pays / Géo | Fiab. | Test |
|---|---|---|---|---|---|
| WHO Disease Outbreak News (API OData) — `https://www.who.int/api/news/diseaseoutbreaknews?$top=…&$orderby=…` | non | plusieurs/jour | mondial, pays listés | O | **200** JSON (champs `Title, Summary, PublicationDateAndTime…`) |
| WHO DON (ancien RSS) — `…/feeds/entity/csr/don/en/rss.xml` | non | — | — | O | **404** (mort → utiliser l'API OData) |
| ECDC feeds — `https://www.ecdc.europa.eu/en/taxonomy/term/{id}/feed` | non | hebdo/jour | UE | O | **200** pour 1244/2794/197 (Mpox, West Nile…) ; `ecdc.europa.eu/en/rss.xml` **404** |
| WHO GHO API — `https://ghoapi.azureedge.net/api/…` | non | variable | par pays (ISO3) | O | **200** |
| ProMED — `https://www.promedmail.org/feed/` | non | — | monde | O | **404** (site Next.js, plus de flux public) |
| HealthMap | non | — | monde | O | page **200**, **pas d'API publique** sans inscription |

### 1.9 Espace

| Source | Clé | Refresh | Pays / Géo | Fiab. | Test |
|---|---|---|---|---|---|
| Launch Library 2 (The Space Devs) — `https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=…` | non (rate-limited) | plusieurs/jour | sites de lancement | O | **200** (`count: 476`) ; **v2.3.0 → 404** (utiliser **v2.2.0**) |
| The Space Devs — `…/2.2.0/event/upcoming/` | non | plusieurs/jour | monde | O | **200** (`count: 30`, EVA…) |
| Wikipedia Current Events (chapitre science/espace) | non | quotidien | monde | P | **200** |

### 1.10 Nucléaire

| Source | Clé | Refresh | Pays / Géo | Fiab. | Test |
|---|---|---|---|---|---|
| World Nuclear News — `https://www.world-nuclear-news.org/rss` | non | quotidien | monde | P (spécialisé) | **200** RSS (recommandé, remplace IAEA) |
| IAEA (site/RSS) | non | — | monde | O | `iaea.org/news` **403 Cloudflare**, `/feeds/topstories` **404**, `/news/rss.xml` **403** → inexploitable côté serveur |
| NTI | non | — | monde | O | **403 Cloudflare** |
| Wikipedia Current Events + GPT `web_search` | — | — | monde | P | voir §3 |

### 1.11 Transversal

- **Sanctions** : OpenSanctions (clé gratuite, API **401** sans clé ; index public **200**).
- **Maritime** : AISStream (clé gratuite, WebSocket) ; OpenSky pour l'aérien.
- **Humanitaire** : OCHA **200** ; ReliefWeb **à ne pas utiliser côté serveur** (406) ; HDX CKAN API **200** (`package_search?q=acled` → 420 résultats) mais dépend de ce que les producteurs rediffusent.
- **Leaders** : Wikidata (déjà en place) ; 3ᵉ source = presse/officiel pour confirmation.

---

## 2. Recette « brief live pays » (au clic)

**Correspondance des codes — piège majeur** : GDELT utilise les **codes FIPS 10-4**, pas l'ISO-3166.
Ex. : Royaume-Uni = `UK` (pas `GB`), Allemagne = `GM`, Japon = `JA`, Chine = `CH`, Corée du Sud = `KS`, Russie = `RS`, Ukraine = `UP`, Suisse = `SZ`, Espagne = `SP`, Inde = `IN`, Iran = `IR`. Oui, `FR`, `IT`, `UK`(FIPS) se recoupent, mais **ne jamais réutiliser l'ISO2 comme FIPS**. UCDP/GED et OpenSky bbox utilisent d'autres référentiels (noms G-W / pays OSM) ; World Bank et pays ORBITAL = **ISO3**. → Prévoir une **table de conversion {ISO3 ↔ ISO2 ↔ FIPS ↔ nom GDELT}** côté serveur (source : liste FIPS de GDELT, `country` du CSV GDELT = libellé).

**Séquence d'appels (parallélisable par groupes) :**
1. Base ORBITAL (clusters/latest) + UCDP (contexte vérifié 1 an) — instantané (local/CSV).
2. GDELT : `gkg_geojson` filtré pays **et** `doc/doc?query=… sourcecountry:{FIPS}&mode=artlist`. Espacés ≥ 10 s, cache **15 min**.
3. GDACS `SEARCH` + USGS (filtre bbox pays) + EONET — cache **15–30 min**.
4. WHO OData (filtre pays dans les titres) + ECDC taxonomy — cache **6 h**.
5. Économie : World Bank (cache 24 h), ECB/Frankfurter FX (cache 6 h), indices via Yahoo/Alpha Vantage (cache 5–15 min), FRED (cache 24 h).
6. OpenSky bbox (cache 10 min, **quota anonyme ~400 crédits/j** → 1 appel/pays max).
7. Leaders (Wikidata) + un RSS national + Wikipedia Current Events.

**TTL récapitulatif** : FX 6 h · indices 5–15 min · GDELT 15 min · GDACS/USGS/EONET 15–30 min · UCDP 12 h · WHO/ECDC 6 h · World Bank/FRED 24 h · FIRMS 3 h · OpenSky 10 min.
**Coût** : **0 €** (clés gratuites : FRED, Twelve Data, Finnhub, OpenSanctions, FIRMS déjà là). Coût réel = **quotas** (OpenSky 400/j, GDELT 1 req/≥5 s, Space Devs ~15 req/h) → un clic pays ≈ **12–18 appels**, ~2–4 s avec cache chaud.

---

## 3. Pipeline « brief quotidien parlé »

**Collecte à heure fixe (ex. 06:00 locales)**, avant le pic :
1. Ingestion sources chaudes (GDELT, GDACS, USGS, EONET, WHO, ECB/FX) → persistance ORBITAL.
2. Constitution d'un **pool d'histoires** : titres + URL + date + pays + type + source.

**Dédupe & classement** :
- Dédupe d'abord par **URL canonique**, puis par **empreinte du titre** (minuscules, sans ponctuation/entités) et par proximité (jour + pays + type).
- **Score = 3·sévérité + 2·(bilan normalisé) + 2·nouveauté(24 h) + 1·diversité de sources − 1·redondance**. Sévérité = échelle du §4. Un fait n'entre au brief que s'il a **≥ 2 sources indépendantes** ou **1 source N1/N2**.

**Structure en chapitres** (ordre demandé) : 1) Catastrophes & climat · 2) Politique · 3) Militaire · 4) Espace · 5) Nucléaire · 6) Société (protestations/émeutes/grèves/crime) · 7) Économie · 8) Santé. Chapitre vide = titre omis (pas de « rien à signaler » long).

**Résumé LLM avec citations** : réutiliser AURA (OpenAI Responses + `web_search`) ; prompt = « ne cite que le pool fourni + web_search, chaque phrase = [source n°] », sortie JSON `{chapter, text, sources[]}`, puis **rendu texte** lu par TTS (voix FR, phrases courtes, pas d'URL à l'oral). Les URL restent en sous-titres/métadonnées.

**Garde-fous anti-désinformation (obligatoires)** :
- Toute affirmation mono-source reste étiquetée **« non vérifié / à confirmer »**.
- Interdire au LLM d'ajouter des faits hors pool/recherche ; journaliser chaque citation.
- **Pas de bilan chiffré** sur un signal presse (GDELT/PRESSAGE) ; bilans seulement N1/N2.
- Vérifier les contradictions (2 sources divergentes → afficher les deux, pas de moyenne).
- Relire automatiquement : détection d'entités inventées (noms de dirigeants ≠ Wikidata, lieux ≠ référentiel) ; si échec, retirer la phrase.

---

## 4. Taxonomie & niveaux de fiabilité

Étendre `EVENT_TYPES` (ACLED-like, déjà en base) et **mapper chaque source** :

| Catégorie | Types (existants / à ajouter) | Sources typiques |
|---|---|---|
| Conflit armé | `Battles`, `Explosions/Remote violence`, `Violence against civilians` | UCDP (N1), ACLED (N1 si retrouvé), GDELT (N4) |
| Société | `Protests`, `Riots`, **`Strikes`**(ajout), `Repression`(ajout) | GDELT DOC/events CAMEO 14, RSS, Wikipedia |
| Terrorisme & crime | **`Terrorism`**, **`Organized crime`**(ajout) | GDELT GKG `TERROR`, OpenSanctions, presse locale |
| Politique | `Strategic developments` + **`Elections`**, **`Sanctions`**, **`Diplomacy`**(ajout) | UN, GOV.UK, Wikipedia, RSS |
| Militaire/air | **`Military movement`**, **`Airspace`**(ajout) | OpenSky, GDELT GKG militaire |
| Économie | **`Markets`**, **`Macro`**, **`Commodities`**(ajout) | Yahoo/AV, ECB, FRED, World Bank |
| Catastrophes | **`Earthquake`**, **`Storm`**, **`Flood`**, **`Wildfire`**, **`Volcano`**, **`Tsunami`**, **`Drought`**(ajout) | GDACS, USGS, EONET, NOAA |
| Santé | **`Epidemic`**(ajout) | WHO DON, ECDC |
| Espace/Nucléaire | **`Launch`**, **`Nuclear`**(ajout) | Space Devs, WNN |

**Niveau de fiabilité affiché** (aligné sur `CONFIDENCE_LEVELS` existants) :
- **N1 VÉRIFIÉ** (= `CONFIRMED`) : UCDP, ACLED → bilan chiffré autorisé.
- **N2 OFFICIEL** (= `REPORTED` fort) : GDACS, USGS, WHO, ECDC, ECB, World Bank, UN, OpenSky (mesure).
- **N3 SATELLITE** : FIRMS, EONET → **jamais** « frappe confirmée » (feu/torchère possibles) ; aujourd'hui mappé `REPORTED`, à distinguer visuellement.
- **N4 SIGNAL PRESSE** (= `MEDIA_SIGNAL`) : GDELT (tous modes), RSS, Wikipedia, ProMED/WNN → pas de bilan, mention « non confirmé ».
- **N5 MARCHÉ/DÉRIVÉ** : Yahoo, Alpha Vantage, FRX → étiqueter « donnée de marché, source non officielle » si Yahoo.
- **DÉMO** : inchangé, jamais présenté comme réel.

---

## 5. Risques

1. **Géocodage** : GDELT géolocalise des **noms** → « White House », « Pentagon », « Downing Street », « Place de la Bastille » peuvent devenir des « foyers » ; homonymies (« Paris » au Texas, « Berlin » en Ohio, « Georgia » pays vs État). → filtre bbox pays + `countryAt()` (déjà utilisé pour FIRMS/OpenSky) + **blacklist toponymes institutionnels**, et ne jamais promouvoir un point presse en événement confirmé.
2. **Biais** : GDELT sur-représente la presse **anglophone/occidentale** ; UCDP a un lag 1–2 mois ; RSS nationaux = ligne éditoriale d'État (Pravda UA, ToI…). → diversité de sources, affichage de la source, jamais d'agrégat « objectif » implicite.
3. **Désinformation** : bilans gonflés, images recyclées, faux comptes. → règle des 2 sources, distinction confirmé/rapporté/revendiqué (déjà dans le prompt AURA), revue humaine possible.
4. **Limites de débit** : GDELT **1 req/5 s** (429 observé même à 25 s : le serveur et les tests partagent l'IP) ; OpenSky ~400 crédits/j ; Space Devs ~15/h ; Yahoo non contractuel. → file d'attente unique + cache + repli (GKG ↔ events export ; Yahoo ↔ Alpha Vantage).
5. **Juridique/ToS** : Yahoo Finance = **endpoint non officiel**, usage à signaler et à isoler ; Reuters/AP/NewsAPI/Guardian = clés/conditions ; **ReliefWeb** = blocage bot → **ne pas contourner** ; OpenSanctions = licence CC-BY (attribution) ; ECB/World Bank/UN = réutilisation ouverte avec attribution. Stocker **attribution + date de récupération** par événement.
6. **Défauts d'intégration constatés** : `EVENT_TYPES` actuel n'a **pas** de protestations exploitées (GKG v1 filtré militaire) ni terrorisme/crime/épidémie/indices → élargir la taxonomie **et** le filtre GDELT ; le connecteur GDELT throttle à **5,2 s** (trop juste) ; `FIRMS` mappé `REPORTED` devrait être `SATELLITE` distinct.

---

### Annexe — commandes de preuve (extraits)
- GDELT : `curl -r 0-500 https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_0_8.csv` → **206** ; `curl …/api/v2/geo/geo?query=protest` → **404** ; `curl …/api/v2/doc/doc?query=trump&mode=artlist&format=json` → **429**.
- WHO : `curl "https://www.who.int/api/news/diseaseoutbreaknews?\$top=2"` → **200** ; `…/feeds/entity/csr/don/en/rss.xml` → **404**.
- Espace : `curl https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=2` → **200** ; `…/2.3.0/…` → **404**.
- Économie : `curl https://api.frankfurter.dev/v1/latest?base=USD` → **200** ; `curl "…/fred/series/observations?series_id=SP500"` → **400 api_key** ; `curl "…/finance.yahoo.com/v8/finance/chart/%5EGDAXI?range=1d"` → **200**.
- Nucléaire : `curl https://www.world-nuclear-news.org/rss` → **200** ; `curl https://www.iaea.org/news` → **403 Cloudflare**.
- Fichiers bruts complets : `/tmp/orbital-audit/r{a,b,c,d,e,f,g}.txt`.
