# Déploiement sur le Raspberry Pi

> Pour faire cette mise en place avec Claude Code sur le Pi, lui donner [`deploy-with-claude-code.md`](deploy-with-claude-code.md) : le même déroulé, écrit pour lui.

Cockpit tourne sur le Pi dans Docker. Il est joignable depuis Internet par un **tunnel Cloudflare** : aucun port n'est ouvert sur le Pi ni sur la box.

```
Internet ──HTTPS──► Cloudflare ◄──tunnel sortant── cloudflared (conteneur) ──► cockpit:3000 (conteneur)
                                                                                    │
                                                                       ~/cockpit/data (la base, sur le Pi)
```

| Fichier | Rôle |
|---|---|
| `Dockerfile` | Construit l'image : la page (Vite), le serveur et ses dépendances de production |
| `docker-compose.yml` | Deux conteneurs : `cockpit` et `cloudflared`. La base est montée depuis `~/cockpit/data` |
| `scripts/deploy.sh` | Crée `~/cockpit/data` si besoin, reconstruit et redémarre ; échoue si Cockpit ne répond pas sur `/api/health` |
| `.github/workflows/cd.yml` | Lancé à la main ; exécute `deploy.sh` sur le Pi |

## Mise en place (une seule fois)

### 1. Le dossier de la base

Rien à faire : `deploy.sh` crée `~/cockpit/data` dans le dossier personnel de l'utilisateur du runner, à côté de `~/actions-runner-cockpit`. Le conteneur tourne avec l'identifiant de cet utilisateur : la base lui appartient, sans `sudo`.

Pourquoi pas dans le dossier du code ? Avant chaque déploiement, le runner nettoie son dossier de travail (`git clean`) : une base rangée là serait effacée.

### 2. Le tunnel Cloudflare

Dans le tableau de bord Cloudflare, partie **Zero Trust** :

1. **Networks → Tunnels** (selon les comptes : *Networks → Connectors → Cloudflare Tunnels*) → **Create a tunnel** → **Cloudflared**. Nom : `cockpit`.
2. Choisir **Docker**. La commande affichée contient `--token <un long texte>` : **copier seulement ce long texte**. Ne pas lancer la commande, `docker-compose.yml` s'en charge.
3. Ajouter une route **Published application** :
   - **Subdomain** : `cockpit` (ou ce que tu veux) ; **Domain** : ton domaine ;
   - **Service** : type `HTTP`, URL `cockpit:3000`.

   `cockpit` est le nom du conteneur dans `docker-compose.yml` : `cloudflared` le joint par le réseau interne de Docker.

Le jeton donne le droit de faire passer du trafic par ton domaine : il ne va **que** dans les secrets GitHub (étape 3). S'il fuit, le régénérer dans le tableau de bord (l'ancien cesse alors de marcher).

### 3. Le secret GitHub

Repo → **Settings → Secrets and variables → Actions → New repository secret** :

- **Name** : `CLOUDFLARE_TUNNEL_TOKEN`
- **Secret** : le jeton copié à l'étape 2.

### 4. Le runner pour ce repo

Avec un compte GitHub personnel, un runner n'est rattaché qu'**à un seul repo** : celui des autres projets ne sert pas pour Cockpit. On en installe un second sur le Pi, dans son propre dossier.

1. Repo → **Settings → Actions → Runners → New self-hosted runner** → **Linux**, **ARM64**.
2. Sur le Pi, suivre les commandes affichées **dans un nouveau dossier**, par exemple `~/actions-runner-cockpit` (pas celui du runner existant).
3. À l'étape `./config.sh`, ajouter l'étiquette attendue par `cd.yml` et un nom reconnaissable :

   ```sh
   ./config.sh --url https://github.com/vidal-dorian/Cockpit-v2 --token <jeton affiché par GitHub> --labels raspberry --name pi5-cockpit
   ```

4. L'installer comme service, pour qu'il redémarre avec le Pi :

   ```sh
   sudo ./svc.sh install
   sudo ./svc.sh start
   ```

5. Le runner doit pouvoir utiliser Docker. La commande `groups` doit afficher `docker` ; sinon : `sudo usermod -aG docker $USER`, puis `sudo ./svc.sh stop && sudo ./svc.sh start`.

Le runner apparaît « Idle » dans **Settings → Actions → Runners**.

## Déployer

Repo → **Actions → CD → Run workflow**.

- Le job **deploy** reconstruit l'image sur le Pi, redémarre les conteneurs et attend que Cockpit réponde. S'il reste rouge, le message d'erreur est dans le journal du job.
- La page s'ouvre ensuite sur `https://cockpit.<ton-domaine>`.

## En cas de problème

Sur le Pi :

```sh
docker compose -p cockpit ps                 # état des deux conteneurs
docker compose -p cockpit logs cockpit       # journal de Cockpit
docker compose -p cockpit logs cloudflared   # journal du tunnel
```

## Sauvegarder la base

La base est le dossier `~/cockpit/data` de l'utilisateur du runner. Pour une copie sûre pendant que Cockpit tourne, utiliser la sauvegarde de SQLite plutôt qu'un simple `cp` (la base écrit aussi dans des fichiers `-wal` et `-shm`) :

```sh
sqlite3 ~/cockpit/data/cockpit.db ".backup '/chemin/vers/cockpit-$(date +%F).db'"
```
