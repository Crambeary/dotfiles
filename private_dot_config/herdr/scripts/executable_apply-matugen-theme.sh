#!/usr/bin/env bash
set -euo pipefail

config="${HERDR_CONFIG_PATH:-$HOME/.config/herdr/config.toml}"
theme="${HERDR_MATUGEN_THEME_PATH:-$HOME/.config/herdr/matugen-theme.toml}"
start_marker="# BEGIN MATUGEN THEME"
end_marker="# END MATUGEN THEME"

if [[ ! -f "$config" || ! -f "$theme" ]]; then
  exit 0
fi

temporary_config="$(mktemp "${config}.XXXXXX")"
trap 'rm -f "$temporary_config"' EXIT

awk -v theme="$theme" -v start_marker="$start_marker" -v end_marker="$end_marker" '
  BEGIN {
    while ((getline line < theme) > 0) generated = generated line ORS
    close(theme)
  }
  $0 == start_marker {
    if (inside) exit 1
    print
    printf "%s", generated
    inside = 1
    found = 1
    next
  }
  $0 == end_marker {
    if (!inside) exit 1
    print
    inside = 0
    next
  }
  !inside { print }
  END { if (!found || inside) exit 1 }
' "$config" > "$temporary_config"

mv "$temporary_config" "$config"
trap - EXIT

herdr server reload-config >/dev/null 2>&1 || true
