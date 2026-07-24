local wezterm = require("wezterm")
local config = wezterm.config_builder()
wezterm.gui.enumerate_gpus()

config = require("colors").apply(config)
config = require("appearance").apply(config)

local bar = wezterm.plugin.require("https://github.com/adriankarlen/bar.wezterm")
-- apply bar after color_scheme is set
bar.apply_to_config(config,
  {
    modules = {
      spotify = {
        enabled = false,
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

-- Platform-specific adjustments (if needed)

if wezterm.target_triple == "x86_64-pc-windows-msvc" then
	config.default_prog = { "powershell.exe", '-NoLogo' }

	-- Local Windows defaults, kept off Mac/Linux so they keep their native
	-- (Metal/WebGpu) rendering and window behaviour.
	config.font = wezterm.font("Hack Nerd Font", { weight = "Regular" })
	config.window_decorations = "RESIZE"
	config.adjust_window_size_when_changing_font_size = false
	config.front_end = "OpenGL"
	config.window_background_opacity = 0.9
	-- Confirm before closing, matching kitty's confirm_os_window_close -1
	config.window_close_confirmation = "AlwaysPrompt"
end

-- Local machine overrides: create ~/.config/wezterm/custom.lua with
--   local M = {}
--   function M.apply(config) ... return config end
--   return M
-- to layer machine-specific tweaks without touching the shared config.
local ok, custom = pcall(require, "custom")
if ok then
	config = custom.apply(config)
end

return config
