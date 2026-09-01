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

-- Stretchly's Ctrl+X "end break" shortcut is registered via Electron's
-- globalShortcut (an X11 grab), which wlroots compositors don't honor even
-- when the break window itself has XWayland focus (verified: a synthetic
-- Ctrl+X sent straight to the focused stretchly window did nothing; `stretchly
-- reset` from the CLI is what actually closes it, ~0.9s after invocation —
-- that's Electron's own cold-start cost for the throwaway CLI process it
-- spins up to forward the command; not worth chasing further since going
-- faster would mean bypassing the app's own break-ending logic, e.g. killing
-- the window directly, which risks leaving its internal break state/schedule
-- inconsistent).
--
-- Registered once, disabled by default, and only enabled while a stretchly
-- break window actually exists. Tried gating this on the window.open/close
-- Lua events first, but they never fire for Stretchly's window (confirmed:
-- they fire fine for ordinary windows; Stretchly's break overlay evidently
-- takes a compositor path that skips Hyprland's normal managed-window
-- open/close hooks even though it shows up in hl.get_windows()/hyprctl
-- clients). So poll instead, in-process (no shell/hyprctl/jq spawned) via
-- hl.timer, and flip the bind's enabled state directly — cheap, and still
-- means Ctrl+X (cut, in every other app) is untouched almost all the time,
-- with at most one poll interval of lag after a break closes.
local stretchly_end_break = hl.bind("CTRL + X", hl.dsp.exec_cmd("/home/marc/.local/bin/stretchly reset"))
stretchly_end_break:set_enabled(false)

-- Note: exact-case "stretchly" (lowercase) on purpose -- Stretchly also keeps
-- a permanent hidden background window alive with class "Stretchly"
-- (capitalized, matching its StartupWMClass), which would false-positive-match
-- a case-insensitive comparison and leave this bind stuck enabled forever.
-- Only the actual break overlay window uses lowercase "stretchly".
hl.timer(function()
	local break_open = false
	for _, w in ipairs(hl.get_windows()) do
		if w.mapped and tostring(w.class) == "stretchly" then
			break_open = true
			break
		end
	end
	if stretchly_end_break:is_enabled() ~= break_open then
		stretchly_end_break:set_enabled(break_open)
	end
end, { timeout = 300, type = "repeat" })

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
