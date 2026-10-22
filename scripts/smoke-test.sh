#!/usr/bin/env bash
# Acceptance tests of slice 1.2: brings the Compose stack up in its own project and checks it.
set -euo pipefail

cd "$(dirname "$0")/.."
# Compose gives this variable precedence over `name:`, so real data is never touched.
export COMPOSE_PROJECT_NAME=cockpit-smoke

TMP=$(mktemp -d)
ENV="$TMP/cockpit.env"
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" > "$ENV"
URL=http://127.0.0.1:3000
VERSION=$(tr -d '[:space:]' < version.txt)
FAILED=0

dc() { docker compose --env-file "$ENV" "$@"; }
cleanup() { dc down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

# check "description" command...: prints PASS/FAIL and remembers failures instead of exiting.
check() {
  local what=$1; shift
  if "$@"; then echo "PASS: $what"; else echo "FAIL: $what"; FAILED=1; fi
}

# Retries a command for about 30 s (the app needs a moment to reconnect after a database restart).
retry() { for _ in $(seq 30); do "$@" && return 0; sleep 1; done; return 1; }

health_version() {
  curl -fsS "$URL/api/health" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0, "utf8")).version)'
}

# Captured first: grep -q closing the pipe early would make curl fail under pipefail.
has_page() { local body; body=$(curl -fsS "$URL/") && grep -q '<title>' <<< "$body"; }

runs_hardened() {
  [ "$(dc exec -T app id -u | tr -d '[:space:]')" != 0 ] && ! dc exec -T app test -e node_modules/vitest
}

users_row_survives_down_up() {
  dc exec -T db psql -U postgres -d cockpit -c "insert into users (github_id, login) values (42, 'smoke')" &&
    dc down && dc up -d --wait --wait-timeout 180 &&
    [ "$(dc exec -T db psql -U postgres -d cockpit -tAc "select count(*) from users where github_id = 42" | tr -d '[:space:]')" = 1 ]
}

db_healthy() { [ "$(docker inspect -f '{{.State.Health.Status}}' "$(dc ps -q db)")" = healthy ]; }

app_survives_db_restart() {
  local app_id
  app_id=$(dc ps -q app)
  dc restart db &&
    retry db_healthy &&
    retry curl -fsS -o /dev/null "$URL/api/health" &&
    # Read last: a crash caused by the first request would be hidden by Docker restarting the app.
    [ "$(docker inspect -f '{{.RestartCount}} {{.State.Running}}' "$app_id")" = "0 true" ]
}

backup_rotates() {
  local dir=$TMP/backups
  mkdir -p "$dir"
  touch -d '30 days ago' "$dir/cockpit-old.sql.gz"
  COCKPIT_ENV_FILE=$ENV BACKUP_DIR=$dir scripts/backup.sh || return 1
  [ ! -e "$dir/cockpit-old.sql.gz" ] || return 1
  local files=("$dir"/cockpit-*.sql.gz)
  [ ${#files[@]} = 1 ] && [ -e "${files[0]}" ] || return 1
  gzip -dc "${files[0]}" > "$TMP/dump.sql" && grep -q 'CREATE TABLE public.users' "$TMP/dump.sql"
}

# With no database container, backup.sh must fail and leave nothing behind, not even a partial file.
backup_fails_cleanly_without_db() {
  local dir=$TMP/empty-backups rc=0
  mkdir -p "$dir"
  COMPOSE_PROJECT_NAME=cockpit-smoke-nodb COCKPIT_ENV_FILE=$ENV BACKUP_DIR=$dir scripts/backup.sh >/dev/null 2>&1 || rc=$?
  [ "$rc" != 0 ] && [ -z "$(ls -A "$dir")" ]
}

# deploy.sh must refuse before calling Compose; $1 = env file, $2 = text expected on stderr.
deploy_refuses() {
  local rc=0 err
  err=$(COCKPIT_ENV_FILE=$1 scripts/deploy.sh 2>&1 >/dev/null) || rc=$?
  [ "$rc" != 0 ] && grep -qF -- "$2" <<< "$err"
}

deploy_refuses_without_tunnel_token() {
  echo "POSTGRES_PASSWORD=x" > "$TMP/partial.env"
  deploy_refuses "$TMP/partial.env" TUNNEL_TOKEN
}

# The stack starts without the tunnel profile; --wait returns once every service is healthy.
if dc up -d --build --wait --wait-timeout 180; then
  check "GET /api/health returns 200 and the version of version.txt" \
    test "$(health_version)" = "$VERSION"
  check "GET / serves the built page" has_page
  check "app runs as non-root and ships no dev dependencies" runs_hardened
  check "users row survives down (without -v) then up" users_row_survives_down_up
  check "app is not restarted by a database restart and recovers" app_survives_db_restart
  check "backup.sh writes a gzipped dump and deletes old ones" backup_rotates
else
  echo "FAIL: the stack did not start with 'docker compose up -d --build --wait' (compose.yaml, Dockerfile or healthchecks missing or broken)"
  FAILED=1
fi

check "backup.sh fails and leaves no file when the database is not running" backup_fails_cleanly_without_db
check "deploy.sh refuses a missing env file and names its path" \
  deploy_refuses "$TMP/missing.env" "$TMP/missing.env"
check "deploy.sh refuses an env file without TUNNEL_TOKEN" deploy_refuses_without_tunnel_token

exit "$FAILED"
