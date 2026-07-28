#!/bin/bash

source "$CONFIG_DIR/colors.sh"

calendar_helper="$CONFIG_DIR/helper/MeetingCalendarHelper.app/Contents/MacOS/meeting-calendar-helper"

if [ ! -x "$calendar_helper" ]; then
  sketchybar --set "$NAME" label="Calendar helper missing" label.color=$RED
  exit 1
fi

meeting_label=$($calendar_helper 2>/dev/null)
meeting_status=$?

if [ "$meeting_status" -eq 0 ] && [ -n "$meeting_label" ]; then
  sketchybar --set "$NAME" label="$meeting_label" label.color=$WHITE
else
  sketchybar --set "$NAME" label="Calendar access needed" label.color=$YELLOW
fi
