#!/bin/bash

if [ ! -d "/Applications/FortiClient.app" ] ||
  ! scutil --nc list 2>/dev/null | grep -qi 'com\.fortinet'; then
  return 0
fi

forticlient=(
  icon=􀎡
  icon.font="$FONT:Bold:13.0"
  icon.color=$GREY
  label="VPN"
  label.color=$GREY
  label.font="$FONT:Semibold:12.0"
  padding_left=6
  padding_right=6
  update_freq=15
  updates=on
  script="$PLUGIN_DIR/forticlient.sh"
  click_script="open -a FortiClient"
)

sketchybar --add item forticlient right \
           --set forticlient "${forticlient[@]}" \
           --subscribe forticlient system_woke
