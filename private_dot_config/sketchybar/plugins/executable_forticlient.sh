#!/bin/bash

source "$CONFIG_DIR/colors.sh"

vpn_service=$(scutil --nc list 2>/dev/null | awk -F'"' '/com\.fortinet/{print $2; exit}')

if [ -z "$vpn_service" ]; then
  sketchybar --set "$NAME" icon="󰌾" label="Unavailable"
  exit 0
fi

vpn_state=$(scutil --nc status "$vpn_service" 2>/dev/null | head -n 1)

case "$vpn_state" in
  Connected)
    sketchybar --set "$NAME" icon.color=$GREEN label="VPN On" label.color=$GREEN
    ;;
  Connecting|Disconnecting)
    sketchybar --set "$NAME" icon.color=$YELLOW label="$vpn_state" label.color=$YELLOW
    ;;
  *)
    sketchybar --set "$NAME" icon.color=$GREY label="VPN Off" label.color=$GREY
    ;;
esac
