-- Options are automatically loaded before lazy.nvim startup
-- Default options that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/options.lua
-- Add any additional options here

return {
  "nvim-treesitter/nvim-treesitter",
  -- opts will be merged with the parent spec
  opts = {
    ensure_installed = {
      "hbs",
    },
  },
  {
    "folke/tokyonight.nvim",
    opts = { style = "night" },
  },
}
