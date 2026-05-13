#!/bin/sh
echo "[entrypoint] running prisma db push..."
npx prisma db push 2>&1
PUSH_EXIT=$?
if [ $PUSH_EXIT -ne 0 ]; then
  echo "[entrypoint] WARNING: prisma db push failed (exit $PUSH_EXIT)"
  echo "[entrypoint] The schema may need manual migration — run: npx prisma db push"
fi
echo "[entrypoint] starting server..."
exec npx next start -H 0.0.0.0 -p ${PORT:-3000}
