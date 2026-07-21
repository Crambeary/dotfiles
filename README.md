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

### Third-party plasmoids and tray apps (not tracked by chezmoi/konsave)

The appletsrc/panelWidgets config references some plugins and tray apps whose
actual packages/binaries live outside both chezmoi and the konsave asset
bundle. Restoring config alone (steps above) brings back references to these
by name but not the software itself — the widget/icon will silently no-op or
show a broken icon until the underlying thing is installed. Confirmed by
diffing a fresh machine against `marc-fedora`:

- **Panel Colorizer + Panel Spacer Extended**
  (`luisbocanegra.panel.colorizer`, `luisbocanegra.panelspacer.extended`) —
  third-party plasmoids from the OBS repo `home:luisbocanegra`, not Fedora
  main or a COPR. Without the repo+packages, the panel silently renders flat
  (no rounded corners/blur/gradient) instead of erroring.
  ```
  sudo tee /etc/yum.repos.d/home:luisbocanegra.repo <<'EOF'
  [home_luisbocanegra]
  name=home:luisbocanegra (Fedora_44)
  type=rpm-md
  baseurl=https://download.opensuse.org/repositories/home:/luisbocanegra/Fedora_44/
  gpgcheck=1
  gpgkey=https://download.opensuse.org/repositories/home:/luisbocanegra/Fedora_44/repodata/repomd.xml.key
  enabled=1
  EOF
  sudo dnf install -y plasma-panel-colorizer plasma-panel-spacer-extended
  ```
  Restart `plasmashell` after installing.

- **Caffeine tray icon** — not a plasmoid at all, it's
  [caffeine-ng](https://github.com/hharzer/caffeine-ng) installed via `pipx`,
  registering itself directly as a StatusNotifierItem. Needs its GSettings
  schema compiled and the `dbus-python` binding injected into the pipx venv:
  ```
  pipx install caffeine-ng
  pipx inject caffeine-ng dbus-python
  mkdir -p ~/.local/share/glib-2.0/schemas
  cp ~/.local/share/pipx/venvs/caffeine-ng/lib/python3.14/site-packages/usr/share/glib-2.0/schemas/net.launchpad.caffeine.gschema.xml \
     ~/.local/share/glib-2.0/schemas/
  glib-compile-schemas ~/.local/share/glib-2.0/schemas/
  ```
  Autostart entry: `~/.config/autostart/caffeine.desktop`, `Exec=/home/marc/.local/bin/caffeine`.

- **SELinux troubleshooter** tray icon needs `setroubleshoot` +
  `setroubleshoot-server` + `setroubleshoot-plugins` installed (dormant,
  DBus-activated only on an actual AVC denial — `inactive (dead)` is the
  expected steady state).

- **omenctl** (`hp-manager`) is HP-laptop-specific fan/thermal control
  software tied to HP WMI hardware — legitimately only relevant on
  `marc-fedora`, skip on other hardware (e.g. the MacBook).

### Gotcha: broken `~/.local/share/icons/hicolor/index.theme`

Found once on a fresh machine: an empty (0-byte) local
`~/.local/share/icons/hicolor/index.theme` silently shadows the real
~56 KB system one at `/usr/share/icons/hicolor/index.theme`, since
icon-theme lookup uses the first `index.theme` found per search-path base
directory rather than merging across all of them. Result: any icon placed
under the local `hicolor` tree (not just caffeine's) fails to resolve, with
no obvious error pointing at the cause. Fix: delete the empty local
`index.theme` (and stale `icon-theme.cache` next to it) so lookups fall
through to the system one.

### MacBook: fractional display scaling via lower render resolution

Plasma 6 only allows fractional (non-integer) display scaling under
Wayland; on X11 `kscreen-doctor`'s scale command silently no-ops. Workaround
used on the 2560x1600 MacBookPro14,1 panel: drop the output mode to
1920x1200 (exactly the native aspect ratio, 2560/1.333 x 1600/1.333) and let
the Intel i915 driver's hardware panel-fitter (`scaling mode: Full aspect`
xrandr output property) stretch it to fill the physical panel with zero
letterboxing. Effect: ~36% fewer pixels to render/composite (helps with this machine's
fan-not-spinning/thermal issue) *and* an effective 1.333x
UI/font scale-up, achieved with one `kscreen-doctor output.eDP-1.mode.<id>`
call instead of per-toolkit Qt/GTK scaling hacks.
