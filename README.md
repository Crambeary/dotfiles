# Dotfiles

Managed with [chezmoi](https://www.chezmoi.io/), synced across macOS, Windows, and Linux.
OS-specific files are gated in `.chezmoiignore` using `{{ if ... .chezmoi.os }}` blocks.

## Herdr

Config lives at `~/.config/herdr/config.toml` on Linux/macOS (both use the same
path — herdr doesn't split them like some tools do) and `%APPDATA%\herdr\config.toml`
on Windows. Both are thin `.tmpl` wrappers (`private_dot_config/herdr/config.toml.tmpl`,
`AppData/Roaming/herdr/config.toml.tmpl`) that pull the real content from the shared
`.chezmoitemplates/herdr-config.toml` partial, following the same pattern as Alacritty.

Four custom `[[keys.command]]` bindings shell out to scripts in
`private_dot_config/herdr/scripts/` (pane→new-tab, move-back-to-origin-tab,
move-to-selected-tab via `fzf`, and split-direction toggle). They're wrapped in
`{{ if ne .chezmoi.os "windows" }}` inside the shared template and omitted from the
Windows config entirely — herdr runs custom command strings through `cmd.exe /d /c`
on Windows, which can't source a bash shebang script, and there's no `fzf`/`jq` there
by default either. Rather than ship bindings that silently fail, Windows just doesn't
get them. Revisit if this setup regularly needs multi-pane tab layouts on Windows —
would need PowerShell equivalents (no `jq` needed there, `ConvertFrom-Json` is
built in; `fzf` is available via `winget`/`scoop`).

`channel = "stable"` is set explicitly, since herdr's own unset-default is
`stable` on Linux/macOS but `preview` on Windows — pinned so all three machines
track the same release channel.

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

## macOS: SketchyBar and AeroSpace

The macOS bar and window-manager configuration is managed by chezmoi. Run
`chezmoi apply` after cloning this repository. Chezmoi installs the
configuration and compiles the EventKit calendar helper from its tracked Swift
source. The SketchyBar configuration is ignored automatically on non-macOS
hosts.

Install the required tools:

```sh
brew install sketchybar jq
brew install --cask font-sketchybar-app-font
brew install --cask nikitabobko/tap/aerospace
xcode-select --install
```

MeetingBar can be installed with `brew install --cask meetingbar`. FortiClient
is normally supplied by the organization providing the VPN. Both are optional:

- The MeetingBar item is only created when `/Applications/MeetingBar.app`
  exists. It displays the next event from calendars currently enabled in
  Calendar.app.
- The FortiClient item is only created when FortiClient and a Fortinet network
  service are present. The service name is detected automatically, so it does
  not need to be named `VPN`.
- The Focus item uses SketchyBar's native Control Center alias and is only
  created when that alias is available.

Grant these macOS permissions after the first apply:

1. In **System Settings > Privacy & Security > Screen Recording**, enable
   SketchyBar. This lets SketchyBar expose the native Focus menu-bar item.
2. In **System Settings > Privacy & Security > Calendars**, enable SketchyBar
   and **SketchyBar Calendar Helper** if it is listed. Depending on the macOS
   version, this may appear under Full Calendar Access.
3. In **System Settings > Control Center > Menu Bar**, enable **Show menu bar
   background** and set **Automatically hide and show the menu bar** to
   **Always**.

Restart the bar after changing permissions:

```sh
brew services restart sketchybar
```

The weather item defaults to Ishpeming, Michigan. To use another location on
one Mac without changing the shared dotfiles, create the ignored file
`~/.config/sketchybar/local.sh`:

```sh
export SKETCHYBAR_WEATHER_LOCATION="Detroit, Michigan, United States"
```

After editing the dotfiles, apply and reload them with:

```sh
chezmoi apply
aerospace reload-config
sketchybar --reload
```
