# Phase 2 — Sécurité d'AURA (2026-10-20)

## Constat de l'audit

| # | Problème | Gravité |
|---|---|---|
| 1 | `*.sslip.io` et toute adresse IP littérale acceptés comme hôtes/origines | haute |
| 2 | `X-Forwarded-For`, `CF-Connecting-IP`, `X-Forwarded-Host` crus sans condition : contournement des limites par client hors proxy | haute (atténuée en production : pare-feu + Caddy réécrit XFF) |
| 3 | Corps lu entièrement avant contrôle de taille s'il est transmis par morceaux ; voix sans contrôle après lecture | moyenne |
| 4 | Jeton de concurrence libéré deux fois (fin de flux + annulation) → dépassement possible | moyenne |
| 5 | Appel OpenAI poursuivi après déconnexion du client (tokens consommés pour rien) | moyenne |
| 6 | Budget en nombre de requêtes seulement, aucun suivi des tokens | moyenne |
| 7 | Message d'erreur interne renvoyé au client ; détail d'erreur OpenAI renvoyé par la voix | basse |
| 8 | Nom de pays / localité en texte libre inséré dans les consignes système | basse (déjà nettoyé, mais pas restreint) |
| 9 | URL de sources : identifiants, hôtes locaux ou privés acceptés | basse |

Déjà correct et conservé : enveloppe `untrusted_external_data` des sorties d'outils,
neutralisation des motifs d'instruction, bornes des messages, budget d'appels d'outils,
délais, `OPENAI_API_KEY` uniquement côté serveur (jamais `NEXT_PUBLIC_*`).

## Architecture (`src/server/aura/`)

Chaque couche est séparée et testable isolément :

| Module | Responsabilité |
|---|---|
| `origin.ts` | Contrôle d'origine (navigateur : CSRF, DNS rebinding). **Pas une authentification.** Allowlist stricte `AURA_ALLOWED_ORIGINS`, boucle locale, aucun joker. |
| `access.ts` | Authentification facultative `AURA_ACCESS_TOKEN` (Bearer, comparaison à durée constante). |
| `clientIdentity.ts` | Clé de limitation du client. Aucun en-tête cru sans `ORBITAL_TRUST_PROXY=1` (alias `AURA_TRUST_PROXY`) ; derrière le proxy : entrée XFF la plus à droite. |
| `rateLimit.ts` | Interface `RateLimitStore` (fenêtres fixes, jetons de concurrence) + `MemoryRateLimitStore`, **non distribué**, signalé au démarrage en production. |
| `budget.ts` | Admission : budget journalier de requêtes et de tokens, concurrence, débit par minute, doublons ; voix : caractères réservés puis rendus en cas d'échec. Libération idempotente. |
| `requestBody.ts` | Lecture bornée du corps (flux interrompu au dépassement, UTF-8 strict). |
| `sanitize.ts` | Nettoyage des textes externes, masquage des secrets (valeurs d'environnement sensibles, motifs de jeton), URL publiques uniquement, noms de lieux du contexte. |

Ordre dans les routes : origine → accès → format → corps borné → validation →
admission → exécution (avec `AbortSignal` relié à la déconnexion du client).

Budget de tokens : `usage.total_tokens` de chaque réponse OpenAI est cumulé par
requête (au-delà de `AURA_MAX_TOKENS_PER_REQUEST`, plus de nouveau tour d'outils) et
par jour UTC (au-delà de `AURA_DAILY_TOKEN_BUDGET`, nouvelles questions refusées).
Le cumul journalier est enregistré à chaque tour : des requêtes simultanées peuvent
dépasser le budget d'au plus leur propre consommation en cours (borné par la concurrence).

## Passage à plusieurs processus

Implémenter `RateLimitStore` sur un magasin partagé (Redis : `INCRBY` + `PEXPIRE` pour
`consume`, `INCR`/`DECR` avec plafond pour `acquire`/`release` ; PostgreSQL : table
`(key, value, expires_at)` + `INSERT … ON CONFLICT … RETURNING`) puis l'installer via
`setRateLimitStore`. Aucune route à modifier.

## Configuration de production

Déjà en place sur le serveur : `AURA_ALLOWED_ORIGINS` (origine du site + boucle locale)
et `AURA_TRUST_PROXY=1` (Caddy réécrit `X-Forwarded-For`, port 3005 fermé par le
pare-feu). Aucune modification de `.env.local` nécessaire.

## Validation

- `pnpm typecheck` OK ; `pnpm test` : 325 réussis (2 ignorés), dont 22 nouveaux tests
  (`tests/aura-security.test.ts`, `tests/aura-voice-route.test.ts`, ajouts à
  `tests/aura-route.test.ts`) ; `pnpm build` code 0.
- Serveur de production local (`next start`) : origine `*.sslip.io` tierce 403,
  origine listée 200, `X-Forwarded-Host` falsifié 403, corps de 200 ko par morceaux 413,
  requête sans origine 403, voix sans clé : message explicite sans détail interne.

## Risques et restes

- Origine ≠ authentification : sans `AURA_ACCESS_TOKEN`, un script peut appeler AURA
  dans la limite des budgets. C'est le compromis d'un site public sans comptes.
- Limitation en mémoire : correcte pour l'unique processus actuel, pas pour plusieurs.
- L'historique `assistant` envoyé par le client reste falsifiable (borné en taille) ;
  le modèle le traite comme une réponse passée, sans privilège particulier.
- `safeHttpUrl` est syntaxique (aucune résolution DNS) : il n'est pas utilisé pour
  effectuer des requêtes serveur, seulement pour afficher des liens.
