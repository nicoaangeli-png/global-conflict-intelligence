# ORBITAL — checklist de première mise en production

Cette liste prépare le déploiement ; elle n'autorise aucun déploiement à elle seule. Conserver le SHA de release, un backup vérifié et un chemin de retour avant de changer le trafic.

## Contrôles automatisables avant release

- [ ] CI verte sur le SHA exact : Node 22 et 24 (`pnpm test`, `pnpm typecheck`, `pnpm build`), PostgreSQL 17 (`pnpm test:postgres`), Playwright (`pnpm test:e2e`).
- [ ] `pnpm benchmark:detection` : comparer précision 0,750, rappel 1,000, F1 0,857 ; clustering précision 1,000, rappel 0,917, F1 0,957. Examiner toute variation, même si un seuil passe.
- [ ] `pnpm audit:deps` examiné ; corriger les vulnérabilités applicables sans mise à jour majeure aveugle.
- [ ] Migrations testées sur une copie jetable et sauvegarde PostgreSQL restaurable vérifiée. Jamais de migration destructive implicite.
- [ ] Build de production démarré localement ; `/`, `/api/health`, `/api/health/live`, `/api/health/ready`, `/api/metrics` et les parcours globe/AURA vérifiés. Tester le refus de `/api/metrics` sans jeton.
- [ ] Aucun secret, dump, `.env.local`, log ou artefact de build dans le diff/release. `git diff --check` propre.

## Préparation manuelle du VPS — non réalisée ici

- [ ] Installer Node 22 ou 24 conforme à `package.json`, pnpm verrouillé, PostgreSQL 17, reverse proxy (Caddy/nginx) et process manager/container avec redémarrage contrôlé.
- [ ] Configurer DNS, HTTPS valide, renouvellement du certificat, pare-feu, accès SSH restreint et sauvegardes chiffrées/hors hôte. HSTS n'est utile qu'une fois HTTPS opérationnel.
- [ ] Renseigner les variables serveur selon `.env.example`, hors dépôt : `DATABASE_URL`, `ORBITAL_METRICS_TOKEN`, `INGEST_TOKEN` si ingestion ouverte, `AURA_ALLOWED_ORIGINS` pour AURA et `OPENAI_API_KEY` seulement si AURA payante est voulue. Aucun `NEXT_PUBLIC_*` ne doit contenir de secret.
- [ ] En multi-instance, conserver PostgreSQL pour les rate limits et la détection ; ne pas forcer `AURA_RATE_LIMIT_BACKEND=memory`. Mettre `ORBITAL_TRUST_PROXY=1` seulement si l'application n'est accessible que derrière un proxy qui réécrit les en-têtes client.
- [ ] Protéger `/api/metrics` au proxy et configurer son Bearer token. Le point de collecte est par instance ; agréger côté Prometheus/Grafana plus tard.
- [ ] Définir taille du pool PostgreSQL, quotas, stockage persistant et rétention ; préparer un rollback applicatif compatible schéma et une restauration du backup.
- [ ] Vérifier visuellement desktop/tablette/mobile, navigation clavier, SSE après déconnexion/reconnexion, géolocalisation, AURA sans clé puis avec clé si activée. Les appels OpenAI réels doivent être validés avec une clé serveur lors de la release review.

## Après bascule — surveillance à prévoir

- [ ] Surveiller extérieurement `/api/health/live` (processus) et `/api/health/ready` (dépendances critiques). Une source secondaire stale n'est pas automatiquement une panne de readiness.
- [ ] Collecter `/api/metrics` de chaque instance ; prévoir des alertes sur 5xx, 429, latence p95, saturation SSE, AURA en erreur, sources stale, RSS/CPU/disque, PostgreSQL, certificat TLS et readiness.
- [ ] Vérifier les logs JSON expurgés, l'absence de prompt/IP/secret et les accès du proxy ; conserver une procédure d'astreinte et de rollback testée.

## CSP de production

La page HTML reçoit un nonce aléatoire par réponse pour les scripts d'hydratation Next.js ; `unsafe-eval` et `unsafe-inline` sont absents de `script-src` en production. `style-src 'unsafe-inline'` reste nécessaire aux styles de positionnement dynamiques de l'interface et des overlays React ; les scripts, frames, objets et connexions externes restent restreints. Les API gardent une CSP statique sans script inline. L'absence de `upgrade-insecure-requests` évite de casser un smoke test HTTP local ; le reverse proxy doit imposer HTTPS en production.

## Limites connues à accepter ou corriger avant Go

- Les données et métriques opérationnelles ne prouvent pas l'exactitude des événements : voir `docs/detection-benchmark.md`.
- Sans proxy de confiance, les quotas clients partagent une identité limitée ; vérifier le modèle réseau réel.
- Les notifications SSE d'ingestion et certains compteurs sont locaux à chaque instance ; un agrégateur externe sera nécessaire.
- Un test court de mémoire ou Lighthouse ne démontre pas l'absence de fuite longue durée.
