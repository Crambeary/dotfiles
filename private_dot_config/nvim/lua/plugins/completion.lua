return {
  -- Lazy-load completion plugin only when needed
  {
    "hrsh7th/nvim-cmp",
    event = { 
      "InsertEnter", 
      "CmdlineEnter" 
    },
    dependencies = {
      "hrsh7th/cmp-nvim-lsp",
      "hrsh7th/cmp-buffer",
      "hrsh7th/cmp-path",
    },
    config = function()
      local cmp = require("cmp")
      cmp.setup({
        preselect = cmp.PreselectMode.None,
        completion = {
          completeopt = "menu,menuone,noinsert,noselect",
        },
        mapping = cmp.mapping.preset.insert({
          ["<C-Space>"] = cmp.mapping.complete(),
          ["<CR>"] = cmp.mapping.confirm({ select = false }),
          ["<Tab>"] = cmp.mapping.select_next_item(),
          ["<S-Tab>"] = cmp.mapping.select_prev_item(),
        }),
        sources = cmp.config.sources({
          { name = "nvim_lsp" },
          { name = "buffer" },
          { name = "path" },
        }),
      })
    end,
  },
  
  -- If you're using blink.cmp, optimize its loading
  {
    "blink.cmp",
    -- Replace with actual plugin name if different
    event = "InsertEnter",
    config = function()
      require("blink.cmp").setup()
    end,
  },
}
