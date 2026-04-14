local wezterm = require("wezterm")
local config = wezterm.config_builder()
wezterm.gui.enumerate_gpus()


config.color_scheme = "tokyonight_night"
local bar = wezterm.plugin.require("https://github.com/adriankarlen/bar.wezterm")
-- apply bar after color_scheme is set
bar.apply_to_config(config,
  {
    modules = {
      spotify = {
        enabled = true,
      },
      workspace = {
        enabled = false,
      },
      pane = {
        enabled = false,
      },
      username = {
        enabled = false,
      },
      hostname = {
        enabled = false,
      },
      clock = {
        enabled = false,
      }
    }
  }
)

config.font = wezterm.font("Hack Nerd Font", { weight = 'Regular' })
config.window_decorations = "RESIZE"
-- config.tab_bar_at_bottom = true
config.adjust_window_size_when_changing_font_size = false
-- config.front_end = "WebGpu" -- Fix render issue on Intel Xe graphics
config.front_end = "OpenGL"
config.window_background_opacity = 0.9
-- config.win32_system_backdrop = 'Mica'
-- config.win32_system_backdrop = 'Tabbed'
-- config.win32_system_backdrop = 'Acrylic'
config.window_close_confirmation = 'NeverPrompt'



-- Platform-specific adjustments (if needed)

if wezterm.target_triple == "x86_64-pc-windows-msvc" then
	config.default_prog = { "powershell.exe", '-NoLogo' }
end

return config
