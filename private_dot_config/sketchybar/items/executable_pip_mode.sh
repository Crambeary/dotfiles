#!/bin/bash

# Shows while the AeroSpace 'pip' binding mode (alt-p) is active, moving/
# resizing a Picture-in-Picture window. Toggled directly by the mode's
# enter/exit bindings in ~/.aerospace.toml -- see scripts/pip-control.sh.

pip_mode_icon=(
  icon="$PIP_ENTER"
  icon.color=$MAGENTA
  drawing=off
)

sketchybar --add item pip_mode_icon right \
           --set pip_mode_icon "${pip_mode_icon[@]}"
