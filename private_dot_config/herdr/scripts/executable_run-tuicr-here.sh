#!/usr/bin/env bash
set -euo pipefail

# Shared by prefix+d and pick-tuicr-dir.sh: review uncommitted changes when
# there are any (skip-selector, straight to the working-tree diff); when the
# tree is clean, fall back to tuicr's own commit-range selector so there's
# still something to browse instead of an empty screen.
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  exec tuicr -w
else
  exec tuicr
fi
