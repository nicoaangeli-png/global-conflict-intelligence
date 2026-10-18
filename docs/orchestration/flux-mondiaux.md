# FLUX MONDIAUX — rapport (18/10/2026)

Livrable : données réelles et en direct, hors conflits armés, via `GET /api/feeds?category=&country=&limit=`
(contrat `src/types/feeds.ts`, **non modifié**, aucun champ ajouté).

## Fichiers
- `src/server/feeds/` : `index.ts` (registre `getFeeds`), `util.ts` (fetch 10 s + User-Agent ORBITAL, cache `globalThis`,
  `runSource` sans exception, parseurs RSS/entités), `countries.ts` (pays par texte, mot entier), `xlsx.ts` (lecteur zip/xlsx sans
  dépendance), `disaster.ts`, `health.ts`, `space.ts`, `nuclear.ts`, `un.ts`, `uap.ts`, `economy.ts`.
- `src/app/api/feeds/route.ts` (nodejs, `force-dynamic`, `Cache-Control: public, max-age=30, stale-while-revalidate=60`).
- Tests : `tests/feeds-{text,disaster,sources,uap,registry}.test.ts` (+ `feeds-helpers.ts`), fixtures `tests/fixtures/feeds/**`
  (extraits réels réduits). `tests/feeds-live.test.ts` appelle le réseau mais est **désactivé par défaut**
  (`FEEDS_LIVE=1 pnpm vitest run tests/feeds-live.test.ts`).

## Preuves (vérifié)
- `pnpm typecheck` : propre. `pnpm test` : 8 fichiers, 91 tests verts, 1 ignoré (le live), aucun appel réseau.
- Appel réel de toutes les sources (test live, 18/10/2026 ~12 h) puis via la route sur le serveur dev :3011
  (`/api/feeds?category=uap`, `?country=FRA`, `?category=space` : HTTP 200, JSON, en-tête Cache-Control présent).

| Source (sourceId) | Statut | Éléments réels | Détail |
|---|---|---|---|
| GDACS (`gdacs`) | OK | 100 | API JSON `geteventlist` (30 j), un élément par événement, alerte Green/Orange/Red -> minor/moderate/severe ; ISO3 fournis |
| USGS (`usgs`) | OK | 10 | `4.5_day` + `significant_week` dédoublonnés, magnitude, pays par coordonnées |
| NASA EONET (`eonet`) | OK | 40 | événements ouverts 20 j, dernière position ; sévérité laissée à null |
| OMS DON (`who-don`) | OK | 30 | API OData `diseaseoutbreaknews`, tri `PublicationDateAndTime desc`, lien `.../item/<DonId>` vérifié (HTTP 200) |
| Launch Library 2 (`ll2`) | OK | 30 | 15 à venir + 15 passés, pays = pays du site (`pad.location.country_code`) |
| World Nuclear News (`wnn`) | OK | 40 | RSS réel : `https://www.world-nuclear-news.org/rss` |
| UN News fr (`un-news`) | OK | 30 | RSS français |
| press.un.org (`un-press`) | OK | 10 | RSS `https://press.un.org/en/rss.xml` : comptes rendus du Conseil de sécurité, commissions, communiqués (anglais) |
| GEIPAN (`geipan`) | OK | 54 | export officiel des cas publiés (voir ci-dessous) |
| BCE / Frankfurter (`ecb-fx`) | OK | 29 | `api.frankfurter.dev/v1`, variation entre les 2 derniers fixings |
| Yahoo Finance (`yahoo-indices`) | OK | 37 | 37 indices nationaux, tous vérifiés un par un |
| AARO (`aaro`) | **KO (volontaire)** | 0 | `aaro.mil` répond HTTP 403 (protection anti-robot) : état « error » avec message honnête, aucun contournement |
| NASA UAP (`nasa-uap`) | `not_configured` | 0 | `science.nasa.gov/uap/` est une page statique (rapport 2023), sans flux daté |

Total mesuré : environ 410 éléments en une requête.

## Choix et écarts à connaître
- **GEIPAN : pas de jeu sur data.gouv.fr.** L'API `datasets/?q=geipan` renvoie 0 résultat (aucun jeu GEIPAN). La source ouverte
  réelle est `https://www.cnes-geipan.fr/fr/cnes/export/cas` (classeur .xlsx, ~1,8 Mo, 3 381 cas). L'ancien CSV `cas_pub.csv` est en 404
  et l'export 2021 est périmé : non utilisés. Lecture sans dépendance (`xlsx.ts`). Règle de sélection : 50 cas les plus récents
  (date d'observation complète) + tous les cas D depuis 5 ans (les enquêtes D sont publiées avec un long délai : le plus récent D de
  l'export date de mars 2022). Chaque cas porte la classification A/B/C/D et le caveat « Classification GEIPAN : X (…) — un cas D
  signifie non expliqué, pas d'origine extraterrestre établie. » Nature `published_report` (témoignage publié), pas `official_publication`.
  Les cas à date incomplète (« --/--/1937 ») ne reçoivent pas de `occurredAt`. Pays : toujours `FRA` (cas du territoire français).
  URL de cas `https://www.cnes-geipan.fr/fr/cas/<id>` (motif relevé sur les liens du site). Le site liste des cas plus récents que
  l'export (avril 2026 présent, export à jour d'août 2026) : léger retard possible.
- **Frankfurter** : `api.frankfurter.app` répond 301 vers `api.frankfurter.dev/v1` ; on utilise directement la nouvelle URL.
- **Yahoo** : `chartPreviousClose` est le cours *avant* la fenêtre de 5 j, pas la veille ; la variation est donc calculée entre les deux
  dernières clôtures de la série. Indices sans réponse retirés : Chili (^IPSA), Russie (^IMOEX.ME), Norvège (^OSEAX), Grèce (^ATG.AT),
  Vietnam HNX, etc. ; ceux retenus sont dans `STOCK_INDICES` (economy.ts). Concurrence 4, requêtes décalées, cache 15 min. Un indice
  qui n'a qu'une séance en 5 j (ex. Arabie saoudite) est affiché sans variation (metric null).
- **Launch Library 2** : mode « normal » (nécessaire pour le pays du site). Cache 65 min, nouvelle tentative après erreur seulement
  au bout de 20 min. **Quota** : 2 requêtes par rafraîchissement. Les tests de validation de cette session ont consommé une dizaine de
  requêtes sur l'heure ; en régime normal c'est 2/h par processus serveur (le cache est par processus : un redémarrage du serveur refait 2 appels).
- **Tri** : par `occurredAt || publishedAt` décroissant, comme demandé ; les lancements à venir (dates futures) et les cotations
  remontent donc en tête du flux non filtré. L'interface devrait filtrer par catégorie.
- **Attribution pays (texte)** : table EN/FR d'environ 190 pays, mot entier, noms longs consommés d'abord (Niger/Nigeria, Iran/Tirana,
  Papua New Guinea, South Sudan, New Mexico testés), sigles en majuscules seulement, ambigus exclus (Georgia, Congo seul). Pour la presse :
  titre d'abord ; le résumé n'est utilisé que s'il nomme au plus 2 pays. Régions et mers : `[]` (ex. un ouragan en mer).
- **Natures** : GDACS/OMS = `official_alert` ; USGS = `sensor_measurement` ; EONET = `sensor_measurement` (cyclones : `official_alert`) ;
  LL2 = `scheduled_event` ; WNN = `press_article` ; ONU = `official_publication` ; devises/indices = `market_quote`.
  Aucune mention presse n'a de bilan ; `severity` reste null quand la source n'en donne pas (EONET, OMS, presse).
- **Cache et erreurs** : `globalThis.__orbitalFeedsCache` ; TTL : USGS 2 min, GDACS 5 min, UN/EONET/Yahoo 10-15 min, OMS/BCE 30 min,
  WNN 20 min, GEIPAN/AARO 6 h, LL2 65 min. Un échec garde les dernières données valides (état `stale`) ou donne `error` avec un message
  lisible ; aucune exception n'atteint la route.
- **Point d'extension « social »** : `EXTRA_SOURCES` dans `index.ts` (commentaire de tête) : ajouter `socialSources: FeedSourceDef[]`.
  `?category=social` renvoie pour l'instant 0 élément et 0 source.

## Limites (non vérifié ou connu)
- Les URLs de pages HTML de cas GEIPAN et de lancements LL2 (lien vers l'API JSON de LL2, pas une page grand public) n'ont pas été
  ouvertes une à une ; seul le motif GEIPAN a été relevé sur le site, les liens OMS ont été testés.
- AARO : seul le 403 de la page d'accueil a été constaté (une fois) ; aucun flux alternatif connu. À reconsulter si l'AARO publie un RSS.
- La licence indiquée est celle annoncée par les sites (à valider juridiquement avant publication commerciale).
- Contenu de l'export GEIPAN et des RSS potentiellement modifié par les sources sans préavis ; les parseurs échouent alors proprement
  (message « format inattendu ») plutôt que de produire des données fausses.
- Pas de test de charge ; le test live n'est pas exécuté en CI.

## Changements demandés hors périmètre
- Aucun. L'interface peut appeler `/api/feeds` directement. `src/server/world.ts` importe `server-only` : le registre le charge en
  import dynamique (échec toléré, pays alors seulement issus des sources) pour rester testable sous Vitest.
