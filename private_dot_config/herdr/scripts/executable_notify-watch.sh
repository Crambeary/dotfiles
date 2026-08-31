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
#
# Failures are logged and skipped rather than fatal (so no lib-herdr.sh here):
# this loop is expected to outlive server restarts and binary upgrades, and
# should resume on its own once the server is healthy. The logging matters
# because the old `2>/dev/null` swallowed the reason: a protocol_mismatch after
# a herdr upgrade left the watcher polling nothing indefinitely, which looked
# exactly like "no agent ever changed state".
#
# The "last error" marker is a file, not a variable: poll runs inside a process
# substitution (`done < <(poll)`), so it is a subshell and any assignment it
# makes is discarded before the next tick.
poll_error_file="${TMPDIR:-/tmp}/herdr-notify-watch-$$.err"
trap 'rm -f "$poll_error_file"' EXIT
poll() {
  local snapshot problem
  snapshot=$(herdr api snapshot 2>&1)

  if jq -e 'has("result")' >/dev/null 2>&1 <<<"$snapshot"; then
    rm -f "$poll_error_file"
    jq -r '
      .result.snapshot.agents[]
      | "\(.pane_id)\t\(.agent_status)\t\(.focused)\t\(.terminal_title_stripped // .agent)"
    ' <<<"$snapshot"
    return 0
  fi

  problem=$(jq -r '.error.message // empty' <<<"$snapshot" 2>/dev/null | head -1)
  problem="${problem:-${snapshot:-no output}}"
  # Deduplicated: a broken server fails every tick, and at the 2s interval an
  # unguarded log line would bury everything else in the journal.
  if [[ "$problem" != "$(cat "$poll_error_file" 2>/dev/null)" ]]; then
    log "poll failed, retrying every ${INTERVAL}s: ${problem:0:200}"
    printf '%s' "$problem" >"$poll_error_file"
  fi
}

herdr_wid() {
  # Herdr sets the outer terminal title to "herdr"; that title is how we find
  # the Ghostty window hosting it. X11 only (xdotool can't see Wayland-native
  # surfaces) — this is the KDE/X11 path.
  xdotool search --name '^herdr$' 2>/dev/null | head -1
}

# COSMIC (Wayland-native, no XWayland fallback for xdotool) needs the
# compositor's own toplevel-activate protocol instead. cos-cli wraps
# zcosmic_toplevel_manager_v1, which — unlike xdg_activation — has no
# input-serial/token gating, so a background script can call it directly.
# https://github.com/estin/cos-cli
raise_herdr_cosmic() {
  local idx
  idx=$(cos-cli info --json 2>/dev/null | jq -r '.apps[] | select(.title=="herdr") | .index' | head -1)
  [[ -z "$idx" ]] && return 1
  cos-cli activate -i "$idx" >/dev/null 2>&1
}

# Hyprland (Wayland-native, no XWayland fallback for xdotool either — same
# reason as COSMIC above). Focusing the window also switches Hyprland to
# whatever workspace it lives on, which xdotool windowactivate never did
# even when it could see the window.
#
# This machine's `hyprctl dispatch` does NOT take the classic
# "dispatch focuswindow address:0x..." string form — it evaluates its
# argument as Lua (`return hl.dispatch(<arg>)`), per this build's Lua-based
# hyprland.lua config (see /usr/share/hypr/stubs/hl.meta.lua and the
# `hl.dsp.focus({ direction = ... })` calls in hyprland.lua). The
# corresponding window-selector form, confirmed live 2026-08-30, is
# hl.dsp.focus({ window = "address:0x..." }). A plain classic install
# without this Lua layer would just use `hyprctl dispatch focuswindow
# "address:$addr"` instead.
raise_herdr_hyprland() {
  local addr host
  # Herdr's default ui.window_title template is "{hostname}: {workspace}",
  # not the literal string "herdr" (confirmed against a live window on
  # 2026-08-30: title was "marc-fedora: Forge") — match the fixed hostname
  # prefix instead, since the workspace half varies per active workspace.
  host=$(hostname)
  addr=$(hyprctl clients -j 2>/dev/null | jq -r --arg prefix "$host: " \
    '.[] | select(.title | startswith($prefix)) | .address' | head -1)
  [[ -z "$addr" ]] && return 1
  hyprctl dispatch "hl.dsp.focus({ window = \"address:$addr\" })" >/dev/null 2>&1
}

raise_herdr() {
  # cos-cli only exists/succeeds under COSMIC; KDE (and anything else) falls
  # straight through to the xdotool/X11 path below, unchanged.
  if [[ "${XDG_CURRENT_DESKTOP:-}" == "COSMIC" ]] && command -v cos-cli >/dev/null 2>&1 \
      && raise_herdr_cosmic; then
    return 0
  fi
  if [[ "${XDG_CURRENT_DESKTOP:-}" == "Hyprland" ]] && command -v hyprctl >/dev/null 2>&1 \
      && raise_herdr_hyprland; then
    return 0
  fi
  local wid
  wid=$(herdr_wid)
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
    # stderr is dropped because notify-send prints "Wait timeout expired" to
    # it every time a toast goes unclicked, which is the normal case and was
    # burying the real log lines.
    action=$(notify-send --app-name=herdr --urgency=normal -t "$EXPIRE" \
      -A focus="Go to pane" \
      "${title:-Agent} — $verb" "$pane_id" 2>/dev/null)
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

    # No "you're already looking at it" suppression on purpose. Every attempt
    # to infer that produced silent misses instead of saved annoyance: the
    # snapshot's `focused` flag means "active pane within herdr", not "on
    # screen", and X11 focus survives a virtual-desktop switch. A redundant
    # toast costs 8 seconds of screen corner; a swallowed one costs a missed
    # agent. `focused` is still logged, just not acted on.
    notify "$pane_id" "$state" "$title"
  done < <(poll)
done
