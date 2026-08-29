#!/usr/bin/env bash
set -euo pipefail
source "${BASH_SOURCE[0]%/*}/lib-herdr.sh"

# Bound to alt+minus/alt+equal (width) and alt+shift+minus/alt+shift+equal
# (height), mirroring Hyprland's Super+-/= resize bindings.
#
# `herdr pane resize --direction X` moves the border in absolute screen
# direction X, not "grow/shrink the focused pane" — so growing the focused
# pane means pushing the border towards whichever neighbor is donating
# space. Concretely: with a neighbor on the left, direction=left grows the
# focused pane (and direction=right shrinks it back); with a neighbor on the
# right, it's the mirror. Same rule for up/down with height. This script
# looks up which neighbor actually exists and picks the matching direction,
# so the same two keys grow/shrink regardless of which side of a split the
# focused pane sits on.
#
# --amount is a fraction of the split ratio (0-1), not a cell count: 0.02
# moves the divider by 2% of the pane's span per press. 0.02 was chosen by
# feel — 0.05 felt too fast.
axis="$1"   # width or height
sign="$2"   # grow or shrink
amount="${3:-0.02}"

case "$axis" in
  width) primary=right; fallback=left ;;
  height) primary=down; fallback=up ;;
  *) herdr_script_fail "unknown axis: $axis" ;;
esac

neighbor_side=""
for side in "$primary" "$fallback"; do
  result=$(herdr_json pane neighbor --direction "$side" --current)
  if jq -e '.result.neighbor.neighbor_pane_id' >/dev/null 2>&1 <<<"$result"; then
    neighbor_side="$side"
    break
  fi
done

# No neighbor on this axis (e.g. a lone pane) — nothing to resize.
[[ -n "$neighbor_side" ]] || exit 0

case "$sign" in
  grow) direction="$neighbor_side" ;;
  shrink)
    case "$neighbor_side" in
      left) direction=right ;;
      right) direction=left ;;
      up) direction=down ;;
      down) direction=up ;;
    esac
    ;;
  *) herdr_script_fail "unknown sign: $sign" ;;
esac

herdr_json pane resize --direction "$direction" --amount "$amount" --current >/dev/null
