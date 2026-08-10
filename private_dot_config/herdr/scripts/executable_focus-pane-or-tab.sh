#!/usr/bin/env bash
set -euo pipefail
source "${BASH_SOURCE[0]%/*}/lib-herdr.sh"

# Bound to alt+h / alt+l / alt+j / alt+k. Focuses the neighboring pane in
# the given direction; if there's no pane there (tab edge), wraps to the
# previous/next tab instead, cycling continuously like zellij's
# move-focus-with-tab-wrap. left/up wrap to the previous tab, right/down
# wrap to the next tab.
direction="$1" # left, right, up, or down

result=$(herdr_json pane focus --direction "$direction")
changed=$(jq -r '.result.focus.changed' <<<"$result")
[[ "$changed" == "true" ]] && exit 0

tabs_json=$(herdr_json tab list --workspace "$HERDR_ACTIVE_WORKSPACE_ID" | jq -c '.result.tabs')
count=$(jq 'length' <<<"$tabs_json")
(( count <= 1 )) && exit 0

current_index=$(jq --arg cur "$HERDR_ACTIVE_TAB_ID" \
  'to_entries[] | select(.value.tab_id == $cur) | .key' <<<"$tabs_json")

if [[ "$direction" == "left" || "$direction" == "up" ]]; then
  next_index=$(( (current_index - 1 + count) % count ))
else
  next_index=$(( (current_index + 1) % count ))
fi

target_tab=$(jq -r ".[$next_index].tab_id" <<<"$tabs_json")
herdr_json tab focus "$target_tab" >/dev/null

# Land on the entry-side edge pane of the target tab, not whatever pane it
# last had focused: push focus in the opposite direction until it stops
# changing, so wrapping left lands on the target tab's rightmost pane (as
# if continuing leftward through a ring of columns), wrapping up lands on
# its bottommost pane, and so on.
case "$direction" in
  left) opposite=right ;;
  right) opposite=left ;;
  up) opposite=down ;;
  down) opposite=up ;;
esac

for _ in $(seq 1 32); do
  push_result=$(herdr_json pane focus --direction "$opposite")
  push_changed=$(jq -r '.result.focus.changed' <<<"$push_result")
  [[ "$push_changed" == "true" ]] || break
done
