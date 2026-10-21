# ORBITAL — Conflict Intelligence

ORBITAL est une interface Next.js / Three.js de consultation géographique : globe
interactif, flux thématiques, fiches pays et analyse AURA. Elle rapproche des
incidents structurés, des publications, des mesures et des alertes de natures
différentes sans prétendre qu'une source réelle rend chaque information certaine.

## Démarrage

```sh
pnpm install
cp .env.example .env.local
pnpm dev
```

Prérequis : Node.js LTS (24 recommandé, voir `.nvmrc` ; 22.13 ou plus pris en
charge, `node:sqlite` l'exige) et pnpm 11. Les versions Node impaires (25…) ne sont
pas prises en charge. Le démarrage de base ne
requiert aucune clé : les sources publiques compatibles restent disponibles et
les connecteurs optionnels signalent simplement qu'ils ne sont pas configurés.

Pour une exécution de production : `pnpm build`, puis `pnpm start`.
Validation locale (identique à la CI) : `pnpm install --frozen-lockfile`,
`pnpm typecheck`, `pnpm test`, `pnpm build`, puis `pnpm audit`.
La CI (`.github/workflows/ci.yml`) exécute ces étapes sous Node 24 et Node 22 ;
toute vulnérabilité connue fait échouer l'audit, sauf exceptions nommées et
justifiées dans `pnpm-workspace.yaml`. Déploiement : `docs/deploiement.md`.
Ne pas lancer un build dans `.next` pendant qu'un serveur utilise ce dossier.

## Variables d'environnement et paramètres

`.env.example` est l'inventaire exhaustif des variables lues par `src/` et
`scripts/`. Chaque entrée indique son caractère facultatif ou obligatoire, son
défaut effectif et, pour les secrets fournisseurs, où obtenir la clé. Toutes les
valeurs de l'exemple sont volontairement vides.

Les principaux réglages sont :

- `OPENAI_API_KEY` pour activer AURA ; `OPENAI_MODEL` est facultatif ;
- `FIRMS_MAP_KEY` pour les anomalies thermiques NASA FIRMS ;
- les identifiants ACLED si un accès a été approuvé par ACLED ;
- `UCDP_ACCESS_TOKEN` pour l'API UCDP, avec repli sans clé vers GED Candidate ;
- `DATABASE_URL` pour PostgreSQL ; sinon SQLite utilise
  `data/intel-events.sqlite` (ou JSON avec `ORBITAL_STORAGE=json`) ;
- `INGEST_TOKEN` pour autoriser `POST /api/ingest`.

Copier `.env.example` vers `.env.local` et ne renseigner que les services utiles.
Ne jamais placer de secret dans une variable `NEXT_PUBLIC_*`, un commit, une
capture ou un message de chat.

Le bouton **PARAMÈTRES / SETTINGS**, dans l'en-tête, ouvre la section sources et
déploiement. `src/components/ui/Header.tsx` gère son accès,
`src/components/IntelApp.tsx` la navigation et
`src/components/ui/SettingsPanel.tsx` son contenu. Les accès fournisseurs restent
côté serveur : modifier `.env.local`, puis redémarrer le processus applicatif.

### Voix d'AURA

Le bouton ♀ du panneau AURA (et du lecteur de bilan) choisit le moteur vocal.
**Neural** fait lire les réponses par la synthèse OpenAI (`gpt-4o-mini-tts`,
route `/api/agent/voice`, clé `OPENAI_API_KEY`), segment par segment, avec
téléchargement en avance et niveau mesuré sur la sortie audio pour animer
l'hologramme. **Navigateur** garde la voix du système, gratuite et hors ligne.
Le neural bascule automatiquement sur la voix du navigateur si la clé manque,
si le budget quotidien est atteint ou en cas d'erreur réseau ; la lecture
ne bloque donc jamais une réponse. Réglages : `AURA_TTS_MODEL`,
`AURA_TTS_VOICE`, `AURA_TTS_MAX_CHARS`, `AURA_TTS_MAX_CHARS_PER_DAY`,
`AURA_TTS_REQUESTS_PER_MINUTE`, `AURA_TTS_DISABLED`.

## Sources de données en direct

- **Conflits et troubles sociaux** : UCDP GED Candidate public et GDELT Events
  2.0. GDELT classe automatiquement des articles selon CAMEO : ce sont des
  signaux de presse non confirmés, parfois bruités, jamais un bilan humain.
  ACLED est prévu par le connecteur mais reste indisponible sans accès approuvé.
- **Catastrophes** : alertes GDACS, mesures sismiques USGS et événements NASA
  EONET. ReliefWeb n'est pas utilisé : son accès automatisé était indisponible et
  aucune protection anti-robot n'est contournée.
- **Santé, espace et institutions** : bulletins OMS Disease Outbreak News,
  lancements Launch Library 2, World Nuclear News, ONU Info et communiqués ONU.
- **Économie** : taux de change Frankfurter/BCE et indices nationaux Yahoo
  Finance. Yahoo est une interface non officielle susceptible de changer ; elle
  ne convient pas à une garantie de cotation ou à une redistribution sans revue
  juridique.
- **OVNI / UAP** : rapports publiés du GEIPAN. Un témoignage publié, y compris
  classé « non expliqué », n'établit ni la matérialité du phénomène ni une origine
  extraterrestre. AARO renvoie actuellement HTTP 403 ; ORBITAL l'affiche comme
  indisponible et ne contourne pas cette protection. La page NASA UAP est une
  publication statique, pas un flux en direct.
- **Fiches pays** : Banque mondiale (population et PIB nominal) et Wikidata pour
  les dirigeants. Une absence ou un retard est affiché comme tel, jamais remplacé
  par une valeur inventée.

Les flux sont servis par `GET /api/feeds?category=&country=&limit=` et mis en
cache côté serveur selon leur cadence. Les appels aux fournisseurs sont faits par
le serveur ; le navigateur ne contacte que l'origine ORBITAL.

## Limites et interprétation

- Une source structurée ou officielle n'est pas une certification indépendante.
- Une mention presse n'est pas un incident confirmé ; une détection satellite
  n'est pas une frappe ; un rapport OVNI publié n'est pas un fait établi.
- Les dates d'événement, de publication et de collecte peuvent différer. UCDP a
  un retard de publication ; GDELT et les flux tiers peuvent être incomplets.
- L'absence d'élément dans la période ou le pays filtré ne prouve pas l'absence
  d'incident. Les quotas, licences, pannes et couvertures propres aux fournisseurs
  s'appliquent.
- Les positions GDELT peuvent désigner une ville, une région ou un centroïde de
  pays ; leur codage automatique peut produire des faux positifs.
- Les données de marché Yahoo ne sont ni un service officiel ni un conseil
  financier. Les droits de réutilisation doivent être validés avant publication.

## Données réelles et provenance

- **Données réelles uniquement** : aucun amorçage ni repli sur la démonstration.
  Les écritures locales et PostgreSQL refusent les enregistrements de démonstration
  et les sources non reconnues. Une source réelle ne garantit pas que chaque fait
  rapporté soit vérifié : provenance, date et niveau de confiance restent nécessaires.
  L'ancien fichier `data/demo-seed.json` est conservé comme archive, non chargé.
  Pour assainir un ancien stockage local, vérifier d'abord le rapport de
  `node scripts/quarantine-demo.cjs --store data/intel-events.json`, puis ajouter
  `--apply` : verrou exclusif, sauvegarde intégrale vérifiée et remplacement atomique.
  La sauvegarde `.before-real-only-*.bak` est hors du stockage actif et ignorée par Git.
  Ce script ne migre pas PostgreSQL ; vérifier son contenu séparément avant déploiement.
- Les anciennes fiches géopolitiques restent explicitement **statiques, non
  vérifiées et non datées**. Ne pas confondre leur contenu avec les indicateurs
  Banque mondiale sourcés. ORBITAL n'est pas un niveau DEFCON officiel.

La recherche des pays fonctionne même sans événements dans la période, notamment
pour l'Iran. Le référentiel Natural Earth simplifié contient 177 entrées et ne
couvre pas tous les petits États. Les favoris restent dans le navigateur.
L'absence d'événements filtrés ne signifie pas l'absence de conflit.

## Ingestion et accès aux données

- Exports CSV : déposer les fichiers dans `data/imports/`, puis déclencher
  l'ingestion authentifiée. Vérifier la provenance et les droits des exports.
- `INGEST_TOKEN` : secret serveur protégeant `POST /api/ingest?days=30`, en-tête
  `Authorization: Bearer <jeton>`. Sans configuration, POST renvoie 503 ; mauvais
  jeton 401 ; période hors 1–365 jours 400 ; déclenchements rapprochés 429.
  Ne pas inclure ce jeton dans le navigateur. GET expose uniquement l'état.

Les fournisseurs configurés sont interrogés périodiquement dans un processus
Node persistant. Un environnement serverless ne garantit ni les minuteries ni
le stockage local : prévoir un ordonnanceur serveur et PostgreSQL pour ce cas.
Les contrôles de concurrence et de fréquence sont locaux au processus, pas une
limitation distribuée. Avant exposition publique, ajouter authentification,
limitation de requêtes en amont et supervision.

## Persistance

`DATABASE_URL` active PostgreSQL. Sans cette URL, le dépôt local utilise SQLite
dans `ORBITAL_SQLITE_PATH` (par défaut `data/intel-events.sqlite`) avec journal
WAL et rétention automatique des flux volumineux. `ORBITAL_STORAGE=json` force
l'ancien dépôt dans `INTEL_STORE_PATH` (par défaut `data/intel-events.json`). Ces
fichiers de travail sont ignorés par Git. Utiliser un volume persistant et des
sauvegardes. Un fichier JSON illisible n'est pas écrasé silencieusement. Après un
arrêt brutal, vérifier qu'aucun processus n'écrit avant de retirer un éventuel
fichier `.lock`. PostgreSQL n'est pas testé sans instance configurée.

Le moteur de détection suit la même priorité : `DATABASE_URL` active son backend
PostgreSQL (tables `detection_events` et `detection_signals`, migration v4) ;
sinon il utilise `ORBITAL_DETECTION_PATH` (défaut `data/detection.sqlite`).
`ORBITAL_DETECTION_STORAGE` vaut `auto` par défaut et peut forcer `sqlite` ou
`postgres`. Une erreur PostgreSQL ne retombe jamais silencieusement sur SQLite :
le snapshot passe à `unavailable`. Plusieurs instances peuvent partager l'état
de détection via PostgreSQL. La reprise volontaire des données SQLite existantes
et la stratégie de concurrence sont décrites dans `docs/postgres-detection.md`.

## API de lecture

- `GET /api/events` : agrégats ; `GET /api/stats` : statistiques de la même sélection.
- `POST /api/cluster` : détail de l'agrégat identifié par `clusterId`.
- `GET /api/latest` : événements récents filtrés.
- `GET /api/country?iso=IRN` : indicateurs Banque mondiale ; ISO alpha-3 requis.
- `GET /api/feeds` : flux mondiaux thématiques et état de chaque source.
- `GET /api/stream` : notifications SSE, sans promesse d'exhaustivité temps réel.

Les séries utilisent des cases horaires sur 24 h, journalières sur les fenêtres
courtes et hebdomadaires sur 6 mois / 1 an. Les classements regroupent les pays
par nombre d'événements chargés et filtrés : ils ne mesurent pas un risque mondial
objectif. Les budgets militaires SIPRI nécessitent un import annuel sourcé ;
aucune API militaire ou position tactique fictive n'est ajoutée.
