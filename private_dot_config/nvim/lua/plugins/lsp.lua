-- Let LazyVim configure servers, completion capabilities, and buffer keys.
-- Replacing its config function prevents the configured servers from starting.
return {
  {
    "mason-org/mason.nvim",
    opts = { ui = { border = "rounded" } },
  },
}
