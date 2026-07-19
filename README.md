# Dotfiles

Managed with [chezmoi](https://www.chezmoi.io/), synced across macOS, Windows, and Linux.
OS-specific files are gated in `.chezmoiignore` using `{{ if ... .chezmoi.os }}` blocks.

## KDE Plasma (Linux)

Only the small text config files are tracked here — panel/widget layout, window
rules, shortcuts, and global colors/fonts:

- `plasma-org.kde.plasma.desktop-appletsrc` — panels, widgets, layout
- `plasmarc`, `plasmashellrc`, `plasmanotifyrc`, `plasma-localerc`, `plasma-welcomerc`
- `kwinrc`, `kwinrulesrc` — window manager settings/rules
- `kglobalshortcutsrc` — keyboard shortcuts
- `kdeglobals`, `kcminputrc`, `ksplashrc`, `kded5rc`
- `kdedefaults/` — global theme defaults overrides

These are plain INI files, diff cleanly, and total ~160 KB. They're gated to
Linux only via `.chezmoiignore` so `chezmoi apply` is a no-op for them on
macOS/Windows.

**Not tracked here:** theme/icon/cursor assets (currently Catppuccin Mocha
Mauve + matching cursors). Those are large binary files that don't diff and
would bloat repo history on every change. Instead they're backed up
separately with [konsave](https://github.com/prayag2/konsave) as a `.knsv`
archive (config in `~/.config/konsave/conf.yaml`, exports land in
`~/plasma-backups/`), synced machine-to-machine outside of git. To restore
Plasma on a new Linux machine:

1. Install the Catppuccin Mocha Mauve theme/icon/cursor packages (or import
   the `.knsv` asset bundle if not available via a repo).
2. `chezmoi apply` to lay down the text configs from this repo.
3. Log out/in (or restart `plasmashell`) to pick everything up.
