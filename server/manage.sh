#!/usr/bin/env bash
# manage.sh — start/stop/restart/status for cloakfetch server
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_LABEL="com.obsidian-worktable.cloakfetch"
LAUNCHD_PLIST="$HOME/Library/LaunchAgents/com.obsidian-worktable.cloakfetch.plist"

_launchctl_uses_bootstrap() {
  launchctl bootstrap 2>&1 | grep -q "Usage:" && return 0 || return 1
}

cmd="${1:-status}"

case "$cmd" in
  start)
    if launchctl list | grep -q "$SERVICE_LABEL"; then
      echo "[manage] service already loaded"
      exit 0
    fi
    if [[ ! -f "$LAUNCHD_PLIST" ]]; then
      echo "[manage] plist not found: $LAUNCHD_PLIST"
      echo "[manage] run install-macos.sh first"
      exit 1
    fi
    if _launchctl_uses_bootstrap; then
      launchctl bootstrap gui/"$(id -u)" "$LAUNCHD_PLIST"
    else
      launchctl load "$LAUNCHD_PLIST"
    fi
    echo "[manage] service started"
    ;;
  stop)
    if _launchctl_uses_bootstrap; then
      launchctl bootout gui/"$(id -u)"/"$SERVICE_LABEL" 2>/dev/null || echo "[manage] service not running"
    else
      launchctl unload "$LAUNCHD_PLIST" 2>/dev/null || echo "[manage] service not running"
    fi
    echo "[manage] service stopped"
    ;;
  restart)
    if _launchctl_uses_bootstrap; then
      launchctl bootout gui/"$(id -u)"/"$SERVICE_LABEL" 2>/dev/null || true
      launchctl bootstrap gui/"$(id -u)" "$LAUNCHD_PLIST"
    else
      launchctl unload "$LAUNCHD_PLIST" 2>/dev/null || true
      launchctl load "$LAUNCHD_PLIST"
    fi
    echo "[manage] service restarted"
    ;;
  status)
    if launchctl list | grep -q "$SERVICE_LABEL"; then
      echo "[manage] service is loaded"
      # Try to get PID
      pid=$(launchctl list | grep "$SERVICE_LABEL" | awk '{print $1}' | head -1)
      if [[ "$pid" != "-" && -n "$pid" ]]; then
        echo "[manage] PID: $pid"
      fi
    else
      echo "[manage] service is not loaded"
    fi
    ;;
  log)
    tail -50 /tmp/cloakfetch.log 2>/dev/null || echo "no log found"
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|log}"
    exit 1
    ;;
esac
