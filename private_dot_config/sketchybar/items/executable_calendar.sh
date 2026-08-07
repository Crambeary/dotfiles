#!/bin/bash

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

# Position "q" is the slot immediately left of the notch. On a display without a
# notch there is no reserved centre region, so q items butt up against the bar's
# midpoint - i.e. the clock reads as centred there.
sketchybar --add item calendar q            \
           --set calendar "${calendar[@]}" \
           --subscribe calendar system_woke
