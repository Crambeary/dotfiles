#!/usr/bin/env bash
set -euo pipefail
source "${BASH_SOURCE[0]%/*}/lib-herdr.sh"

# Linux stand-in for "jump to the pane that just notified me".
#
# Built-in prefix+o (open_notification_target) only fires while a notification
# target is still visible. This instead reads the live snapshot and jumps to
# the agent whose state changed most recently — `state_change_seq` is a
# monotonic counter, so the highest one *is* the newest notification.
#
# Only blocked (needs input) and done (finished) count as notifications;
# idle and working panes never asked for anything. The currently focused
# pane is skipped, so pressing the key repeatedly walks back through the
# attention queue newest-first instead of sticking on one pane.

target=$(herdr_json api snapshot \
  | jq -r '
      [.result.snapshot.agents[]
       | select(.agent_status == "blocked" or .agent_status == "done")
       | select(.focused != true)]
      | max_by(.state_change_seq)
      | .pane_id // empty
    ')

if [[ -z "${target:-}" ]]; then
  herdr notification show "No agents waiting" --sound none >/dev/null
  exit 0
fi

herdr_json agent focus "$target" >/dev/null
