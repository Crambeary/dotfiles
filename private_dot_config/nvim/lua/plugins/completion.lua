-- Use LazyVim's single completion engine and retain its LSP/snippet setup.
return {
  {
    "saghen/blink.cmp",
    opts = {
      completion = { list = { selection = { preselect = false } } },
      keymap = {
        preset = "enter",
        ["<Tab>"] = { "select_next", "snippet_forward", "fallback" },
        ["<S-Tab>"] = { "select_prev", "snippet_backward", "fallback" },
      },
    },
  },
}
