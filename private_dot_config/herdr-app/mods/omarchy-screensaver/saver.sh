#!/bin/bash
# Runs inside the screensaver terminal. $1 = frame file the mod writes (first line
# $2, the nonce for this run, then the window as SGR text), $3 = effect ("random"
# or a tuiffects name), $4 = terminal to read if no frame arrives.
# Plays an effect on the frame, lingers, plays another, until a key is pressed
# (checked every second); then exits, which closes the overlay.
F=$1; NONCE=$2; E=${3:-random}; T=$4
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"
BIN=$(command -v tuiffects || ls "$HOME"/.local/share/mise/installs/go/*/bin/tuiffects 2>/dev/null | tail -n1)
[ -x "$BIN" ] || { echo "tuiffects not installed (mise use -g go:github.com/Gaurav-Gosain/tuiffects/cmd/tuiffects)"; read -r _; exit 1; }
stty -echo 2>/dev/null
trap 'printf "\033[?25h"' EXIT
printf '\033[2J\033[H\033[?25l'
FRAME=""
for _i in $(seq 1 20); do
  if [ -f "$F" ] && [ "$(head -n1 "$F")" = "$NONCE" ]; then FRAME=$(tail -n +2 "$F"); break; fi
  if read -r -s -n1 -t 1 _; then exit 0; fi
done
[ -n "$FRAME" ] || FRAME=$(hc read "$T" 2>/dev/null)
while :; do
  printf '\033[2J\033[H\033[?25l'
  if [ "$E" = random ]; then printf '%s\n' "$FRAME" | "$BIN" & else printf '%s\n' "$FRAME" | "$BIN" -e "$E" & fi
  P=$!
  while kill -0 "$P" 2>/dev/null; do
    if read -r -s -n1 -t 1 _; then kill "$P" 2>/dev/null; exit 0; fi
  done
  wait "$P" 2>/dev/null
  for _i in 1 2 3 4 5; do if read -r -s -n1 -t 1 _; then exit 0; fi; done
done
