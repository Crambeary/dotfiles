#!/usr/bin/env bash
set -euo pipefail

# Bound to alt+h / alt+l. Focuses the neighboring pane in the given
# direction; if there's no pane there (tab edge), wraps to the
# previous/next tab instead, cycling continuously like zellij's
# move-focus-with-tab-wrap.
direction="$1" # left or right

result=$(herdr pane focus --direction "$direction")
changed=$(jq -r '.result.focus.changed' <<<"$result")
[[ "$changed" == "true" ]] && exit 0

tabs_json=$(herdr tab list --workspace "$HERDR_ACTIVE_WORKSPACE_ID" | jq -c '.result.tabs')
count=$(jq 'length' <<<"$tabs_json")
(( count <= 1 )) && exit 0

current_index=$(jq --arg cur "$HERDR_ACTIVE_TAB_ID" \
  'to_entries[] | select(.value.tab_id == $cur) | .key' <<<"$tabs_json")

if [[ "$direction" == "left" ]]; then
  next_index=$(( (current_index - 1 + count) % count ))
else
  next_index=$(( (current_index + 1) % count ))
fi

target_tab=$(jq -r ".[$next_index].tab_id" <<<"$tabs_json")
herdr tab focus "$target_tab"
