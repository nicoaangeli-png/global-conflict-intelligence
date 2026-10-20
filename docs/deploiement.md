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
   puis synchronisation des sources depuis le poste de développement. Les motifs
   d'exclusion rsync doivent être **ancrés à la racine** (`/data/`, `/.next/`,
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
