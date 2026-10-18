Déposez ici vos exports de données de conflit :

- export ACLED (.csv)
- export UCDP GED (.csv)

Puis lancez une ingestion authentifiée côté serveur : `POST /api/ingest?days=30`,
avec `Authorization: Bearer <INGEST_TOKEN>`. Ne placez pas ce secret dans le navigateur.

N'importez que des exports réels dont vous connaissez la provenance et les droits.
Chaque nouvelle ligne porte la source `import:csv` et la confiance `REPORTED` par
défaut. Une colonne explicite peut déclarer `CONFIRMED` : ce niveau reste celui du
fichier, pas une vérification indépendante. Les lignes invalides sont rejetées et
comptabilisées dans le rapport d'ingestion ; aucun contenu fictif ne sert de repli.
