# Phase 4 — Découpage des gros modules (2026-10-20)

Règle suivie : ne séparer que lorsqu'une responsabilité claire existe, sans réécrire la
logique (extraction mécanique), et ajouter des tests sur ce qui devient testable seul.

| Fichier | Avant | Après | Décision |
|---|---|---|---|
| `src/server/agent.ts` | 1 090 | 368 | Découpé (voir ci-dessous) |
| `src/components/globe/GlobeScene.tsx` | 758 | 617 | Caméra extraite |
| `src/components/agent/AgentPanel.tsx` | 759 | 588 | Rendu des réponses et lecture NDJSON extraits |
| `src/components/feeds/CountryPanel.tsx` | 610 | 554 | Chargement des données extrait |
| `src/store/useIntelStore.ts` | 529 | 529 | Conservé |

## AURA (`src/server/aura/`)

`agent.ts` ne garde que l'orchestration (tours OpenAI, exécution d'outil avec enveloppe,
provenance, état terminal). Extraits : `types.ts` (contrats NDJSON), `config.ts` (limites,
constantes), `context.ts` (contexte de l'écran), `prompt.ts` (consignes), `errors.ts`,
`sse.ts` (lecture du flux OpenAI), `tools/definitions.ts` (schémas), `tools/run.ts`
(exécution : appelle uniquement les services métier — base de conflits, flux, santé des
sources, Wikidata, Banque mondiale, OpenSky), `tools/liveFeeds.ts`, `tools/country.ts`.
`@/server/agent` réexporte l'API historique : aucune route ni aucun test modifié.

## Globe

`GlobeCamera.ts` (`GlobeCameraController`) : état sphérique, inertie, rotation automatique,
molette / trackpad / pincement, recentrage, boutons — sans WebGL, 7 tests. Le composant ne
fait plus que brancher les événements et le cycle de vie Three.js. Formules identiques ;
vérifié au navigateur (glisser, zoom molette, retour à la vue initiale).

Non extrait : la priorité de sélection (mobile > flux > calque > pays), deux appels courts
liés aux références des calques ; un module dédié serait artificiel.

## AURA côté client

`auraTranscript.tsx` (types des tours, citations, provenance, historique) et
`src/lib/ndjson.ts` (lecture du flux, 2 tests : coupures de lignes et de caractères
multi-octets, lignes illisibles).

## Fiche pays

`useCountryData.ts` : flux du pays, indicateurs, calques ; chaque source échoue isolément.

## Magasin Zustand conservé

`useIntelStore` (529 lignes) regroupe des tranches cohérentes et interdépendantes (thème ↔
flux, filtres ↔ foyers, sélection ↔ calques). Un découpage en tranches déplacerait le code
sans réduire le couplage ; à reconsidérer si une tranche grossit (voir phase 6 : abonnements).

## Validation

`pnpm typecheck` OK ; `pnpm test` 344 réussis (2 ignorés), dont 9 nouveaux ; tests
navigateur mobiles 11/11 ; `pnpm build` code 0 ; captures (globe, fiche pays, AURA) sans
erreur JavaScript.
