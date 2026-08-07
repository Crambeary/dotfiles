#!/bin/bash

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"

BREW_BIN=/opt/homebrew/bin/brew
[ -x "$BREW_BIN" ] || BREW_BIN=/usr/local/bin/brew

# Report against the local cache only; keeping it fresh is a separate concern.
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_ENV_HINTS=1

# sketchybar spawns scripts with SIGCHLD set to SIG_IGN, so their children are
# auto-reaped. Homebrew's Ruby then gets nil back from waitpid and dies with
# "undefined method 'exitstatus' for nil". Re-exec brew through perl with the
# default disposition restored so it can collect its own subprocesses.
OUTDATED=$(perl -e '$SIG{CHLD} = "DEFAULT"; exec @ARGV' "$BREW_BIN" outdated --quiet 2>/dev/null)
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  # Surface the failure. Rendering a broken brew as "0 outdated" is worse than
  # useless -- it reads as good news.
  sketchybar --set "$NAME" icon.color=$RED label="?" label.color=$RED
  exit 0
fi

if [ -z "$OUTDATED" ]; then
  COUNT=0
else
  COUNT=$(printf '%s\n' "$OUTDATED" | wc -l | tr -d ' ')
fi

if [ "$COUNT" -eq 0 ]; then
  sketchybar --set "$NAME" icon.color=$GREY label="0" label.color=$GREY
else
  sketchybar --set "$NAME" icon.color=$YELLOW label="$COUNT" label.color=$YELLOW
fi
