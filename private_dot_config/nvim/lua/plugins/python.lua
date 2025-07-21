return {
  -- Lazy-load refactoring plugin only for specific filetypes
  {
    "ThePrimeagen/refactoring.nvim",
    ft = { "python", "javascript", "typescript", "lua" },  -- Load only for these file types
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-treesitter/nvim-treesitter",
    },
    config = function()
      require("refactoring").setup()
    end,
  },
  
  -- LSP setup for Python - lazy-loaded
  {
    "neovim/nvim-lspconfig",
    event = { "BufReadPost *.py", "BufNewFile *.py" },
    opts = {
      servers = {
        pyright = {
          settings = {
            python = {
              analysis = {
                autoSearchPaths = true,
                useLibraryCodeForTypes = true,
                diagnosticMode = "workspace",
              },
            },
          },
        },
      },
    },
  },
  
  -- Tree-sitter configuration optimized for Python
  {
    "nvim-treesitter/nvim-treesitter",
    opts = {
      ensure_installed = { 
        "python",  -- Only ensure Python parser is installed by default
      },
      -- Lazy-load additional parsers as needed
      auto_install = false,
    },
  },
}
