#!/usr/bin/env bash
# Dumps the Cockpit database to a gzipped file and deletes dumps older than KEEP_DAYS.
set -euo pipefail

cd "$(dirname "$0")/.."

env_file=${COCKPIT_ENV_FILE:-/etc/cockpit/cockpit.env}
backup_dir=${BACKUP_DIR:-/var/backups/cockpit}
keep_days=${KEEP_DAYS:-14}

if [ ! -f "$env_file" ]; then
  echo "Env file $env_file not found (set COCKPIT_ENV_FILE)." >&2
  exit 1
fi

mkdir -p "$backup_dir"
tmp=$(mktemp "$backup_dir/.cockpit-XXXXXX.tmp")
trap 'rm -f "$tmp"' EXIT

docker compose --env-file "$env_file" exec -T db pg_dump -U postgres -d cockpit | gzip > "$tmp"
# Renamed only once the dump succeeded, so a failed one never leaves a half file under the final name.
mv "$tmp" "$backup_dir/cockpit-$(date -u +%Y%m%d-%H%M%S).sql.gz"

find "$backup_dir" -name 'cockpit-*.sql.gz' -mtime +"$keep_days" -delete
