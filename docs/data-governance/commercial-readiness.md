# Maturité commerciale d'ORBITAL — revue du 21 octobre 2026

> Analyse technique et documentaire, pas avis juridique ni certification de conformité.
> Aucun palier n'est déclaré légalement prêt sans vérification des droits et contrats applicables.

## 1. Périmètre et preuves

La matrice sources-licensing.md contient **36 lignes de périmètre**, et non 35 sources
actives : connecteur GKG historique désactivé, pipeline Events actif, import CSV,
package cartographique et fournisseur IA y figurent séparément. Ce décompte est
vérifié sur la table ; il n'établit pas 36 contrats ni la complétude des droits.

Vérifié dans le dépôt : pipeline GDELT 2.0 Events et enrichissement GKG 2.1,
ancien endpoint GKG API v1 désactivé, absence de LICENSE à la racine et package
private. Les références, attributions et précautions analytiques de la matrice
sont conservées. L'absence de GPL/AGPL dans l'ensemble des dépendances et artefacts
**n'est pas démontrée**. Un audit de sécurité npm n'est pas un audit de licences.

## 2. Quatre paliers d'exploitation

| Palier | Statut de diligence | Conditions avant ouverture |
| --- | --- | --- |
| A — personnel / recherche locale | À confirmer par source | Un usage individuel ou académique n'accorde pas d'exemption générale ; vérifier compte, quotas, stockage, contrats et juridiction. |
| B — site public gratuit | Revue juridique nécessaire | Gratuit ne signifie pas autorisé à redistribuer ; vérifier affichage, extraits, cache, attribution, clauses de non-endossement et droits cartographiques. |
| C — SaaS commercial | Non validé juridiquement | Obtenir les licences adaptées aux usages réellement proposés ; isoler ou désactiver les flux sans preuve de permission, avec une validation produit/contractuelle. |
| D — API / redistribution | Revue juridique renforcée | Documenter droits de redistribution et droits sur les données dérivées, limitations et provenance dans les payloads ; pas d'autorisation automatique liée au clustering. |

Une donnée factuelle, publique ou transformée ne devient pas automatiquement libre
de droits. Les détections, scores et agrégats d'ORBITAL peuvent rester soumis aux
conditions des entrées ou aux droits de bases de données. Ne pas promettre leur
libre revente sans analyse. Le domaine public annoncé par un fournisseur doit
être vérifié pour le jeu exact, les contenus tiers et les pays concernés.

## 3. Principaux risques et actions

- **OpenSky — restriction identifiée** : les conditions officielles prévoient une licence écrite pour l'usage commercial. Vérifier le contrat détenu avant activation payante. Référence : https://opensky-network.org/about/terms-of-use.
- **ACLED — à confirmer sur le contrat applicable** : identifier formule d'accès, usages autorisés, conservation et redistribution. Ne pas déduire la permission commerciale d'un compte gratuit ou d'une clé client. Conserver la citation universitaire et la provenance des autres jeux, notamment UCDP.
- **AISStream — à confirmer** : accès gratuit annoncé, mais aucune interdiction générale de tout SaaS payant démontrée ici. Obtenir confirmation écrite des droits d'affichage, de cache et de redistribution. Référence : https://aisstream.io/.
- **TeleGeography — risque de droits à traiter** : vérifier provenance et permission du fichier submarine_cables.json et du flux. La FAQ renvoie les demandes de données à un formulaire, sans établir à elle seule une contrefaçon avérée. Ne pas supprimer le fichier ni son attribution dans cette intégration. Référence : https://www.submarinecablemap.com/faq.
- **Yahoo Finance — revue juridique nécessaire** : vérifier endpoint utilisé, conditions du service et droits des places de marché avant exposition payante. Quotas et absence de contrat peuvent bloquer l'exploitation ; bannissement et poursuites ne sont pas des conséquences certaines.
- **GDELT et presse — probablement compatible sous conditions** : GDELT annonce une base ouverte, mais les articles liés conservent leurs droits propres. Ne pas transformer titres/liens/mentions en événements confirmés ni redistribuer un article intégral sans permission. Référence : https://www.gdeltproject.org/about.html.
- **Cartographie et alternatives** : évaluer OpenStreetMap/ODbL et les obligations sur bases dérivées, pas seulement l'attribution. Attribution à conserver si OSM est retenu : « © les contributeurs d'OpenStreetMap ». Aucune substitution effectuée ici.
- **Données sensibles et IA** : vérifier finalités, minimisation, rétention, transferts, contrats de sous-traitance, conditions du fournisseur et obligations réglementaires applicables. La signature AURA seule ne prouve pas la conformité à l'AI Act. La liste OFAC n'est pas une certification KYC/AML.

## 4. BYOK n'est pas une dispense

Une architecture Bring Your Own Key peut isoler la consommation et le contrat du
client, mais ne transfère pas automatiquement les droits de redistribution, ne
neutralise pas les CGU et ne décharge pas l'éditeur de ses responsabilités.
Vérifier explicitement les usages SaaS, API, cache, sous-traitance, multi-tenant
et territoires. Aucun fournisseur alternatif ni tarif n'est réputé autorisé
sans examen de son offre et de sa licence à la date de souscription.

## 5. Licence du dépôt et dépendances

L'absence de LICENSE racine n'est ni une licence open source implicite ni une
interdiction de commercialiser son propre code par ses ayants droit. Vérifier
les droits des contributeurs et les composants tiers avant tout choix.

Les options Apache/MIT, BSL ou AGPL discutées dans la matrice sont des options
à examiner avec les ayants droit et un conseil, pas une décision prise par
l'intégrateur. BSL n'est pas automatiquement adaptée et une AGPL ne concerne
pas sans nuance tout code voisin. Aucune licence nouvelle n'est ajoutée.

Produire avant distribution une SBOM de l'artefact livré, collecter les licences
et NOTICE, examiner les dépendances transitives, binaires et assets ; documenter
les exceptions et préserver les attributions. Le relevé des packages directs
de la matrice ne permet pas de conclure à l'absence de copyleft.

## 6. Plan de mise en commercialisation recommandé

1. Versionner les conditions/licences exactes de chaque ligne, date de consultation, jeu, endpoint, titulaire et preuve de permission.
2. Distinguer flux actifs, désactivés et expérimentaux ; consigner droits de stockage, affichage, dérivation, revente et rétention par usage.
3. Obtenir les accords nécessaires ou désactiver les fonctions non couvertes avant lancement ; aucune suppression de données dans ce commit documentaire.
4. Faire valider les droits du code, dépendances et données, puis les clauses clients, mentions, attribution, protection des données et obligations IA.
5. Décider le périmètre SaaS/API effectivement autorisé avec un conseil juridique ; ne pas présenter ce document comme un feu vert.

## 7. Décompte et limites

**36 lignes dans la matrice**, catégories de risque indicatives, parfois mixtes.
Les anciennes sommes 19 LOW / 9 MEDIUM / 5 HIGH / 2 revue sont retirées : elles
comptaient 35 éléments, omettaient des lignes et se chevauchaient. Elles ne sont
pas remplacées par des chiffres artificiels. Revue juridique nécessaire avant
commercialisation ; aucun fournisseur ni infraction n'est déclaré validé par défaut.
