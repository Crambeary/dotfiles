#!/usr/bin/env bash
set -euo pipefail
state_file="$HOME/.local/state/herdr/break-origin/$HERDR_ACTIVE_PANE_ID"
if [[ -f "$state_file" ]]; then
  target_tab="$(cat "$state_file")"
  rm -f "$state_file"
  herdr pane move "$HERDR_ACTIVE_PANE_ID" --tab "$target_tab" --split right --focus
fi
