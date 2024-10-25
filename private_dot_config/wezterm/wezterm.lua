local wezterm = require("wezterm")
local config = {}

config.color_scheme = "tokyonight_night"
config.font = wezterm.font("Hack Nerd Font")
config.window_decorations = "RESIZE"
config.tab_bar_at_bottom = true
config.default_prog = { "powershell.exe" }

return config
