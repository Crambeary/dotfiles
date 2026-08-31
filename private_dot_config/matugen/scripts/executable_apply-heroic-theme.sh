#!/usr/bin/env bash
set -euo pipefail

# Heroic doesn't watch its custom theme CSS file -- it only re-reads it from
# disk inside window.setTheme(), which runs once at startup and again on
# Settings > Select Theme change. There's no IPC signal it listens for (unlike
# helix/opencode's SIGUSR1/SIGUSR2), so the only way to push a live update is
# to make it reload its own window.
#
# Ctrl+R (mainWindow.reload()) does that, but sending it as a normal keypress
# doesn't reach Heroic -- Hyprland's global bind handling swallows it first.
# hl.dsp.send_shortcut bypasses that by delivering the shortcut straight to
# the matching window instead of going through the compositor's bind table.
# (This Hyprland build parses `hyprctl dispatch <text>` as Lua -- the classic
# "sendshortcut MODS,KEY,WINDOW" string dispatcher doesn't exist here.)
command -v hyprctl >/dev/null 2>&1 || exit 0
hyprctl clients -j 2>/dev/null | python3 -c '
import json, sys
clients = json.load(sys.stdin)
sys.exit(0 if any(c.get("class") == "com.heroicgameslauncher.hgl" for c in clients) else 1)
' || exit 0

hyprctl dispatch "hl.dsp.send_shortcut({mods='CTRL', key='R', window='class:^(com.heroicgameslauncher.hgl)\$'})" >/dev/null 2>&1 || true
