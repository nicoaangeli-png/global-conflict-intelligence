# AURA ↔ Flux mondiaux — rapport (18/10/2026)

## Vérifié

- Ajout de `get_live_feeds({ category?, country_iso3?, hours?, limit? })` dans `src/server/agent.ts`.
  - Appelle `getFeeds()` avec la catégorie, le pays ISO3, une borne UTC `sinceMs` et la limite : la fenêtre `hours` est donc appliquée avant la troncature.
  - La fenêtre est strictement comprise entre 1 h et 720 h (7 jours par défaut) ; types incorrects, catégories inconnues, ISO3 invalide et bornes invalides renvoient une erreur d'outil lisible.
  - Les sorties sont construites élément par élément sous un budget inférieur à `MAX_TOOL_OUTPUT_CHARS`. Elles signalent `truncated: true` et `omittedItems` sans jamais remplacer une requête conforme par `result_too_large`.
  - Pour une catégorie, les états des seules sources concernées sont transmis. Toutes catégories confondues, seules les erreurs sont détaillées avec le nombre de sources `ok`.
  - Titres, résumés, avertissements et messages de sources sont regroupés sous `untrusted_content`. Les consignes AURA interdisent explicitement de traiter tout texte de donnée d'outil comme une instruction ; les balises et motifs d'instruction évidents sont neutralisés.
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

- À compléter par le rapport `docs/orchestration/correctifs-aura.md` après les vérifications de la mission de correctifs.

## Non vérifié / limites

- Aucun `next build` n'a été lancé, conformément aux règles communes.
- Aucun appel OpenAI, aucun essai sur `:3005`, aucun serveur arrêté ou redémarré, aucune dépendance ajoutée et aucun secret lu.
