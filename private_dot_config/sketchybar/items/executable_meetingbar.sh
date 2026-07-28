#!/bin/bash

[ -d "/Applications/MeetingBar.app" ] || return 0

meetingbar=(
  icon=􀐫
  icon.font="$FONT:Black:13.0"
  icon.color=$BLUE
  label="MeetingBar"
  label.max_chars=24
  label.font="$FONT:Semibold:12.0"
  padding_left=6
  padding_right=6
  update_freq=60
  updates=on
  script="$PLUGIN_DIR/meetingbar.sh"
  click_script="open 'meetingbar://preferences'"
)

sketchybar --add item meetingbar right \
           --set meetingbar "${meetingbar[@]}" \
           --subscribe meetingbar system_woke
