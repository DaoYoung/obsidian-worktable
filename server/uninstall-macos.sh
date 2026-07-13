#!/usr/bin/env bash
# uninstall-macos.sh — remove cloakfetch server from macOS
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$HOME/.cloakfetch-env"
LAUNCHD_PLIST="$HOME/Library/LaunchAgents/com.obsidian-worktable.cloakfetch.plist"
SERVICE_LABEL="com.obsidian-worktable.cloakfetch"

_launchctl_uses_bootstrap() {
  launchctl bootstrap 2>&1 | grep -q "Usage:" && return 0 || return 1
}

echo "[uninstall] stopping service..."
if _launchctl_uses_bootstrap; then
  launchctl bootout gui/"$(id -u)"/"$SERVICE_LABEL" 2>/dev/null || true
else
  launchctl unload "$LAUNCHD_PLIST" 2>/dev/null || true
fi

if [[ -f "$LAUNCHD_PLIST" ]]; then
  rm -f "$LAUNCHD_PLIST"
  echo "[uninstall] removed $LAUNCHD_PLIST"
fi

if [[ -d "$VENV_DIR" ]]; then
  rm -rf "$VENV_DIR"
  echo "[uninstall] removed venv $VENV_DIR"
fi

echo "[uninstall] config files in ~/.config/obsidian-worktable/ were preserved."
echo "[uninstall] to remove config: rm -rf ~/.config/obsidian-worktable/"
echo "[uninstall] cloakfetch server uninstalled."
