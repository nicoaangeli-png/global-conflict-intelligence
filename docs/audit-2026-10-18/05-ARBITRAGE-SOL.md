# ORBITAL — Arbitrage indépendant des derniers audits

Date : 18 octobre 2026. Référence du code examiné : `a0bb6c36`.

## 1. Verdict et périmètre

**Conserver le projet et son interface. Corriger les contrats de données et de sélection avant d'ajouter de nouvelles API.** Le globe et l'application fonctionnent ; les chiffres affichés ne constituent pas encore un bilan fiable des conflits en temps réel. AURA présente en outre des risques de consommation non autorisée et de réponses tronquées présentées comme terminées.

Cet arbitrage confronte les quatre rapports `01-SYNTHESE.md`, `02-code-et-verite-des-donnees.md`, `03-ux-ui.md` et `04-sources-en-direct.md` au code actuel, aux réponses locales, à des régressions isolées et à une inspection navigateur. L'accord entre plusieurs modèles n'est pas une preuve.

- **Confirmé** : chemin de code vérifié et, lorsque précisé, reproduction indépendante.
- **Partiel** : mécanisme réel mais conséquence, portée ou remède du rapport à nuancer.
- **Rejeté/obsolète** : affirmation contredite par l'état actuel ou recommandation incorrecte.
- **Non certifié** : intégration externe, exploitation réelle ou interaction non vérifiée.

Aucun fichier applicatif, secret, jeu de données ou configuration n'a été modifié. Aucun commit, redémarrage, ingestion manuelle ou appel OpenAI payant. Le seul ajout au dépôt est ce rapport. Les contrôles temporaires sont hors dépôt.

## 2. Contrôles et résultats reproductibles

| Contrôle | Résultat et limite |
|---|---|
| `pnpm exec tsc --noEmit --incremental false` | Réussite. L'ancien blocage par import `CountryIndicators` manquant n'est plus actuel. |
| Build de production | Réussite, dix routes générées ; copie isolée de `src`, `public` et des configurations, sans `.env` ni données locales, pour préserver le `.next` du serveur en cours. |
| `git diff --check` | Réussite avant rédaction. |
| `pnpm audit --prod --json` | Zéro vulnérabilité signalée par le registre consulté ; ce n'est pas une certification de sécurité. |
| `pnpm lint` | Échec non interactif : lance l'assistant de configuration ESLint. Aucun lint reproductible configuré. `next lint` n'est pas une commande inexistante dans cette version de Next 15. |
| Suite de tests | Pas de suite/script de tests dans le projet ; les contrôles ci-dessous sont des fixtures temporaires, pas une couverture durable. |
| Géométrie du focus | 35 directions comparées à la conversion lat/lon partagée ; écart maximal `4.70e-16`. Ce contrôle ne certifie pas tout le picking souris/tactile. |
| AURA, terminaison du flux | Réponse incomplète et coupure EOF reproduites avec transport simulé : toutes deux finissent par `done`, sans erreur. |
| AURA, requête inter-origines | Handler appelé avec `Origin: https://untrusted.invalid` et corps `text/plain` : HTTP 200 et une invocation de l'agent simulé. Aucun appel facturable. |
| Import CSV | Latitude 95 / longitude 210 acceptées ; latitude invalide remplacée par zéro ; `(0,0)` supprimé ; date invalide lève `Invalid time value`. |
| Navigateur local | Paramètres accessibles, recherche Iran fonctionnelle ; chevauchements desktop et mobile observés. Les entrées console sont omises par l'outil de capture : console non certifiée propre. |

Pièces temporaires de cette session : `/tmp/orbital-arbitre/checks.cjs`, `checks.json`, `csv-checks.json`, `/tmp/orbital-arbitre-audit-deps.json`. La copie de build est indiquée dans `/tmp/orbital-arbitre-build-path`. Ces fichiers ne sont ni versionnés ni une garantie de conservation.

### Mesures locales, à ne pas mélanger entre instantanés

Réponses autour de **05 h 49 UTC** le 18 octobre ; fenêtre glissante, donc chiffres susceptibles de changer.

| Sélection | Total 24 h | Total 7 j affiché | Total 30 j affiché | Couverture de la sélection |
|---|---:|---:|---:|---|
| 30 j, grille 2,4° | 5 902 | 6 056 | 6 056 | 5 960 médias, 96 thermiques, 0 documenté, 0 démo |
| 24 h, grille 2,4° | 5 902 | 5 902 | 5 902 | 5 850 médias, 52 thermiques |
| 1 an, grille 2,4° | 5 902 | 6 056 | 6 056 | 13 659 documentés, 5 960 médias, 96 thermiques |
| 30 j, `datasets=` vide | 5 902 | 6 470 | 7 007 | 951 démos réintroduites, en plus des médias et thermiques |

Le magasin contient 24 000 enregistrements : 3 190 démos, 5 960 GDELT, 13 659 UCDP et 1 191 FIRMS. Les événements UCDP du magasin vont jusqu'au 31 août 2026. **Zéro événement documenté dans la fenêtre 30 jours ne signifie donc pas zéro donnée UCDP dans le projet.**

Les 5 960 enregistrements GDELT correspondent à 2 028 URL distinctes. Une URL peut porter plusieurs lieux ; une URL distincte n'est pas non plus nécessairement un incident distinct. Le chiffre d'environ 98 % de médias porte ici sur la sélection 30 jours, pas sur tout le stockage.

## 3. Arbitrage des six constats P0 des rapports 01/02

| Référence | Décision | Preuve et décision retenue |
|---|---|---|
| P0-1 — Langue/Chrome | **Partiel** | `src/app/layout.tsx:15` déclare bien `en` pour l'interface française. Corriger la langue et l'accessibilité ; la corruption exacte par traduction automatique Chrome n'a pas été reproduite indépendamment. `translate="no"` ne remplace pas une vraie gestion FR/EN. |
| P0-2 — Compteurs | **Confirmé** | `src/server/intel.ts:420` applique d'abord la fenêtre sélectionnée, puis calcule les compteurs 24 h/7 j/30 j sur ce sous-ensemble. Les clusters dépendent de la grille : 538 zones à 2,4°, 215 à 22° pour la même sélection 30 j. Choisir explicitement des KPI absolus ou des intersections correctement libellées. Ne pas appeler incident vérifié une mention géographique ou une détection. |
| P0-3 — Fraîcheur/volume | **Confirmé, portée précisée** | `updatedAt` reflète l'ingestion et ne prouve pas la date de l'événement. Le total indexé peut inclure la démo alors que la vue la masque. Afficher séparément date de l'événement, publication, collecte et borne disponible par source. |
| P0-4 — GDELT | **Confirmé, remède partiel** | `src/server/connectors/gdelt.ts` privilégie le vocabulaire militaire, utilise des sous-chaînes et ne fournit pas de vrai titre d'article. Le défaut de prédicat est réel ; attribuer toutes les mentions albanaises à « Tirana contient iran » n'est pas démontré. CAMEO aiderait la classification, pas la vérification des faits. |
| P0-5 — Identité pays | **Confirmé, remède à encadrer** | `src/components/ui/Overlays.tsx:200` compare des noms strictement ; l'explorateur normalise certains alias autrement. `world.ts` et l'explorateur ne privilégient pas les mêmes propriétés Natural Earth. ISO3 canonique nécessaire, avec tables provider/FIPS/CAMEO explicites. Ne pas écraser systématiquement l'identité source par une géométrie Natural Earth 110m, imprécise aux frontières et incomplète pour de petits États. |
| P0-6 — Sélections/panneaux | **Confirmé dans le code** | `GlobalSituationPanel.tsx:148` conserve `chosenCountry` localement ; AURA lit `country`/`selected` dans le store. Choisir Iran dans l'explorateur ne transmet pas cette sélection de la même façon. La concurrence des panneaux est possible par architecture ; toutes les combinaisons de doublons n'ont pas été reproduites visuellement. Unifier sélection et navigation sans reconstruire l'interface. |

L'absence initiale de l'Iran dans un classement ne prouve pas l'absence du pays : un classement d'événements n'est pas un référentiel mondial. Dans l'état actuel, **Iran est trouvable dans l'explorateur**, avec données et indicateurs. Il faut distinguer présence dans le référentiel, couverture des sources et activité observée.

## 4. Arbitrage des P1 et de l'hygiène

| Référence 02 | Décision | Suite pertinente |
|---|---|---|
| P1-1 — Fiches statiques/live | **Confirmé** | Les avertissements existent déjà. Treize profils statiques non datés restent mêlés aux données annuelles sourcées ; contradictions visibles sur Iran. Séparer ou retirer les assertions non vérifiées, sans inventer les inconnues. |
| P1-2 — Dirigeants Wikidata | **Partiel** | `src/server/leaders.ts:36` exclut tout mandat ayant une date de fin, même future. L'omission actuelle du président français n'est pas certifiée par un nouvel appel. Ne pas simplement supprimer le filtre : cela ramènerait aussi les anciens dirigeants. Gérer validité temporelle, rang et attribution. |
| P1-3 — N/A / 0 † | **Confirmé** | Une détection FIRMS n'observe pas les pertes humaines. Zéro, inconnu et non applicable doivent être distincts ; ne pas afficher un symbole de morts sur un décompte de signaux. |
| P1-4 — Libellés/vues | **Partiel** | Le vocabulaire et certaines traductions promettent trop. L'onglet TIMELINE n'a pas de branche dédiée dans `ViewPanel`, mais une frise existe déjà. Le bouton Sources actualise l'état ET appelle `refresh()` : « ne fait rien » est faux ; il ne déclenche pas une nouvelle ingestion. |
| P1-5 — Clusters | **Confirmé comme limite de modèle** | Un cluster spatial n'est pas un théâtre de guerre validé. Expliciter agrégation, précision et provenance ; ne pas fusionner automatiquement ACLED/UCDP par proximité en supposant qu'il s'agit du même incident. |
| P1-6 — Sélection au zoom | **Confirmé dans le code** | `src/store/useIntelStore.ts:132` remplace un identifiant disparu par le voisin compatible ou `null`. La regrille peut perdre ou changer la sélection. Préserver l'identité métier et vérifier l'annulation des requêtes devenues obsolètes. |
| P1-7 — FIRMS | **Confirmé** | `src/server/intel.ts:290` conditionne la couche thermique à des zones déjà présentes, dont celles de GDELT ; pas de mode indépendant dédié. Séparer observation thermique et hypothèse de lien avec un conflit. Une détection n'est pas une frappe. |
| P1-8 — Retard UCDP | **Confirmé pour cet instantané** | Le retard mesuré est réel. Exposer la dernière période disponible et ne pas laisser une vue 24 h masquer silencieusement la source structurée. Ne pas présenter « latest available » comme « live ». |
| P1-9 — Stockage | **Confirmé pour le risque, estimation rejetée** | Lecture/parsing JSON et écritures complètes dans `repository.ts`, verrou avec délai sans reprise d'orphelin. La « panne dans cinq mois » n'est pas démontrée par un test de charge. PostgreSQL existe déjà ; SQLite n'est pas une obligation. |
| P1-10 — Démo publique | **Confirmé, faible gravité isolée** | `public/data/events.json` est un duplicat de démo non consommé par le code applicatif examiné. Nettoyage éventuel après inventaire ; pas une fuite de secrets démontrée. |

Autres points de la section P2 :

- **Confirmé** : `datasets=` vide peut réintroduire la démo ; imposer un défaut sûr et documenté côté serveur. Une interface prudente ne suffit pas à sécuriser le contrat API.
- **Confirmé** : paramètres invalides comme `limit=abc`, erreurs brutes et gestion d'erreurs hétérogène des routes. Normaliser validation, limites et erreurs publiques sans traces internes.
- **Confirmé/à tester** : frise temporelle, source des totaux, surlignage de fenêtre et affichage UTC/local méritent des fixtures dédiées. La frise n'est pas inexistante.
- **Confirmé** : noms de variables et aide de déploiement exposés dans Sources/Paramètres. Ce ne sont pas les valeurs des secrets. Séparer information publique de couverture et diagnostic administrateur.
- **Obsolète** : `server.log` n'est pas suivi dans le HEAD actuel. Ne pas demander sa suppression de l'index sur cette ancienne observation.
- **Rejeté comme incident serveur** : un seul listener sur le port 3005 ; les processus parent/enfant ne prouvent pas deux serveurs concurrents.
- **À traiter prudemment** : absence de politique CSP/en-têtes dédiés. Construire une politique testée avec les iframes et ressources réellement utilisées ; ne pas casser la reconnaissance Google Maps par une liste approximative.
- **À centraliser** : replis `ISO_A3=-99` / `ADM0_A3` et noms canoniques. Kosovo et territoires contestés demandent aussi une politique explicite, pas seulement un correctif technique.
- **Non prioritaire sans impact prouvé** : code mort et taille des fichiers. Ne pas supprimer `next-env.d.ts`, fichier normal de déclaration Next, au motif qu'il est généré/versionné.

## 5. AURA / OpenAI : réaudit spécifique

### A. Accès et consommation — priorité avant exposition

`src/app/api/agent/route.ts` valide les messages mais ne protège pas l'identité de l'appelant et ne vérifie ni l'origine ni le type de contenu. Le limiteur global à 20 requêtes/minute reste insuffisant pour attribuer et borner les dépenses. Le serveur local écoute sur `*:3005`.

La fixture inter-origines prouve l'acceptation par le handler, **pas une exploitation navigateur complète** : restrictions réseau privé, mixed content, navigateur et exposition du serveur restent à considérer. CORS n'est pas une authentification ; un appel HTTP direct reste possible si la route est accessible.

Décision : authentification adaptée au déploiement, contrôle d'origine/type de contenu en défense complémentaire, taille de corps bornée, délais, concurrence et budgets par utilisateur. `MAX_ROUNDS=6` borne les tours de boucle, **pas exactement six recherches web ni un plafond financier**. Ne pas prétendre sécuriser tout cela en ajoutant seulement un en-tête CORS.

### B. Nouveau défaut confirmé : fausse réussite du streaming

Dans `src/server/agent.ts`, le parseur ne distingue pas correctement :

1. texte suivi de `response.completed` ;
2. texte suivi de `response.incomplete` avec `max_output_tokens` ;
3. texte suivi d'une coupure EOF sans événement terminal.

Les trois fixtures finissent actuellement par `done`. Les deux dernières peuvent donc présenter une réponse partielle comme complète. Exiger un état terminal explicite, rendre l'incomplétude visible, gérer annulation/timeout et ne pas rejouer automatiquement une requête payante dont le résultat est incertain.

La référence officielle des événements Responses distingue bien `response.incomplete` de `response.completed` : `https://developers.openai.com/api/reference/resources/responses/streaming-events`.

### C. Contexte, citations et modèle

- AURA ne reçoit pas toujours le pays affiché à gauche : corriger le contrat de sélection avant de retoucher les prompts.
- La recherche de pays par sous-chaîne peut rapprocher Niger/Nigeria lorsqu'une correspondance exacte n'est pas trouvée : utiliser ISO3 et gérer l'ambiguïté.
- `AgentPanel.tsx:30` supprime des liens/citations dans le texte puis affiche au plus huit URL en pied. Cela ne garde pas l'association affirmation-source. Préserver les annotations et liens visibles/clickables, et inclure provenance et dates des outils internes.
- L'outil `web_search` disponible n'implique pas qu'il ait été utilisé pour chaque réponse. Afficher ce qui a réellement été recherché, pas une assurance générale de fraîcheur.
- Le modèle par défaut/configuré n'a pas été testé avec un compte OpenAI réel. **Aucune conclusion sur son existence, son accès ou la facturation effective.** Pas de remplacement aveugle de modèle ni de nouvelle clé nécessaire pour ces constats.

Référence officielle sur l'affichage des citations de recherche : `https://developers.openai.com/api/docs/guides/tools-web-search`.

## 6. Globe, clics, interface et Paramètres

**Ne pas annuler les corrections du globe.** La conversion caméra dérivée de `atan2(x,z)`, le chemin angulaire court, l'arrêt de l'inertie au focus, la capture des pointeurs et le seuil de picking de 12 pixels CSS sont présents. La géométrie passe les fixtures. Cela ne prouve pas que tout clic et toute interaction tactile sont irréprochables.

Deux causes restantes doivent être séparées de cette ancienne erreur de rotation : sélection remplacée lors de la regrille et point de focus pays approximatif. `countryCenter` dans `GlobalSituationPanel.tsx:80` choisit l'anneau ayant le plus de sommets, pas le polygone de plus grande superficie, puis moyenne les sommets. Un centre intérieur/point d'étiquette stable est préférable pour archipels ou formes concaves ; **un mauvais saut précis lié à cet algorithme n'a pas été reproduit dans cet arbitrage**.

Inspection navigateur :

- À 1280×800, le bandeau gêne les titres/navigation et AURA concurrence les contrôles de zoom/panneau droit.
- À 390×844, la navigation haute est masquée sans alternative de menu ; les panneaux latéraux se chevauchent. Pas de débordement horizontal global observé.
- Les FPS faibles de cette prévisualisation automatisée ne sont pas un benchmark matériel généralisable.
- Le bouton Paramètres du header est visible et son ouverture/fermeture fonctionne. `src/components/ui/Header.tsx:98`, `SettingsPanel.tsx:12` et le câblage `IntelApp.tsx` en sont les points d'entrée.
- Cette section est surtout une aide de configuration serveur, pas un formulaire enregistrant des préférences. L'aide FIRMS/OpenAI est incomplète. Améliorer le dialogue accessible, le focus, Échap et le retour au déclencheur ; ces parcours clavier restent à tester.

**Rapport 03 : accepter** la hiérarchie monde → pays → événement, une fiche principale, une sélection centrale, un mobile à tiroir unique et un vocabulaire lisible. **Ne pas appliquer en bloc** suppression d'onglets, refonte visuelle ou briefing vocal : ce sont des choix produit, pas des réparations indispensables.

**Rejeter** les substitutions de donnée absente par « marché stable », « calme », « aucune menace » ou « donnée stable ». Une absence de couverture ne démontre ni stabilité ni sécurité. Les indicateurs annuels Banque mondiale ne permettent pas ces conclusions. Le briefing vocal nécessite une validation séparée de l'exactitude, du coût et de la confidentialité.

## 7. Rapport 04 : quelles API ajouter réellement ?

Le catalogue est une piste d'exploration, pas une liste d'intégrations validées pour la production. Ses endpoints n'ont pas tous été retestés pendant cet arbitrage. Un HTTP 200 prouve une réponse ponctuelle, pas gratuité, droit de redistribution, quota durable, qualité ou couverture. Un 404/403/429 ne prouve pas qu'un fournisseur entier est mort, inaccessible partout ou limité à un quota global particulier.

| Domaine proposé | Décision et précautions |
|---|---|
| Conflits — UCDP/ACLED | Renforcer l'existant avant d'ajouter un doublon : dates, licences, couverture, provenance, identifiants et erreurs. Source structurée ne signifie pas vérité absolue ni bilan définitivement vérifié. |
| Société — ACLED/CAMEO | Utile pour manifestations et troubles sociaux ; distinguer événements structurés sous licence et classification de mentions médiatiques. Deux reprises de la même dépêche ne sont pas deux confirmations indépendantes. |
| Crime/sanctions — OpenSanctions | Base d'entités/listes, pas un flux d'incidents criminels ni une preuve de culpabilité. La page de licence indique CC BY-NC et des modalités commerciales : « CC-BY / gratuit / légal à 0 € » n'est pas acquis. Vérifier offre API et usage commercial. |
| Politique — RSS institutionnels | Pertinent pour annonces attribuées et datées, pas pour conclure automatiquement à une menace géopolitique. |
| Aviation — OpenSky | Mesure partielle du trafic ADS-B, pas inventaire exhaustif des aéronefs militaires ni détection de menace. Authentification, quotas, confidentialité et droits à vérifier. |
| Économie — Banque mondiale/BCE | Banque mondiale déjà intégrée avec année et source ; données annuelles, pas cours temps réel. BCE pour changes de référence ; cours financiers et redistribution à traiter séparément. |
| Catastrophes — USGS/GDACS/EONET/FIRMS | Bon candidat après séparation des couches ; séismes, alertes, événements naturels et anomalies thermiques ne sont pas la même unité. Ne pas mélanger avec les incidents de guerre. |
| Santé — OMS/DON | Bulletins de surveillance datés, pas preuve d'absence de maladie dans un pays sans bulletin. Un ancien endpoint défaillant ne suffit pas à invalider l'OMS. |
| Espace — SpaceDevs | Calendrier de lancements intéressant comme couche optionnelle ; pas indicateur intrinsèque de conflit ou d'activité militaire hostile. |
| Nucléaire — AIEA/WNN | Distinguer communiqué institutionnel et média spécialisé ; un 403 peut venir d'une protection web. Aucun contournement de contrôle d'accès recommandé. |

Correction technique importante : **`sourcecountry` de GDELT DOC filtre le pays du média, pas le pays où l'événement se déroule**. Utiliser cette option comme filtre géographique d'incident serait une nouvelle erreur. Les codes FIPS/CAMEO et ISO ne sont pas interchangeables.

Références officielles relues : `https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/` et `https://www.opensanctions.org/licensing/`. Ceci ne constitue pas une validation juridique des usages envisagés.

## 8. Nouveau constat supplémentaire : import CSV

`src/server/connectors/csvImport.ts:74` transforme une valeur numérique invalide en zéro, ne borne pas latitude/longitude et rejette `(0,0)` par test de vérité. Une date invalide fait échouer l'import ; `fetchEvents()` remonte une erreur pour le lot au lieu de conserver explicitement les fichiers valides.

Le format d'en-tête suffit aussi à attribuer `sourceDataset=acled/ucdp`, et le format ACLED reçoit `CONFIRMED`. Un fichier local compatible n'est pas pour autant un export authentifié ni une preuve de confirmation.

Décision : validation ligne par ligne, dates et coordonnées strictes, rapport des rejets, provenance d'import distincte, confiance indépendante du seul format. Impact : intégrité des données déposées par l'opérateur ; aucune attaque distante démontrée ici.

## 9. Ordre de travail recommandé et critères d'acceptation

### Étape 1 — Protéger et ne plus suraffirmer

Avant exposition publique : protéger AURA, borner les dépenses/concurrences, corriger ses états de terminaison et préserver les citations. Dans l'interface : séparer incidents documentés, articles/mentions, thermiques et démo ; afficher inconnu et couverture sans badges de sécurité inférés.

Acceptation : requêtes non autorisées refusées avant appel fournisseur ; tests de flux complet/incomplet/EOF/annulation ; aucune réponse partielle présentée comme complète ; `datasets=` n'active pas la démo ; dates de collecte et d'événement distinctes.

### Étape 2 — Identité pays et sélection stable

Centraliser ISO3, alias et contexte sélectionné, sans remplacer toute la navigation. Garder les corrections de caméra/picking. Tester France, Iran, États-Unis, Niger/Nigeria, Congo, archipels et antéméridien ; privilégier des points de focus intérieurs stables.

Acceptation : recherche, clic globe, classement et AURA parlent du même pays ; compteurs cohérents sur la même sélection ; un zoom ne change pas silencieusement l'événement inspecté ; réponse asynchrone ancienne ne remplace pas la nouvelle sélection.

### Étape 3 — Pipeline fiable et stockage maîtrisé

Corriger GDELT et CSV, exposer le retard UCDP, rendre FIRMS indépendant. Définir rétention, index/cache et seuils de passage au PostgreSQL déjà disponible selon mesure de charge. Prévoir reprise de verrou fondée sur propriétaire/lease et tests, pas suppression aveugle d'un verrou après trente secondes.

Acceptation : fixtures USA/alias, mot contenant WAR sans guerre, ville contenant iran, dates invalides, coordonnées limites, sources sans pertes humaines ; compteurs absolus/intersections explicitement testés ; aucune fusion incident automatique non justifiée.

### Étape 4 — Lisibilité et validation durable

Résoudre les chevauchements sans changer le style, un seul tiroir mobile, navigation alternative, Paramètres accessibles, séparation aide administrateur/préférences. Configurer lint et tests de non-régression avant développement supplémentaire.

Acceptation : vues 390×844 et 1280×800 utilisables, contrôles globe accessibles, navigation clavier vérifiée, tests et lint non interactifs en CI. Console et réseau réellement inspectés, non simplement absents d'un rapport tronqué.

### Étape 5 — Enrichissement sous conditions

Ajouter une seule couche utile à la fois, probablement catastrophes naturelles ou actualités politiques attribuées selon l'objectif choisi. Pour chaque source : schéma, licence, quota, coût, fraîcheur, couverture, provenance et comportement indisponible documentés. Reporter briefing vocal et multiplication des domaines tant que les étapes précédentes ne sont pas validées.

## 10. Ce qui reste non certifié

Pas de test OpenAI réel : modèle accessible, qualité factuelle des réponses, recherche effective, coût et voix restent non certifiés. Pas de validation PostgreSQL en charge, de reprise après crash réel, de revue juridique complète ou de retest intégral du catalogue externe. Pas de certification exhaustive souris/tactile ni de console propre, les captures ayant omis ces entrées.

**Conclusion : les audits ont identifié les bons grands chantiers, mais plusieurs remèdes proposés créeraient de nouvelles erreurs. La priorité n'est ni de recommencer le globe, ni de brancher dix API : c'est rendre l'existant cohérent, traçable et correctement borné.**
