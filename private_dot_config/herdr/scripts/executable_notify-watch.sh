#!/usr/bin/env bash
set -uo pipefail

# Click-to-pane for Linux.
#
# Herdr's own toasts (ui.toast.delivery = "terminal") go out as OSC escapes to
# Ghostty, which has no return channel — clicking one can raise the Ghostty
# window but can never say *which pane* asked. This watcher posts the toast
# itself via libnotify instead, so the action button carries the pane id and
# the click lands you on the right pane.
#
# Cost: one `herdr api snapshot` per interval. Measured ~2ms CPU / ~7ms wall
# against a 10KB payload, so at the 2s default this is ~0.1% of one core.
#
# Set ui.toast.delivery = "off" in config.toml while this runs, or every
# notification arrives twice.

INTERVAL="${HERDR_NOTIFY_INTERVAL:-2}"

# Popup lifetime in ms. KDE ignores this for urgency=critical, which is why
# the toasts stay at normal urgency.
EXPIRE="${HERDR_NOTIFY_EXPIRE:-8000}"

# Everything goes to stderr -> the journal. Without this the only way to tell
# "never fired" from "fired and notify-send failed" is guesswork.
log() { echo "[$(date +%T)] $*" >&2; }

# One snapshot per tick, formatted as pane_id / status / focused / title.
poll() {
  herdr api snapshot 2>/dev/null | jq -r '
    .result.snapshot.agents[]
    | "\(.pane_id)\t\(.agent_status)\t\(.focused)\t\(.terminal_title_stripped // .agent)"
  '
}

raise_herdr() {
  # Herdr sets the outer terminal title to "herdr"; that title is how we find
  # the Ghostty window hosting it. X11 only — a Wayland session would need
  # the compositor's own activation path instead.
  local wid
  wid=$(xdotool search --name '^herdr$' 2>/dev/null | head -1)
  [[ -n "$wid" ]] && xdotool windowactivate "$wid" 2>/dev/null
  return 0
}

# notify-send -A implies --wait, so each toast owns a background subshell or
# the poll loop stalls until the user clicks something.
notify() {
  local pane_id="$1" state="$2" title="$3" verb
  [[ "$state" == "blocked" ]] && verb="needs input" || verb="finished"
  log "NOTIFY $pane_id ($state) \"$title\""
  (
    local action rc
    # Expires on its own. Missing the popup costs nothing now that prefix+o
    # finds the same pane from the snapshot whenever you get to it, so there's
    # no reason to leave toasts sitting in the tray demanding a dismissal.
    action=$(notify-send --app-name=herdr --urgency=normal -t "$EXPIRE" \
      -A focus="Go to pane" \
      "${title:-Agent} — $verb" "$pane_id")
    rc=$?
    log "  notify-send rc=$rc action=${action:-<none>} pane=$pane_id"
    if [[ "$action" == "focus" ]]; then
      herdr agent focus "$pane_id" >/dev/null 2>&1
      log "  agent focus rc=$? pane=$pane_id"
      raise_herdr
    fi
  ) &
}

declare -A last_state

# Seed from the current snapshot so starting the watcher doesn't fire a
# notification for every agent already sitting in done/blocked.
while IFS=$'\t' read -r pane_id state _ _; do
  [[ -n "$pane_id" ]] && last_state["$pane_id"]="$state"
done < <(poll)

while true; do
  sleep "$INTERVAL"

  while IFS=$'\t' read -r pane_id state focused title; do
    [[ -z "$pane_id" ]] && continue
    prev="${last_state[$pane_id]:-}"
    last_state["$pane_id"]="$state"

    # Only the transition fires, not the resting state.
    [[ "$state" == "$prev" ]] && continue
    log "transition $pane_id: ${prev:-<new>} -> $state (focused=$focused)"

    # Idle is deliberately not an attention state — agents pass through it
    # while settling, and every finished turn would notify twice.
    if [[ "$state" != "blocked" && "$state" != "done" ]]; then
      log "  skip: $state is not an attention state"
      continue
    fi

    # A pane you're already looking at doesn't need a toast.
    if [[ "$focused" == "true" ]]; then
      log "  skip: pane is focused"
      continue
    fi

    notify "$pane_id" "$state" "$title"
  done < <(poll)
done
