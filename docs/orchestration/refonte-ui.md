# Refonte de l'interface — rapport (18/10/2026)

Mission : équipe « REFONTE DE L'INTERFACE ». Globe 3D conservé au centre (rendu de la Terre, étoiles, orbites et caméra de base **inchangés** : `HolographicEarth.ts`, `Starfield.ts`, `OrbitLayer.ts` non touchés). Rien n'a été commité.

## 1. Ce qui a été supprimé

| Élément | Raison |
|---|---|
| `DataProvenanceBanner` (bandeau « SOURCES DISPONIBLES — NON EXHAUSTIVES… SYNC ») et la légende « DOCUMENTÉS · PRESSE · 0 DÉMO · … / INCIDENTS DOCUMENTÉS ≠ DONNÉES FICTIVES / GDELT : SIGNAUX PRESSE » | Chevauchaient l'en-tête et le panneau gauche ; mentions démo/fictif obsolètes. La provenance passe par l'indicateur **Sources** de l'en-tête. |
| `v0.2 TACTICAL`, sous-titre « Conflict Intelligence », compteur « événements indexés » | Décoratif / redondant. |
| Onglets VUE GLOBALE · ÉVÉNEMENTS EN DIRECT · CONFLITS ARMÉS · CHRONOLOGIE · GÉOPOLITIQUE · SOURCES & AUDIT + raccourcis 1–6 | Remplacés par les thèmes du FIL MONDIAL. |
| `ui/ViewPanel.tsx` (vues fantômes), `ui/Timeline.tsx` (frise basse), `ui/FiltersPanel.tsx` (dont 8 interrupteurs de « couches orbitales » **sans aucun effet** : `layers` n'était lu nulle part), `ui/GlobalSituationPanel.tsx` (« Foyers d'affrontements », « Pertes humaines N/A »), `ui/LiveConflictPanel.tsx`, `ui/CountryProfile.tsx`, `ui/CountryIndicators.tsx`, `CountryCard` (fiche centrale concurrente), `SystemReadout` (fps/foyers) | Composants morts, doublons ou fiches pays concurrentes. La fenêtre temporelle est désormais dans l'onglet Conflits ; la recherche de pays dans la barre des thèmes. |
| `ui/TacticalReconModal.tsx` | Affichait un onglet « intel » nourri par `src/data/geopolitics.ts` (régime, indice de démocratie… statiques, non sourcés, non datés). Remplacé par deux liens externes simples (carte OSM, vue satellite) dans le détail d'une zone. |
| État `layers` / `reconTarget` du store | Morts. |
| Télémétrie inventée du réacteur AURA (`NEURAL 94.3 %`, `LINK SECURE`) | Valeurs factices. Restent : MODE (état réel), VOX (niveau vocal mesuré), SRC, UTC (11 px). Le réacteur fait 330 px de large pour tenir dans la colonne la plus étroite (1280 px). |
| Toute mention « démo / démonstration / fictif / DEMO » de l'interface, « N/A », « Inconnu » | Vérifié par `tests/ui-no-demo.test.ts`. |

## 2. Ce qui a été ajouté

- **En-tête sur une ligne** (`ui/Header.tsx`) : ORBITAL + accroche + horloge UTC à la seconde · état réel du direct (connexion SSE `/api/stream` : Direct / Connexion… / Direct interrompu, info-bulle explicative) · **Sources n/N** (popover) · **🎙️ Bilan du jour** désactivé avec info-bulle « Bientôt… » (aucun bilan inventé ; prop `onBriefing` = point de branchement pour `GET /api/briefing`, le bouton s'active dès qu'elle est fournie) · ⚙ Paramètres · FR/EN. `document.documentElement.lang` suit la langue, `translate="no"`.
- **Indicateur Sources** (`feeds/SourcesPopover.tsx`) : pour chaque source, état réel (Opérationnelle / Données anciennes / Non branchée / Indisponible + message serveur), **date de la donnée la plus récente** (date propre de l'élément, jamais la collecte ; jamais un lancement futur), date de collecte, licence, lien. Conflits : FIRMS / GDELT / UCDP depuis `stats.sources`, ACLED « non branché ».
- **Barre des thèmes** (`feeds/ThemeBar.tsx`) : Tout · Conflits · Social · Catastrophes · Santé · ONU · Espace · Nucléaire · Économie · OVNI, avec compteur (éléments datés des 24 dernières heures ; zones signalées pour Conflits) et **recherche de pays** (référentiel Natural Earth, noms localisés par `Intl.DisplayNames`, drapeau emoji). Choisir un thème : (a) filtre le fil, (b) n'allume sur le globe que ce calque (foyers de conflit visibles seulement sur Tout/Conflits ; points de flux seulement de la catégorie).
- **FIL MONDIAL** (`feeds/WorldFeedPanel.tsx`, `feeds/FeedItem.tsx`) : liste chronologique des `LiveItem` — titre, source, pays, heure relative (date absolue UTC au survol), badge de nature (« Alerte officielle », « Mesure », « Publication officielle », « Presse — non confirmé », « Signalement publié — non vérifié », « Planifié », « Cotation »), pastille **DIRECT** si < 2 h, variation colorée pour les cotations, caveat de la source visible, lien « Source ↗ ». Période 24 h / 7 j / 30 j / Tout, défaut adapté au rythme du thème (24 h ; 7 j pour ONU/Santé/Nucléaire/Espace ; Tout pour OVNI). Polling `/api/feeds` toutes les 2 min (une requête **par catégorie**, pour qu'aucune catégorie n'en évince une autre) + bouton ↻ qui relance réellement les requêtes (`cache: "no-store"`). États : chargement, « Service des flux indisponible (catégorie) : HTTP 404 », « Source indisponible : AARO — … HTTP 403 », vide honnête « Aucun élément sur 24 h dans les sources couvertes » + liste des sources couvertes + bouton « Élargir à 7 j ». « Tout » exclut les cotations/devises et les éléments datés dans le futur ; Espace a une section « À venir » distincte des lancements passés.
- **Onglet Conflits** (`feeds/ConflictsPanel.tsx`) : période (24 h → 1 an), trois compteurs **jamais additionnés** — « Articles de presse » (GDELT, un article × un lieu, non confirmés, sans bilan), « Incidents vérifiés (UCDP GED, jusqu'au 31/08/2026) » (avec « Aucun sur 30 j : publication différée… Élargir à 6 mois »), « Détections satellite » (FIRMS, « pas des combats ») — ; filtres « Afficher sur le globe : Presse / Incidents vérifiés / Satellite » (impossible de tout masquer) ; liste des « Zones signalées » avec natures séparées et mention « localisé au niveau pays/région » si le serveur la fournit.
- **Onglet OVNI = Dossiers OVNI / PAN** : bandeau permanent « Rapports et témoignages publiés par des organismes officiels — ne constituent pas des faits établis », classification GEIPAN A/B/C/D expliquée, état AARO (403, aucun contournement) affiché.
- **Onglet ONU** : actualités ONU Info + couverture des réunions/communiqués (40 éléments sur 7 j au moment du test).
- **Fiche pays unique** (`feeds/CountryPanel.tsx`, colonne droite, `feeds/Inspector.tsx`) : drapeau, nom localisé, ISO3 ; bouton « Approfondir avec AURA » (ouvre AURA et **pré-remplit** la question, sans l'envoyer) ; sections Conflit (natures séparées, période, « Voir la zone la plus citée »), Social, Catastrophes, Santé, ONU (+ Nucléaire/Espace/OVNI si présents), Économie (indice boursier et variation via `/api/feeds?category=economy&country=ISO3`, devise BCE, population et PIB Banque mondiale **avec année**), Dirigeants (Wikidata, date de collecte). Section vide : « Rien dans nos sources sur 24 h. » + « Plus ancien (il y a 3 j) : titre » s'il existe.
- **Sélection unique** dans le store : fiche pays, zone de conflit et élément de flux s'excluent (une seule inspection à droite) ; AURA occupe la colonne droite quand elle est ouverte ; Échap ferme dans l'ordre AURA → réglages → inspection.
- **Calque globe** `globe/FeedLayer.ts` : un `THREE.Points` au-dessus de la sphère, couleur de catégorie, **halo pulsant si < 2 h**, éclat décroissant (< 6 h plein, < 24 h 70 %, au-delà 40 %), faces cachées éliminées dans le shader, survol (info-bulle) et clic (détail + recentrage) avec seuil 10 px ; surlignage du point survolé depuis le fil. Les foyers dont le serveur indiquerait `geoPrecision` « country »/« region » ne sont plus dessinés comme points (voir §5).
- **Lisibilité** (`globals.css`) : texte d'interface ≥ 11 px (variables `--text-*` relevées), contrastes relevés (`--color-text-faint` #4a6f88 → #7f9fb5), aucune troncature à points de suspension dans le fil ni la fiche (retour à la ligne), gabarit à zones fixes (en-tête 48 px, barre des thèmes 44 px, colonnes `clamp(330px, 26vw, 400px)`, dock caméra + lanceur AURA en bas-centre) : plus aucune collision. Classes de couleur historiques (`text-ice`, `text-text-faint`…) qui n'existaient pas dans la config Tailwind : définies en CSS.
- **Voix d'AURA** (`agent/useAuraVoice.ts`, `speakable`) : ne lit plus le markdown (titres, gras, listes, code, tableaux), ni les marqueurs `[1]`, `[3, 4]`, `[^2]`, ni les URL / `www.` / liens markdown.
- Icône inline (data:) et métadonnées honnêtes dans `layout.tsx` (plus de 404 `/favicon.ico`, compatible CSP).

## 3. Preuves

| Vérification | Résultat |
|---|---|
| `pnpm typecheck` | OK, 0 erreur |
| `pnpm test` | 19 fichiers réussis, 1 ignoré (hors périmètre) — 207 tests réussis, 2 ignorés (fin de mission) |
| `tests/ui-feeds.test.ts` (19 tests, fixture réelle réduite `tests/fixtures/ui-feeds-sample.json`) | thèmes, libellés de nature, DIRECT < 2 h, date propre ≠ collecte, période bidirectionnelle, tri (futur à part), « Tout » sans cotations ni futur, fusion par catégorie + catégories en échec, sources en erreur (AARO oui, NASA non branchée non), date réelle de dernière donnée, sections pays 24 h + « plus ancien », cotations pays, drapeau, trois natures de conflit jamais additionnées, précision pays/région |
| `tests/ui-no-demo.test.ts` | aucune mention démo/fictif, aucun « N/A »/« Inconnu », composants morts absents |
| `tests/ui-aura-voice.test.ts` | voix sans markdown, sans [n], sans URL |
| Console navigateur (Chrome headless via CDP, CSP stricte active après redémarrage de :3011) | aucune violation CSP, aucune exception JS ; seuls messages : avertissements de performance WebGL du rendu logiciel |
| `/api/feeds` réel sur :3011 | 8 catégories en 200 ; 15/17 sources opérationnelles (AARO : 403 affiché ; NASA UAP : non branchée, affiché) |

### Captures (`docs/orchestration/captures-refonte-ui/`)

Avant : `avant-1280.png`, `avant-1440.png`, `avant-1710.png`.

Après, pour chaque largeur `W` ∈ {1280 (×800), 1440 (×900), 1710 (×1000)} :
`apres-W-tout.png` (fil « Tout »), `apres-W-conflits.png`, `apres-W-ovni.png`, `apres-W-espace.png` (« À venir »), `apres-W-onu.png`, `apres-W-fiche-france.png`, `apres-W-fiche-france-bas.png` (Économie, Dirigeants), `apres-W-sources.png` (popover), `apres-W-detail-element.png` (clic sur un élément du fil), `apres-W-aura.png` (« Approfondir avec AURA » depuis la fiche Japon : question pré-remplie).

Relecture : en-tête sur une ligne et barre des thèmes sans débordement aux trois largeurs ; panneaux gauche/droit, dock caméra et lanceur AURA sans chevauchement ; pas de texte coupé par points de suspension (titres longs du fil limités à 4 lignes, titre complet dans le détail).

## 4. Vérifié / non vérifié

**Vérifié** (captures + console) : en-tête, thèmes (filtrage du fil et du calque), fil et états (chargement, erreur par source, vide), onglets Conflits/OVNI/ONU/Espace, fiche pays via la recherche, détail d'un élément, popover Sources, ouverture d'AURA pré-remplie, absence de violation CSP.

**Non vérifié / limites** :
- Clic **direct sur un point du globe** et sur un pays du globe : code testé par typecheck et logique de picking reprise de `ConflictLayer`, mais pas cliqué en navigateur automatisé (positions écran non déterministes).
- **Heure locale** du pays dans la fiche : non affichée (aucune donnée de fuseau horaire par pays disponible côté client ; ne pas deviner).
- Rendu mobile (< 768 px) : volets à bascule « Globe / Fil / Détail » codés, non capturés.
- Navigation clavier complète des onglets (flèches) non implémentée : Tab + Entrée fonctionnent.
- Le badge « N » en bas à gauche des captures est l'indicateur de développement de Next.js (absent en production).

## 5. Demandes hors périmètre

1. **Précision des foyers** : `ConflictCluster` ne porte pas `geoPrecision` (les clusters de `/api/events` n'ont que `confidence…realShare`). L'UI lit déjà un champ additif optionnel `cluster.geoPrecision` (`feeds/conflictModel.ts › isPointPrecise`) : il suffit que l'agrégation (`src/lib/clustering/cluster.ts` / serveur) l'expose (ex. la précision la plus fine du foyer, ou « country » si tous ses événements sont au niveau pays) pour que ces foyers disparaissent du rendu en points et soient mentionnés « localisé au niveau pays ». Le détail d'une zone affiche déjà la mention par événement (`event.geoPrecision`).
2. **Bilan du jour** : brancher `GET /api/briefing` via la prop `onBriefing` de `Header` (dans `IntelApp`).
3. `src/data/geopolitics.ts` n'est plus utilisé par l'interface (assertions statiques non sourcées) : suppression à décider.
4. Optionnel : `devIndicators: false` dans `next.config.mjs` pour masquer le badge Next en développement.
5. ⚠️ **Serveur :3005** : lancer `next dev` sur :3011 (comme demandé par la mission) partage le dossier `.next` avec le `next start` de :3005 et **a remplacé son build de production** (plus de `BUILD_ID` dans `.next` dès 12:20). :3005 répondait encore 200 en fin de mission (modules déjà chargés en mémoire), mais toute page ou route non encore chargée risque d'échouer, et un redémarrage de :3005 exigera un `next build`. À l'avenir : `distDir` distinct pour le dev, ou une copie du dépôt.

## 6. Fin de mission

- Serveur de dev :3011 arrêté (port libre vérifié) ; :3005 non touché (répond 200).
- Captures prises sur :3011 **après redémarrage** avec la CSP stricte de `next.config.mjs` : aucune violation CSP ni exception dans la console (Chrome headless, domaines `Runtime` + `Log` du protocole DevTools). L'interface ne charge aucune ressource tierce : drapeaux en emoji, icône inline `data:`, données via `/api/*` et `/data/*` uniquement ; les liens externes (« Source ↗ », carte OSM, vue satellite) sont de simples liens ouvrant un nouvel onglet.
- Aucun commit.
