-- Optional per-user keybind overrides (managed by DMS). Loaded after default binds.

hl.bind("CTRL + space", hl.dsp.exec_cmd("vicinae toggle"))

-- Launch default browser (mirrors Omarchy's SUPER+SHIFT+B, via xdg-settings
-- default-web-browser instead of a hardcoded desktop id, so it stays correct
-- if the default browser changes).
hl.bind(
	"SUPER + B",
	hl.dsp.exec_cmd([[gtk-launch "$(xdg-settings get default-web-browser)"]])
)

-- Toggle floating + center with side padding (percentage of screen)
-- Note: this Hyprland build parses `hyprctl dispatch <text>` as Lua
-- (hl.dispatch(<text>)), so dispatchers must use hl.dsp.* calls, not the
-- classic "dispatcher arg1 arg2" string syntax.
hl.bind("SUPER + C", hl.dsp.exec_cmd([[
  hyprctl dispatch 'hl.dsp.window.float({action = "toggle"})'
  sleep 0.1
  active=$(hyprctl activewindow -j)
  floating=$(echo "$active" | jq -r ".floating")
  pinned=$(echo "$active" | jq -r ".pinned")
  if [ "$floating" = "true" ]; then
    mon=$(echo "$active" | jq -r ".monitor")
    wh=$(hyprctl monitors -j | jq -r ".[] | select(.id==$mon) | \"\(.width) \(.height)\"")
    w=$(echo "$wh" | cut -d' ' -f1)
    h=$(echo "$wh" | cut -d' ' -f2)
    fw=$(( w * 65 / 100 ))
    fh=$(( h * 70 / 100 ))
    hyprctl dispatch "hl.dsp.window.resize({ x = $fw, y = $fh, relative = false })"
    hyprctl dispatch 'hl.dsp.window.center({})'
    if [ "$pinned" != "true" ]; then
      hyprctl dispatch 'hl.dsp.window.pin({})'
    fi
  else
    if [ "$pinned" = "true" ]; then
      hyprctl dispatch 'hl.dsp.window.pin({})'
    fi
  fi
]]))

-- Toggle transparency on the active window (per-window state via a stamp file)
hl.bind("SUPER + Backspace", hl.dsp.exec_cmd([[
  addr=$(hyprctl activewindow -j | jq -r ".address")
  state_dir="${XDG_RUNTIME_DIR:-/tmp}/hypr-opacity"
  mkdir -p "$state_dir"
  state_file="$state_dir/$addr"
  if [ -f "$state_file" ]; then
    hyprctl dispatch 'hl.dsp.window.set_prop({ prop = "opacity", value = 1.0 })'
    rm -f "$state_file"
  else
    hyprctl dispatch 'hl.dsp.window.set_prop({ prop = "opacity", value = 0.85 })'
    touch "$state_file"
  fi
]]))
