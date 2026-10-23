# Cockpit v2

Service en ligne de pilotage des repos GitHub développés avec Claude Code. Le produit est décrit dans [`cockpit-v2-brief.md`](cockpit-v2-brief.md), l'ordre de construction dans [`docs/decoupage.md`](docs/decoupage.md), les choix dans [`docs/decisions/`](docs/decisions/) et leur résumé dans [`docs/architecture.md`](docs/architecture.md).

## Créer la GitHub App

Rien à faire à la main : Cockpit crée lui-même sa GitHub App au premier lancement, avec ton accord ([décision 012](docs/decisions/012-configuration-automatique.md)). L'assistant « Installer Cockpit » s'ouvre tout seul à l'adresse de Cockpit tant que l'App n'existe pas :

1. Entrer le **code de démarrage** que le serveur affiche dans ses logs (`Cockpit setup code: …`).
2. Vérifier l'**adresse publique**, détectée à partir de ta requête : c'est celle que GitHub utilisera pour renvoyer vers Cockpit.
3. Cliquer sur « Créer l'App GitHub » : GitHub affiche l'App et ses permissions (lecture des repos, des PR et de la CI ; écriture du contenu et des issues).
4. Cliquer sur « Create GitHub App » sur GitHub. Cockpit récupère l'App, chiffre ses secrets en base et te renvoie vers la connexion GitHub : **le premier compte qui se connecte devient administrateur**.

Pour que Cockpit voie des repos, il faut ensuite **installer l'App sur le compte** en choisissant les repos : `https://github.com/apps/<slug>/installations/new`, ou le lien « Installer l'App sur mes repos » de la page Projets. Seuls les repos cochés peuvent être importés. L'App est publique (« Any account »), mais seuls les comptes autorisés par Cockpit entrent ; pour l'instant, seul l'administrateur (la liste des comptes autorisés arrive avec la tranche 1.6).

## Lancer en local

Il faut Node.js 24 ou plus récent et une base PostgreSQL 18. Pour avoir une base en local :

```sh
docker run --name cockpit-db -e POSTGRES_PASSWORD=cockpit -p 5432:5432 -d postgres:18
```

La seule variable à fournir :

```sh
export DATABASE_URL=postgres://postgres:cockpit@localhost:5432/postgres
```

```sh
npm install
npm run build
npm start
```

Les migrations sont appliquées au démarrage. Au premier lancement, le serveur crée sa clé de chiffrement dans `secrets/master.key` (`COCKPIT_KEY_FILE` pour la changer) et affiche le code de démarrage. Ouvrir http://localhost:3000 : l'assistant crée la GitHub App de développement (voir « Créer la GitHub App »).

Pour développer, lancer `npm run dev:server` et `npm run dev:web` dans deux terminaux, puis ouvrir http://localhost:5173 : la page se recharge à chaque modification. L'App est créée avec l'adresse que tu confirmes dans l'assistant : pour `npm run dev:web`, confirmer `http://localhost:5173`.

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
4. Créer les dossiers et le fichier d'environnement, au nom de l'utilisateur du runner (`<runner-user>`), lisible par lui seul. Il ne contient que le jeton du tunnel : le mot de passe de la base est généré par le premier déploiement, et GitHub est configuré par l'assistant.

   ```sh
   sudo install -d -o <runner-user> -m 700 /etc/cockpit /var/backups/cockpit
   echo 'TUNNEL_TOKEN=<jeton du tunnel>' | sudo tee /etc/cockpit/cockpit.env > /dev/null
   sudo chown <runner-user> /etc/cockpit/cockpit.env && sudo chmod 600 /etc/cockpit/cockpit.env
   ```

   Le fichier reste hors du repo, car `actions/checkout` supprime à chaque déploiement les fichiers non suivis.

### Déployer

Dans GitHub : Actions → CD → Run workflow. `scripts/deploy.sh` vérifie le fichier d'environnement (il ajoute `POSTGRES_PASSWORD` s'il manque), construit l'image, démarre les services, contrôle que `/api/health` renvoie la version de `version.txt`, puis supprime les anciennes images. Un autre fichier peut être indiqué avec `COCKPIT_ENV_FILE`.

### Premier lancement : l'assistant

Le premier déploiement affiche dans son journal la ligne `Cockpit setup code: XXXX-XXXX-XXXX-XXXX — open …/installation` (on la retrouve avec `docker compose --env-file /etc/cockpit/cockpit.env logs app`). Ensuite :

1. Ouvrir l'adresse publique de Cockpit, entrer le code de démarrage et confirmer l'adresse.
2. Cliquer sur « Créer l'App GitHub », puis sur « Create GitHub App » sur GitHub.
3. Se connecter avec GitHub : on devient administrateur.

### Garder une copie de la clé de chiffrement

Les secrets de la GitHub App sont chiffrés en base ; la clé est dans le volume Docker `secrets` (`/app/secrets/master.key`), jamais dans la base ni dans ses sauvegardes. **Une seule fois, après l'assistant**, copier cette clé hors du Pi (gestionnaire de mots de passe, autre machine) :

```sh
docker compose --env-file /etc/cockpit/cockpit.env cp app:/app/secrets/master.key ~/cockpit-master.key
chmod 600 ~/cockpit-master.key
```

Perdre le volume sans cette copie oblige à refaire l'assistant (nouvelle App) et chaque utilisateur à réinstaller l'App.

**Clé perdue ou changée.** Au démarrage, si la base contient la GitHub App mais que la clé ne la déchiffre pas (volume perdu, clé recréée, mauvaise clé), Cockpit s'arrête avec un message qui nomme le fichier de clé. Deux issues :

- remettre la copie de la clé (voir « Restaurer », étape de la clé), puis relancer ;
- ou refaire l'assistant avec une nouvelle App (chaque utilisateur devra réinstaller l'App) : effacer la configuration enregistrée, puis relancer.

  ```sh
  docker compose --env-file /etc/cockpit/cockpit.env exec db psql -U postgres -d cockpit -c 'DELETE FROM instance_settings;'
  ```

  La base tourne pendant que l'application redémarre en boucle ; une fois la ligne effacée, le prochain redémarrage ouvre l'assistant.

**Administrateur perdu.** Si l'App existe mais qu'aucun compte n'est administrateur (par exemple l'assistant s'est arrêté avant la première connexion), Cockpit réaffiche son code de démarrage au lancement, et la page d'accueil propose de redevenir administrateur avec ce code.

### Sauvegarde

`scripts/backup.sh` écrit un `pg_dump` compressé dans `/var/backups/cockpit` (`BACKUP_DIR`) et supprime ceux de plus de 14 jours (`KEEP_DAYS`). Une sauvegarde par jour, avec `crontab -e` sous l'utilisateur du runner :

```cron
0 3 * * * /chemin/du/runner/_work/Cockpit-v2/Cockpit-v2/scripts/backup.sh >> $HOME/cockpit-backup.log 2>&1
```

En cas de doute, lire `~/cockpit-backup.log` : les erreurs du script y sont écrites.

### Restaurer

Il faut la sauvegarde de la base **et** la clé de chiffrement (volume `secrets`) : sans la clé, les secrets de la GitHub App stockés en base ne se relisent pas.

**Ne jamais lancer `docker compose down -v` sur la vraie pile** : `-v` supprime aussi le volume `secrets`, donc la clé. On arrête avec `down` seul, et on ne supprime que le volume de la base.

Depuis le dossier du checkout (celui de `compose.yaml`), avec `ENV=/etc/cockpit/cockpit.env` :

```sh
docker compose --env-file "$ENV" --profile tunnel down       # sans -v
docker volume rm cockpit_db-data                             # efface la base actuelle, et elle seule
# La clé, écrite par l'utilisateur de l'image (un `cp` garderait le propriétaire de l'hôte, illisible pour l'application) :
docker compose --env-file "$ENV" run --rm -T --no-deps app sh -c 'cat > secrets/master.key && chmod 600 secrets/master.key' < ~/cockpit-master.key
docker compose --env-file "$ENV" up -d --wait db             # la base seule, avant que l'application crée ses tables
gzip -dc /var/backups/cockpit/cockpit-AAAAMMJJ-HHMMSS.sql.gz |
  docker compose --env-file "$ENV" exec -T db psql -v ON_ERROR_STOP=1 --single-transaction -U postgres -d cockpit
```

Puis relancer le CD (ou `scripts/deploy.sh`) pour démarrer l'application et le tunnel.

### Tester la pile

`scripts/smoke-test.sh` démarre la pile dans son propre projet Compose (`cockpit-smoke`), avec un mot de passe jetable et sans le tunnel, puis la supprime : les vraies données ne sont pas touchées. La CI le lance dans le job `docker`.
