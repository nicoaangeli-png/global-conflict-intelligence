# ORBITAL — Implémentation données backend (audit 18 octobre 2026)

Périmètre : `src/server/intel.ts`, `src/server/filters.ts`, `src/server/connectors/{gdelt,csvImport,firms,types}.ts`, `src/types/conflict.ts` (ajouts optionnels uniquement). Aucune donnée stockée n'a été purgée, réécrite ni réingérée ; aucune API ajoutée.

## 1. `datasets=` vide ne réactive plus la démonstration
- `filters.ts` : `resolveDatasets()` — liste absente, vide, ou sans source reconnue → `REAL_DATASETS`. `demo:seed` n'est servi que s'il est nommé explicitement.
- `intel.ts` : défense en profondeur dans `selectEventsDetailed` (`requestedDatasets`) : un `EventFilters.datasets` vide construit directement (agent, appels internes) retombe aussi sur les sources réelles.
- Non modifié : l'amorçage automatique de la démo dans le stockage vide (`ensureReady`, `ingest`) ; elle reste invisible par défaut. À coordonner avec la séparation du mode démonstration côté parent.

## 2. Compteurs de période — contrat explicite
- `events24h/7d/30d` (inchangés, UI intacte) = **intersection** plage sélectionnée × fenêtre glissante. Sur une plage 24 h, 7 j et 30 j valent 24 h.
- Nouveau `periodCounts` : `{ reference, unit: "records", withinSelection, absolute }`. `absolute` applique les mêmes filtres (types, sources, confiance, pays, morts) mais indépendamment de la plage (fenêtres 24 h/7 j/30 j jusqu'à la même borne haute, curseur `at` inclus). Même filtre thermique que la carte.
- L'unité est l'enregistrement, pas l'incident distinct.

## 3. Provenance, unités, fraîcheur
- `sources[]` (StatsResponse) : par source `provenance`, `unit` (`incident_record`, `media_mention`, `thermal_detection`, `operator_import_record`, `fictional_record`), `dateBasis` (GDELT = publication, FIRMS = détection), `fatalitiesApplicable`, `recordsInStore`, `recordsInSelection`, `latestEventAt` — expose le retard UCDP.
- `freshness` : `lastIngestAt`, `lastStoreUpdateAt`, `latestEventAt` (hors démo), `null` si inconnu. `storeBreakdown` : `real` / `demo` dans `totalInStore`.
- `lastDataUpdate` / `lastIngestAt` historiques : le repli utilise d'abord une date réelle du stockage avant « maintenant » (le type reste non nul).
- `fatalitiesRange` et `totalFatalities` ne somment que les sources qui mesurent des morts ; `fatalities.{applicableRecords,notApplicableRecords}`. GDELT/FIRMS : `fatalities: 0` = non applicable (le type ne permet pas `null`).

## 4. GDELT
- Zones : comparaison par **segment entier normalisé** (casse, diacritiques, ponctuation), avec alias (Burma, Russian Federation…). « Tirana » ne contient plus « Iran », « Malaysia » ≠ « Mali ». Le nom de pays conservé est celui du fournisseur (pas de réécriture).
- Thèmes GKG : séparés par « ; », codes exacts ou mots entiers (`_`). « AWARD »/« SOFTWARE » ne contiennent plus « WAR ».
- Titre : repris **uniquement** si GDELT fournit `title`/`urltitle`/`sharetitle`, sinon `source` = domaine + « titre non fourni ». Jamais déduit de l'URL. Les compteurs « n dépêche(s) » (qui comptaient des mentions répétées d'une même URL) sont supprimés.
- `subEventType` : « Mention presse géolocalisée » (ex. « Alerte presse… » pour les nouvelles lignes ; l'historique stocké n'est pas modifié).
- Limite : un lieu cité n'est pas le lieu des faits ; la date est celle de publication. Le filtre de tonalité (≤ −2,5) reste heuristique. `sourcecountry` n'est pas utilisé.

## 5. Import CSV
- Validation ligne à ligne : latitude/longitude vides, non numériques, hors bornes, ou exactement (0,0) → rejetées avec motif ; la latitude 0 seule reste valide. Date `YYYY-MM-DD` stricte (jour calendaire réel — `Date.parse` décale `2026-02-31`), année ≥ 1945, pas de date future (> +1 j). Morts non entières, négatives ou non numériques → rejet ; vide → 0 mais compté en `fatalitiesUnknown`.
- Un fichier invalide ou illisible n'empêche plus les autres ; erreur de connecteur seulement si tous échouent. Rapport par fichier dans le rapport d'ingestion et la note de statut (acceptées/rejetées par motif, échantillon de lignes).
- Provenance : `sourceDataset = "import:csv"` (plus `acled`/`ucdp`), identifiant `csv-acled-…`/`csv-ucdp-…`, confiance `REPORTED` par défaut. `CONFIRMED`/`MEDIA_SIGNAL` seulement si une colonne `confidence` l'indique, et alors tracé dans `source`. `DEMO` ne peut pas être déclaré.
- Sans identifiant natif : empreinte du contenu (l'ancien repli « lat,lon » fusionnait des lignes distinctes). `sourceUrl` n'est conservé que s'il s'agit d'une URL http(s). BOM UTF-8 retiré.
- `importCsvText(text, file, now)` est exporté (tests).

## 6. FIRMS
- Détections sans `frp` lisible (NaN passait le filtre) ignorées ; libellé « Détection thermique · FRP … » ; `source` précise « cause non établie ». Aucune assertion de frappe ni de morts.
- Indépendance : `EventFilters.thermal` (`near-conflict` | `all`, paramètre `thermal=`). Défaut historique conservé (proximité aux zones de conflit, pour ne pas inonder le globe). Une sélection purement thermique (`types=Thermal anomaly` ou `datasets=firms` seul) affiche toutes les détections. Réponses : `thermal: { mode, detected, shown }` (stats et clusters).
- Limite : les zones de proximité incluent toujours GDELT (30 j) en mode `near-conflict` — heuristique d'affichage, pas un lien causal.

## 7. Contrats modifiés (tous additifs)
`EventFilters.thermal?`, `StatsResponse.{periodCounts,sources,freshness,storeBreakdown,fatalities,thermal}?`, `EventsResponse` (champ `thermal` servi mais non typé), `Connector.lastReport?()`, types `PeriodCounts`, `SourceAvailability`, `SourceProfile`, `ThermalMode`, `ThermalSelection`, `RecordUnit`, `DateBasis`, `strictIsoDate()` (connectors/types.ts). Comportement modifié : `datasets=` vide, `fatalitiesRange`/`totalFatalities` (sources sans létalité exclues, sans effet numérique car valeur 0), `sourceDataset` des lignes CSV nouvelles.

## 8. Vérifications et limites
`pnpm exec tsc --noEmit --incremental false` : réussite. Tests ciblés hors dépôt (`/tmp/orbital-data-test`) : fixtures GDELT (Tirana/Iran, Malaysia/Mali, AWARD/WAR, alias), `datasets=` vide/invalide, CSV (13 cas : dates impossibles, bornes, (0,0), futur, morts, BOM, confiance déclarée, URL), et `queryStats` sur dépôt mémoire (absolu ≠ intersection, thermique, démo exclue par défaut, appel direct à `datasets: []`). Non vérifié : ingestion réelle, PostgreSQL, rendu UI, champs de titre réellement présents dans la réponse GDELT (non testé en réseau). Non traité (hors périmètre) : repository (clé de dédup, verrou), routes (`limit=abc`), `data/imports/README.md` (affirme encore « CONFIRMED / REPORTED selon le format »), UI (à brancher sur `periodCounts` / `sources`).
