#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
echo "Deploying Cockpit v$(tr -d '[:space:]' < version.txt) ($(git rev-parse --short HEAD))"

# --wait fails the deploy (and the CD run) if Cockpit does not become healthy.
docker compose up --detach --build --wait --remove-orphans
# Old images pile up after each build and would fill the Pi's disk.
docker image prune --force
