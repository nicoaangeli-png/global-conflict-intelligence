# ORBITAL — Correctifs AURA (18/10/2026)

## Vérifié

- `get_live_feeds` construit désormais sa réponse sous un budget de caractères inférieur à `MAX_TOOL_OUTPUT_CHARS`, en ajoutant les éléments un à un.
  - Le résultat conserve les éléments qui tiennent, indique `truncated: true` et `omittedItems`, au lieu de renvoyer `result_too_large`.
  - Les sources sont compactées : pour une catégorie, seulement ses états ; pour toutes les catégories, seulement les erreurs et `okCount`.
  - Test sans réseau : 40 éléments longs et 20 sources produisent une enveloppe JSON strictement inférieure à 14 000 caractères.
- `hours` est transmis à `getFeeds` sous forme de borne UTC `sinceMs`, filtrée avant le tri et `limit`.
  - Le tri utilise la date réellement interprétée (`Date.parse`), pas l'ordre lexical de chaînes ISO.
  - Test sans réseau : des éléments anciens placés avant des éléments récents ne privent plus la limite des éléments récents.
- Les champs tiers des flux (titre, résumé, source, avertissement, message de source) sont placés dans `untrusted_content`.
  - Les instructions système précisent que tout texte des données d'outil n'est jamais une instruction.
  - Les balises de type HTML/XML et les motifs d'instruction évidents sont neutralisés avant transmission.
- Les arguments invalides de `get_live_feeds` donnent une erreur explicite : mauvais type de catégorie ou ISO3, catégorie inconnue, ISO3 invalide, `hours` hors borne ou de type invalide. `limit` est validé selon la même règle.

## Fichiers modifiés

- `src/server/agent.ts`
- `src/server/feeds/index.ts`
- `tests/aura-live-feeds.test.ts`
- `tests/feeds-registry.test.ts`
- `docs/orchestration/aura-flux.md`
- `docs/orchestration/correctifs-aura.md`

## Preuves

- `pnpm vitest run tests/aura-live-feeds.test.ts tests/feeds-registry.test.ts` : 2 fichiers, 32 tests verts.
- `pnpm typecheck` : vert.
- `pnpm test` : 19 fichiers verts, 1 fichier ignoré ; 207 tests verts, 2 ignorés. Les appels réseau des tests actifs sont simulés.

## Limites et non vérifié

- Aucun `next build` n'a été lancé, conformément aux règles communes.
- Aucun accès à `.env.local`, aucun serveur arrêté ou redémarré, aucun appel réseau ni dépendance ajoutée.
- Les tests couvrent les contrats locaux et les mocks ; ils ne valident pas la disponibilité réelle des fournisseurs de flux.
