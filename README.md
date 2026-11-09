# Dotfiles

My personal Linux, macOS, and Windows configuration, managed with
[chezmoi](https://www.chezmoi.io/). This is a working setup I adapt for my
own machines, rather than a general-purpose desktop distribution.

It includes shell and terminal settings, Linux desktop configuration,
macOS SketchyBar/AeroSpace integration, and shared app configuration.
OS-specific target files are selected in `.chezmoiignore`; templates also
handle platform and machine differences.

## Start here

Install chezmoi first. To inspect this setup without applying it:

```sh
git clone https://github.com/Crambeary/dotfiles
cd dotfiles
```

Browse `.chezmoiignore`, `.chezmoi.toml.tmpl`, and the `run_once_` /
`run_onchange_` scripts before using it as a chezmoi source. Apply scripts
can install tools, change desktop settings, compile helpers, or start
services; this is more than copying text files.

To adopt the setup on a machine you intend to configure:

```sh
chezmoi init Crambeary
chezmoi diff
chezmoi apply --dry-run --verbose
```

Review the proposed changes and scripts before running `chezmoi apply`.
Back up existing configuration first. Run commands from a terminal with
chezmoi available; use shell syntax appropriate to your OS.

For later updates, `chezmoi git pull` fetches source changes without applying
them; repeat the diff and dry run before applying. These dotfiles do not
install every referenced application or restore all desktop assets. Per-OS
notes below describe additional dependencies and known gaps. A template
being gated to an OS does not establish that every feature was tested there.

## Configuration guide

- [Device-specific values](#device-specific-values)
- [Herdr](#herdr)
- [rtk](#rtk-rust-token-killer)
- [KDE Plasma](#kde-plasma-linux)
- [Deskflow and keyboard shortcuts](#macos-deskflow-and-the-voyager-space-shortcuts)
- [SketchyBar and AeroSpace](#macos-sketchybar-and-aerospace)

## Device-specific values

Anything that differs *per machine* rather than per OS — toolchain versions,
install paths — does not belong in a tracked file, because every machine would
then fight over the value on each `chezmoi apply`. Those live in the machine's
own `~/.config/chezmoi/chezmoi.toml` under `[data]`, which is never committed.

`.chezmoi.toml.tmpl` generates that file and is the answer to "how does a new
machine know what to set": `chezmoi init` prompts for each value. It uses
`promptStringOnce`, so re-running `init` on an already-configured machine keeps
the existing answer instead of asking again, and `--no-tty` runs take the
default. Leave a prompt blank when the thing isn't installed on that host.

The init template retains a `vulkan_sdk_version` prompt. The current
checkout has a plain `dot_zshrc`, not the former `dot_zshrc.tmpl` consumer;
do not assume changing that value configures the SDK automatically. Review
the actual shell configuration before adding SDK paths on a new host.

When adding a template consumer for a new machine value, handle both missing
and blank answers so older machines can still render it. Re-run `chezmoi
init` when you need to regenerate chezmoi's own configuration template.

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

The `[theme]` block is gated on `.chezmoi.hostname`: `tpw026` gets `gruvbox`
plus a `[theme.custom]` warm `panel_bg`/`accent`, everything else stays on
`catppuccin`. That's a "which box am I on" cue for SSH sessions, not a taste
preference — if you retheme, keep the two visibly far apart. The gate uses the
short hostname, so confirm with `chezmoi data | rg hostname` on the remote
before assuming it matched.

## rtk (Rust Token Killer)

A CLI proxy that compacts command output. This repository tracks its shared
configuration; install the Rust Token Killer separately. Do not assume
`cargo install rtk` installs this tool: that crate name belongs to a different
project. Check for `rtk gain` to distinguish the expected CLI.

The config is the awkward part. rtk resolves its config directory per platform
and accepts no override, so the same content has to land in three places:
`~/Library/Application Support/rtk/` on macOS, `~/.config/rtk/` on Linux, and
`%APPDATA%\rtk\` on Windows. Rather than triplicate it, all three are one-line
wrappers around the shared `.chezmoitemplates/rtk-config.toml` partial, the
same arrangement Herdr uses above, each gated to its own OS in
`.chezmoiignore`. **Edit the partial, not the wrappers.** Only the macOS path
is verified first-hand; the Linux and Windows paths follow the `dirs`-crate
convention rtk is built on but have not been exercised on those machines yet.

Not tracked alongside it: `filters.toml` (rtk writes a comment-only example
scaffold with no real content) and `history.db` (per-machine usage stats).

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

## macOS: Deskflow and the Voyager Space shortcuts

Karabiner swaps the Voyager's left Ctrl/Cmd keys. Its two Space exceptions
undo that swap **only on the Mac**. On a Deskflow client, Space follows the
normal modifier mapping, including that client's existing Deskflow mapping.

`~/.local/bin/deskflow-karabiner` follows the Deskflow server's INFO log and sets
Karabiner's `deskflow_remote` variable: `0` locally, `1` on any remote computer.
It reads the screen name and log filename from
`~/Library/Deskflow/Deskflow.conf`; those machine-specific values are not tracked.
The helper requires Python 3 (`/usr/bin/python3`, provided by Apple's Command
Line Tools), Karabiner-Elements, and Deskflow's normal macOS GUI configuration.

### Setup

1. In Deskflow settings, enable **Log to file** and use **INFO** log level.
   Restart Deskflow so its core process picks up the logging settings.
2. Run `chezmoi apply`. The macOS-only
   `com.marctotaro.deskflow-karabiner` LaunchAgent starts the helper at login;
   the `run_onchange` script reloads it after helper/agent changes.
3. Test Ctrl+Space and Super+Space on the Mac and a remote computer, then return
   to the Mac. The Mac keeps its Space exceptions; remote input uses the normal
   swap. This is scoped to the Voyager and the existing left-modifier rules.

Transitions are polled every 50 ms, plus the time to call `karabiner_cli`.
Server exits are detected within roughly one second. Forced returns after a
client disconnect, suspend/resume, log replacement/truncation, and helper
restarts are handled. A session-scoped checkpoint in
`~/Library/Caches/deskflow-karabiner/state.json` preserves the destination and
log position across helper restarts, including after Deskflow discards its log.
The variable is refreshed every five seconds to recover from Karabiner restarts.

Diagnostics: `~/Library/Logs/deskflow-karabiner.log` records variable changes
and errors. The parser is based on Deskflow **1.26.0**'s `switch from`, `jump
from`, and server lifecycle messages. If a future Deskflow version changes its
logging format, update the parser and its fixtures in
`tests/deskflow/test_deskflow_karabiner.py`.

To disable the integration and restore the original always-local exceptions:

```sh
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.marctotaro.deskflow-karabiner.plist"
"/Library/Application Support/org.pqrs/Karabiner-Elements/bin/karabiner_cli" --set-variables '{"deskflow_remote":0}'
```

Run its automated checks with:

```sh
PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -m unittest discover -s tests/deskflow -v
```

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


## Xfce: shortcuts, theme, and Deskflow

On Linux, `chezmoi apply` installs `configure-xfce` and an Xfce-only autostart
entry. Preferences are applied through `xfconf-query` when Xfwm is running,
both after changes and at login. No generated Xfce XML is tracked.

- Super+Space opens Vicinae (or Xfce Appfinder if Vicinae is absent).
- Super+1–9/0 selects one of ten workspaces; adding Shift moves the window.
- Super+Enter opens Kitty (or the default terminal); adding Shift opens the browser.
- Super+Q closes, Super+F maximizes, Super+Shift+F toggles fullscreen.
- Super+arrows tile windows. Workspaces span all monitors.
- Greybird-dark and Yaru are selected when installed; packages are not installed
  by this setup. Xfce supplies the fallback launcher and terminal command.

The autostart supervisor starts Vicinae when available. If the Deskflow snap
and `~/.config/Deskflow/Deskflow.conf` exist, it starts the client with X11
explicitly selected and the snap's XKB data path. The config and TLS material
remain local: install the snap and configure/pair Deskflow on a fresh machine.
The Control_R workaround is deployed only to `marc-Ubuntu-TPL071`.

These use transient user services (`vicinae-xfce`, `deskflow-xfce`, and
`deskflow-rctrl-xfce`), stopped when the Xfce session exits. Do not enable the
older `deskflow-client.service` alongside this Xfce startup path.
Run `~/.local/bin/configure-xfce` to restore preferences manually;
`journalctl --user -u deskflow-xfce -u vicinae-xfce` shows startup diagnostics.
