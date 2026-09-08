-- Optional per-user keybind overrides (managed by DMS). Loaded after default binds.

-- Per-monitor workspaces (awesome/dwm-style): SUPER+N focuses/moves to
-- workspace N *on the currently active monitor* instead of a single global
-- workspace N. Overrides the SUPER+1..9 binds from dms/binds.lua below,
-- since this file loads after it. https://github.com/shezdy/hyprsplit
local hyprsplit = require("hyprsplit")
hyprsplit.config({ num_workspaces = 10, persistent_workspaces = false })
-- Explicit order avoids hyprsplit falling back to raw monitor-id-based
-- blocks (id 3 would've meant workspaces 31-40) before settling here.
hyprsplit.monitor_priority({ "HDMI-A-1", "DP-2" })
for i = 1, 10 do
	local key = i % 10 -- 10 maps to key 0
	hl.bind("SUPER + " .. key, hyprsplit.dsp.focus({ workspace = i }), { description = "Focus workspace " .. i .. " (this monitor)" })
	hl.bind("SUPER + SHIFT + " .. key, hyprsplit.dsp.window.move({ workspace = i, follow = false }), { description = "Move window to workspace " .. i .. " (this monitor)" })
end
-- Recover windows stranded on another monitor's now-invalid workspace
-- (e.g. after unplugging a monitor).
hl.bind("SUPER + CTRL + G", hyprsplit.dsp.grab_rogue_windows(), { description = "Recover windows stranded on an invalid workspace" })
-- Swap all windows between the active workspaces of two monitors.
hl.bind("SUPER + D", hyprsplit.dsp.workspace.swap_monitors({ monitor1 = "current", monitor2 = "+1" }), { description = "Swap workspaces between this monitor and the next" })

hl.bind("CTRL + space", hl.dsp.exec_cmd("vicinae toggle"), { description = "Toggle Vicinae launcher" })

-- Launch default browser (mirrors Omarchy's SUPER+SHIFT+B, via xdg-settings
-- default-web-browser instead of a hardcoded desktop id, so it stays correct
-- if the default browser changes).
hl.bind(
	"SUPER + B",
	hl.dsp.exec_cmd([[gtk-launch "$(xdg-settings get default-web-browser)"]]),
	{ description = "Open default browser" }
)

-- Universal copy/paste/cut (ported from Omarchy's default/hypr/bindings/
-- clipboard.lua) — send a synthetic Ctrl+C/V/X to whatever's focused,
-- reaching layer-shell surfaces too since this injects at the seat rather
-- than through a virtual keyboard. Terminals get Ctrl+Shift+C/V instead,
-- since bare Ctrl+C/V there means SIGINT/nothing in most terminal
-- emulators. (Originally Ctrl+Insert/Shift+Insert, but kitty/foot/
-- alacritty/wezterm/ghostty don't bind Insert by default — Ctrl+Shift+V
-- silently did nothing in kitty. Ctrl+Shift+C/V is the shared default
-- across all terminals in terminal_classes below.) The down/up split
-- works around Hyprland send_shortcut sometimes leaving synthetic key
-- state stuck/repeating.
-- https://github.com/hyprwm/Hyprland/discussions/14099
local terminal_classes = {
	kitty = true,
	foot = true,
	footclient = true,
	Alacritty = true,
	["org.wezfurlong.wezterm"] = true,
	["com.mitchellh.ghostty"] = true,
}

local function send_key_once(mods, key)
	return function()
		hl.dispatch(hl.dsp.send_key_state({ mods = mods, key = key, state = "down" }))
		hl.timer(function()
			hl.dispatch(hl.dsp.send_key_state({ mods = mods, key = key, state = "up" }))
		end, { timeout = 50, type = "oneshot" })
	end
end

local function active_window_is_terminal()
	local window = hl.get_active_window()
	return window ~= nil and terminal_classes[tostring(window.class)] == true
end

local function universal_clipboard_shortcut(default_mods, default_key, terminal_mods, terminal_key)
	return function()
		if active_window_is_terminal() then
			send_key_once(terminal_mods, terminal_key)()
		else
			send_key_once(default_mods, default_key)()
		end
	end
end

hl.bind("SUPER + C", universal_clipboard_shortcut("CTRL", "C", "CTRL + SHIFT", "C"), { description = "Copy (universal, works in terminals too)" })
hl.bind("SUPER + V", universal_clipboard_shortcut("CTRL", "V", "CTRL + SHIFT", "V"), { description = "Paste (universal, works in terminals too)" })
hl.bind("SUPER + X", send_key_once("CTRL", "X"), { description = "Cut (universal)" })

-- Clipboard manager moves here since SUPER+V is now universal paste
-- (matches Omarchy's own SUPER+CTRL+V slot for the same feature).
hl.bind("SUPER + CTRL + V", hl.dsp.exec_cmd("dms ipc call clipboard toggle"), { description = "Toggle clipboard manager" })

-- Power menu moves here since SUPER+X is now universal cut (matches
-- Omarchy's own SUPER+ESCAPE slot for its "System menu").
hl.bind("SUPER + ESCAPE", hl.dsp.exec_cmd("dms ipc call powermenu toggle"), { description = "Toggle power menu" })

-- Window grouping moves off SUPER+W (now just closes, like SUPER+Q) onto
-- SUPER+G, matching Omarchy.
hl.bind("SUPER + G", hl.dsp.group.toggle(), { description = "Toggle window group" })
hl.bind("SUPER + W", hl.dsp.window.close(), { description = "Close window" })

-- Group workflow companions (Omarchy's tiling.lua) -- the old SUPER+W-only
-- toggle never had a way to add windows to a group by direction, cycle
-- within one, or jump straight to a member, so none of this collides with
-- prior behavior.
hl.bind("SUPER + ALT + LEFT", hl.dsp.window.move({ into_group = "l" }), { description = "Add window to group (left)" })
hl.bind("SUPER + ALT + RIGHT", hl.dsp.window.move({ into_group = "r" }), { description = "Add window to group (right)" })
hl.bind("SUPER + ALT + UP", hl.dsp.window.move({ into_group = "u" }), { description = "Add window to group (up)" })
hl.bind("SUPER + ALT + DOWN", hl.dsp.window.move({ into_group = "d" }), { description = "Add window to group (down)" })
hl.bind("SUPER + ALT + G", hl.dsp.window.move({ out_of_group = true }), { description = "Remove window from group" })
hl.bind("SUPER + ALT + TAB", hl.dsp.group.next(), { description = "Next window in group" })
hl.bind("SUPER + ALT + SHIFT + TAB", hl.dsp.group.prev(), { description = "Previous window in group" })
for index = 1, 5 do
	hl.bind("SUPER + ALT + " .. tostring(index), hl.dsp.group.active({ index = index }), { description = "Jump to group member " .. index })
end

-- Scratchpad: a hide-away special workspace with no prior equivalent here.
hl.bind("SUPER + S", hl.dsp.workspace.toggle_special("scratchpad"), { description = "Toggle scratchpad" })
hl.bind("SUPER + ALT + S", hl.dsp.window.move({ workspace = "special:scratchpad", follow = false }), { description = "Move window to scratchpad" })

-- Jump back to whichever workspace had focus before this one (like `cd -`),
-- distinct from the sequential SUPER+U/I (e+1/e-1) binds above.
hl.bind("SUPER + CTRL + TAB", hl.dsp.focus({ workspace = "previous" }), { description = "Jump to previous workspace" })

-- DMS already ships these features (dms ipc list), just unbound until now.
hl.bind("SUPER + PRINT", hl.dsp.exec_cmd("dms ipc call color-picker toggle"), { description = "Toggle color picker" })
hl.bind("SUPER + CTRL + N", hl.dsp.exec_cmd("dms ipc call night toggle"), { description = "Toggle night light" })

-- Idle-inhibit ("caffeine") toggle, matching Omarchy's SUPER+CTRL+I slot.
-- That key was previously "move window to previous workspace" in binds.lua,
-- but that's a dead duplicate of SUPER+SHIFT+I (same dispatch), so nothing
-- is lost freeing it up here.
hl.bind("SUPER + CTRL + I", hl.dsp.exec_cmd("dms ipc call inhibit toggle"), { description = "Toggle idle inhibit (caffeine)" })

-- Extract text (OCR) from a screenshot region, ported from Omarchy's
-- bin/omarchy-capture-text (installed to ~/.local/bin/capture-text.sh).
hl.bind("SUPER + CTRL + PRINT", hl.dsp.exec_cmd("/home/marc/.local/bin/capture-text.sh"), { description = "Extract text (OCR) from screenshot region" })

-- Pop window out: toggle floating + center with side padding (percentage of
-- screen). Moved here from SUPER+C, which is now universal copy — this is
-- Marc's fuller version of Omarchy's SUPER+O "pop window out (float & pin)".
-- Note: this Hyprland build parses `hyprctl dispatch <text>` as Lua
-- (hl.dispatch(<text>)), so dispatchers must use hl.dsp.* calls, not the
-- classic "dispatcher arg1 arg2" string syntax.
hl.bind("SUPER + O", hl.dsp.exec_cmd([[
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
]]), { description = "Pop window out (float, center, and pin)" })

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
local stretchly_end_break = hl.bind("CTRL + X", hl.dsp.exec_cmd("/home/marc/.local/bin/stretchly reset"), { description = "End Stretchly break (only while a break is showing)" })
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
]]), { description = "Toggle transparency on active window" })
