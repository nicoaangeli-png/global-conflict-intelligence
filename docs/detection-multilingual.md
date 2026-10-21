# Détection multilingue : périmètre intégré

Les lexiques couvrent en, fr, es, pt, de, it, ru, uk, ar, fa, tr, he, zh, ja et ko.
Il s'agit de règles déterministes, pas d'une compréhension générale de ces langues.

## Chemin utilisé par le moteur

- `normalize.words` conserve les écritures non latines et applique les concepts et alias connus.
- `fingerprint.tokens` appelle `language/tokenizer.tokenizeText` : segmentation multi-écriture, mots vides et stemming léger.
- `fingerprint.similarity` délègue au Jaccard de `similarity/textSimilarity`.
- Les lexiques de catégories, agences, lieux et contradictions servent la classification, le matching et la confiance.
- `fromConflict` conserve le contrat typé `ConflictEvent` et les distinctions incident, presse et observation thermique.

La normalisation Unicode est destinée à la comparaison : NFKC, casse, typographie et certains diacritiques sont unifiés. Les textes sources ne sont pas réécrits.

## Modules expérimentaux, hors décision de production

`similarity/embedding.ts` est conservé pour ses expériences et tests locaux : il hache des trigrammes de caractères dans un vecteur déterministe. Ce n'est ni un modèle sémantique entraîné ni une preuve de correspondance entre traductions. Aucun appel réseau ; aucun raccord au score de matching ou de confiance.

`minOverlapCoefficient` et `sharedDescriptiveTokens` restent des utilitaires expérimentaux tant qu'un gain mesuré n'est pas démontré. Le Jaccard du même fichier est utilisé en production.

Les fixtures synthétiques sont limitées aux tests ; elles ne sont jamais ajoutées aux données de l'application.
