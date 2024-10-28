local wezterm = require("wezterm")
local config = {}

config.color_scheme = "tokyonight_night"
config.font = wezterm.font("Hack Nerd Font")
config.window_decorations = "RESIZE"
config.tab_bar_at_bottom = true
config.default_prog = { "powershell.exe" }
config.adjust_window_size_when_changing_font_size = false

return config
