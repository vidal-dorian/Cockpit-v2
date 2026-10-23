#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
echo "Deploying Cockpit v$(tr -d '[:space:]' < version.txt) ($(git rev-parse --short HEAD))"

# The env file lives outside the repo: the CD checkout cleans untracked files.
env_file=${COCKPIT_ENV_FILE:-/etc/cockpit/cockpit.env}
if [ ! -f "$env_file" ]; then
  echo "Env file $env_file not found (set COCKPIT_ENV_FILE or create it, see README)." >&2
  exit 1
fi
# grep instead of sourcing the file, so a crafted file cannot run code.
has_value() { grep -Eq "^$1=([^\"']|[\"'][^\"'])" "$env_file"; }
# The tunnel token comes from the Cloudflare account: only a human can provide it (decision 012).
if ! has_value TUNNEL_TOKEN; then
  echo "TUNNEL_TOKEN is missing or empty in $env_file." >&2
  exit 1
fi
# Generated at the first deploy; appending keeps the file's mode.
if ! has_value POSTGRES_PASSWORD; then
  # A last line without its newline would swallow the new one.
  [ -z "$(tail -c1 "$env_file")" ] || echo >> "$env_file"
  # Its own line, so `set -e` stops on a failure instead of appending an empty password.
  password=$(openssl rand -hex 24)
  [ -n "$password" ] || { echo "Could not generate POSTGRES_PASSWORD." >&2; exit 1; }
  echo "POSTGRES_PASSWORD=$password" >> "$env_file"
  echo "POSTGRES_PASSWORD was missing in $env_file: generated and added."
fi

dc() { docker compose --env-file "$env_file" --profile tunnel "$@"; }

dc up -d --build --wait --wait-timeout 180 --remove-orphans || {
  dc logs --tail 50 >&2
  exit 1
}

version=$(tr -d '[:space:]' < version.txt)
served=$(dc exec -T app node -e 'fetch("http://localhost:3000/api/health").then((r) => r.json()).then((h) => process.stdout.write(h.version))') || served=
if [ "$served" != "$version" ]; then
  echo "Health check failed: expected version $version, got '${served}'." >&2
  exit 1
fi
echo "Cockpit v$version is up."

# Printed again here so the CD log shows it while the wizard still has to run, or no administrator exists yet.
# A failing status call counts as "needs it": better one line too many than a code nobody sees.
if dc exec -T app node -e 'fetch("http://localhost:3000/api/setup/status").then((r) => r.json()).then((s) => process.exit(!s.configured || s.hasAdmin === false ? 0 : 1), () => process.exit(0))'; then
  dc logs app 2>&1 | grep 'setup code:' | tail -n 1 || true
fi

docker image prune -f
