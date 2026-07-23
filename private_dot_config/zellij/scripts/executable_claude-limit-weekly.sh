#!/bin/sh
# Undocumented Anthropic endpoint (github.com/ohugonnot/claude-code-statusline) - may break without notice.
token=$(jq -r '.claudeAiOauth.accessToken // empty' ~/.claude/.credentials.json 2>/dev/null)
[ -z "$token" ] && { echo "—"; exit 0; }

used=$(curl -s -m 5 "https://api.anthropic.com/api/oauth/usage" \
  -H "Authorization: Bearer $token" \
  -H "anthropic-beta: oauth-2025-04-20" 2>/dev/null | jq -r '.seven_day.utilization // empty')

[ -z "$used" ] && { echo "—"; exit 0; }
awk -v u="$used" 'BEGIN { printf "%.0f%% left", 100 - u }'
