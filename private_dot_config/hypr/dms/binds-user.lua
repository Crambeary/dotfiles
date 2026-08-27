-- Optional per-user keybind overrides (managed by DMS). Loaded after default binds.

-- Toggle floating + center with side padding (percentage of screen)
-- Note: this Hyprland build parses `hyprctl dispatch <text>` as Lua
-- (hl.dispatch(<text>)), so dispatchers must use hl.dsp.* calls, not the
-- classic "dispatcher arg1 arg2" string syntax.
hl.bind("SUPER + C", hl.dsp.exec_cmd([[
  hyprctl dispatch 'hl.dsp.window.float({action = "toggle"})'
  sleep 0.1
  active=$(hyprctl activewindow -j)
  floating=$(echo "$active" | jq -r ".floating")
  if [ "$floating" = "true" ]; then
    mon=$(echo "$active" | jq -r ".monitor")
    wh=$(hyprctl monitors -j | jq -r ".[] | select(.id==$mon) | \"\(.width) \(.height)\"")
    w=$(echo "$wh" | cut -d' ' -f1)
    h=$(echo "$wh" | cut -d' ' -f2)
    fw=$(( w * 65 / 100 ))
    fh=$(( h * 70 / 100 ))
    hyprctl dispatch "hl.dsp.window.resize({ x = $fw, y = $fh, relative = false })"
    hyprctl dispatch 'hl.dsp.window.center({})'
  fi
]]))
