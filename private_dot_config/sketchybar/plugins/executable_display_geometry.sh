#!/bin/bash

# sketchybar's --bar margin/corner_radius have no per-notch override (only
# height/notch_display_height and y_offset/notch_offset do), and there is no
# display-connect/disconnect event, so this polls for an external monitor and
# reissues --bar only when the monitor state actually changed: flush to the
# screen edges on the native display alone, floating with a top gap once an
# external monitor joins.
#
# margin only insets the bar horizontally (reduces width, shifts x) for a
# position=top bar -- it does not add vertical clearance. The top gap comes
# from y_offset instead, which is why floating mode sets both.
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

if [ "${external_displays:-0}" -ge 1 ]; then
  target_margin=6
  target_corner=9
  target_yoffset=6
else
  target_margin=0
  target_corner=0
  target_yoffset=0
fi

current_margin=$(sketchybar --query bar | jq '.margin')

[ "$current_margin" = "$target_margin" ] && exit 0

sketchybar --bar margin=$target_margin corner_radius=$target_corner y_offset=$target_yoffset
