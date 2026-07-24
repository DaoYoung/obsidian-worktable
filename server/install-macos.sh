#!/usr/bin/env bash
# install-macos.sh — install and configure cloakfetch server on macOS
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$HOME/.cloakfetch-env"
CFG_DIR="$HOME/.config/obsidian-worktable"
CFG_FILE="$CFG_DIR/server.json"
LAUNCHD_PLIST="$HOME/Library/LaunchAgents/com.obsidian-worktable.cloakfetch.plist"

# Determine launchctl bootstrap/fallback
_launchctl_uses_bootstrap() {
  launchctl bootstrap 2>&1 | grep -q "Usage:" && return 0 || return 1
}

# ── Create config directory ──────────────────────────────────────────────────
mkdir -p "$CFG_DIR"

# ── Generate service token if not already present ──────────────────────────────
if [[ -f "$CFG_FILE" ]]; then
  existing_token="$(python3 -c "import json; print(json.load(open('$CFG_FILE')).get('serviceToken',''))" 2>/dev/null || true)"
  if [[ -n "$existing_token" ]]; then
    echo "[install] service token already exists in $CFG_FILE"
  else
    TOKEN=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
    python3 -c "
import json, sys
path='$CFG_FILE'
try:
    with open(path) as f: d=json.load(f)
except Exception:
    d={}
d['serviceToken']='$TOKEN'
with open(path,'w') as f: json.dump(d, f, indent=2)
"
    echo "[install] generated service token in $CFG_FILE"
  fi
else
  TOKEN=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
  python3 -c "
import json
d={'serviceToken':'$TOKEN'}
with open('$CFG_FILE','w') as f: json.dump(d, f, indent=2)
"
  echo "[install] created $CFG_FILE with service token"
fi

# ── Create venv and install ───────────────────────────────────────────────────
if [[ -d "$VENV_DIR" ]]; then
  echo "[install] venv already exists at $VENV_DIR"
else
  echo "[install] creating venv at $VENV_DIR..."
  python3 -m venv "$VENV_DIR"
fi

echo "[install] installing requirements..."
"$VENV_DIR/bin/pip" install --quiet -r "$REPO_DIR/server/requirements.txt"

# ── Render and install launchd plist ─────────────────────────────────────────
REPO_CURRENT="$(cd "$REPO_DIR" && pwd)"
VENV_PYTHON="$VENV_DIR/bin/python3"
SERVICE_LABEL="com.obsidian-worktable.cloakfetch"

cat > "$LAUNCHD_PLIST" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${VENV_PYTHON}</string>
    <string>${REPO_CURRENT}/server/server.py</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${REPO_CURRENT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>/tmp/cloakfetch.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/cloakfetch.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${VENV_DIR}/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
PLIST

echo "[install] plist written to $LAUNCHD_PLIST"

# ── Load via launchctl ───────────────────────────────────────────────────────
if launchctl list | grep -q "$SERVICE_LABEL"; then
  echo "[install] unloading existing service..."
  if _launchctl_uses_bootstrap; then
    launchctl bootout gui/"$(id -u)"/"$SERVICE_LABEL" 2>/dev/null || true
  else
    launchctl unload "$LAUNCHD_PLIST" 2>/dev/null || true
  fi
fi

if _launchctl_uses_bootstrap; then
  echo "[install] loading via launchctl bootstrap..."
  launchctl bootstrap gui/"$(id -u)" "$LAUNCHD_PLIST"
else
  echo "[install] loading via launchctl load (legacy)..."
  launchctl load "$LAUNCHD_PLIST"
fi

echo "[install] cloakfetch server installed and loaded."
echo "[install] Manage with: $REPO_DIR/server/manage.sh"
