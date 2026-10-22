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
for var in POSTGRES_PASSWORD TUNNEL_TOKEN; do
  if ! grep -Eq "^$var=([^\"']|[\"'][^\"'])" "$env_file"; then
    echo "$var is missing or empty in $env_file." >&2
    exit 1
  fi
done

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

docker image prune -f
