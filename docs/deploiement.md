# Déploiement d'ORBITAL sur un serveur Linux (systemd)

ORBITAL s'exécute comme un processus Node persistant (`next start`) : les connecteurs
interrogent leurs sources à intervalles réguliers et SQLite vit dans `data/`.

## Prérequis serveur

- Node.js LTS : **24** recommandé (`.nvmrc`), **22.13 ou plus** accepté
  (`node:sqlite` sans option expérimentale). Pas de version impaire (25…).
- pnpm 11 ou plus récent.
- Un proxy HTTPS en frontal (Caddy, nginx) vers `127.0.0.1:<port>`.

Unité systemd type :

```ini
[Service]
Type=simple
User=<utilisateur>
WorkingDirectory=/home/<utilisateur>/orbital
Environment=NODE_ENV=production
Environment=PORT=3005
ExecStart=/usr/bin/pnpm run start -p 3005
Restart=always
RestartSec=5
```

## Ce qui ne doit jamais être écrasé

- `.env.local` : secrets et réglages propres au serveur ;
- `data/` : base SQLite (`intel-events.sqlite` + `-wal` + `-shm`), imports,
  calques en cache, trajets des mobiles.

## Procédure (sans coupure longue)

1. **Sauvegarde** de l'installation courante, données comprises :
   `tar czf ~/orbital-backups/orbital-<date>.tar.gz --exclude=orbital/node_modules -C ~ orbital`
2. **Dossier de préparation** : copie de l'installation sans `data/` ni `.next/`,
   puis synchronisation des sources d'un **commit de `main` dont la CI est verte**,
   exportées proprement (jamais un dossier de travail local, qui peut contenir des
   modifications non commitées) :
   `git archive --format=tar <sha> | tar -x -C /tmp/orbital-<sha>`, puis
   `git rev-parse <sha> > /tmp/orbital-<sha>/REVISION` et rsync de ce dossier.
   Les motifs d'exclusion rsync doivent être **ancrés à la racine** (`/data/`, `/.next/`,
   `/node_modules/`, `/.env.local`) : un motif `data/` exclurait aussi `src/data`,
   `public/data` et les dossiers `data` des dépendances.
3. Dans le dossier de préparation : `pnpm install --frozen-lockfile`, puis `pnpm build`.
   Un échec ici n'affecte pas le site en ligne.
4. **Bascule** : `systemctl stop orbital`, rsync du dossier de préparation vers
   l'installation en excluant `/data/` et `/.env.local`, `systemctl start orbital`.
5. **Vérification** : `systemctl is-active orbital`, réponse HTTP 200 locale et
   publique, puis contrôle visuel (ordinateur et téléphone). Les flux mettent
   ~10 s à se remplir après un redémarrage (démarrage à froid).

Retour arrière : arrêter le service, restaurer l'archive de l'étape 1, redémarrer.

## Base de données et migrations

- SQLite est migré automatiquement à l'ouverture (`PRAGMA user_version`) ; PostgreSQL
  applique ses migrations dans une transaction sous verrou consultatif
  (`orbital_schema_migrations`). Une base au schéma plus récent que l'application est
  refusée au démarrage : ne jamais démarrer une ancienne version sur une base migrée.
- **Sauvegarder `data/` avant chaque bascule** (étape 1) : c'est le seul retour arrière
  fiable pour SQLite. Avec PostgreSQL, utiliser `pg_dump` avant la bascule et vérifier
  que la restauration fonctionne.
- `systemctl stop` envoie `SIGTERM` : SQLite effectue un checkpoint WAL et tronque le
  fichier `-wal`. Un arrêt forcé (`SIGKILL`, coupure) reste récupérable par WAL ;
  `PRAGMA quick_check` est exécuté à l'ouverture et son résultat apparaît dans
  `GET /api/health`.
- Rétention : GDELT 30 jours et FIRMS 14 jours par défaut
  (`ORBITAL_RETENTION_GDELT_DAYS`, `ORBITAL_RETENTION_FIRMS_DAYS`).

## Supervision

- `GET /api/health` : statut global, stockage (version du schéma, intégrité), résumé des
  sources, configuration d'AURA et nature du magasin de limitation de débit.
- `GET /api/sources/status` : détail par source (dernier succès, âge des données, latence,
  erreur). Lecture seule, aucun appel réseau déclenché.
- Ces deux routes sont légères et peuvent être interrogées par une sonde toutes les
  minutes. Un statut `degraded` n'indique pas un processus mort : consulter le détail.

## Compression du proxy

Next ne compresse pas les réponses JSON des routes (`/api/events` peut dépasser 600 Ko
bruts pour 30 jours de données). Activer la compression du proxy, par exemple avec Caddy :

```caddyfile
encode zstd gzip
```

Elle s'applique notamment à `/api/events`, `/api/stats`, `/api/latest` et `/api/layers`.
Ne pas mettre ces réponses en cache partagé : elles dépendent des filtres et de
l'ingestion (`Cache-Control: no-store`).
