# Neovim

LazyVim with its standard language-server setup and one completion engine
(blink.cmp). LazyVim is pinned to 16.0.2; lazy-lock.json records the plugin
revisions tested with it. Upgrade these together instead of mixing old
LazyVim with new plugin APIs.

Press **Space** and pause to see the available commands. Press **Esc** to
return to normal mode, then use:

| Keys | Action |
| --- | --- |
| Space Space | Find a file |
| Space / | Search text in the project |
| Space e | Toggle the file explorer |
| Space , | Choose an open buffer |
| Ctrl-s | Save (also works while typing) |
| u / Ctrl-r | Undo / redo |
| gd / K | Go to definition / show documentation |
| Space c a | Code actions |
| Space c r | Rename symbol |
| Space q q | Quit |

While typing, **Tab / Shift-Tab** select completion suggestions, **Enter**
accepts a selected suggestion, and **Ctrl-Space** opens completion manually.
Suggestions are not preselected, so Enter normally inserts a newline.

Install Neovim >= 0.12 (the enabled refactoring extra requires it), Git, ripgrep, fd, a C compiler, and the Tree-sitter
CLI (`brew install neovim ripgrep fd tree-sitter-cli` on macOS). Node.js is
needed for servers such as Pyright and the JSON language server. `:Mason`
shows installed language tools; `:checkhealth` checks the environment.

The Tree-sitter CLI is separate from Homebrew's tree-sitter library.
Use `:Lazy` for plugin updates and `:TSUpdate` for parsers. Avoid running
Neovim or plugin installation with sudo: root-owned caches break updates.
Restart Neovim after applying configuration or plugin updates.

From the dotfiles repository, run the integration smoke check with:

```sh
nvim --headless '+luafile tests/nvim/smoke.lua'
```

It checks real parsing/highlighting, completion setup, language-server
attachment, and file search. It requires the configured parsers and language
servers to be installed and writes its fixtures to ignored `.scratch/`.
