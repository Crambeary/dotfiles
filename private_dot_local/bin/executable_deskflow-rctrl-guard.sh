#!/bin/bash
# Keep Control_R out of the X11 "control" modifier map.
#
# Deskflow synthesizes a modifier key when a screen remaps ctrl<->super. It
# picks whichever keycode supplies the control bit, and it chose Control_R (105)
# -- a key this laptop has no physical equivalent for, so a stuck Control_R can
# never be cleared by typing. With only Control_L in the map, Deskflow is forced
# to use Control_L, which a real keypress can release.
#
# GNOME rewrites the XKB map on input-source changes, so this re-checks on a
# loop rather than applying once at login.
# Use the display and authentication supplied by the current session.
while true; do
  if xmodmap -pm 2>/dev/null | grep -q "^control.*Control_R"; then
    xmodmap -e "remove control = Control_R" 2>/dev/null
    echo "$(date "+%F %T") re-removed Control_R from control modifier"
  fi
  sleep 15
done
