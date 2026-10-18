# ORBITAL — Conflict Intelligence

Interface Next.js / Three.js existante : globe interactif, agrégation géographique,
filtres, chronologie, fiches pays et sources. Les données de démonstration ne sont
pas des observations de conflits.

## Démarrage

```sh
pnpm install
cp .env.example .env.local
pnpm dev
```

Pour une exécution de production : `pnpm build`, puis `pnpm start`.
Validation TypeScript : `pnpm exec tsc --noEmit --incremental false`.
Audit des dépendances de production : `pnpm audit --prod`.
Ne pas lancer un build dans `.next` pendant qu'un serveur utilise ce dossier.

## Paramètres

Le bouton **PARAMÈTRES / SETTINGS**, dans l'en-tête, ouvre la section sources et
déploiement. `src/components/ui/Header.tsx` gère son accès,
`src/components/IntelApp.tsx` la navigation, et
`src/components/ui/SettingsPanel.tsx` les instructions et statuts.
Les filtres de consultation sont dans `src/components/ui/FiltersPanel.tsx` et
`src/store/useIntelStore.ts`. Les accès aux fournisseurs restent côté serveur :
modifier `.env.local`, puis redémarrer. Ne jamais placer de secret dans une
variable `NEXT_PUBLIC_*`, un commit ou un message de chat.

## Sources et couverture

- **Données documentées** : ACLED, UCDP ou exports importés. Le niveau de
  confiance est celui de la normalisation, pas une certification indépendante.
  Les accès, licences, délais et couvertures propres aux fournisseurs s'appliquent.
- **GDELT** : mentions de presse géolocalisées, pas des incidents confirmés.
  Aucun nombre de morts n'est déduit d'une mention. Les requêtes ont une
  couverture limitée : ce n'est pas un inventaire exhaustif de tous les conflits.
- **Données réelles uniquement** : aucun amorçage ni repli sur la démonstration.
  Les écritures locales et PostgreSQL refusent les enregistrements de démonstration
  et les sources non reconnues. Une source réelle ne garantit pas que chaque fait
  rapporté soit vérifié : provenance, date et niveau de confiance restent nécessaires.
  L'ancien fichier `data/demo-seed.json` est conservé comme archive, non chargé.
  Pour assainir un ancien stockage local, vérifier d'abord le rapport de
  `node scripts/quarantine-demo.cjs --store data/intel-events.json`, puis ajouter
  `--apply` : verrou exclusif, sauvegarde intégrale vérifiée et remplacement atomique.
  La sauvegarde `.before-real-only-*.bak` est hors du stockage actif, ignorée par Git.
  Ce script ne migre pas PostgreSQL ; vérifier son contenu séparément avant déploiement.
- **Banque mondiale** : population et PIB nominal annuels, avec année et lien
  officiel par indicateur. API sans clé ; cache serveur 24 h pour les succès,
  60 s pour les indisponibilités. Une panne affiche N/A, jamais une valeur inventée.
- Les anciennes fiches géopolitiques restent explicitement **statiques, non
  vérifiées et non datées**. Ne pas confondre leur contenu avec les indicateurs
  Banque mondiale sourcés. ORBITAL n'est pas un niveau DEFCON officiel.

La recherche des pays fonctionne même sans événements dans la période, notamment
pour l'Iran. Le référentiel Natural Earth simplifié contient 177 entrées et ne
couvre pas tous les petits États. Les favoris restent dans le navigateur.
L'absence d'événements filtrés ne signifie pas l'absence de conflit.

## Accès aux données

- `ACLED_ACCESS_TOKEN`, ou `ACLED_EMAIL` et `ACLED_PASSWORD` : accès ACLED.
- `UCDP_ACCESS_TOKEN` et `UCDP_VERSION` : accès et version GED souhaitée.
- `GDELT_DISABLED=1` / `UCDP_DISABLED=1` : désactivation ciblée.
- Exports CSV : déposer les fichiers dans `data/imports/`, puis déclencher
  l'ingestion authentifiée. Vérifier la provenance et les droits des exports.
- `INGEST_TOKEN` : secret serveur protégeant `POST /api/ingest?days=30`, en-tête
  `Authorization: Bearer <jeton>`. Sans configuration, POST renvoie 503 ; mauvais
  jeton 401 ; période hors 1–365 jours 400 ; déclenchements rapprochés 429.
  Ne pas inclure ce jeton dans le navigateur. GET expose uniquement l'état.

Les fournisseurs configurés sont interrogés périodiquement dans un processus
Node persistant. Un environnement serverless ne garantit ni les minuteries ni
le stockage local : prévoir un ordonnanceur serveur et PostgreSQL pour ce cas.
Les contrôles de concurrence et de fréquence sont locaux au processus, pas une
limitation distribuée. Avant exposition publique, ajouter authentification,
limitation de requêtes en amont et supervision.

## Persistance

`DATABASE_URL` active PostgreSQL. Sans base disponible, le dépôt local écrit dans
`INTEL_STORE_PATH` (par défaut `data/intel-events.json`) avec remplacement atomique.
Ce fichier est ignoré par Git. Utiliser un volume persistant et des sauvegardes.
Un fichier illisible n'est pas écrasé silencieusement. Après un arrêt brutal,
vérifier qu'aucun processus n'écrit avant de retirer un éventuel fichier `.lock`.
La base PostgreSQL n'est pas testée sans instance configurée.

## API de lecture

- `GET /api/events` : agrégats ; `GET /api/stats` : statistiques de la même sélection.
- `POST /api/cluster` : détail de l'agrégat identifié par `clusterId`.
- `GET /api/latest` : événements récents filtrés.
- `GET /api/country?iso=IRN` : indicateurs Banque mondiale ; ISO alpha-3 requis.
- `GET /api/stream` : notifications SSE, sans promesse d'exhaustivité temps réel.

Les séries utilisent des cases horaires sur 24 h, journalières sur les fenêtres
courtes et hebdomadaires sur 6 mois / 1 an. Les classements regroupent les pays
par nombre d'événements chargés et filtrés : ils ne mesurent pas un risque mondial
objectif. Les budgets militaires SIPRI nécessitent un import annuel sourcé ;
aucune API militaire ou position tactique fictive n'est ajoutée.
