# ORBITAL — Flux militaire, météo et infrastructures

Date de vérification : 19 octobre 2026.

## Réalisation

- `military.ts` : positions d'aéronefs militaires ADS-B publiées par adsb.lol, limitées aux positions vieilles d'au plus cinq minutes. Le pays est celui survolé via l'index Natural Earth ; aucun pays d'opérateur n'est déduit.
- `weather.ts` : alertes CAP OMM, alertes NWS `Actual` Severe/Extreme, avertissements Environnement Canada et cyclones actifs NHC. Les dates d'émission, d'effet et d'expiration viennent des sources. Un centroïde n'est calculé que lorsque la réponse contient un polygone GeoJSON.
- `infrastructure.ts` : transitions `critical` IODA des dernières 24 heures pour les entités `country` et `region`, et perturbations PortWatch en cours ou terminées depuis trente jours au plus.
- Chaque fournisseur est une source indépendante du registre : une panne produit donc un état `error` lisible via `runSource` sans casser `/api/feeds`.
- Tous les téléchargements ont délai, User-Agent et plafond d'octets. La requête ArcGIS PortWatch omet la géométrie et ne demande que les champs utiles (la réponse brute `outFields=*` mesurait 8 145 685 octets).

## Vérification réelle des sources

Commande :

```text
node --experimental-transform-types --loader /tmp/orbital-ts-loader.mjs /tmp/orbital-live-feeds.ts
```

Le script importe les trois modules et exécute chaque `FeedSourceDef`. Résultat à `2026-10-19T16:58:30.714Z` :

| Source | HTTP / état | Éléments ORBITAL | Observation |
|---|---:|---:|---|
| adsb.lol `/v2/mil` | 200 / ok | 253 | 345 aéronefs dans la première réponse brute ; seuls ceux avec position fraîche sont gardés. |
| OMM Severe Weather | 200 / ok | 1 563 | 1 953 alertes dans la réponse brute ; alertes non encore effectives, expirées et doublons Severe/Extreme du NWS retirés. |
| NWS active alerts | 200 / ok | 13 | En-tête User-Agent ORBITAL envoyé par `fetchJson`. |
| Environnement Canada | 200 / ok | 0 | Réponse brute : 11 objets, dont 2 `warning`, 1 `watch`, 8 `statement`. Les deux avertissements n'étaient effectifs qu'à 18:00 UTC, après l'appel. |
| NOAA NHC | 200 / ok | 1 | Tempête tropicale Trudy active lors de l'appel. |
| IODA | 200 / ok | 119 | Requêtes séparées `entityType=country` et `entityType=region`; transitions `critical` uniquement. L'endpoint `/outages/events` n'est pas utilisé. |
| FMI PortWatch | 200 / ok | 2 | 132 objets bruts ; deux épisodes sans date de fin (mer Rouge et détroit d'Ormuz), aucun épisode clos dans les trente derniers jours. |

L'URL CAP a été vérifiée sur un document réel : `https://severeweather.wmo.int/v2/cap-alerts/<capURL>` répond 200 en XML. Les chemins OMM peuvent être fournis dans `capURL` ou dans l'ancien champ `url`; les deux formes sont gérées. Les CAP NWS de sévérité Severe/Extreme sont écartés de l'OMM d'après leur chemin et identifiant CAP, car le flux NWS dédié les fournit. Les avis NWS Minor/Moderate restent couverts par l'OMM.

## Licences et attributions exposées

| Source | `homepage` | Licence / attribution affichée |
|---|---|---|
| adsb.lol | `https://adsb.lol/` | Open Database License (ODbL) 1.0 — attribution « adsb.lol » |
| OMM SWIC | `https://severeweather.wmo.int/` | © OMM — usage personnel non commercial ; courts extraits autorisés avec mention de la source, restrictions spécifiques possibles |
| NWS | `https://www.weather.gov/` | Domaine public (NOAA / National Weather Service) |
| Environnement Canada | `https://meteo.gc.ca/` | Licence du gouvernement ouvert – Canada |
| NOAA NHC | `https://www.nhc.noaa.gov/` | Domaine public (NOAA / National Hurricane Center) |
| IODA | `https://ioda.inetintel.cc.gatech.edu/` | Texte exact de la réponse API : `This data is Copyright (c) 2021-2025 Georgia Tech Research Corporation. All Rights Reserved.` |
| FMI PortWatch | `https://portwatch.imf.org/` | © FMI ; le service ArcGIS ne publie aucune licence explicite, donc aucune licence ouverte n'est affirmée. |

## Tests et contrôles

- `pnpm vitest run tests/feeds-military.test.ts tests/feeds-weather.test.ts tests/feeds-infrastructure.test.ts tests/feeds-registry.test.ts` : **4 fichiers, 40 tests verts**. Fixtures locales uniquement, aucun réseau.
- `pnpm typecheck` : échec limité aux deux erreurs attendues et hors périmètre dans `src/components/feeds/feedModel.ts:17` et `:31` (libellés/icônes manquants pour les trois catégories). Aucune erreur TypeScript signalée dans les modules ajoutés.
- `pnpm test` : **230 tests verts, 2 ignorés**, mais suite globale non verte pour deux causes hors périmètre : `tests/aura-live-feeds.test.ts:65` attend encore l'ancienne liste de catégories, et `tests/aura-route.test.ts` ne trouve pas le paquet `server-only`. Aucun test de cette mission n'échoue.
- `git diff --check` : propre.

## Limites honnêtes

- ADS-B ne couvre que les appareils qui choisissent d'émettre ; l'absence d'un appareil ne prouve rien. Altitude et vitesse restent les mesures brutes publiées (ft et kt).
- Le sommaire JSON OMM ne contient pas les polygones CAP : les positions OMM restent donc `null`. Les CAP individuels sont liés, pas téléchargés en masse.
- Une alerte NWS sans géométrie conserve une position `null`. Environnement Canada ne garde que `alert_type=warning`, conformément au périmètre ; les `statement` et `watch` ne sont pas présentés comme avertissements.
- La gravité d'impact des cyclones NHC n'est pas déduite de leur seule intensité : `severity` reste `null`.
- IODA est une mesure automatique, pas une attribution de cause. Si une requête pays ou région atteint 500 transitions, la source reste `ok` mais signale explicitement un résultat potentiellement partiel.
- PortWatch considère comme en cours un enregistrement sans `todate`, même ancien, et ne présente que ceux qui déclarent au moins un port ou passage affecté. La base ne publie pas de licence explicite dans ses métadonnées ArcGIS.

## Respect des règles

Aucun commit, build Next.js, lancement/arrêt de serveur, lecture de `.env.local`, ajout de dépendance ou contournement anti-robot. Aucun fichier hors périmètre n'a été modifié par cette mission.
