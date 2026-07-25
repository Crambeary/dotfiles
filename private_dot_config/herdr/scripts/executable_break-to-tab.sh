#!/usr/bin/env bash
set -euo pipefail
state_dir="$HOME/.local/state/herdr/break-origin"
mkdir -p "$state_dir"
echo "$HERDR_ACTIVE_TAB_ID" > "$state_dir/$HERDR_ACTIVE_PANE_ID"
herdr pane move "$HERDR_ACTIVE_PANE_ID" --new-tab --focus
