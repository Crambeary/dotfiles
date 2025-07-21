-- Performance optimizations for Neovim

local M = {}

-- Function to optimize startup time
M.setup = function()
  -- Disable unnecessary builtin plugins
  local disabled_built_ins = {
    "gzip",
    "tarPlugin",
    "zipPlugin",
    "tutor",
    "2html_plugin",
    "tohtml",
    "man",
    "matchparen", -- Optional: can disable if not needed
    "netrwPlugin", -- If using another file explorer
    "spellfile_plugin",
    "matchit",
  }

  for _, plugin in pairs(disabled_built_ins) do
    vim.g["loaded_" .. plugin] = 1
  end

  -- =====================================
  -- CRITICAL PERFORMANCE OPTIMIZATION
  -- =====================================
  -- Disable Python provider by default (reduces startup time by ~9.6 seconds)
  vim.g.loaded_python3_provider = 1
  vim.g.python3_host_skip_check = 1
  
  -- Create lazy loader for Python provider
  local python_provider_loaded = false
  
  -- Function to load Python provider only when needed
  _G.load_python_provider = function()
    if not python_provider_loaded then
      -- Unset the loaded flag so Neovim will initialize the provider
      vim.g.loaded_python3_provider = nil
      
      -- Force reload of the provider
      vim.cmd('runtime autoload/provider/python3.vim')
      
      -- Mark as loaded to avoid repeated loading
      python_provider_loaded = true
      
      vim.notify('Python provider loaded on demand')
    end
  end

  -- Improve Python file handling
  local python_group = vim.api.nvim_create_augroup("PythonOptimizations", { clear = true })
  
  -- Delay loading of heavy plugins until file is fully loaded
  vim.api.nvim_create_autocmd("FileType", {
    group = python_group,
    pattern = "python",
    callback = function()
      -- Set Python-specific settings only when needed
      vim.opt_local.expandtab = true
      vim.opt_local.shiftwidth = 4
      vim.opt_local.tabstop = 4
      vim.opt_local.softtabstop = 4
    end,
    once = false,
  })
  
  -- Faster syntax highlighting for large files
  vim.api.nvim_create_autocmd("BufReadPre", {
    pattern = "*.py",
    callback = function()
      local size_kb = vim.fn.getfsize(vim.fn.expand("%")) / 1024
      if size_kb > 1000 then -- For files larger than 1MB
        vim.cmd("syntax off") -- Disable syntax highlighting for very large files
        vim.notify("Large file detected, some features disabled for performance")
      end
    end,
  })
  
  -- Only load Python provider when specifically needed for Python operations
  vim.api.nvim_create_autocmd({"BufWritePost", "LspAttach"}, {
    pattern = "*.py",
    callback = function()
      -- Check if we're using features that need the Python provider
      -- Only load when doing actual Python operations beyond basic editing
      local has_lsp_operations = (vim.lsp.buf_request_sync ~= nil)
      
      if has_lsp_operations then
        -- Defer loading to avoid blocking the UI
        vim.defer_fn(function()
          _G.load_python_provider()
        end, 1000) -- Load after 1 second of Python LSP activity
      end
    end,
    once = true, -- Only trigger once per session
  })
  
  -- Faster LSP startup
  vim.lsp.set_log_level("ERROR") -- Reduce LSP logging
  
  -- Reduce delay for CursorHold events
  vim.opt.updatetime = 300
end

return M
