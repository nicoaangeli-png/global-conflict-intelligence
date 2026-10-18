# AURA ↔ Flux mondiaux — rapport (18/10/2026)

## Vérifié

- Ajout de `get_live_feeds({ category?, country_iso3?, hours?, limit? })` dans `src/server/agent.ts`.
  - Appelle `getFeeds()` avec la catégorie, le pays ISO3 et une limite bornée à 40.
  - La fenêtre est bornée entre 1 h et 720 h (7 jours par défaut) ; les éléments sans date propre ou hors fenêtre ne sont pas transmis.
  - Les sorties sont compactes : titre, résumé tronqué, source, nature, date et son type, pays ISO3, URL HTTP(S), avertissement et métrique.
  - Les états de toutes les sources de la catégorie sont transmis, y compris `error`, `stale` et `not_configured`, avec leur message nettoyé.
  - Les textes et URL des flux passent par les mêmes protections que les autres outils AURA : caractères de contrôle et motifs d'instruction retirés, URLs non HTTP(S) écartées, taille bornée.
- Les instructions d'AURA imposent maintenant la consultation préalable des outils internes pour l'actualité, avant `web_search`, et rappellent les limites des articles de presse, signalements UAP publiés et cotations Yahoo.
- `get_country_activity` transmet maintenant `title` et `geoPrecision` des enregistrements GDELT 2.0 lorsqu'ils sont présents.
- Portage Vitest, sans réseau, des contrôles AURA durables auparavant sous `/tmp/aura-tests` : streaming/terminaux, erreurs HTTP, citations, historique du panneau, contexte pays, appels d'outils et route NDJSON. Les nouveaux scénarios flux utilisent `tests/fixtures/aura/live-feeds.json` et un mock de `getFeeds()`.

## Fichiers modifiés ou ajoutés

- `src/server/agent.ts`
- `tests/aura-agent.test.ts`
- `tests/aura-live-feeds.test.ts`
- `tests/aura-panel.test.ts`
- `tests/aura-route.test.ts`
- `tests/fixtures/aura/live-feeds.json`
- `docs/orchestration/aura-flux.md`

## Preuves

- `pnpm vitest run tests/aura-agent.test.ts tests/aura-live-feeds.test.ts tests/aura-panel.test.ts tests/aura-route.test.ts` : 18 tests verts.
- `pnpm typecheck` : vert.
- `pnpm test` : 19 fichiers verts, 180 tests verts, 1 test live ignoré ; aucun appel réseau pour les tests actifs.

## Non vérifié / limites

- Aucun `next build` n'a été lancé, conformément aux règles communes.
- Aucun appel OpenAI, aucun essai sur `:3005`, aucun serveur arrêté ou redémarré, aucune dépendance ajoutée et aucun secret lu.
