#!/usr/bin/env bash
set -euo pipefail

script="${BASH_SOURCE[0]%/*}/../../private_dot_config/herdr/scripts/executable_pick-attention-pane.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export XDG_STATE_HOME="$tmp/state" MOCK_SNAPSHOT="$tmp/snapshot.json" MOCK_FOCUS="$tmp/focus"

herdr() {
  case "$1 $2" in
    'api snapshot') jq -n --slurpfile snapshot "$MOCK_SNAPSHOT" '{result: {snapshot: $snapshot[0]}}' ;;
    'agent focus') printf '%s\n' "$3" >"$MOCK_FOCUS"; printf '{"result":{}}\n' ;;
    'notification show') printf '{"result":{}}\n' ;;
    *) return 1 ;;
  esac
}
export -f herdr

snapshot() {
  jq -n --arg focused "$1" --arg state "$2" '{
    focused_pane_id: $focused,
    agents: [
      {pane_id: "new", agent_status: $state, state_change_seq: 30},
      {pane_id: "middle", agent_status: "blocked", state_change_seq: 20},
      {pane_id: "old", agent_status: "blocked", state_change_seq: 10}
    ]
  }' >"$MOCK_SNAPSHOT"
}

expect_focus() {
  bash "$script"
  actual=$(<"$MOCK_FOCUS")
  if [[ "$actual" != "$1" ]]; then
    printf 'expected focus %s, got %s\n' "$1" "$actual" >&2
    exit 1
  fi
}

snapshot elsewhere done
expect_focus new
# A seen done agent drops out of the queue, but the cursor must survive.
snapshot new idle
expect_focus middle
# Checking something outside the queue must not reset the FILO cursor.
snapshot elsewhere idle
expect_focus old
# A blocked agent remains in the queue after focus. Continue past it, not
# back to the most recent notification.
snapshot old idle
expect_focus middle
snapshot middle idle
expect_focus old
# When the older agent was last visited, wrap around to the newest.
snapshot elsewhere done
expect_focus new
printf 'attention cycle ok\n'
