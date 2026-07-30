#!/usr/bin/env bash
set -euo pipefail

# prefix+shift+d: review a diff in any directory, not just the launching
# pane's cwd (prefix+d covers that case already). Runs inside the popup's
# own terminal: fzf picks a directory here, then tuicr replaces the picker
# in the same pane.

mapfile -t ghq_dirs < <(find "$HOME/ghq" -mindepth 3 -maxdepth 3 -type d 2>/dev/null)

candidates=("$PWD" "$HOME/.local/share/chezmoi" "${ghq_dirs[@]}")

target=$(printf '%s\n' "${candidates[@]}" | sort -u | fzf --prompt="review diff in > ")
[[ -n "${target:-}" ]] || exit 0

cd "$target"
exec "$HOME/.config/herdr/scripts/run-tuicr-here.sh"
