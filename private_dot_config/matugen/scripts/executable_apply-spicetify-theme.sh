#!/usr/bin/env bash
# Regenerates the spicetify CSS from the freshly-templated color.ini, then
# pushes it into a running Spotify without a full page reload -- see
# spicetify-cdp-reload-colors.mjs for why that matters (a full reload via
# "spicetify watch" resets the SPA back to Home). Falls back to that full
# reload only if Spotify's remote-debugging port isn't up yet.
set -euo pipefail

export PATH="$HOME/.spicetify:$PATH"
export PATH="/home/linuxbrew/.linuxbrew/bin:$PATH"

pgrep -x spotify >/dev/null 2>&1 || exit 0

spicetify refresh -s >/dev/null 2>&1 || true

if ! node "$HOME/.config/matugen/scripts/spicetify-cdp-reload-colors.mjs" >/dev/null 2>&1; then
  spicetify watch -s 2>&1 | sed '/Reloaded Spotify/q' >/dev/null 2>&1 || true
fi
