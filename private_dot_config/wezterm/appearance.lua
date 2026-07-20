local wezterm = require("wezterm")

local M = {}

local FOCUSED_OPACITY = 0.7
local UNFOCUSED_OPACITY = 0.6

-- Dim the window when it loses focus, kitty-style (dynamic_background_opacity).
wezterm.on("window-focus-changed", function(window, pane)
	window:set_config_overrides({
		window_background_opacity = window:is_focused() and FOCUSED_OPACITY or UNFOCUSED_OPACITY,
	})
end)

function M.apply(config)
	config.font = wezterm.font("Hack Nerd Font", { weight = "Regular" })
	config.window_decorations = "RESIZE"
	-- config.tab_bar_at_bottom = true
	config.adjust_window_size_when_changing_font_size = false
	config.front_end = "WebGpu"
	config.window_background_opacity = FOCUSED_OPACITY
	config.window_close_confirmation = "NeverPrompt"

	if wezterm.target_triple:find("linux") then
		-- Wayland-specific: this machine only behaves reliably under X11.
		config.enable_wayland = false
	end

	-- config.win32_system_backdrop = 'Mica'
	-- config.win32_system_backdrop = 'Tabbed'
	-- config.win32_system_backdrop = 'Acrylic'

	return config
end

return M
