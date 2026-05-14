#!/usr/bin/env bash
set -euo pipefail

# Download the latest kazam release binary into .bin/kazam
# This ensures local builds use the same binary as CI.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$REPO_ROOT/.bin"
KAZAM="$BIN_DIR/kazam"

mkdir -p "$BIN_DIR"

# Detect platform
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) ASSET="kazam-darwin-arm64" ;;
  Darwin-x86_64) ASSET="kazam-darwin-arm64" ;; # Rosetta handles arm64
  Linux-x86_64) ASSET="kazam-linux-amd64" ;;
  *) echo "unsupported platform: $(uname -s)-$(uname -m)"; exit 1 ;;
esac

LATEST_URL="https://github.com/tdiderich/kazam/releases/latest/download/$ASSET"

# Skip if binary exists and is less than 1 day old
if [ -f "$KAZAM" ]; then
  if find "$KAZAM" -mmin -1440 -print -quit 2>/dev/null | grep -q .; then
    echo "kazam binary is fresh (< 1 day old), skipping download"
    exit 0
  fi
fi

echo "downloading kazam from $LATEST_URL"
curl -fL "$LATEST_URL" -o "$KAZAM"
chmod +x "$KAZAM"
echo "installed kazam to $KAZAM"
