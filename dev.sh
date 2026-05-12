#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# ── Preflight checks ─────────────────────────────────────────────────
for cmd in docker pnpm; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: $cmd is not installed" >&2
    exit 1
  fi
done

# ── 1. Start Postgres ────────────────────────────────────────────────
echo "==> Starting Postgres..."
docker compose up -d postgres
echo "    Waiting for healthy..."
until docker compose ps postgres --format json 2>/dev/null \
  | grep -q '"healthy"'; do
  sleep 1
done
echo "    Postgres is ready."

# ── 2. Create .env if missing ────────────────────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  echo "==> Created .env from .env.example"
else
  echo "==> .env already exists, skipping"
fi

# ── 3. Install deps + generate ────────────────────────────────────────
echo "==> Installing dependencies..."
pnpm install

echo "==> Generating Prisma client + kazam renderer..."
pnpm generate

# ── 4. Push schema to DB ─────────────────────────────────────────────
echo "==> Pushing schema to Postgres..."
npx prisma db push

# ── 5. Start dev server ──────────────────────────────────────────────
echo ""
echo "============================================"
echo "  curata dev server starting on :3000"
echo "  Open http://localhost:3000"
echo ""
echo "  To generate an API key (separate terminal):"
echo "    cd $(pwd)"
echo "    npx tsx packages/cli/src/index.ts api-key"
echo "============================================"
echo ""
exec pnpm dev
