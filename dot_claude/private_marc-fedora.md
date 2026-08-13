# Docker on this machine (marc-fedora)

- SELinux is **Enforcing**. Any bind mount into a container needs the relabel suffix or the container silently fails to read/write it (Navidrome's first setup crash-looped on "unable to open database file" purely from a missing label, no permission-bit issue at all).
  - Read-write mounts: add `:Z` (private label) — use for a directory only one container touches, e.g. `./data:/data:Z`.
  - Read-write mounts shared across containers, or read-only mounts: add `:z` (shared label) — e.g. `/srv/media/music:/music:ro,z`.
  - Existing compose files in `~/docker/*/docker-compose.yml` already follow this convention (see `plex/docker-compose.yml`); match it for any new service.
- Fixing ownership on a bind-mounted directory does NOT need host sudo: `marc` is in the `docker` group, so run a throwaway container as root against the mount instead, e.g. `docker run --rm -v /host/path:/data:z alpine chown -R 1000:1000 /data`. Add `:z`/`:Z` to this throwaway mount too, same as above, or the chown itself gets silently blocked by SELinux.
- PUID/PGID env vars are a linuxserver.io image convention (used by `lscr.io/linuxserver/*` images like Plex) — not universal. Non-linuxserver images (e.g. `deluan/navidrome`) instead take a numeric `user: 1000:1000` field directly in the compose service.

# Sudo on this machine (marc-fedora)

- Passwordless, no approval needed: `dmesg`, `smartctl`, `dmidecode`, `lspci`, `fdisk -l` (via `/etc/sudoers.d/agent-readonly`).
- Everything else: use `sudo -A`, never plain `sudo` (plain sudo just fails — no terminal to prompt). `SUDO_ASKPASS` is set in `~/.zshrc` but doesn't reach tool-call shells, so export it inline every time: `SUDO_ASKPASS="$(command -v askpass)" sudo -A <cmd>`.
- At the desk (`DISPLAY` set): a GUI dialog (zenity) asks Marc to Allow/Deny, showing the exact command.
- Remote/phone (no `DISPLAY`): askpass asks for a TOTP code instead. State the exact command to Marc, wait for the 6-digit code from his authenticator app, then run `TOTP="<code>" SUDO_ASKPASS="$(command -v askpass)" sudo -A <cmd>`. Codes are single-use and expire in ~30s — request a fresh one per command, don't reuse or pre-ask.
- Never run `sudoplz get` — it prints the plaintext stored password into the transcript.
- Background/rationale/full history: `Agent Sudo Setup` effort note in the Forge vault (`~/Documents/Forge/Efforts/Agent Sudo Setup.md`).
