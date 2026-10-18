# Revue croisée — flux GDELT et flux mondiaux

- **Mission** : relecture croisée (lecture seule) des deux derniers commits, défauts réels classés P0/P1/P2.
- **Périmètre** : `3f4aead4` (feat gdelt : `gdeltEvents.ts`, `country.ts`, `gdelt.ts`, `intel.ts`, `types/conflict.ts`, `tests/gdelt-events.test.ts`) et `0639d3db` (feat feeds : `src/server/feeds/**`, `src/app/api/feeds/route.ts`, `src/types/feeds.ts`, `tests/feeds-*`), plus les rapports `gdelt-events.md` et `flux-mondiaux.md`.
- **HEAD** : `0639d3db`. Hors périmètre : les nombreux fichiers modifiés/non commités par d'autres agents (`src/components/feeds/`, `tests/ui-feeds.test.ts`, `src/server/agent.ts`, `intel.ts`…) — signalés sans être notés.
- **Preuves exécutées** : `pnpm test` → `180 passed | 1 skipped` (dont `gdelt-events.test.ts` 31 et tous les `feeds-*` verts) ; `pnpm typecheck` → **OK** (l'erreur `agent.ts` vue plus tôt a été corrigée entre-temps par un autre agent). Formats des sources live validés une fois (WHO OData, UN News/Press RSS FR/EN, WNN, Frankfurter `base:"EUR"`, GDACS `alertlevel`/`iso3`) ; xlsx GEIPAN relu. Table FIPS 10-4 et mapping CAMEO recoupés avec les sources de référence.

---

## P0 — aucun

Aucun défaut faux/dangereux retenu. Points sensibles vérifiés et jugés corrects (détail en fin de document) : table FIPS 10-4 (Niger/Nigeria `NG`/`NI`, RDC/Congo `CG`/`CF`, Soudan/Soudan du Sud `SU`/`OD`, Dominique/Rép. dominicaine `DO`/`DR`, Iran `IR`, Guinée/Guinée-Bissau/Guinée équatoriale `GV`/`PU`/`EK`), mapping CAMEO (141–145, 18x, 19x, 20x), absence de bilan humain sur les mentions presse, et résolution « Congo »/« Georgia » volontairement non attribuée.

---

## P1

### P1-1 — `occurredAt` reçoit la date d'observation GDELT et est présentée comme la date de l'événement

- **Fichier** : `src/server/connectors/gdeltEvents.ts:597-598` (voir aussi `:388` et `:233`).
- **Fait** : `publishedAt` et `occurredAt` valent tous deux `first`, le plus ancien `eventDate` du groupe d'articles. Or `eventDate = m.firstSeen = row.addedAt`, et `addedAt` provient de la colonne 59 `DATEADDED`, que le code décrit lui-même (`gdeltEvents.ts:32`, `:387`) comme « instant où GDELT a vu l'article » — une date d'**ingestion/observation par la source**, pas la date de l'événement. `LiveItem.occurredAt` est documenté (`src/types/feeds.ts:50-51`) comme « Date de l'événement lui-même (séisme, lancement…) ou null ».
- **Scénario concret** : une manifestation survenue il y a trois semaines est reprise aujourd'hui par un fil de presse ; GDELT l'ingère aujourd'hui. L'item sort avec `occurredAt` = aujourd'hui, et `getFeeds` trie par `occurredAt ?? publishedAt` (`src/server/feeds/index.ts:50`) : le flux la place **en tête** comme un fait du jour.
- **Contraste** : tous les autres flux presse mettent `occurredAt: null` car un article n'a pas de date d'événement (`nuclear.ts:21`, `un.ts:28`, `health.ts:36`). Le choix GDELT est l'exception.
- **Correctif attendu** : `occurredAt: null` (conserver `publishedAt = DATEADDED`, éventuellement libellé « première observation GDELT » côté UI, comme le suggère `docs/orchestration/gdelt-events.md:25`). Règles 1 et 2.

### P1-2 — Le plafond `maxBytes` ne borne pas la mémoire

- **Fichier** : `src/server/feeds/util.ts:34-35`.
- **Fait** : le corps entier est matérialisé par `await response.arrayBuffer()` **avant** le contrôle `buffer.byteLength > options.maxBytes`. Le plafond est donc purement décoratif : une réponse anormalement volumineuse (ou un fichier qui grossit côté source) est intégralement chargée en RAM avant d'être rejetée.
- **Même lecture non bornée** : `src/server/connectors/gdeltEvents.ts:429` (`Buffer.from(await res.arrayBuffer())`) et `src/server/connectors/types.ts:33-53` (`safeFetch` renvoie la `Response` brute, consommée ensuite par `arrayBuffer()`), sans aucun plafond.
- **Scénario concret** : la source se met à servir un fichier de plusieurs Go (ou un zip très compressé) → pic mémoire / OOM du process Node qui sert `/api/feeds` et l'ingestion des conflits.
- **Correctif attendu** : lire `response.body` en flux en cumulant les octets et en avortant dès dépassement de `maxBytes`.

---

## P2

### P2-1 — Décompression xlsx sans plafond (zip bomb)

`src/server/feeds/xlsx.ts:38` : `inflateRawSync(raw)` sans `maxOutputLength`. Une entrée zip forgée ou corrompue peut produire une sortie arbitrairement grande et épuiser la mémoire. Le chemin GDELT plafonne pourtant à 200 Mo (`unzipFirstEntry`) : le plafond manque ici. Correctif : `inflateRawSync(raw, { maxOutputLength: N })`.

### P2-2 — Heure de publication inventée pour le fixing BCE

`src/server/feeds/economy.ts:77-78` : `publishedAt`/`occurredAt` = `${last}T14:15:00Z`. Frankfurter ne fournit que la **date** ; l'heure 14:15 est inventée. Le `caveat` du même item (`:85`) annonce « fixing quotidien vers 16 h CET », ce qui contredit `14:15Z` (15:15 en hiver, 16:15 en été). Règle 1 (aucune donnée inventée). Correctif : `T00:00:00Z` ou ne pas prétendre à une heure précise.

### P2-3 — Échecs partiels Yahoo rapportés comme `ok`

`src/server/feeds/economy.ts:208-222` : `hardFailure` n'est levé que si **tous** les symboles échouent. Si un seul indice répond, la source renvoie `status:"ok"` avec moins d'items et aucun message ; les indices manquants sont invisibles pour l'utilisateur. Correctif : signaler un message partiel (`stale`/mention) lorsque `items.length < STOCK_INDICES.length`.

### P2-4 — Homonymes de prénoms attribués comme pays

`src/server/feeds/countries.ts:130` (`MUS|Mauritius|Maurice`) et `:52` (`TCD|Chad|Tchad`) : « Maurice » (prénom français) et « Chad » (prénom anglais) sont des alias matchés en mot entier → fausse attribution MUS/TCD sur un titre qui les emploie comme prénom. L'en-tête du fichier (`countries.ts:12`) revendique pourtant que « les noms ambigus (Georgia, Congo seul, Guinea-pig…) sont volontairement absents ». « Maurice » est bien le nom français de l'île, mais l'alias nu est risqué. Correctif : exiger « île Maurice » et retirer les prénoms nus.

### P2-5 — Rapport `flux-mondiaux.md` périmé (contredit le code livré)

`docs/orchestration/flux-mondiaux.md:67-68` affirme que `?category=social` renvoie « pour l'instant 0 élément et 0 source » et que `socialSources` reste à brancher. Le code livré fait déjà l'inverse : `src/server/feeds/index.ts:18` déclare `EXTRA_SOURCES = [...socialSources]` et `tests/feeds-registry.test.ts:35-40` vérifie que la catégorie « social » est couverte. La source `gdelt-events` est également absente du tableau des sources du rapport. Artefact de revue incohérent avec le commit `0639d3db`.

---

## Non-retrouvé / vérifié sans défaut (pour éviter les doublons de contrôle)

- **SSRF / injection d'URL** : `/api/feeds` (`src/app/api/feeds/route.ts:8-12`) n'accepte que `category`/`country`/`limit` ; aucune URL fournie par l'utilisateur n'atteint `fetch`. Pas de SSRF.
- **Exception non rattrapée cassant `/api/feeds`** : `runSource` (`src/server/feeds/util.ts:215-273`) n'échoue jamais ; `getFeeds` a un `Promise.allSettled` de secours (`index.ts:74-96`) et la route un `try/catch` (`route.ts:11-16`).
- **Entités HTML, CSV entre guillemets, colonnes GDELT/GKG, géo-précision, titres jamais fabriqués, `fatalities: 0` = non applicable, AARO toujours `error`/honnête, GEIPAN `published_report` + caveats** : relus et jugés corrects.

## Hors périmètre (signalé, non noté)

- `src/server/agent.ts` (et plusieurs composants/`intel.ts`/`repository.ts`) sont modifiés/non commités par d'autres agents. `pnpm typecheck` est actuellement **vert** ; l'échec `agent.ts:872 Cannot find name 'TOOLS'` observé en début de revue ne provenait pas des deux commits examinés.
