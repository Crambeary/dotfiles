#!/bin/bash
# Background updater for the 5h/weekly usage cache, run async from
# statusline-command.sh so the statusline never blocks on the network.
# Pattern borrowed from ssenart/oh-my-claude: statusline reads a cache
# file only; this script is the only thing that ever hits the network.

CACHE="$HOME/.cache/claude-usage/usage.json"
LOCK="$HOME/.cache/claude-usage/usage.lock"
mkdir -p "$HOME/.cache/claude-usage"

exec 9>"$LOCK"
flock -n 9 || exit 0

token=$(jq -r '.claudeAiOauth.accessToken // empty' "$HOME/.claude/.credentials.json" 2>/dev/null)
[ -z "$token" ] && exit 0

curl -s -m 5 "https://api.anthropic.com/api/oauth/usage" \
  -H "Authorization: Bearer $token" \
  -H "anthropic-beta: oauth-2025-04-20" 2>/dev/null > "$CACHE.tmp"

[ -s "$CACHE.tmp" ] && jq -e . "$CACHE.tmp" >/dev/null 2>&1 && mv "$CACHE.tmp" "$CACHE"
rm -f "$CACHE.tmp"
