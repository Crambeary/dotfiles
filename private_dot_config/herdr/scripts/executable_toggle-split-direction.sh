#!/usr/bin/env bash
set -euo pipefail
source "${BASH_SOURCE[0]%/*}/lib-herdr.sh"
pane_id="$HERDR_ACTIVE_PANE_ID"
tab_id="$HERDR_ACTIVE_TAB_ID"

layout=$(herdr_json pane layout --pane "$pane_id" | jq -c '.result.layout')

pane_count=$(echo "$layout" | jq '.panes | length')
split_count=$(echo "$layout" | jq '.splits | length')
if [[ "$pane_count" != "2" || "$split_count" != "1" ]]; then
  # only handles a simple two-pane single split; leave complex layouts alone
  exit 0
fi

direction=$(echo "$layout" | jq -r '.splits[0].direction')
other_pane=$(echo "$layout" | jq -r --arg me "$pane_id" '.panes[] | select(.pane_id != $me) | .pane_id')

new_direction="down"
if [[ "$direction" == "down" ]]; then
  new_direction="right"
fi

herdr_json pane move "$pane_id" --new-tab >/dev/null
herdr_json pane move "$pane_id" --tab "$tab_id" --split "$new_direction" --target-pane "$other_pane" --focus
