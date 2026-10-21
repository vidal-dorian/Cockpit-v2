#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
echo "Deploying Cockpit v$(tr -d '[:space:]' < version.txt) ($(git rev-parse --short HEAD))"

# Outside the checkout on purpose: the runner cleans its workspace (git clean) before each run.
export COCKPIT_DATA_DIR="${HOME:?}/cockpit/data"
export COCKPIT_UID COCKPIT_GID
COCKPIT_UID="$(id -u)"
COCKPIT_GID="$(id -g)"
mkdir -p "$COCKPIT_DATA_DIR"

# --wait fails the deploy (and the CD run) if Cockpit does not become healthy.
docker compose up --detach --build --wait --remove-orphans
# Old images pile up after each build and would fill the Pi's disk.
docker image prune --force
