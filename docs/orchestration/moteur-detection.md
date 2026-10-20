# ORBITAL — reprise du moteur de détection

Compte rendu du 20 octobre 2026. Les changements déjà présents ont été conservés comme acquis : cette reprise termine les corrections ciblées et la validation, sans reconstruire le moteur ni reprendre la tâche antérieure des paramètres.

## Changements propres à cette reprise

- `src/server/detection/cluster.ts` : rapprochement complémentaire par proportion de mots partagés dans le titre/texte le plus court. Il exige simultanément un même lieu explicite normalisé, des positions fiables proches et un recouvrement d'au moins 0,4. Les contraintes de catégorie, de fenêtre temporelle globale de 45 minutes et de distance maximale de 25 km restent en place.
- `tests/detection.test.ts` : attentes alignées sur les plafonds de prudence existants. Une observation officielle ne force pas le statut confirmé ; le cas USGS magnitude 6,4 reste probable avec une importance de 70. Ajout d'un test empêchant le nouveau rapprochement lorsque la position manque, que le lieu diffère ou que les positions sont éloignées.
- Le présent document est nouveau. Aucun fichier suivi déjà modifié avant cette reprise n'a été réécrit. Aucun commit ni push effectué.

## Architecture déjà présente et conservée

| Fichiers | Rôle |
| --- | --- |
| `src/types/detection.ts` | Signaux, événements, preuves, facteurs de confiance et historique. |
| `src/server/detection/normalize.ts` | Adaptateurs des données existantes, catégories et validation des dates/positions. |
| `src/server/detection/fingerprint.ts` | Empreintes, URL canonique, mots normalisés et groupes de dépendance. |
| `src/server/detection/cluster.ts` | Rapprochement borné des signaux vers les événements candidats. |
| `src/server/detection/confidence.ts` | Facteurs explicites, contradictions et plafonds de prudence. |
| `src/server/detection/importance.ts` | Importance distincte de la confiance et sélection LIVE. |
| `src/server/detection/store.ts` | Stockage SQLite séparé, transactions, rétention et historique. |
| `src/server/detection/engine.ts`, `index.ts` | Ingestion incrémentale, révisions, instantanés et intégration serveur. |
| `src/app/api/detection/route.ts` | Lecture des résultats et indisponibilité explicite. |
| `src/components/detection/DetectionPanel.tsx`, `useDetection.ts`, `presentation.ts` | Bandeau LIVE, liste, détail, preuves, historique, polling et présentation. |
| `src/server/aura/tools/detection.ts` | Consultation bornée des événements et des preuves par AURA. |

Les raccordements existaient dans `src/server/feeds/util.ts`, `src/server/intel.ts`, `src/components/IntelApp.tsx`, `src/app/globals.css` et les fichiers AURA `prompt.ts`, `tools/definitions.ts`, `tools/run.ts`. La configuration Vitest existante utilise une base de détection en mémoire pour les tests.

Les nouvelles données de détection utilisent par défaut `data/detection.sqlite`, avec surcharge par `ORBITAL_DETECTION_PATH`, sans migration de la base métier. Aucun fournisseur, dépendance ou traitement LLM payant ajouté par cette reprise.

## Déduplication et indépendance

Le rapprochement combine catégorie, dates de source, lieu, distance et recouvrement lexical. Il ne repose pas uniquement sur la proximité. La fenêtre de 45 minutes s'applique à toutes les preuves d'un événement, pour éviter un chaînage temporel sans fin. Les positions fiables incompatibles excluent le rapprochement.

Les groupes de dépendance réunissent notamment fournisseur commun, domaine commun, URL canonique, empreinte identique, titre copié, corps quasi identique ou agence amont reconnue. Une reprise de Reuters/AP/AFP ne devient donc pas automatiquement une confirmation indépendante. Le nombre de preuves, le nombre de fournisseurs et le nombre de groupes indépendants sont des compteurs distincts. Ces métadonnées ne prouvent toutefois pas l'indépendance éditoriale réelle.

## Calcul de confiance existant

Indice heuristique explicable, **pas une probabilité statistique**. Un représentant de meilleure qualité est retenu par groupe de dépendance.

| Facteur | Points avant plafonnement |
| --- | --- |
| Groupes indépendants | +12 par groupe, maximum +48 |
| Qualité | +18 observation officielle attestant l'occurrence ; sinon +12 structuré ; sinon +10 source officielle ; sinon +6 |
| Présence d'un capteur | +12 |
| Présence d'un enregistrement structuré | +8 |
| Cohérence temporelle | +8, sinon −8 |
| Cohérence géographique | +8, sinon −8 |
| Accord descriptif ou observation officielle | +8, sinon 0 |
| Récence | +6 jusqu'à 30 minutes ; +2 jusqu'à 2 heures ; −4 jusqu'à 6 heures ; −12 au-delà ou inconnue |
| Absence d'attestation officielle de l'occurrence | −6 |
| Contradictions détectées | −20 chacune, maximum −40 |

Le total est borné à 0–100, puis plafonné : sans attestation officielle, moins de deux groupes limite à 49 et moins de trois à 74. Une occurrence inconnue, une géolocalisation insuffisante, une contradiction ou des preuves tronquées limitent à 74. Sans attestation officielle, atteindre 90 exige au moins quatre groupes et une preuve structurée, sans que cela suffise à lui seul.

Seuils : 0–24 `signal`, 25–49 `watch`, 50–74 `probable`, 75–89 `high`, 90–100 `confirmed`. La base de confirmation reste explicite. Les démentis et les divergences arme/origine industrielle reposent sur des règles lexicales limitées, non sur une compréhension exhaustive du texte.

## Importance, LIVE et interface

L'importance ne mesure pas la véracité : bases par catégorie (séisme 40, explosion 55, incident 40, panne 20, météo 25, manifestation 25, thermique 10, autre 10), augmentées du maximum entre gravité et magnitude, puis bornées à 100. Pour les séismes, les bonus de magnitude sont +10 à partir de 5, +30 à partir de 6 et +40 à partir de 7.

LIVE exige une ancienneté de 0 à 6 heures, une importance ≥55 et une confiance ≥25. L'ancienneté part de la première date de source, jamais d'un nouveau téléchargement. Les résultats LIVE sont bornés à 12 ; le bandeau présente au plus deux titres avec accès à tous les signaux. Le détail expose preuves, facteurs et historique ; le globe ne reçoit un focus que pour des coordonnées point/ville valides.

Le polling est de 30 secondes avec délai maximal de 12 secondes, pause en onglet masqué et annulation au démontage. Les états périmé et indisponible sont visibles. Les résultats sont bornés (200 événements par instantané, lots de 500 signaux, 64 candidats, 128 preuves, 512 entrées d'historique et rétention de 7 jours).

GDELT reste un signal de presse, FIRMS une détection thermique, USGS une observation instrumentale : aucun de ces libellés ne devient automatiquement une attaque confirmée.

## Validation exécutée

- `pnpm test` : **423 tests réussis, 6 ignorés** ; 47 fichiers réussis et 2 ignorés.
- `pnpm typecheck` : réussi.
- `pnpm exec playwright test tests/detection-ui.spec.ts` : **5 scénarios réussis**, dont détails, actualisation, focus clavier, états dégradés, anglais et formats 360/768 px.
- `pnpm exec playwright test` : **29 scénarios réussis**, incluant détection, globe, pays, calques, AURA, paramètres et navigation tactile 360/375/390/430/768 px, ainsi que le bureau.
- `git diff --check` : propre avant rédaction du rapport ; nouveau contrôle effectué à la livraison.

Les scénarios navigateur utilisent les API simulées du dépôt et le serveur de développement géré par Playwright sur le port 3011. Ils valident les parcours et la présentation testés, pas la disponibilité des fournisseurs réels. Les tests de stockage externes ignorés ne constituent pas une validation PostgreSQL.

## Limites et suite éventuelle

Le moteur reste lexical et heuristique : faux regroupements, non-regroupements, couverture linguistique imparfaite et sous-estimation de l'indépendance sont possibles. Les bornes et la rétention limitent l'exhaustivité. Le nouveau rapprochement ne prétend pas résoudre ces limites générales.

Environnement local : Node **25.9.0**, hors des versions déclarées par le projet (`^22.13.0 || ^24.0.0`) ; avertissement conservé, sans changement d'environnement. Aucun build de production, exécution distante de CI, contrôle des fournisseurs en direct ou validation PostgreSQL n'a été effectué pendant cette reprise. Une validation de livraison sous Node 22/24 et en production demeure distincte des résultats locaux ci-dessus.
