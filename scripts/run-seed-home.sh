#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Load .env so DATABASE_URL is available to tsx (Next.js loads this automatically
# at runtime, but standalone scripts need it explicitly)
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
pnpm tsx scripts/seed-home.ts
