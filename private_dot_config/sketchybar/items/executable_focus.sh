#!/bin/bash

focus_watcher=(
  drawing=off
  update_freq=5
  updates=on
  script="$PLUGIN_DIR/focus.sh"
)

sketchybar --add item focus_watcher right \
           --set focus_watcher "${focus_watcher[@]}" \
           --subscribe focus_watcher system_woke

"$PLUGIN_DIR/focus.sh"
