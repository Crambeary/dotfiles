# Dotfiles

Managed with [chezmoi](https://www.chezmoi.io/), synced across macOS, Windows, and Linux.
OS-specific files are gated in `.chezmoiignore` using `{{ if ... .chezmoi.os }}` blocks.

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

Current values:

- `vulkan_sdk_version` — the Vulkan SDK version, e.g. `1.4.350.1`. Consumed by
  `dot_zshrc.tmpl`, which renders the `VULKAN_SDK`/`PATH`/`DYLD_LIBRARY_PATH`
  block only when it's set and non-empty. Blank on the Linux hosts, which have
  no SDK and for which those macOS-only paths were previously being exported
  regardless. **Installing a new SDK does not take effect on its own** — bump
  the value, then `chezmoi apply ~/.zshrc`.

When adding a consumer, guard it as *nested* `{{ if hasKey . "x" }}` then
`{{ if .x }}`, not a single `and`. chezmoi renders with `missingkey=error`, so a
bare `{{ .x }}` aborts `apply` outright on any machine that predates the prompt,
and Go's `and` does not reliably short-circuit away from that. The second check
catches the blank-answer case, which would otherwise interpolate an empty string
into the middle of a path.

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

A CLI proxy that compacts command output before it reaches Claude Code, wired
in as a `PreToolUse` hook that rewrites commands transparently (`git status` →
`rtk git status`). `run_once_after_install-rtk.sh.tmpl` installs it from
`homebrew/core`, which covers both macOS and Linux. Windows gets no automated
install: there is no verified scoop/winget package, and **`cargo install rtk`
is the wrong move** — that crate name belongs to an unrelated "Rust Type Kit".
The script probes for `rtk gain`, a subcommand only the Token Killer has, so a
machine that ended up with the impostor gets told rather than silently
proxying through the wrong binary. Like the ccusage script this is
best-effort: without rtk, command output is simply unfiltered.

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

## Claude Code: prefer-modern-tools hook

A `PreToolUse` hook denies `grep`, `sed`, and `find` inside Bash commands and
steers Claude toward `rg`, `sd`, and `fd`. The denial is surgical, not
blanket: `grep` is always denied (rg is a strict superset here, and `git
grep` passes through untouched); `sed` is denied only for `-i`/in-place edits
and `s///`-style substitution, since `sd` can't do those but also can't do
ranges/prints/deletes, so `sed -n '5,10p'` and `sed '2d'` stay allowed; `find`
is denied by *default*, escaping only via a narrow allow-list of predicates
`fd` genuinely cannot express (`-perm`, `-newer FILE`, `-atime`/`-ctime`,
`-inum`/`-links`/`-samefile`, `-empty`, `-printf`, `-prune`).

An allow-list rather than a deny-list, because a deny-list silently passes
whatever it forgets to name — `find . -size +1M` has no `-name`/`-type` to
catch it. Note that `-exec` is *not* on the allow-list: fd has `-x` (per file)
and `-X` (batched, equivalent to `-exec {} +`), along with `-S` for size,
`--changed-within`/`--changed-before` for mtime, and `-o` for owner, so those
all route to fd. The hook is a heuristic tokenizer, not a shell
parser, and fails open on any parse error rather than blocking a command it
can't confidently classify. The logic lives entirely in
`dot_claude/hooks/executable_prefer-modern-tools.py`, plain Python with no
templating needed in the body — the only thing that differs by OS is the
interpreter name (`python` on Windows, `python3` elsewhere).

The hook path is written into `settings.json` as the literal, *unexpanded*
string `$HOME/.claude/hooks/prefer-modern-tools.py`, matching how the
`statusLine` entry stores `~/...`. Expanding it at install time would hardcode
one machine's home directory into a config synced across three of them. Left
unexpanded, the shell Claude Code runs the hook through resolves it — including
on Windows, where Git Bash expands `$HOME` and then MSYS-translates the POSIX
path when handing the argument to native `python.exe`, so no `cygpath`
conversion is needed.

The merge script declares the *whole* Bash `PreToolUse` chain, rtk's hook
included, not just this one — rtk's entry was originally added to
settings.json by hand, so a fresh machine used to get the deny hook with no
rtk rewriting behind it. Both hooks fire on every Bash call and a deny from
either blocks the command; rtk stays first in the list. rtk separately
rewrites `rg` to `rtk rg`, so steering grep→rg keeps rtk's output compaction
rather than fighting it.

One accepted gap from that coexistence: rtk rewrites `find` to `rtk find`,
whose wrapper rejects every predicate on this hook's find allow-list
(`-perm`, `-newer FILE`, `-atime`, …), so those commands are blocked by rtk
even though this hook permits them. Setting `exclude_commands = ["find"]` in
the rtk config would fix it, at the cost of losing rtk's find compaction
everywhere; the gap is small enough that it is left alone. `rtk proxy find …`
is the per-call escape.

`~/.claude/settings.json` is deliberately **not** chezmoi-managed, because
Claude Code rewrites it at runtime and a tracked copy would fight that on
every `apply`. Instead, `run_onchange_after_configure-claude-hooks.sh.tmpl`
follows the same pattern already used by
`run_onchange_after_configure-claude-statusline.sh.tmpl`: it merges in just
the one hook entry and leaves machine-specific keys (model, effortLevel,
mcpServers) alone. It shells out to inline Python rather than `jq` for the
JSON merge, since `jq` isn't assumed present on Windows. The `run_onchange_`
prefix means chezmoi re-runs it automatically whenever the hook script's
content changes, via a hash of that script embedded in a comment.

On Windows, the merge script runs through Git Bash — Windows has no shebang
support, so nothing would execute `run_*.sh` there at all without the new
`[interpreters.sh]` block added to `.chezmoi.toml.tmpl`, and Claude Code's
Windows setup guarantees Git Bash is on `PATH`. That block's `{{ if eq
.chezmoi.os "windows" }}` gate lives in `.chezmoi.toml.tmpl` rather than
`.chezmoiignore`, a deliberate exception to this README's opening rule:
`.chezmoiignore` selects which *target files* apply to a machine, but this
block configures chezmoi itself, not a target file. **`.chezmoi.toml.tmpl`
only renders at `chezmoi init`, not at `chezmoi apply`** — so, in the same
spirit as the "Installing a new SDK does not take effect on its own" warning
above, an *existing* Windows machine pulling this change must run `chezmoi
init` once before its next `chezmoi apply`, or the merge script silently
never executes and the hook never gets registered.

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
