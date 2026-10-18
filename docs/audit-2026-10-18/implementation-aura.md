# ORBITAL — Implémentation AURA (audit 05, section 5)

Date : 18 octobre 2026. Périmètre : `src/server/agent.ts`, `src/app/api/agent/route.ts`, `src/components/agent/AgentPanel.tsx` (le panneau réellement importé par `IntelApp.tsx` ; `src/components/ui/AgentPanel.tsx` n'existe pas) et ce document.

Aucun appel OpenAI réel, aucun secret lu ou modifié, aucune nouvelle clé, aucun changement de modèle (`OPENAI_MODEL`, défaut `gpt-5.6-terra`, inchangé et **non vérifié** contre un compte réel), aucun commit, aucun `.next`, aucun redémarrage.

## 1. Ce qui a été corrigé

| Constat de l'audit | Correction |
|---|---|
| Fausse réussite du flux (§5.B) | Un seul état terminal par échange : `done` (uniquement `response.completed` sans appel d'outil en attente et texte non vide), `incomplete` (`response.incomplete`, ou limite de tours d'outils), `error` (`response.failed`, événement `error`, EOF sans événement terminal, inactivité, délai global, HTTP non 2xx, réponse vide). Le route garantit aussi un terminal si l'agent n'en émet pas. Annulation client : aucun terminal, requête OpenAI annulée. Aucun rejeu automatique d'une requête payante. |
| Bornes (§5.A) | Corps 64 Ko (Content-Length puis lecture bornée), 12 messages, 2 000 car./question, 12 000 car./réponse en historique, 24 000 car. au total, `max_output_tokens` 3 000 (`AURA_MAX_OUTPUT_TOKENS`, 600–6 000), `max_tool_calls` 4 (outils intégrés), 5 tours maximum (le dernier force `tool_choice: "none"`), 4 appels de fonction par tour et 8 au total (les excédentaires reçoivent une erreur explicite pour que chaque `call_id` soit répondu), délai global 90 s, inactivité du flux 40 s, 20 s par outil, SSE ≤ 1 Mo. |
| Concurrence / débit | 2 analyses simultanées au total, 1 par client, 6/min par client, 20/min global, 300/jour global (variables `AURA_MAX_CONCURRENT`, `AURA_CLIENT_PER_MINUTE`, `AURA_GLOBAL_PER_MINUTE`, `AURA_DAILY_LIMIT`). Créneau libéré à la fin, à l'annulation du client et sur erreur. 429 avec `Retry-After`. |
| Origine / type de contenu | Voir §3. Tout refus intervient avant lecture du corps et avant tout appel OpenAI. |
| Pays sélectionné (§5.C) | `normalizeContext()` côté serveur et `canonicalCountryIdentity()` côté panneau, via `@/lib/geo/country` partagé : ISO3 canonique transmis au modèle et aux outils. Les outils pays acceptent `iso3` (prioritaire) et `country` ; **plus aucune recherche par sous-chaîne** : Niger ≠ Nigeria, iso3/nom incohérents ou invalides => erreur explicite, jamais de devinette. Correspondance des noms de la base via alias partagés puis noms Natural Earth. |
| Citations (§5.C) | Les annotations `url_citation` sont rattachées à leur affirmation : le serveur envoie des `spans` en coordonnées de la réponse cumulée (plusieurs tours) uniquement si le texte diffusé est identique au texte annoté et sans paire de substitution UTF-16 ; sinon la source reste listée mais sans marqueur inventé. Le panneau affiche des marqueurs `[n]` cliquables après l'affirmation et la liste numérotée en pied (plus de limite à huit liens). Seuls http(s) sont rendus. |
| Provenance (§5.C) | Chunk `provenance` : pour chaque outil interne source, statut (`ok/empty/unavailable/error`), date de récupération UTC, détail (fenêtre, plus récente date de donnée, nombre d'enregistrements) ; pour la recherche web, uniquement les requêtes réellement présentes dans les éléments `web_search_call` de la réponse. Présenté dans un `<details>` repliable. |
| Incertitude / injection | Chaque résultat d'outil est enveloppé (`untrusted_external_data`, statut, date), nettoyé (caractères de contrôle, longueur, motifs d'injection évidents remplacés et comptés, URL non http(s) supprimées). Le prompt déclare ces contenus comme données non fiables, interdit de combler les manques, d'en déduire calme/sécurité et d'affirmer une recherche non faite. Limite : heuristique, pas une garantie. |
| Données fictives | Filtres des outils figés sur `REAL_DATASETS`; en plus, tout enregistrement/source `demo*`, `DEMO` ou `provenance: demonstration` est retiré des sorties et le prompt dit qu'il n'existe aucune donnée de démonstration. `fatalities` est `null` hors ACLED/UCDP/import (non applicable ≠ zéro). Dirigeants : avertissement Wikidata (mandats sans date de fin, possiblement en retard). |
| UI | Mise en page et streaming inchangés. Nouveaux états visibles : complète / incomplète / interrompue / erreur (avec le texte partiel conservé et un avertissement), voix qui ne lit pas la fin d'une réponse non terminée, historique envoyé limité aux réponses complètes et aux bornes serveur (lues via `GET /api/agent`), « Nouvelle conversation » et arrêt annulent la requête. |

## 2. Contrat NDJSON

`status`, `delta`, `citations {spans}`, `sources {items}`, `provenance {items}` puis exactement un de : `done` · `incomplete {reason,text}` · `error {code,text}`. Un client qui ne voit aucun terminal doit traiter la réponse comme interrompue (le panneau le fait).

Contrat Responses vérifié dans la documentation OpenAI : `response.created` (`incomplete_details.reason` ∈ `max_output_tokens`, `content_filter`…, `error.code/message`), éléments `web_search_call` (`action.type=search`, `queries`), annotations `url_citation` (`start_index`, `end_index`, `url`, `title`), obligation d'afficher les citations de façon visible et cliquable, paramètres `max_output_tokens`, `max_tool_calls` (outils intégrés uniquement), `tool_choice`, `parallel_tool_calls`. Les schémas détaillés de `response.incomplete`/`response.failed` n'ont pas pu être lus sur la page officielle tronquée : l'implémentation lit défensivement `response.incomplete_details.reason` et `response.error.code`.

## 3. Politique d'origine (déploiement actuel : serveur local sur `*:3005`, sans authentification)

POST accepté si **tous** les points suivent : hôte = `localhost`, `*.localhost`, adresse IP littérale (127.0.0.1, `[::1]`, IP LAN) ou hôte d'une origine listée dans `AURA_ALLOWED_ORIGINS` (protège du DNS rebinding : un nom de domaine arbitraire est refusé) ; `Sec-Fetch-Site` absent, `same-origin` ou `none` ; `Origin` présent et de même hôte (ou listé), ou à défaut `Sec-Fetch-Site: same-origin` ; en-tête `X-Orbital-Client: aura` (force un pré-vol CORS pour tout autre site) ; `Content-Type: application/json` (415 sinon). `AURA_TRUST_PROXY=1` lit `X-Forwarded-Host`. Localhost, 127.0.0.1 et `[::1]` testés.

**Ce n'est pas une authentification.** Un client non navigateur qui forge `Host`, `Origin` et l'en-tête passe. `X-Forwarded-For` n'est fiable que derrière un proxy maîtrisé ; sans proxy un appelant peut le changer et contourner les limites *par client* : seules les limites globales (concurrence, minute, jour) bornent alors la dépense. Des budgets par utilisateur exigent un vrai système d'identité, absent du projet : **décision produit à prendre avant toute exposition hors machine locale**. Compteurs en mémoire d'un processus, remis à zéro au redémarrage. `GET /api/agent` (état configuré + bornes, sans secret) n'est pas protégé.

## 4. Preuves (mock, hors dépôt, aucun appel payant)

`tsc --noEmit` du dépôt : sans erreur. Suite `/tmp/aura-tests/aura.test.cjs` (31 tests) et `/tmp/aura-tests/ui.test.cjs` (4 tests), `node --test`, `fetch` simulé, `intel/leaders/indicateurs/airspace` simulés, référentiel monde réel en lecture seule, build tsc isolé dans `/tmp/aura-tests/build` :

- flux complet, fragmenté (7 octets) → `done` unique ; `response.incomplete` max_output_tokens → `incomplete` sans `done` ; EOF → `error interrupted` ; `response.failed` / événement `error` → `error` ; complété sans texte → `error empty_answer` ; inactivité → `idle_timeout` ; délai global → `deadline` ; annulation client → aucun terminal et signal fetch annulé ;
- HTTP 401/429 quota/429 débit/404/500 → codes distincts, aucun détail amont renvoyé, une seule requête (pas de rejeu) ;
- corps de requête OpenAI : modèle inchangé, `stream`, `max_output_tokens`, `max_tool_calls`, `tool_choice`, `previous_response_id` au tour suivant ;
- citations : `texte.slice(start,end)` exact, offsets corrects sur deux tours, URL `javascript:` écartée, texte divergent → aucun span ;
- 6 appels parallèles → 4 exécutés et 6 sorties ; 5 tours d'outils → `tool_choice` `auto×4, none`, puis `incomplete tool_rounds` ;
- démo exclue (filtres, clusters, sources, événements, `coverage.demo`), Niger/Nigeria, USA par alias, iso3 incohérent, injection dans un acteur remplacée, URL `javascript:` retirée ;
- route : refus (origine étrangère, hôte rebinding, `Origin: null`, en-tête manquant, `Sec-Fetch-Site` cross/same-site, origine absente, `text/plain`) sans aucune requête fournisseur ; 413 (corps, conversation), 400 (13 messages, dernier message assistant, 2 001 car., JSON invalide) ; concurrence 429 puis libération à l'annulation ; quotas minute et jour ; EOF amont → `error` côté client ;
- panneau : marqueurs `[n]` cliquables après l'affirmation, numérotation stable, URL non http(s) ignorée, historique réduit aux réponses complètes et aux bornes.

Les tests ne sont **pas** dans le dépôt (pas de runner configuré) : ils ne sont ni durables ni exécutés en CI. Rejouer : `node_modules/.bin/tsc -p /tmp/aura-tests/tsconfig.json && NODE_PATH=<repo>/node_modules node --test /tmp/aura-tests/aura.test.cjs`.

## 5. Limites et non-certifié

- Aucun test avec un vrai compte OpenAI : existence/accès du modèle, qualité factuelle, coût, présence de `web_search` réellement utilisée, forme exacte des événements terminaux réels restent non certifiés.
- Interface : typage et rendu serveur de la logique seulement ; pas d'inspection navigateur, ni micro, ni voix, ni mobile.
- `store` n'est pas désactivé : `previous_response_id` impose que les réponses soient conservées côté OpenAI (défaut documenté ≥ 30 jours). À décider côté confidentialité ; non modifié.
- Détection d'injection par motifs : contournable ; la défense principale est l'enveloppe + les consignes + l'absence d'outil à effet de bord.
- Annotations dont le texte contient des paires de substitution UTF-16 : sources listées, marqueurs non posés (indices de l'API non spécifiés dans la doc lue).
- `include: web_search_call.action.sources` non demandé : les sources consultées mais non citées ne sont pas affichées.
- Pas de budget financier (tokens d'entrée, coût de la recherche web) : `max_output_tokens`/`max_tool_calls` bornent, ne plafonnent pas la dépense.
- Incident de test : un premier lancement a chargé par erreur le vrai `intel.js` (clé de cache `/tmp` vs `/private/tmp`), qui a journalisé une ingestion. `data/intel-events.json` a été modifié à 10:08 (serveur local en écoute sur 3005 ou ce processus : indéterminable) ; son contenu reste 21 355 enregistrements (ucdp 13 659, gdelt 6 505, firms 1 191), sans démo, conforme au décompte du parent. Les tests suivants n'ont plus chargé le vrai module (`INTEL_STORE_PATH` pointe vers un chemin jetable, aucune ingestion journalisée).

## 6. Dépendances d'intégration

- `@/lib/geo/country` (`canonicalCountryIdentity`, `resolveCountryIdentity`, `normalizeCountryName`) : doit rester exporté ; utilisé côté serveur et côté panneau.
- `intel.ts` : `queryStats` doit conserver `sources`, `periodCounts`, `freshness`, `coverage`, `connectors` ; `queryClusters(...).clusters[].realShare/confidence` ; `queryLatestEvents` filtre par `countries` en noms exacts. `filters.ts` : `datasets=` explicite honoré. `types/conflict.ts` : `REAL_DATASETS`, `TIME_RANGES`.
- Store (autre agent) : le panneau lit `country.name`/`country.iso` et `selected`. Un futur champ `iso3` n'exige aucun changement (le panneau canonicalise) ; si `country.iso` devient ISO3 exact, le contexte devient plus fiable.
- Tout autre client de `POST /api/agent` doit envoyer `Content-Type: application/json`, `Origin` et `X-Orbital-Client: aura`.
- Variables non secrètes à documenter dans `.env.example` (fichier non modifié ici) : `AURA_ALLOWED_ORIGINS`, `AURA_TRUST_PROXY`, `AURA_MAX_OUTPUT_TOKENS`, `AURA_DEADLINE_MS`, `AURA_IDLE_MS`, `AURA_MAX_CONCURRENT`, `AURA_CLIENT_PER_MINUTE`, `AURA_GLOBAL_PER_MINUTE`, `AURA_DAILY_LIMIT`.
- `pnpm exec` a tenté un `pnpm install` (échec `ERR_PNPM_IGNORED_BUILDS` pour esbuild, dépendance ajoutée par ailleurs) : j'ai utilisé `node_modules/.bin/tsc` directement.
