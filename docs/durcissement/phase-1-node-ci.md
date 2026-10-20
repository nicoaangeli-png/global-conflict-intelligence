# Phase 1 — Node LTS et CI complète (2026-10-20)

## Modifications

- **Node.js 25 → LTS** : `.nvmrc` = 24 ; `package.json` `engines.node` =
  `^22.13.0 || ^24.0.0` (22.13 : `node:sqlite` sans option). Le serveur de
  production tourne en Node 22.23 (LTS maintenue jusqu'en avril 2027) : il reste
  compatible, sa mise à niveau vers 24 est recommandée mais non effectuée (serveur
  partagé avec d'autres applications).
- `@types/node` reste en 22 : empêche d'utiliser une API absente de la plus
  ancienne version prise en charge.
- **vitest 3.2 → 4.1** : corrige 2 alertes critiques (tinypool) et 2 modérées
  (vitest, @vitest/mocker). Aucune modification de test nécessaire.
- **CI** (`.github/workflows/ci.yml`) :
  - job `validate`, matrice Node 24 + 22, `fail-fast` : installation verrouillée,
    typecheck, tests, build de production ;
  - job `dependencies` : `pnpm audit` (dépendances de production **et** de
    développement), bloquant ;
  - cache pnpm via `actions/setup-node` (clé = `pnpm-lock.yaml`), `concurrency`
    annule les pipelines obsolètes d'une même branche.
- **Exceptions d'audit** (`pnpm-workspace.yaml`, `auditConfig.ignoreGhsas`) :
  - GHSA-vfj7-8cjw-p6xm (`braces`, via tailwindcss > chokidar) : le correctif
    annoncé (3.0.4) n'est pas publié ; motifs de glob = notre configuration ;
  - GHSA-rj75-hqrm-r3gf (`postcss-selector-parser` via tailwindcss 3) : correctif
    seulement en 7.x, incompatible ; n'analyse que notre propre CSS à la compilation.
  Les deux disparaîtront avec une migration tailwindcss 4 (hors périmètre : risque visuel).
- Documentation : `README.md` (prérequis, validation), `docs/deploiement.md`.

## Validation

Copie propre du dépôt, Node 24.22.0 puis Node 22.23.3 :
`pnpm install --frozen-lockfile` OK, `pnpm typecheck` OK, `pnpm test` 303 réussis
(2 ignorés), `pnpm build` code 0, `pnpm audit` code 0 (2 exceptions nommées).
La CI GitHub elle-même n'a pas encore tourné (branche non poussée).

## Restant

- Pas de lint : `next lint` est déprécié dans Next 15.5 et ESLint n'est pas
  installé. Le script `lint` existant ne fonctionne pas ; à traiter avec un choix
  explicite (ESLint flat config ou suppression).
- Tests navigateur Playwright pas encore dans la CI (phase 5).
