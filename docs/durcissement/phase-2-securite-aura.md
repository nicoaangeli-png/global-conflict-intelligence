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
| `rateLimit.ts` | Contrat `RateLimitStore`, consommations groupées atomiques et backend mémoire mono-instance. |
| `postgresRateLimit.ts` | Compteurs PostgreSQL atomiques, clés SHA-256 et leases expirables multi-instance. |
| `rateLimitStore.ts` | Sélection explicite `auto | memory | postgres`, sans repli silencieux en production. |
| `budget.ts` | Admission : budget journalier de requêtes et de tokens, concurrence, débit par minute, doublons ; voix : caractères réservés puis rendus en cas d'échec. Libération idempotente. |
| `requestBody.ts` | Lecture bornée du corps (flux interrompu au dépassement, UTF-8 strict). |
| `sanitize.ts` | Nettoyage des textes externes, masquage des secrets (valeurs d'environnement sensibles, motifs de jeton), URL publiques uniquement, noms de lieux du contexte. |

Ordre dans les routes : origine → accès → format → corps borné → validation →
admission → exécution (avec `AbortSignal` relié à la déconnexion du client).

Budget de tokens : `AURA_MAX_TOKENS_PER_REQUEST` est réservé atomiquement avant
l'appel OpenAI. Quand OpenAI fournit un usage final fiable, `usage.total_tokens` est
cumulé localement et la réservation est rapprochée de cette valeur. Sans usage final
fiable (erreur réseau, annulation ou flux interrompu), aucun remboursement n'est effectué.
Deux instances ne peuvent donc pas réserver le même dernier crédit. Après un crash, la
réservation reste conservatrice jusqu'à l'expiration du jour.

## Passage à plusieurs processus

Le backend PostgreSQL réutilise `DATABASE_URL`. Les quotas sont modifiés par UPSERT
conditionnel dans une transaction ; les groupes de compteurs sont agrégés puis verrouillés
dans un ordre global avant mutation et restent tout-ou-rien. Le nettoyage opportuniste
est lancé après libération du client transactionnel : son échec dégrade la santé sans
invalider une opération déjà commitée. Les
places simultanées sont des leases avec TTL, sérialisées par advisory lock. Les tables
ne contiennent que le namespace, un SHA-256 de la clé, une valeur et une expiration :
aucune IP brute, aucun prompt, aucun texte TTS.

`AURA_RATE_LIMIT_BACKEND=auto` sélectionne PostgreSQL lorsque `DATABASE_URL` existe.
Sans base, `auto` utilise la mémoire uniquement en développement ; en production il
échoue fermé. `memory` reste disponible par choix explicite pour un seul processus.

## Configuration de production

Déjà en place sur le serveur : `AURA_ALLOWED_ORIGINS` (origine du site + boucle locale)
et `AURA_TRUST_PROXY=1` (Caddy réécrit `X-Forwarded-For`, port 3005 fermé par le
pare-feu). Aucune modification de `.env.local` nécessaire.

## Validation

- Node 22.22.0 et 24.13.0 : `pnpm test` 629 réussis / 65 ignorés,
  `pnpm typecheck` et `pnpm build` OK.
- PostgreSQL 17.10 jetable : `pnpm test:postgres` 106/106, dont les courses de
  compteurs, leases et fingerprints multi-store ; Playwright Chrome 38/38.
- Serveur de production local (`next start`) : origine `*.sslip.io` tierce 403,
  origine listée 200, `X-Forwarded-Host` falsifié 403, corps de 200 ko par morceaux 413,
  requête sans origine 403, voix sans clé : message explicite sans détail interne.

## Risques et restes

- Origine ≠ authentification : sans `AURA_ACCESS_TOKEN`, un script peut appeler AURA
  dans la limite des budgets. C'est le compromis d'un site public sans comptes.
- Le mode `memory` reste volontairement mono-instance et apparaît comme non distribué
  dans `/api/health`.
- L'historique `assistant` envoyé par le client reste falsifiable (borné en taille) ;
  le modèle le traite comme une réponse passée, sans privilège particulier.
- `safeHttpUrl` est syntaxique (aucune résolution DNS) : il n'est pas utilisé pour
  effectuer des requêtes serveur, seulement pour afficher des liens.
