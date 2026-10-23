# Observabilité ORBITAL

Les métriques `GET /api/metrics` sont au format texte Prometheus 0.0.4. Elles sont **locales à chaque processus** : collecter toutes les instances puis agréger les compteurs dans Prometheus. Leur lecture ne lance ni ingestion, ni appel externe, ni écriture en base. En production, définir `ORBITAL_METRICS_TOKEN` et configurer la collecte avec `Authorization: Bearer <token>` ; sans jeton, cette route répond 503. Limiter également son accès au réseau interne. Ne pas exposer le jeton dans une URL. Aucun système de monitoring n'est déployé par cette modification.

`GET /api/health` conserve sa forme historique et ajoute `liveness` et le dernier résultat `readiness`. `GET /api/health/live` répond si Node fonctionne. `GET /api/health/ready` vérifie le stockage et le limiteur de débit requis, avec un cache de cinq secondes et un délai de réponse borné à deux secondes ; une source externe secondaire dégradée ne retire pas l'instance du trafic. La première sonde peut initialiser les migrations normales du stockage et du limiteur. Les sondes suivantes ne collectent pas les flux externes. L'état `unknown` dans `/api/health` signifie que la sonde readiness n'a pas encore été appelée ou que son dernier résultat date de plus de quinze secondes. Configurer une sonde `/api/health/ready` régulière pour que la jauge de readiness reste utile.

`ORBITAL_LOG_LEVEL` accepte `debug`, `info`, `warn`, `error` (défaut : `info`). Les journaux serveur sont des lignes JSON à champs contrôlés : horodatage, niveau, événement, sous-système, identifiant de requête, route, méthode, statut, durée et code d'erreur normalisé. Le serveur génère chaque identifiant ; l'en-tête `X-Request-Id` entrant n'est pas réutilisé. Ni contenu AURA/voix, ni IP, ni en-tête d'authentification, ni corps de requête ne sont journalisés. Les durées HTTP couvrent l'arrivée jusqu'aux en-têtes ; les flux AURA et SSE ont des métriques de cycle de vie distinctes.

Les séries utilisent uniquement des routes déclarées, des statuts et des résultats normalisés, et au plus 128 identifiants de sources contrôlés. Les compteurs et histogrammes ont des bornes fixes ; aucun historique individuel n'est retenu. `orbital_rate_limit_backend_status` renseigne l'état connu du limiteur ; `orbital_sse_active_connections` est le nombre local, pas la somme du cluster. La télémétrie est best-effort : un sink de logs indisponible ne doit pas interrompre une requête.

## Alertes initiales (à ajuster après mesure réelle)

| Niveau | Signal proposé | Première action |
| --- | --- | --- |
| CRITICAL | `orbital_readiness == 0` pendant 2 min après démarrage | Examiner `/api/health/ready`, stockage et limiteur ; ne pas relancer les collectes externes. |
| CRITICAL | `orbital_rate_limit_backend_status{status="unavailable"} == 1` pendant 1 min | Vérifier PostgreSQL et la configuration AURA ; préserver le fail-closed. |
| CRITICAL | Ratio 5xx HTTP > 5 % sur 5 min avec au moins 100 requêtes | Corréler les logs JSON par `requestId`, route et code contrôlé. |
| WARNING | Ratio 429 > 10 % sur 10 min | Examiner limites publiques/SSE et trafic légitime avant de modifier les quotas. |
| WARNING | p95 HTTP > 2 s sur 10 min pour une route | Vérifier saturation CPU, mémoire et latence du stockage. Pour les flux, consulter leur métrique de cycle de vie. |
| WARNING | Source critique `stale` ou âge du dernier succès > 3 fois sa cadence | Vérifier le connecteur et sa provenance ; ne pas inventer de donnée de remplacement. |
| WARNING | Échecs AURA > 20 % sur 10 min | Examiner codes normalisés et disponibilité du fournisseur, sans lire les prompts. |
| WARNING | SSE actifs proches de la limite ou refus SSE en hausse | Examiner clients lents, reconnexions et backpressure. |
| WARNING | RSS augmente continûment sur plusieurs heures | Comparer les instances et vérifier les clients SSE et caches ; un court benchmark ne prouve pas l'absence de fuite. |

Pour un diagnostic rapide : `readiness=0` → sonde ready et schéma ; 5xx → route/status et logs `requestId` ; 429 → quota ou saturation SSE ; source stale → dernier succès et tentative ; AURA timeout/abort → `orbital_aura_runs_total` et latence ; RSS croissant → connexions SSE actives. Les seuils sont des points de départ, non des objectifs de disponibilité garantis.
