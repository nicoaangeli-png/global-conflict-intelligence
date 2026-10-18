# ORBITAL — Hygiène et fiabilité du projet

Date : 18/10/2026  
Périmètre : `next.config.mjs`, `.env.example`, `.gitignore`,
`.github/workflows/ci.yml`, `README.md` et ce rapport.

## Résultat

La configuration d'environnement est documentée sans secret, des en-têtes de
sécurité globaux sont définis, les fichiers de travail sont ignorés, une CI
reproductible Node 25 / pnpm 11 est ajoutée et le README décrit les sources et
leurs limites sans présenter les signaux comme des faits certains.

## Fichiers concernés

- `next.config.mjs` : CSP, en-têtes complémentaires et suppression de
  `X-Powered-By`.
- `.env.example` : inventaire exhaustif des variables lues par `src/` et
  `scripts/`, commentaires français et valeurs vides.
- `.gitignore` : fichiers JSON/SQLite de travail, briefings, sauvegardes, logs et
  environnements locaux.
- `.github/workflows/ci.yml` : installation verrouillée, typecheck et tests.
- `README.md` : démarrage, paramètres, persistance, flux en direct et limites.
- `docs/orchestration/hygiene.md` : preuves, décisions et limites de cette mission.

## Variables d'environnement

L'inventaire couvre les accès optionnels ACLED, UCDP, FIRMS et OpenAI, les
réglages GDELT, les protections/limites AURA, le jeton d'ingestion et les trois
modes de persistance : PostgreSQL, SQLite local par défaut, ou ancien stockage
JSON demandé explicitement. Chaque valeur de `.env.example` est vide ; les
défauts indiqués dans les commentaires sont ceux du code, pas des valeurs
injectées par le fichier d'exemple.

Contrôle effectué en comparant les noms déclarés dans `.env.example` aux accès
directs `process.env.X` et aux accès dynamiques `env(...)`, `boundedNumber(...)`
et `envInteger(...)` : aucune différence au moment de la vérification.

## Politique de sécurité HTTP

Le navigateur utilise uniquement des URL relatives pour `fetch`, les données
géographiques et `EventSource("/api/stream")`. Les URL OpenStreetMap et Google
Maps sont des liens de navigation ouverts dans un nouvel onglet, pas des appels
réseau de l'application. Les appels aux fournisseurs externes (GDELT, UCDP,
FIRMS, OpenAI, Banque mondiale, Wikidata et flux mondiaux) sont exécutés côté
serveur : aucun domaine tiers n'a donc été ajouté à `connect-src`.

Directives CSP :

- `default-src 'self'` : repli limité à l'origine ORBITAL.
- `base-uri 'self'` et `form-action 'self'` : empêchent le détournement de la
  base URL et l'envoi de formulaires vers un tiers.
- `frame-ancestors 'none'` et `X-Frame-Options: DENY` : interdisent
  l'encapsulation de l'application.
- `object-src 'none'` et `frame-src 'none'` : désactivent plugins et iframes, qui
  ne sont pas utilisés.
- `script-src 'self' 'unsafe-inline'` : autorise les scripts Next et son amorçage
  inline. `unsafe-eval` est ajouté uniquement quand `NODE_ENV=development`, pour
  les outils de développement Next, jamais dans la politique de production.
- `style-src 'self' 'unsafe-inline'` : compatible avec les styles inline de Next
  et l'interface existante.
- `img-src 'self' data: blob:`, `font-src 'self' data:`,
  `media-src 'self' blob:` et `worker-src 'self' blob:` : autorisent les actifs
  locaux, données/canvas et objets mémoire utiles au rendu Three.js/WebGL sans
  ouvrir de domaine distant.
- `connect-src 'self'` : autorise les API same-origin, le fetch local et le SSE,
  mais aucun fetch navigateur vers un tiers.
- `manifest-src 'self'` : limite un éventuel manifeste à l'application.

Les autres en-têtes sont `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin` et une `Permissions-Policy`
qui refuse caméra, géolocalisation, paiement, USB et Topics. `useAuraVoice`
utilise `speechSynthesis`, qui ne requiert pas le microphone ; `AgentPanel`
utilise toutefois `SpeechRecognition` pour la dictée AURA. Le microphone reste
donc autorisé pour `self` uniquement et soumis à l'autorisation du navigateur.
`poweredByHeader: false` retire l'en-tête d'identification Next.js.

## Fichiers ignorés

Les motifs vérifiés sont :

- `data/*.json` et les variantes `data/intel-events.json.*` ;
- `data/*.sqlite*` ;
- `data/briefing/` ;
- `*.bak` et `*.log` ;
- `.env*.local` et `.env`, avec `!.env.example` pour conserver l'exemple.

Le contrôle final `git ls-files` ne retourne aucun log, `.bak`, JSON de travail,
briefing, SQLite ou `.env*.local` déjà suivi. `server.log` n'est pas versionné.
Il n'y a donc actuellement aucune commande `git rm --cached` à exécuter.

Si un de ces fichiers était réintroduit dans l'index, la commande non exécutée
serait :

```sh
git rm --cached -- <chemin-du-fichier>
```

## Intégration continue

Le workflow GitHub Actions s'exécute sur `push` et `pull_request`, avec droits de
lecture seuls. Il installe pnpm 11, Node.js 25, active le cache pnpm, puis lance :

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

Aucune clé ni aucun secret fournisseur n'est requis par cette CI.

## Sources et limites documentées

Le README distingue incidents structurés, articles GDELT, détections, alertes,
publications et cotations. Il mentionne explicitement : AARO HTTP 403 sans
contournement, ReliefWeb non utilisé car indisponible à l'accès automatisé,
ACLED indisponible sans accès approuvé, Yahoo Finance non officiel, et rapports
OVNI/GEIPAN publiés qui ne constituent pas des faits établis. Il reprend les flux
effectivement branchés décrits dans `flux-mondiaux.md` et `gdelt-events.md`.

## Preuves

### Vérifié

- Chargement de la configuration :

  ```sh
  node -e "import('./next.config.mjs').then(...)"
  ```

  Résultat : succès ; `poweredByHeader=false`, cinq en-têtes présents et
  `connect-src 'self'` confirmé.

- Format des changements : `git diff --check` — succès.
- Tests : `pnpm test` — succès, 16 fichiers réussis, 145 tests réussis et
  1 test réseau volontairement ignoré (`tests/feeds-live.test.ts`).
- Inventaire d'environnement — aucune variable manquante ou surnuméraire dans la
  comparaison automatisée.

### Non vérifié / bloqué hors périmètre

- `pnpm typecheck` échoue sur deux erreurs apparues dans le fichier concurrent
  `tests/aura-live-feeds.test.ts:43` : TS2493 (index 1 sur un tuple vide), puis
  TS2339 (`body` sur `never`). Ce fichier n'appartient pas au périmètre de cette
  mission et n'a pas été modifié ici. La CI restera rouge tant que l'équipe
  propriétaire n'aura pas corrigé ces types.
- Aucun `next build` n'a été exécuté, conformément aux règles communes.
- Le serveur du port 3005 n'a été ni interrogé, ni arrêté, ni redémarré.
- Les en-têtes n'ont pas été testés dans un navigateur en direct, afin de ne pas
  toucher au serveur partagé. Leur structure et leur valeur ont été vérifiées en
  chargeant directement la configuration Next.

## Hors périmètre restant

Corriger les deux erreurs TypeScript de `tests/aura-live-feeds.test.ts`, puis
laisser la nouvelle CI confirmer l'ensemble dans un checkout stable. Aucun autre
changement hors périmètre n'est demandé par cette mission.
