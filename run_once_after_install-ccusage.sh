#!/bin/bash
# Installs ccusage, which the Claude statusline shells out to for the
# "Extra:$" credit-burn figure once a rate-limit window is maxed. The
# statusline degrades gracefully without it (shows "Extra:?"), so this
# script is best-effort: a machine with no npm just doesn't get the figure.
set -uo pipefail

if command -v ccusage >/dev/null 2>&1; then
  echo "ccusage: already installed, skipping"
  exit 0
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ccusage: npm not found — skipping (statusline will show Extra:? when maxed)" >&2
  exit 0
fi

echo "ccusage: installing globally via npm"
npm install -g ccusage || {
  echo "ccusage: install failed — skipping (statusline will show Extra:? when maxed)" >&2
  exit 0
}
