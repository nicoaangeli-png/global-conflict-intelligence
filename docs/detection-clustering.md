# Clustering robuste intégré (P2 sur P4 + P3)

## Provenance et choix d'intégration

Comparaison fichier par fichier de cluster, engine, store, limits, fingerprint,
confidence, types et tests pour `5e01581f`, `72f8bc86`, `03f513ff` et `9bdb8a37`.
Leur base commune `d76b8495` précède le main retenu : aucun snapshot entier repris.

- `5e01581f` : décision explicable, majorité indépendante, ancrage robuste et distinction instantané/durable retenus comme principes, réimplémentés sur les interfaces async P4 et lexiques P3.
- `72f8bc86` : comparaison de la fenêtre 6 h ; rejet du regroupement géographique chaîné et de la moyenne sensible aux outliers. Pas de reprise du store/engine synchrone.
- `03f513ff` et `9bdb8a37` : identiques sur les fichiers comparés. Suite étendue de 39 cas récupérée et adaptée à async ; cluster ancien à veto individuel rejeté. Ajustements de fixtures détaillées récupérés sans affaiblir leurs assertions.
- `fee03a2b` : variante P4 exclue ; seule `dd884ec0` intégrée.

## Décision bornée et explicable

Une provenance indépendante représente une voix. Pour un incident instantané,
sa première preuve empêche le chaînage par copies successives. Pour un événement
durable, sa dernière preuve permet une corroboration récente.

Le noyau temporel doit être majoritaire : largeur **45 minutes** pour un incident
instantané ; durée maximale **6 heures** pour les catégories panne, manifestation et météo,
avec continuité des preuves (écarts de 45 minutes au plus) et au moins deux
provenances récentes pour une extension. La recherche des candidats porte sur
**6 h 45**, sans permettre pour autant de fusionner deux explosions à trois heures.

L'ancre de recherche est la médiane du noyau majoritaire, non la plus vieille
preuve. Une vieille preuve isolée ne cache donc pas le candidat. Le temps
d'occurrence affiché reste la première occurrence rapportée, pas une certitude nouvelle.

Les positions point/city sont fiables seulement si leurs coordonnées sont valides.
Une majorité des positions fiables du noyau doit se situer à **25 km** au plus du
signal entrant ; aucune chaîne de voisinages ne permet de traverser une grande zone.
La position affichée est une position effectivement rapportée au centre d'un
consensus majoritaire, jamais une coordonnée inventée par moyenne. Sans consensus,
elle est inconnue. Une précision région/pays n'est jamais promue en point.

Lieu canonique, pays, entités spécifiques, catégorie et contenu descriptif P3
complètent ce consensus. Un lieu seul ou une catégorie seule ne suffisent pas.
Sans coordonnées fiables, le seuil textuel est plus strict et un lieu commun est
nécessaire. Une contradiction missile/industriel pénalise le matching et reste
visible dans les contradictions/confiance ; elle n'est pas tranchée arbitrairement.

`MatchDecision` expose score, raisons, facteurs positifs/négatifs et identifiants
des preuves de soutien. Score heuristique borné, **pas une probabilité calibrée** :
0,5 × Jaccard moyen + 0,2 + 0,15 si géographie + 0,1 si entité + 0,05 × ratio
de soutien, moins 0,05 en présence de facteurs négatifs. L'admissibilité repose
d'abord sur les règles et majorités, pas sur cette somme. Deux candidats à moins
de 0,05 sont ambigus : création séparée plutôt que fusion arbitraire.

Au plus 128 preuves par événement et 64 candidats ; le dépassement de preuves
reste explicitement tronqué par le moteur. Les inconnues ne deviennent pas des faits.
Les tests couvrent SQLite et une base PostgreSQL réelle isolée, y compris
réouverture, outliers, alias et ingestion multi-instance.
