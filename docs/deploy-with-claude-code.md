# Deploying Cockpit on the Raspberry Pi — instructions for Claude Code

You are Claude Code running **on Dorian's Raspberry Pi 5** (Raspberry Pi OS 64-bit, Docker already installed). Your job tonight: do the one-time setup so that Cockpit deploys from GitHub to this Pi and is reachable at `https://cockpit.<Dorian's domain>` through a Cloudflare Tunnel, then run the first deployment and prove it works.

**Talk to Dorian in French.** He is learning: before each step, say in one or two sentences what you are about to do and why.

## How the deployment works (read before acting)

- Repository: `https://github.com/vidal-dorian/Cockpit-v2`. The files that matter: `Dockerfile`, `docker-compose.yml`, `scripts/deploy.sh`, `.github/workflows/cd.yml`, and `docs/deploiement.md` (the same setup, in French, for Dorian).
- The **CD** workflow is started by hand (Actions → CD → Run workflow). Its `deploy` job runs on a **self-hosted runner** on this Pi with the labels `self-hosted` and `raspberry`, and executes `scripts/deploy.sh`.
- `deploy.sh` creates `~/cockpit/data` (home of the user the runner runs as), then runs `docker compose up --detach --build --wait`. The image is built **on the Pi**. The `cockpit` container runs with the runner user's uid/gid, so the database files belong to that user. `--wait` makes the job fail if Cockpit does not answer on `/api/health`.
- The `cloudflared` container opens an **outbound** tunnel to Cloudflare with the token from the GitHub secret `CLOUDFLARE_TUNNEL_TOKEN`. **No port is opened** on the Pi or the router.
- The database must stay **outside** the runner's workspace: the runner runs `git clean` on its workspace before each job.

## Rules

1. **Never touch the existing runner(s)** used by Dorian's other projects: do not stop, reconfigure, update or remove them, and do not edit their folders.
2. **Never see, print or store the Cloudflare tunnel token.** Dorian copies it from the Cloudflare dashboard straight into the GitHub secret. If it ever appears in your output, tell Dorian to rotate it in Cloudflare and update the secret.
3. **Do not open ports**, change the firewall, the router or any service unrelated to Cockpit.
4. **Ask Dorian before every `sudo` command** and before anything that deletes files or restarts the Pi. Show the exact command first.
5. Things only Dorian can do in a browser (Cloudflare dashboard, GitHub settings): give him the exact clicks, wait for him to say it is done, then verify what you can from the Pi.
6. If something fails, read the logs, explain the cause in plain French and propose the fix. Do not work around a failure by weakening the setup (running as root, disabling the health check, publishing a port…).

## Step 0 — Preconditions

- The pull request `vidal-dorian/Cockpit-v2#11` (slice 1.2) should be merged into `main`. Check with `gh pr view 11 --repo vidal-dorian/Cockpit-v2` if `gh` is installed and logged in, otherwise ask Dorian. If it is **not** merged yet, the deployment can still run from its branch `claude/ecstatic-newton-qj6oya` (step 5 explains how), but tell Dorian.
- Run and report (no `sudo` needed):

  ```sh
  uname -m                      # expected: aarch64
  docker compose version        # Compose v2.17+ (for --wait)
  df -h ~                       # at least ~3 GB free for the image build
  id -un; id -u; groups         # who you are; is "docker" in the groups?
  ls -d ~/actions-runner* 2>/dev/null
  systemctl list-units --type=service 'actions.runner.*' --no-pager
  ```

- From the existing runner service(s), note **which user they run as** (`systemctl show -p User <unit>`). The new runner must run as a user that is in the `docker` group; using the same user as the existing runner is the simplest.

## Step 1 — Cloudflare Tunnel (Dorian, in the browser)

Give Dorian these steps, then wait:

1. Cloudflare dashboard → **Zero Trust** → **Networks → Tunnels** (on some accounts: *Networks → Connectors → Cloudflare Tunnels*) → **Create a tunnel** → **Cloudflared** → name it `cockpit`.
2. Choose **Docker** as the environment. The command shown contains `--token <long string>`. Copy **only the long string**. Do **not** run that command: `docker-compose.yml` already runs `cloudflared`.
3. Add a route of type **Published application**: subdomain `cockpit` (or another name he prefers), his domain, service type **HTTP**, URL **`cockpit:3000`** (`cockpit` is the service name in `docker-compose.yml`, reachable on the Docker network).
4. Note the full hostname (for example `cockpit.example.com`): you need it in step 6.

## Step 2 — GitHub secret (Dorian, in the browser)

GitHub → repository `vidal-dorian/Cockpit-v2` → **Settings → Secrets and variables → Actions → New repository secret**:

- Name: `CLOUDFLARE_TUNNEL_TOKEN`
- Secret: the token from step 1.

Verify without reading it: `gh secret list --repo vidal-dorian/Cockpit-v2` should list the name (if `gh` is available).

## Step 3 — A dedicated runner for this repository

On a personal GitHub account a self-hosted runner belongs to **one** repository, so the existing runner cannot serve Cockpit. Install a second one in its own folder: `~/actions-runner-cockpit`.

1. Ask Dorian to open GitHub → `vidal-dorian/Cockpit-v2` → **Settings → Actions → Runners → New self-hosted runner** → **Linux** / **ARM64**. That page shows the download commands (runner version, URL, SHA-256) and a `./config.sh` command with a registration token valid for one hour.
2. Run the download, checksum and extract commands from that page **inside `~/actions-runner-cockpit`** (create it first). Stop if the checksum does not match.
3. Configure it with the labels the CD workflow expects. Dorian pastes the registration token; use it directly in the command:

   ```sh
   cd ~/actions-runner-cockpit
   ./config.sh --url https://github.com/vidal-dorian/Cockpit-v2 --token <REGISTRATION_TOKEN> \
     --name pi5-cockpit --labels raspberry --work _work --unattended
   ```

4. Install and start it as a service (ask before these `sudo` commands). Pass the user chosen in step 0 if it is not the current one:

   ```sh
   sudo ./svc.sh install            # or: sudo ./svc.sh install <user>
   sudo ./svc.sh start
   sudo ./svc.sh status
   ```

5. If that user is not in the `docker` group: `sudo usermod -aG docker <user>`, then `sudo ./svc.sh stop && sudo ./svc.sh start` (ask first).
6. Dorian checks in **Settings → Actions → Runners** that `pi5-cockpit` is **Idle**, with the labels `self-hosted`, `Linux`, `ARM64`, `raspberry`.

## Step 4 — Nothing to prepare for the database

`deploy.sh` creates `~/cockpit/data` itself, owned by the runner user. Do not create it with `sudo` (it would belong to root and the container could not write to it).

## Step 5 — First deployment

- From the browser: **Actions → CD → Run workflow**, branch `main` (or `claude/ecstatic-newton-qj6oya` if PR #11 is not merged yet).
- Or from the Pi, if `gh` is logged in: `gh workflow run cd.yml --repo vidal-dorian/Cockpit-v2 --ref main`, then `gh run watch --repo vidal-dorian/Cockpit-v2`.

The first build takes a few minutes on the Pi (npm install + Vite build). The `deploy` job must end green. The `release-please` job that follows only manages release pull requests; its result does not affect the deployment.

## Step 6 — Prove it works

Run and show Dorian the results:

```sh
docker compose -p cockpit ps                      # cockpit: running (healthy); cloudflared: running
ls -l ~/cockpit/data                              # cockpit.db owned by the runner user
docker compose -p cockpit logs --tail 20 cockpit  # "Cockpit v0.1.0 listening on http://localhost:3000"
docker compose -p cockpit logs --tail 20 cloudflared   # "Registered tunnel connection" lines
curl -fsS https://<hostname>/api/health           # {"status":"ok","version":"0.1.0"}
```

Then ask Dorian to open `https://<hostname>` in his browser: the page shows **Cockpit** and the badge **« Serveur OK · v0.1.0 »**.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| The CD job stays **Queued** | No online runner with the labels `self-hosted` + `raspberry` for this repo | Check step 3 (service running, labels) |
| `permission denied ... docker.sock` | The runner user is not in the `docker` group | Step 3.5, then restart the runner service |
| `CLOUDFLARE_TUNNEL_TOKEN is not set` | Secret missing or misnamed | Step 2 (exact name) |
| `unable to open database file` | `~/cockpit/data` not writable by the runner user (created with sudo?) | `sudo chown -R <user>:<user> ~/cockpit` (ask first) |
| `--wait` fails, `cockpit` unhealthy | The app does not start | `docker compose -p cockpit logs cockpit` |
| `cloudflared` logs `Unauthorized` / invalid token | Wrong or rotated token | Copy the token again into the secret, re-run the CD |
| Browser shows Cloudflare error **502** / **1033** | Route points to the wrong service, or the tunnel is down | Route service must be `HTTP` + `cockpit:3000`; check `cloudflared` logs |
| `npm ci` fails on `better-sqlite3` / `node-gyp` | `--ignore-scripts` was removed from the `Dockerfile` | Restore it: the package ships its own ARM64 binary |

## What to report to Dorian at the end (in French)

What you did step by step, the output of the step 6 checks, the hostname, anything left undone or that looked wrong, and how to redeploy next time (Actions → CD → Run workflow).
