#!/bin/bash

[ -x /opt/homebrew/bin/brew ] || [ -x /usr/local/bin/brew ] || return 0

brew_item=(
  icon=$BREW
  icon.font="$FONT:Bold:13.0"
  icon.color=$GREY
  label.color=$GREY
  label.font="$FONT:Semibold:12.0"
  padding_left=6
  padding_right=6
  update_freq=3600
  updates=on
  script="$PLUGIN_DIR/brew.sh"
  click_script="$PLUGIN_DIR/brew.sh"
)

sketchybar --add item brew right \
           --set brew "${brew_item[@]}" \
           --subscribe brew system_woke
