# Phase 3 — Santé et observabilité des sources (2026-10-20)

## Constat

- Flux mondiaux : déjà isolés (`Promise.allSettled`, `runSource` ne lève jamais, dernier
  cache valide servi en cas d'échec). Mais vocabulaire propre (`ok/error/stale/not_configured`),
  sans dernière tentative, latence, âge des données ni quota.
- Connecteurs de la base (ACLED, UCDP, GDELT, FIRMS, CSV) : `reachable` + note texte.
- Calques de référence : `status` dans chaque réponse, rien de centralisé.
- Aucune route de supervision.

## Modifications

- **Modèle commun** `src/types/health.ts` (`SourceHealth`) : identifiant, famille, nom,
  catégorie, statut normalisé, dernière tentative, dernier succès, date de la donnée la plus
  récente, âge, latence, nombre d'éléments, dernière erreur, provenance, quota.
  Statuts : `healthy`, `degraded`, `stale`, `unavailable`, `unconfigured`, plus `pending`
  (pas encore interrogée depuis le démarrage : plus honnête qu'un faux « indisponible »).
- **Registre** `src/server/health/registry.ts` : alimenté par les trois familles à chaque
  tentative (`recordAttempt`), lu sans jamais déclencher d'appel réseau. Une source dont le
  dernier succès dépasse 3 périodes de rafraîchissement passe en `stale`. Erreurs nettoyées et
  secrets masqués (`src/server/security/redact.ts`, partagé avec AURA).
- Branchements : `runSource` (flux), boucle d'ingestion `intel.ts` (connecteurs), `loadLayer`
  (calques ; relecture du cache disque = succès sans latence mesurée).
- **Routes** : `GET /api/sources/status` (liste + résumé par statut) et `GET /api/health`
  (statut global `ok`/`degraded`, stockage, résumé des sources, AURA et nature du magasin de
  limitation). Lecture seule.
- **Interface** : chaque état de flux porte `health`, `lastSuccessAt`, `latencyMs`,
  `newestDataAt`, `quota`. Le panneau Sources et les avertissements du fil utilisent le statut
  normalisé (libellés « Partiellement disponible », « Données anciennes… », « Pas encore
  interrogée »), présentation inchangée.
- **AURA** : `get_live_feeds` expose santé, dernier succès et date de la donnée la plus récente
  de chaque source (liste `degraded` en plus des erreurs) ; `get_platform_overview` les expose
  pour les connecteurs ; consignes mises à jour (ne rien conclure d'une source non `healthy`).

## Validation

- `pnpm typecheck` OK, `pnpm test` 335 réussis (2 ignorés) dont 10 nouveaux
  (`tests/source-health.test.ts`, `tests/health-routes.test.ts`), `pnpm build` code 0.
- Serveur de production local, sources réelles : 32 sources déclarées en `pending` au démarrage ;
  après un appel à `/api/feeds` : 19 `healthy`, AARO `unavailable` (HTTP 403), AIS `stale`
  (connexion en cours, trajets sauvegardés servis), NASA UAP `unconfigured`.
- Capture du panneau Sources : présentation identique, aucune erreur JavaScript.

## Restes

- Registre en mémoire : repart de `pending` à chaque redémarrage (pas d'historique).
- Quotas renseignés seulement lorsqu'ils sont documentés (Launch Library 2, FIRMS, ACLED).
- Les éléments du fil n'affichent pas individuellement la santé de leur source : les sources
  en retard ou indisponibles sont signalées en tête du fil et dans le panneau Sources.
