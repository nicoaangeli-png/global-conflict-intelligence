# ORBITAL — correctifs de revue des flux GDELT et mondiaux

Date : 18/10/2026  
Périmètre : `gdeltEvents.ts`, `connectors/types.ts`, `server/feeds/**`, tests associés et documentation.  
Méthode : chaque constat de `revue-flux-gdelt.md` a été relu dans le code avant modification. Aucun appel réseau n'a été effectué ; les tests utilisent les fixtures locales ou des flux HTTP synthétiques en mémoire.

## Résultat constat par constat

| Constat | Vérifié ? | Correctif | Preuve automatisée |
|---|---|---|---|
| P1-1 — `DATEADDED` utilisé comme date de l'événement dans `fetchSocialFeed` | **Oui.** `publishedAt` et `occurredAt` recevaient tous deux le plus ancien `DATEADDED`, alors que la colonne représente le repérage de l'article par GDELT. | `publishedAt` conserve cette approximation de publication, explicitée par un commentaire ; `occurredAt` vaut désormais `null`. La signature de `fetchSocialFeed(): Promise<LiveItem[]>` est inchangée. | `gdelt-events.test.ts` vérifie la valeur de `publishedAt` issue de la fixture et `occurredAt === null`. |
| P1-2 — contrôle `maxBytes` après matérialisation complète | **Oui.** `fetchBytes` appelait `arrayBuffer()` avant le contrôle ; `safeFetch` et GDELT n'avaient pas de plafond effectif. | Helper commun `readResponseBytes` : contrôle préalable de `Content-Length`, lecture de `response.body` par chunks, compteur, annulation du reader et `AbortController.abort()` au dépassement. `fetchBytes` a un plafond par défaut de 5 Mio et remonte une `FeedError` lisible ; `safeFetch` a un plafond par défaut documenté de 64 Mio et remonte une `ConnectorError` ; les téléchargements GDELT 15 minutes sont explicitement bornés à 50 Mio. | Tests avec flux progressif : interruption avant la fin et signal avorté ; test `Content-Length` ; test de l'erreur normalisée des connecteurs ; constante GDELT à 50 Mio. |
| P2-1 — XLSX décompressé sans plafond | **Oui.** `inflateRawSync(raw)` n'avait aucune limite. | `maxOutputLength` de 16 Mio par entrée XML ; même limite pour une entrée ZIP stockée ; méthode de compression inconnue rejetée. | ZIP fortement compressé généré en mémoire, dont la sortie dépasse le plafond : rejet explicite « trop volumineuse ». |
| P2-2 — heure de fixing BCE inventée | **Oui.** Le code ajoutait `T14:15:00Z` à une source qui ne fournit qu'une date et le caveat prétendait une heure approximative. | `publishedAt` et `occurredAt` contiennent la date ISO `YYYY-MM-DD` seule. Le caveat dit désormais que l'heure n'est pas fournie par la source. | Test Frankfurter sur fixture : les deux champs valent exactement la dernière date disponible et le caveat mentionne l'absence d'heure. |
| P2-3 — échecs Yahoo partiels silencieux | **Oui.** Un succès parmi les symboles suffisait à renvoyer un état `ok` sans message. | Une charge de source peut désormais retourner `{ items, message }`. Yahoo conserve les cotations valides avec `status: "ok"`, mais le message liste exactement les symboles en échec. L'échec total reste une erreur. | Test avec une réponse Yahoo issue de fixture et un HTTP 503 simulé ; test de propagation d'un avertissement avec état `ok`. |
| P2-4 — homonymes de prénoms attribués comme pays | **Partiellement oui.** `Chad`, `Maurice`, `Jordan` et `Israel` nus pouvaient être attribués. En revanche, `Georgia` et `Victoria` étaient déjà absents : ces deux sous-constats étaient faux et aucun alias n'a été ajouté. `Chile` est conservé : ce terme n'est pas traité comme prénom anglais ambigu dans ce référentiel. | Suppression des quatre alias nus ambigus. `Chad`, `Jordan` et `Israel` exigent un contexte géographique/institutionnel ou un gentilé ; Maurice exige une forme non ambiguë (`Mauritius`, `île Maurice`, nom officiel). | Faux positifs testés : Chad Smith, Maurice Sendak, Michael Jordan, Israel Adesanya, Victoria Beckham, Georgia O'Keeffe. Vrais positifs testés avec contexte pour TCD/MUS/JOR/ISR ; vrai positif CHL pour Chile. |
| P2-5 — rapport affirmant que le social n'est pas branché | **Oui.** `socialSources` était déjà inclus dans `EXTRA_SOURCES` et le registre testait la catégorie. | `flux-mondiaux.md` inclut désormais `social.ts`, la source `gdelt-events`, son statut testé sur fixture et le caractère variable de son volume. Le passage « 0 élément et 0 source » a été supprimé. | Le test du registre couvre toujours toutes les catégories, dont `social`; la suite complète est verte. |

## Consommateurs de la date GDELT

La recherche dans `src/` n'a trouvé aucun consommateur exigeant que `occurredAt` soit non nul pour les éléments de `fetchSocialFeed` :

- le tri des flux utilise déjà `occurredAt ?? publishedAt` (`src/server/feeds/index.ts`) ;
- l'agent utilise le même repli (`src/server/agent.ts`) ;
- `src/server/briefing/collect.ts`, hors périmètre et donc non modifié, utilise aussi `occurredAt ?? publishedAt` avant de normaliser ses faits. Il continuera donc à dater l'article par `publishedAt`, sans présenter `DATEADDED` comme date de survenue dans le `LiveItem` source.

Les tests complets du briefing passent après la modification. Aucun fichier sous `src/server/briefing/**` n'a été touché.

## Vérifications

- Avant correction : 6 fichiers ciblés, **90 tests réussis**.
- Après correction, ciblé : `pnpm vitest run tests/gdelt-events.test.ts tests/feeds-text.test.ts tests/feeds-sources.test.ts tests/feeds-uap.test.ts tests/feeds-disaster.test.ts tests/feeds-registry.test.ts` → **6 fichiers, 99 tests réussis**.
- `pnpm typecheck` → **réussi**, aucune erreur.
- `pnpm test` → **19 fichiers réussis, 1 fichier live ignoré ; 191 tests réussis, 1 ignoré**. Le message `OpenAI 429 insufficient_quota` affiché sur stderr est le scénario simulé et attendu de `aura-agent.test.ts`, pas un appel réseau ni un échec.

## Fichiers modifiés

- `src/server/connectors/types.ts` : lecture HTTP commune bornée et plafond par défaut des connecteurs.
- `src/server/connectors/gdeltEvents.ts` : plafond 50 Mio et sémantique des dates du flux social.
- `src/server/feeds/util.ts` : lecture bornée des flux et avertissement de succès partiel.
- `src/server/feeds/xlsx.ts` : plafond de décompression.
- `src/server/feeds/economy.ts` : date BCE fidèle et visibilité des échecs Yahoo partiels.
- `src/server/feeds/countries.ts` : garde-fous sur les homonymes.
- `tests/gdelt-events.test.ts`, `tests/feeds-registry.test.ts`, `tests/feeds-uap.test.ts`, `tests/feeds-sources.test.ts`, `tests/feeds-text.test.ts` : régressions couvertes sans réseau.
- `docs/orchestration/flux-mondiaux.md` : état réel du flux social.
- `docs/orchestration/correctifs-revue.md` : présent rapport.

## Limites et hors périmètre

- Aucun test live n'a été lancé : les formats et comportements sont validés sur fixtures enregistrées et réponses synthétiques, conformément aux règles communes.
- Aucun serveur n'a été lancé, arrêté ou interrogé ; le port `:3005` n'a pas été touché.
- Aucun `next build`, aucune dépendance, aucun commit, et aucune lecture de `.env.local`.
- Aucun changement demandé hors périmètre. La dépendance générique du briefing aux dates est seulement signalée ci-dessus.
