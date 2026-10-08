#!/bin/bash

# Runs both sourced from sketchybarrc (PLUGIN_DIR/FONT already set) and
# executed standalone by display_geometry.sh (only CONFIG_DIR is set there).
PLUGIN_DIR="${PLUGIN_DIR:-$CONFIG_DIR/plugins}"
FONT="${FONT:-SF Pro}"

calendar=(
  icon=􀐫
  icon.font="$FONT:Black:12.0"
  icon.padding_right=0
  label.align=right
  padding_left=15
  padding_right=10
  update_freq=30
  script="$PLUGIN_DIR/calendar.sh"
  click_script="$PLUGIN_DIR/zen.sh"
)

# Position "q" (immediately left of the notch) only gets a reserved centre gap
# on the notched built-in display -- the gap comes from the hardware notch,
# not from notch_width, so it does not exist on an external monitor and q
# items butt up against the bar's exact midpoint there. That midpoint is also
# where Vorssaint's simulated Dynamic Island renders on a non-notched display,
# so q and the island collide. Keep calendar at q on the native display, fall
# back to the right cluster on an external monitor.
#
# --remove then --add makes this idempotent, which lets display_geometry.sh
# re-run this file whenever it detects a monitor change.
external_displays=$(system_profiler SPDisplaysDataType -json 2>/dev/null \
  | jq '[.SPDisplaysDataType[] | (.spdisplays_ndrvs // [])[]
         | select(has("_spdisplays_display-vendor-id"))] | length')

if [ "${external_displays:-0}" -ge 1 ]; then
  position=right
else
  position=q
fi

sketchybar --remove calendar >/dev/null 2>&1
sketchybar --add item calendar "$position" \
           --set calendar "${calendar[@]}" \
           --subscribe calendar system_woke
