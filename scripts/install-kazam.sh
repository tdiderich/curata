#!/usr/bin/env bash
set -euo pipefail

# Download the latest kazam release binary into .bin/kazam
# Checks the release tag_name to skip re-downloads when unchanged.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$REPO_ROOT/.bin"
KAZAM="$BIN_DIR/kazam"
VERSION_FILE="$BIN_DIR/.kazam-version"

mkdir -p "$BIN_DIR"

# Detect platform
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) ASSET="kazam-darwin-arm64" ;;
  Darwin-x86_64) ASSET="kazam-darwin-arm64" ;; # Rosetta handles arm64
  Linux-x86_64) ASSET="kazam-linux-amd64" ;;
  *) echo "unsupported platform: $(uname -s)-$(uname -m)"; exit 1 ;;
esac

LATEST_URL="https://github.com/tdiderich/kazam/releases/latest/download/$ASSET"

# Check if release has changed by comparing published_at timestamp
REMOTE_TS=$(curl -fsSL "https://api.github.com/repos/tdiderich/kazam/releases/latest" 2>/dev/null \
  | grep '"published_at"' | head -1 | sed 's/.*: "//;s/".*//' || true)

if [ -f "$KAZAM" ] && [ -f "$VERSION_FILE" ] && [ -n "$REMOTE_TS" ]; then
  LOCAL_TS=$(cat "$VERSION_FILE")
  if [ "$REMOTE_TS" = "$LOCAL_TS" ]; then
    echo "kazam binary matches latest release ($REMOTE_TS), skipping download"
    exit 0
  fi
fi

echo "downloading kazam from $LATEST_URL"
curl -fSL "$LATEST_URL" -o "$KAZAM"
chmod +x "$KAZAM"
[ -n "$REMOTE_TS" ] && echo "$REMOTE_TS" > "$VERSION_FILE"
echo "installed kazam to $KAZAM"
