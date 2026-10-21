# Contribuer à ORBITAL — branches, validations, release

## Rôle des branches

- **`main`** : branche stable et protégée. Tout ce qui y entre a passé la CI complète
  et peut être déployé. Aucun push direct, aucun force push, aucune suppression.
- **Branches de travail** : une branche par sujet, créée depuis `main`
  (`feat/…`, `fix/…`, `chore/…`, `docs/…`). Elles entrent dans `main` par pull request.
- Une branche fusionnée est conservée quelques jours si elle a été déployée, comme
  point de récupération, puis supprimée.

Messages de commit : `type(portée): description` en français (`feat`, `fix`, `perf`,
`refactor`, `test`, `docs`, `chore`), comme l'historique existant.

## Validations requises avant fusion

La pull request ne peut être fusionnée que si les cinq contrôles de la CI sont verts
sur une branche à jour avec `main` :

| Contrôle | Ce qu'il vérifie |
|---|---|
| Valider (Node 24) / Valider (Node 22) | installation verrouillée, `pnpm typecheck`, `pnpm test`, `pnpm build` |
| Contrôler les dépendances | `pnpm audit` (exceptions nommées et justifiées dans `pnpm-workspace.yaml`) |
| Tests de bout en bout (navigateur) | Playwright sur le build de production, API simulées |
| Migrations PostgreSQL (base réelle) | migrations sur PostgreSQL 17 |

Les conversations de revue doivent être résolues. Un test n'est jamais désactivé ni
assoupli pour faire passer la CI sans justification écrite dans la pull request.

En local, avant d'ouvrir la PR (Node 22 ou 24, voir `.nvmrc` et `engines`) :

```sh
pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build
pnpm test:e2e        # PLAYWRIGHT_CHANNEL=chrome si Chromium de Playwright n'est pas installé
```

Aucune donnée de démonstration, aucun secret dans le dépôt : les tests utilisent des
fixtures explicitement marquées, les secrets vivent dans `.env.local` (jamais versionné).

## Stratégie de fusion

- **Merge commit** pour les branches d'intégration ou de durcissement en plusieurs
  commits significatifs : les SHA validés par la CI restent inchangés dans `main`,
  et le retour arrière se fait d'un seul `git revert -m 1 <merge>`.
- **Squash** pour une petite branche de travail (un sujet, commits intermédiaires sans
  valeur propre).
- Pas de « rebase and merge » : GitHub réécrit alors les commits (nouveaux SHA), ce qui
  casse le lien avec les exécutions de CI validées.

## Avant un déploiement

1. Le SHA à déployer est sur `main` et sa CI est verte.
2. Les sources sont exportées depuis ce SHA, jamais depuis un dossier de travail local
   (`git archive` ou `git worktree`, voir [docs/deploiement.md](docs/deploiement.md)).
3. Sauvegarde de `data/` (SQLite) ou `pg_dump` (PostgreSQL) avant la bascule.
4. Variables d'environnement nouvelles ou renommées : comparer `.env.example` avec le
   `.env.local` du serveur.
5. Après bascule : `GET /api/health`, contrôle visuel ordinateur et téléphone, et le SHA
   déployé est noté (fichier `REVISION` à la racine de l'installation).
