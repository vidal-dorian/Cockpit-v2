#!/bin/bash
# Installs the ponytail plugin in cloud sessions, which do not auto-install
# marketplaces declared in .claude/settings.json. Idempotent.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if claude plugin list 2>/dev/null | grep -q 'ponytail@ponytail'; then
  exit 0
fi

claude plugin marketplace add DietrichGebert/ponytail
claude plugin install ponytail@ponytail
