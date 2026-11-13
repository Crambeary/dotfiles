#!/bin/bash
# Runs inside the screensaver terminal. $1 = frame file the mod writes (first line
# $2, the nonce for this run, then the window as SGR text), $3 = effect ("random"
# or a tuiffects name), $4 = terminal to read if no frame arrives, $5 = seconds an
# effect may run before tuiffects jumps to its end (0: no limit; tuiffects' own default
# of 12 cuts most effects short on a whole-window frame).
# Plays an effect on the frame, lingers, plays another, until a key is pressed or
# the mouse moves or clicks over it (mouse reporting turns those into input bytes);
# then exits, which closes the overlay.
#
# Written for bash 3.2, macOS's /bin/bash: no fractional `read -t`. A background
# reader takes the first input byte and signals; the script itself just waits,
# on tuiffects or on a sleep, so it redraws the moment an effect ends.
F=$1; NONCE=$2; E=${3:-random}; T=$4; S=${5:-0}
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"
BIN=$(command -v tuiffects || ls "$HOME"/.local/share/mise/installs/go/*/bin/tuiffects 2>/dev/null | tail -n1)
[ -x "$BIN" ] || { echo "tuiffects not installed (mise use -g go:github.com/Gaurav-Gosain/tuiffects/cmd/tuiffects)"; read -r _; exit 1; }
stty -echo 2>/dev/null
MOUSE_ON='\033[?1000h\033[?1003h\033[?1006h' MOUSE_OFF='\033[?1006l\033[?1003l\033[?1000l'
P="" W=""
trap 'kill $P $W 2>/dev/null; printf "$MOUSE_OFF\033[?7h\033[?25h"' EXIT
trap 'exit 0' USR1
printf "\033[2J\033[H\033[?25l$MOUSE_ON"
# Any key, or the mouse over the window, ends it. A background job's stdin is
# /dev/null unless given the terminal.
( read -r -s -n1 _ </dev/tty; kill -USR1 $$ ) 2>/dev/null &
W=$!
# Waits that a signal cuts short (a plain `sleep` would hold the exit back).
pause() { sleep "$1" & P=$!; wait "$P" 2>/dev/null; }
FRAME=""
for _i in $(seq 1 20); do
  if [ -f "$F" ] && [ "$(head -n1 "$F")" = "$NONCE" ]; then FRAME=$(tail -n +2 "$F"); break; fi
  pause 1
done
[ -n "$FRAME" ] || FRAME=$(hc read "$T" 2>/dev/null)
while :; do
  printf "\033[?7h\033[2J\033[H\033[?25l$MOUSE_ON"
  # tuiffects reads keys from /dev/tty (a key skips its effect), so the first key
  # would go to it, not the reader above. In its own session it has no terminal
  # to read; it still draws, on the stdout it inherits.
  printf '%s\n' "$FRAME" | perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' "$BIN" -e "$E" -t "$S" &
  P=$!
  wait "$P" 2>/dev/null
  # tuiffects ends with the cursor two lines under its canvas, which scrolls a
  # full-screen frame up by one: draw the final frame again from the top, with no
  # newline after its last line. Its bottom row runs to the last column, so
  # auto-wrap goes off first (writing that cell would wrap and scroll the frame up
  # a row), and the cursor tuiffects turned back on is hidden again.
  printf '\033[?25l\033[?7l\033[2J\033[H%s' "$FRAME"
  pause 5
done
