#!/bin/bash
# Sets KWin's focus-stealing prevention to None so that clicking a desktop
# notification actually *activates* the window. At the default level (1/Low)
# KWin refuses the activation and downgrades it to "demands attention", which
# is why a notification click only highlights the task bar entry. Once
# activation succeeds, KWin's ActivationDesktopPolicy (default
# SwitchToOtherDesktop) follows the window to its virtual desktop for free.
#
# Managed as a setting rather than a file: ~/.config/kwinrc is in
# .chezmoiignore because it's session-state churn (desktop UUIDs, popup
# geometry, screen res), so tracking the whole file would sync noise. This is
# the same merge-one-key approach as configure-claude-statusline.sh.
#
# Self-gating: no-ops on any machine without kwriteconfig6, so it's safe on
# non-KDE Linux, macOS, and Windows without needing a .chezmoiignore entry.
#
# Re-runs (via run_onchange) whenever the value below changes.
# FocusStealingPreventionLevel: 0
set -euo pipefail

command -v kwriteconfig6 >/dev/null 2>&1 || exit 0

kwriteconfig6 --file kwinrc --group Windows --key FocusStealingPreventionLevel 0

# Apply live if KWin is running; a no-op during first-run provisioning.
for q in qdbus6 qdbus qdbus-qt6; do
  if command -v "$q" >/dev/null 2>&1; then
    "$q" org.kde.KWin /KWin reconfigure >/dev/null 2>&1 || true
    break
  fi
done
