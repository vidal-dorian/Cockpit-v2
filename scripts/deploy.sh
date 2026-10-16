#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
echo "Deploying Cockpit v$(tr -d '[:space:]' < version.txt) ($(git rev-parse --short HEAD))"

# TODO: replace with the real deployment (docker compose up -d --build, systemctl restart, ...).
