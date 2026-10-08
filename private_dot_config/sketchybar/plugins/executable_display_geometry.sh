#!/bin/bash

# The bar stays flush to the screen edge on every display (set once in
# bar=() in sketchybarrc, never overridden here) so it sits inline with
# Vorssaint's simulated Dynamic Island, which is itself anchored flush to
# the true top edge. This script's only remaining job is calendar.sh's
# q-vs-right placement, which depends on whether an external monitor is
# attached (q has no reserved centre gap on a non-notched display) and has
# no display-connect/disconnect event to key off, so this polls and
# re-runs that placement only when the monitor topology actually changed.
#
# Can't just count connected displays: in clamshell mode (lid closed, only
# the external monitor active) system_profiler reports exactly one display,
# same as native-only. Instead check each reported display for EDID-derived
# identity fields (vendor/product id, serial) -- present on real external
# monitors, absent on the built-in panel -- so clamshell-with-external is
# correctly told apart from native-only.

external_displays=$(system_profiler SPDisplaysDataType -json 2>/dev/null \
  | jq '[.SPDisplaysDataType[] | (.spdisplays_ndrvs // [])[]
         | select(has("_spdisplays_display-vendor-id"))] | length')

state_file="/tmp/sketchybar_external_displays"
previous=$(cat "$state_file" 2>/dev/null)

[ "$previous" = "${external_displays:-0}" ] && exit 0
echo "${external_displays:-0}" > "$state_file"

"$CONFIG_DIR/items/calendar.sh"
