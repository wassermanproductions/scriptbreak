#!/usr/bin/env bash
# ScriptBreak macOS installer
#
# Downloads the latest release and installs it to /Applications, bypassing
# the Gatekeeper "app is damaged" false alarm that macOS shows for
# browser-downloaded unsigned apps (terminal downloads aren't quarantined).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/wassermanproductions/scriptbreak/master/install.sh | bash
set -euo pipefail

REPO="wassermanproductions/scriptbreak"

case "$(uname -m)" in
  arm64)  ASSET="ScriptBreak_aarch64.app.tar.gz" ;;
  x86_64) ASSET="ScriptBreak_x64.app.tar.gz" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

DEST="/Applications"
if [ ! -w "$DEST" ]; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading the latest ScriptBreak ($(uname -m))..."
curl -fL --progress-bar "https://github.com/$REPO/releases/latest/download/$ASSET" -o "$TMP/$ASSET"

echo "Installing to $DEST..."
rm -rf "$DEST/ScriptBreak.app"
tar -xzf "$TMP/$ASSET" -C "$DEST"
xattr -cr "$DEST/ScriptBreak.app" 2>/dev/null || true

echo "✓ ScriptBreak installed — launching."
open "$DEST/ScriptBreak.app"
