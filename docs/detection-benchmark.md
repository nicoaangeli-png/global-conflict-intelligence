# Benchmark de détection ORBITAL (jeu synthétique v1.0.0)

## Exécution et périmètre

`pnpm benchmark:detection` exécute le même jeu sur SQLite en mémoire. Si `ORBITAL_TEST_DATABASE_URL` pointe **explicitement vers une base PostgreSQL 17 jetable**, il ajoute PostgreSQL. La commande imprime une ligne `ORBITAL_DETECTION_BENCHMARK_JSON=...` par backend, exploitable par un parseur JSON après retrait du préfixe. Elle n'utilise ni réseau de sources, ni clé API, ni date courante pour les admissions. Le rapport porte le commit, l'heure d'exécution, la version du jeu et ses paramètres ; les mesures de performance et la mémoire RSS dépendent de la machine et de sa charge.

Le benchmark utilise le vrai `DetectionEngine` et les vrais stores. Les signaux sont des **constructions synthétiques explicitement étiquetées**, pas des événements réels ni une validation du monde réel. L'admission se fait à l'instant fixe `2026-10-22T15:10:00Z`. Le jeu de qualité est séparé du jeu de charge.

## Vérité terrain et métriques

Le jeu versionné contient 18 signaux : 12 positifs regroupés en 6 incidents attendus et 6 négatifs. Il couvre explosion Odessa multi-source EN/FR, relais d'une même dépêche, seconde explosion trois heures plus tard, explosion de même formulation à Kharkiv, séisme Tokyo EN/FR, panne Odessa EN/FR, manifestation Kyiv, signal incomplet, signal trop vieux, géolocalisation contradictoire et trois commentaires/analyses sans nouvel événement. Les scénarios annexes couvrent révision compatible, correction de catégorie et de lieu, ID dérivé occupé, replay, limite 128 et quatre permutations déterministes.

La **détection** est mesurée ici au niveau du *signal admis et représenté dans une preuve*. TP = positif représenté, FP = négatif représenté, FN = positif absent, TN = négatif absent. Précision = TP/(TP+FP), rappel = TP/(TP+FN), F1 = moyenne harmonique. Cela **ne mesure pas** la découverte exhaustive des conflits dans des flux réels : les FN hors du petit jeu étiqueté sont inconnus.

Le **clustering** évalue chaque paire des 12 signaux positifs : regroupée correctement, regroupée à tort, séparée correctement, séparée à tort. Une preuve manquante n'est pas créditée comme une séparation correcte. Le score de corroboration est le nombre de groupes de dépendance calculés par le moteur, **pas** une preuve d'indépendance éditoriale réelle. Les événements mono-source, multi-source et les relais de dépêche restent visibles dans la sortie structurée.

## Mesuré le 23 octobre 2026

Référence : commit `279d285d7216846f61ba147b7a10fc73a391f6d0`, Node 24.22.1, PostgreSQL 17.10 Homebrew sur cluster et base jetables locaux. Les chiffres ci-dessous sont des observations d'une exécution, pas des garanties de latence production.

| Mesure qualité | SQLite | PostgreSQL |
| --- | ---: | ---: |
| TP / FP / FN / TN | 12 / 4 / 0 / 2 | 12 / 4 / 0 / 2 |
| Précision / rappel / F1 admission | 0,750 / 1,000 / 0,857 | 0,750 / 1,000 / 0,857 |
| Paires correctes ensemble / à tort ensemble | 11 / 0 | 11 / 0 |
| Paires correctes séparées / à tort séparées | 54 / 1 | 54 / 1 |
| Précision / rappel / F1 clustering | 1,000 / 0,917 / 0,957 | 1,000 / 0,917 / 0,957 |
| Événements produits / attendus | 11 / 6 | 11 / 6 |
| Mappings cachés / preuves sans mapping | 0 / 0 | 0 / 0 |

**Erreurs observées** : `generic-analysis`, `past-attack`, `vague-comment` et `misgeolocated` deviennent des événements alors que le label indique « pas de nouvel événement ». Le signal de panne d'Odessa en français reste séparé du signal anglais : une paire positive est perdue. Leurs formulations ne satisfont pas la similarité exigée. Ces défauts sont consignés, non corrigés dans ce Prompt : une politique de rejet sémantique, une validation géographique ou une modification de seuil de clustering demanderait un travail de qualité distinct et davantage de données indépendantes.

**Révisions et déduplication** : un replay exact est ignoré ; la révision compatible conserve l'identité ; la correction « explosion Odessa → séisme Tokyo » quitte l'ancien événement et rejoint/crée une identité compatible. Les 12 preuves attendues gardent leurs mappings. À la borne 128, le 129e signal est `skipped` lors de deux tentatives, sans mapping fantôme ni suppression de preuve. L'ID dérivé volontairement occupé n'écrase pas l'occupant.

**Corroboration mesurée** : le rapport liste chaque événement avec 1, 2 ou plusieurs preuves et le nombre de groupes de dépendance calculés. Le groupe portuaire a 5 preuves de 5 fournisseurs mais seulement 3 groupes calculés (deux relais `reuters` et un titre copié). Le séisme bilingue a 2 preuves et 2 groupes calculés ; les événements isolés restent à 1. Ces nombres ne prouvent pas que deux rédactions ont enquêté indépendamment.

**Ordre d'arrivée** : 4 mélanges déterministes (graines 1, 7, 42, 2026) conservent les 11 regroupements et les mêmes scores. Les IDs changent dans les quatre ordres car le premier signal reçu amorce l'identité. Pour les graines 1 et 7, le représentant du groupe portuaire porte `Odesa` au lieu de `Odessa` ; catégorie et pays restent identiques. Les autres graines conservent les métadonnées observées. La stabilité absolue des identités et de la graphie du lieu inter-ordres **n'est pas garantie**. Les IDs déjà émis restent toutefois vérifiés dans les scénarios de révision compatibles.

### Charge synthétique, séparée de la qualité

Trois tailles de 30/90/180 signaux, chacune sur un store frais. Une lecture sans effet termine l'initialisation/migration avant le chronométrage. Les admissions sont séquentielles et alternent trois catégories ; le batch chronométré admet ensuite **20 nouveaux signaux**. Les latences p50/p95/p99 concernent une admission unitaire, en millisecondes. RSS = mémoire du processus entier avant/après le scénario ; ce delta n'est pas une mesure de fuite.

| Backend | N | Signaux/s | p50 / p95 / p99 (ms) | Batch 20 (ms) | Δ RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| SQLite | 30 | 2 984 | 0,325 / 0,482 / 0,482 | 11,85 | +0,75 Mo |
| SQLite | 90 | 1 516 | 0,644 / 1,101 / 1,420 | 24,98 | +0,82 Mo |
| SQLite | 180 | 845 | 1,135 / 2,155 / 2,297 | 48,37 | +0,41 Mo |
| PostgreSQL | 30 | 1 068 | 0,876 / 1,060 / 3,183 | 20,94 | +0,00 Mo |
| PostgreSQL | 90 | 747 | 1,265 / 1,940 / 3,118 | 40,19 | +0,28 Mo |
| PostgreSQL | 180 | 501 | 1,925 / 3,317 / 3,730 | 70,86 | +15,22 Mo |

Le test de concurrence distinct utilise deux stores/pools PostgreSQL sur **le même schéma**, 20 admissions simultanées, et vérifie les 20 preuves et 20 mappings ainsi que zéro orphelin, zéro mapping caché, zéro événement vide et zéro ID dupliqué. Il complète, sans remplacer, les tests de concurrence du Prompt 5. Une absence de deadlock dans ce scénario ne prouve pas l'impossibilité d'un autre cycle.

## Seuils et interprétation

Seuils initiaux permanents du jeu v1 : précision d'admission ≥ 0,70 ; rappel ≥ 0,90 ; FP ≤ 4 ; F1 par paires ≥ 0,90 ; au moins 5 des 6 groupes avec catégorie/lieu/pays cohérents ; zéro mapping caché ou manquant ; replay idempotent ; révisions cohérentes ; 128 preuves exactement et 129e refusée. Ils visent la **détection de régression** sur ce jeu et sont volontairement distincts des objectifs de qualité : viser ≥ 0,95 de précision d'admission, zéro FP sémantique sur un corpus élargi, ≥ 0,98 de F1 par paires et stabilité sémantique des métadonnées malgré l'ordre. Les chiffres actuels sont inférieurs à ces objectifs ; aucun seuil n'a été abaissé pour fabriquer un 100 %.

**Non mesuré** : rappel sur tous les événements mondiaux, indépendance éditoriale réelle, vérité d'une source, précision géographique au-delà des six labels, performance de longue durée, qualité sur des données historiques non synthétiques, p95/p99 en charge concurrente soutenue, et déploiement multi-VPS. Les tests ne sont pas une estimation statistique de la précision de production. Le suivi du Prompt 8 (`detection_signals_total`, `detection_changes_total`, `detection_errors_total`, `detection_duration_seconds`) est réutilisé ; le benchmark ne crée aucune seconde couche de métriques ni écriture PostgreSQL dédiée à l'observabilité.

## Recommandations

1. Étendre le jeu par des cas humains vérifiés, hors test de développement, avec procédure d'annotation indépendante et provenance, avant d'ajuster la logique sémantique.
2. Étudier séparément un filtre de commentaire/analyse non événementielle et le rapprochement multilingue des pannes, avec tests de contre-exemples pour éviter les faux merges.
3. Évaluer l'effet de l'ordre d'arrivée sur l'identité et le représentant de façon explicite avant de promettre une stabilité inter-ordres ou de modifier l'algorithme.
4. Répéter les mesures de charge sur environnement constant et plusieurs runs avant d'imposer un seuil de latence en CI ; le benchmark actuel ne fige pas les millisecondes d'une machine locale.
