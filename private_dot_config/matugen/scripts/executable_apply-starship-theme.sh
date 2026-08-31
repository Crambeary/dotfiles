#!/usr/bin/env bash
set -euo pipefail

config="${STARSHIP_CONFIG_PATH:-$HOME/.config/starship.toml}"
theme="${STARSHIP_MATUGEN_THEME_PATH:-$HOME/.config/starship-matugen-theme.toml}"
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

# Overwrite the existing file's contents in place instead of mv'ing the temp
# file over it. mv swaps in mktemp's inode (mode 0600), silently dropping
# whatever permissions chezmoi set (0644) -- which then makes every
# `chezmoi apply` see the file as changed externally and prompt about it.
cat "$temporary_config" > "$config"
rm -f "$temporary_config"
trap - EXIT

# No reload needed: starship re-reads its config file on every prompt render.
