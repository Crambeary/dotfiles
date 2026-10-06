#!/usr/bin/env bash
set -euo pipefail
source "${BASH_SOURCE[0]%/*}/lib-herdr.sh"

# Cycle through agents needing attention, newest notification first.
#
# Built-in prefix+o (open_notification_target) only fires while a notification
# target is visible. state_change_seq orders blocked/done agents by recency.
# Remember the last jump because focusing a done agent marks it idle, and a
# blocked agent can remain blocked. Keep the cursor even when the user checks
# another pane between presses, so the next jump goes to the next older agent.

cursor_file="${XDG_STATE_HOME:-$HOME/.local/state}/herdr/attention-cursor.json"
cursor='{}'
if [[ -f "$cursor_file" ]]; then
  cursor=$(jq -c 'if type == "object" then . else {} end' "$cursor_file" 2>/dev/null) || cursor='{}'
fi

target=$(herdr_json api snapshot | jq -c --argjson cursor "$cursor" '
  .result.snapshot as $snapshot
  | [$snapshot.agents[]
     | select(.agent_status == "blocked" or .agent_status == "done")
     | select(.pane_id != $snapshot.focused_pane_id)]
  | sort_by(-.state_change_seq) as $waiting
  | ($snapshot.focused_pane_id) as $focused
  | ($cursor.state_change_seq // ([$snapshot.agents[]
       | select(.pane_id == $focused and
                (.agent_status == "blocked" or .agent_status == "done"))
       | .state_change_seq] | first)) as $after
  | (if $after == null then $waiting[0]
     else ([$waiting[] | select(.state_change_seq < $after)] | first) // $waiting[0]
     end)
  | if . == null then empty else {pane_id, state_change_seq} end
')

if [[ -z "${target:-}" ]]; then
  herdr notification show "No other agents waiting" --sound none >/dev/null
  exit 0
fi

herdr_json agent focus "$(jq -r .pane_id <<<"$target")" >/dev/null
mkdir -p "${cursor_file%/*}"
printf '%s\n' "$target" >"$cursor_file"
