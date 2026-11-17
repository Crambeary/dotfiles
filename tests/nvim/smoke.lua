-- Run from the dotfiles repo: nvim --headless '+luafile tests/nvim/smoke.lua'
-- Exercises the installed configuration; does not update plugins.
local errors = {}
local notify = vim.notify
vim.notify = function(message, level, opts)
  if level == vim.log.levels.ERROR then
    errors[#errors + 1] = tostring(message)
  end
  return notify(message, level, opts)
end

vim.schedule(function()
  local ok, err = pcall(function()
    local scratch = vim.fn.getcwd() .. "/.scratch/nvim-smoke"
    assert(vim.fn.system({ "git", "check-ignore", scratch .. "/" }) ~= "", "Scratch must be ignored")
    vim.fn.mkdir(scratch, "p")
    local fixtures = {
      { "fenced.md", { "# Example", "```python", "print('hello')", "```" }, "markdown", "marksman" },
      { "embedded.html", { '<script type="application/javascript">const x = 1;</script>' }, "html" },
      { "example.py", { "def greet(name: str) -> str:", '    return "Hello " + name' }, "python", "pyright" },
      { "example.lua", { 'local message = "hello"', "print(message)" }, "lua", "lua_ls" },
      { "example.json", { '{"enabled": true}' }, "json", "jsonls" },
      { "example.toml", { 'name = "example"' }, "toml", "taplo" },
    }
    for _, fixture in ipairs(fixtures) do
      local path = scratch .. "/" .. fixture[1]
      vim.fn.writefile(fixture[2], path)
      vim.cmd.edit(vim.fn.fnameescape(path))
      assert(vim.bo.filetype == fixture[3], "Wrong filetype: " .. fixture[1])
      local parser = vim.treesitter.get_parser(0)
      parser:parse(true) -- Previously crashed on fenced Markdown in Neovim 0.12.
      assert(vim.treesitter.highlighter.active[vim.api.nvim_get_current_buf()], "Highlighting inactive")
      if fixture[4] then
        assert(vim.wait(15000, function()
          return #vim.lsp.get_clients({ bufnr = 0, name = fixture[4] }) > 0
        end), "Server did not attach: " .. fixture[4])
      end
      vim.api.nvim_exec_autocmds("InsertEnter", {})
      assert(require("blink.cmp").get_lsp_capabilities().textDocument.completion, "Completion capabilities missing")
      print("PASS " .. fixture[1] .. " parsing, highlighting, completion" .. (fixture[4] and ", LSP" or ""))
    end
    -- Exercise the configured picker and the extension its sf mapping uses.
    require("telescope.builtin").find_files({ cwd = scratch })
    vim.wait(250)
    assert(vim.bo.filetype == "TelescopePrompt", "File picker did not open")
    require("telescope.actions").close(vim.api.nvim_get_current_buf())
    assert(require("telescope").extensions.file_browser, "File browser extension missing")
    vim.wait(500)
    assert(#errors == 0, table.concat(errors, "\n"))
  end)
  if not ok then
    io.stderr:write("FAIL " .. tostring(err) .. "\n")
    vim.cmd("cquit 1")
  else
    print("PASS Neovim smoke checks")
    vim.cmd("qa!")
  end
end)
