#!/bin/bash

display_geometry_watcher=(
  drawing=off
  update_freq=5
  updates=on
  script="$PLUGIN_DIR/display_geometry.sh"
)

sketchybar --add item display_geometry_watcher right \
           --set display_geometry_watcher "${display_geometry_watcher[@]}" \
           --subscribe display_geometry_watcher system_woke

"$PLUGIN_DIR/display_geometry.sh"
