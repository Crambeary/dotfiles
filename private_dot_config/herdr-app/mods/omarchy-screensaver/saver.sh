#!/bin/bash
# Runs inside the screensaver terminal. $1 = frame file the mod writes (first line
# $2, the nonce for this run, then the window as SGR text), $3 = effect ("random"
# or a tuiffects name), $4 = terminal to read if no frame arrives, $5 = seconds an
# effect may run before tuiffects jumps to its end (0: no limit; tuiffects' own default
# of 12 cuts most effects short on a whole-window frame).
# Plays an effect on the frame, lingers, plays another, until a key is pressed or
# the mouse moves or clicks over it (mouse reporting turns those into input bytes;
# checked every second); then exits, which closes the overlay.
F=$1; NONCE=$2; E=${3:-random}; T=$4; S=${5:-0}
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"
BIN=$(command -v tuiffects || ls "$HOME"/.local/share/mise/installs/go/*/bin/tuiffects 2>/dev/null | tail -n1)
[ -x "$BIN" ] || { echo "tuiffects not installed (mise use -g go:github.com/Gaurav-Gosain/tuiffects/cmd/tuiffects)"; read -r _; exit 1; }
stty -echo 2>/dev/null
MOUSE_ON='\033[?1000h\033[?1003h\033[?1006h' MOUSE_OFF='\033[?1006l\033[?1003l\033[?1000l'
trap 'printf "$MOUSE_OFF\033[?25h"' EXIT
printf "\033[2J\033[H\033[?25l$MOUSE_ON"
FRAME=""
for _i in $(seq 1 20); do
  if [ -f "$F" ] && [ "$(head -n1 "$F")" = "$NONCE" ]; then FRAME=$(tail -n +2 "$F"); break; fi
  if read -r -s -n1 -t 1 _; then exit 0; fi
done
[ -n "$FRAME" ] || FRAME=$(hc read "$T" 2>/dev/null)
while :; do
  printf "\033[2J\033[H\033[?25l$MOUSE_ON"
  printf '%s\n' "$FRAME" | "$BIN" -e "$E" -t "$S" &
  P=$!
  while kill -0 "$P" 2>/dev/null; do
    if read -r -s -n1 -t 1 _; then kill "$P" 2>/dev/null; exit 0; fi
  done
  wait "$P" 2>/dev/null
  # tuiffects ends with the cursor two lines under its canvas, which scrolls a
  # full-screen frame up by one: draw the final frame again from the top, with no
  # newline after its last line.
  printf '\033[2J\033[H%s' "$FRAME"
  for _i in 1 2 3 4 5; do if read -r -s -n1 -t 1 _; then exit 0; fi; done
done
