#!/bin/bash

alias_name="Control Center,FocusModes"

if sketchybar --query default_menu_items 2>/dev/null |
  grep -q "\"$alias_name\""; then
  if ! sketchybar --query "$alias_name" >/dev/null 2>&1; then
    sketchybar --add alias "$alias_name" right \
      --set "$alias_name" \
        alias.scale=0.85 \
        alias.update_freq=1 \
        padding_left=5 \
        padding_right=5
  fi
elif sketchybar --query "$alias_name" >/dev/null 2>&1; then
  sketchybar --remove "$alias_name"
fi
