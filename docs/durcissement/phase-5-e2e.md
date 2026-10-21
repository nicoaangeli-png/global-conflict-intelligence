# Phase 5 — Tests de bout en bout (2026-10-20)

## Modifications

- `tests/e2e/fixtures.ts` : API ORBITAL simulées dans le navigateur (`page.route`),
  paramétrables par scénario (panne d'une route, base vide, AURA non configurée, flux NDJSON).
  Données explicitement marquées « fixture » ; aucun appel Internet.
- `tests/e2e/scenarios.spec.ts` — 13 scénarios sur ordinateur (1440 × 900) :
  - parcours : démarrage et globe WebGL, flux récupérés, sélection d'un événement (détail et
    source), fiche pays depuis la recherche, calque activé puis désactivé, AURA avec réponse
    diffusée et sources (NDJSON simulé) ;
  - modes dégradés : AURA non configurée, OpenAI en erreur, source externe indisponible,
    source en retard (date du dernier succès), base de conflits vide, erreur réseau sur les
    flux, Banque mondiale / Wikidata indisponibles (fiche partielle), ADS-B et AIS indisponibles.
  Chaque scénario vérifie aussi l'absence d'erreur JavaScript lorsque c'est pertinent.
- `tests/empty-store.test.ts` (Vitest) : base SQLite neuve et vide, connecteurs désactivés —
  statistiques et foyers à zéro, dates nulles, aucun appel réseau.
- `playwright.config.ts` : toute la suite `tests/**/*.spec.ts` (mobile + scénarios), serveur
  configurable (`E2E_SERVER_COMMAND`), relance unique et rapport HTML en CI.
- CI : job `e2e` après `validate` — build de production, Chromium, `pnpm test:e2e`, rapport
  conservé 7 jours en cas d'échec. Scripts : `pnpm test:e2e` (tout), `pnpm test:mobile`.

## Validation

- `pnpm test` : 345 réussis (2 ignorés).
- Suite navigateur complète sur build de production (`next start`), comme en CI : 24/24
  (11 mobiles + 13 scénarios).
- Le job CI lui-même n'a pas encore tourné (branche non poussée).

## Restes

- Les scénarios n'exercent pas le serveur réel derrière les routes (simulées par conception) ;
  le serveur est couvert par les tests Vitest des routes et services.
- Pas de test visuel par comparaison d'images (fragile avec WebGL) : captures manuelles.
