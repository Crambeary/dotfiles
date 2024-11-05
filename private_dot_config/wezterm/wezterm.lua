local wezterm = require("wezterm")
local config = {}

config.color_scheme = "tokyonight_night"
config.font = wezterm.font("Hack Nerd Font")
config.window_decorations = "RESIZE"
config.tab_bar_at_bottom = true
config.adjust_window_size_when_changing_font_size = false
-- Platform-specific adjustments (if needed)

if os.getenv("OS") == "Darwin" then
	-- Mac-specific setting here
	config.default_prog = { "fish" }
elseif os.getenv("OS") == "Windows" then
	config.default_prog = { "powershell.exe" }
end

return config
