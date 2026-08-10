#!/usr/bin/env bash
set -euo pipefail
source "${BASH_SOURCE[0]%/*}/lib-herdr.sh"
state_dir="$HOME/.local/state/herdr/break-origin"
mkdir -p "$state_dir"
echo "$HERDR_ACTIVE_TAB_ID" > "$state_dir/$HERDR_ACTIVE_PANE_ID"
herdr_json pane move "$HERDR_ACTIVE_PANE_ID" --new-tab --focus
