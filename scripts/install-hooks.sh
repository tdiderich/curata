#!/usr/bin/env bash
set -euo pipefail

# Install git hooks from scripts/hooks/ into .git/hooks/
REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$REPO_ROOT/scripts/hooks"

for hook in "$HOOKS_DIR"/*; do
  name="$(basename "$hook")"
  target="$REPO_ROOT/.git/hooks/$name"
  cp "$hook" "$target"
  chmod +x "$target"
  echo "installed $name"
done

echo "done — hooks active"
