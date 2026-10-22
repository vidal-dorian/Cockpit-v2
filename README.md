# Cockpit v2

Service en ligne de pilotage des repos GitHub développés avec Claude Code. Le produit est décrit dans [`cockpit-v2-brief.md`](cockpit-v2-brief.md), l'ordre de construction dans [`docs/decoupage.md`](docs/decoupage.md), les choix dans [`docs/decisions/`](docs/decisions/) et leur résumé dans [`docs/architecture.md`](docs/architecture.md).

## Créer la GitHub App

Une seule fois, sur le compte de Dorian : la connexion à Cockpit passe par une GitHub App ([décision 009](docs/decisions/009-connexion-github.md)).

1. GitHub → Settings → Developer settings → GitHub Apps → New GitHub App.
2. Donner un nom (par exemple « Cockpit ») ; **Homepage URL** : l'adresse publique de Cockpit.
3. **Callback URL** : `<PUBLIC_URL>/api/auth/callback`.
4. Laisser « Expire user authorization tokens » tel quel (coché).
5. Laisser décoché « Request user authorization (OAuth) during installation ».
6. **Webhook** : décocher « Active » (les webhooks arrivent avec la tranche 5.1).
7. Aucune permission sur les repos pour l'instant (elles arrivent avec la tranche 2.1).
8. « Where can this GitHub App be installed? » : « Only on this account ». Créer l'App.
9. Copier le **Client ID**, puis « Generate a new client secret » et copier le secret (il ne s'affiche qu'une fois).

Une App privée (« Only on this account ») peut refuser la connexion des autres comptes GitHub : si un proche de la liste des comptes autorisés tombe sur une page d'erreur de GitHub, passer l'App en « Any account » dans ses réglages. La liste `ALLOWED_GITHUB_LOGINS` de Cockpit décide toujours qui entre.

Pour développer en local, créer une seconde App du même genre, avec pour Callback URL `http://localhost:5173/api/auth/callback` (avec `npm run dev:web`) ou `http://localhost:3000/api/auth/callback` (avec `npm start`).

## Lancer en local

Il faut Node.js 24 ou plus récent, une base PostgreSQL 18 et une GitHub App (voir ci-dessus). Pour avoir une base en local :

```sh
docker run --name cockpit-db -e POSTGRES_PASSWORD=cockpit -p 5432:5432 -d postgres:18
```

Le serveur refuse de démarrer sans ces variables :

```sh
export DATABASE_URL=postgres://postgres:cockpit@localhost:5432/postgres
export GITHUB_CLIENT_ID=<Client ID de l'App>
export GITHUB_CLIENT_SECRET=<secret de l'App>
export PUBLIC_URL=http://localhost:3000        # http://localhost:5173 avec npm run dev:web
export ALLOWED_GITHUB_LOGINS=<ton-login>       # plusieurs : login1,login2
```

```sh
npm install
npm run build
npm start
```

Puis ouvrir http://localhost:3000. Les migrations sont appliquées au démarrage.

Pour développer, lancer `npm run dev:server` et `npm run dev:web` dans deux terminaux (avec `PUBLIC_URL=http://localhost:5173`), puis ouvrir http://localhost:5173 : la page se recharge à chaque modification.

## Vérifier

```sh
npm test
npm run lint
npm run typecheck
```

## Déployer sur le Pi

Cockpit tourne sur le Raspberry Pi avec Docker Compose (Cockpit, PostgreSQL, `cloudflared`), derrière un Cloudflare Tunnel : aucun port ouvert sur la box.

### Installation, une seule fois

1. Installer Docker et le plugin Compose sur le Pi.
2. Installer le runner GitHub auto-hébergé avec les labels `self-hosted, raspberry`, et ajouter son utilisateur au groupe `docker`.
3. Dans le tableau de bord Cloudflare, créer un tunnel géré à distance, avec un nom d'hôte public qui pointe vers `http://app:3000`. Garder son jeton.
4. Créer la GitHub App (voir « Créer la GitHub App ») et garder son Client ID et son secret.
5. Créer les dossiers et le fichier d'environnement, au nom de l'utilisateur du runner (`<runner-user>`), lisible par lui seul :

   ```sh
   sudo install -d -o <runner-user> -m 700 /etc/cockpit /var/backups/cockpit
   sudo tee /etc/cockpit/cockpit.env > /dev/null <<EOF
   POSTGRES_PASSWORD=$(openssl rand -hex 24)
   TUNNEL_TOKEN=<jeton du tunnel>
   GITHUB_CLIENT_ID=<Client ID de la GitHub App>
   GITHUB_CLIENT_SECRET=<secret de la GitHub App>
   PUBLIC_URL=https://<domaine>
   ALLOWED_GITHUB_LOGINS=<login1,login2>
   EOF
   sudo chown <runner-user> /etc/cockpit/cockpit.env && sudo chmod 600 /etc/cockpit/cockpit.env
   ```

   Le mot de passe est en hexadécimal pour pouvoir figurer tel quel dans une URL. Le fichier reste hors du repo, car `actions/checkout` supprime à chaque déploiement les fichiers non suivis.

### Déployer

Dans GitHub : Actions → CD → Run workflow. `scripts/deploy.sh` vérifie le fichier d'environnement, construit l'image, démarre les services, contrôle que `/api/health` renvoie la version de `version.txt`, puis supprime les anciennes images. Un autre fichier peut être indiqué avec `COCKPIT_ENV_FILE`.

### Sauvegarde

`scripts/backup.sh` écrit un `pg_dump` compressé dans `/var/backups/cockpit` (`BACKUP_DIR`) et supprime ceux de plus de 14 jours (`KEEP_DAYS`). Une sauvegarde par jour, avec `crontab -e` sous l'utilisateur du runner :

```cron
0 3 * * * /chemin/du/runner/_work/Cockpit-v2/Cockpit-v2/scripts/backup.sh >> $HOME/cockpit-backup.log 2>&1
```

En cas de doute, lire `~/cockpit-backup.log` : les erreurs du script y sont écrites.

### Restaurer

Depuis le dossier du checkout (celui de `compose.yaml`), avec `ENV=/etc/cockpit/cockpit.env` :

```sh
docker compose --env-file "$ENV" --profile tunnel down -v    # efface la base actuelle
docker compose --env-file "$ENV" up -d --wait db             # la base seule, avant que l'application crée ses tables
gzip -dc /var/backups/cockpit/cockpit-AAAAMMJJ-HHMMSS.sql.gz |
  docker compose --env-file "$ENV" exec -T db psql -v ON_ERROR_STOP=1 --single-transaction -U postgres -d cockpit
```

Puis relancer le CD (ou `scripts/deploy.sh`) pour démarrer l'application et le tunnel.

### Tester la pile

`scripts/smoke-test.sh` démarre la pile dans son propre projet Compose (`cockpit-smoke`), avec un mot de passe jetable et sans le tunnel, puis la supprime : les vraies données ne sont pas touchées. La CI le lance dans le job `docker`.
