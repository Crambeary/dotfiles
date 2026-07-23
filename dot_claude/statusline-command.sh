#!/bin/bash
# Claude Code statusline: model, effort, context window, and 5h/weekly usage

input=$(cat)

model=$(echo "$input" | jq -r '.model.display_name // "unknown"')
effort=$(echo "$input" | jq -r '.effort.level // empty')

used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
remaining_pct=$(echo "$input" | jq -r '.context_window.remaining_percentage // empty')

# Colors
RESET='\033[0m'
BOLD='\033[1m'
CYAN='\033[36m'
MAGENTA='\033[35m'
YELLOW='\033[33m'
GREEN='\033[32m'
RED='\033[31m'
GRAY='\033[2;37m'

# ge_color <used_pct> -> color for a "% used" figure (green/yellow/red)
ge_color() {
  if [ "$1" -ge 85 ]; then
    echo "$RED"
  elif [ "$1" -ge 60 ]; then
    echo "$YELLOW"
  else
    echo "$GREEN"
  fi
}

left="${BOLD}${CYAN}${model}${RESET}"

if [ -n "$effort" ]; then
  case "$effort" in
    high|max|xhigh) effort_color="$MAGENTA" ;;
    medium)         effort_color="$YELLOW" ;;
    *)               effort_color="$GRAY" ;;
  esac
  left="$left ${GRAY}(${RESET}${effort_color}${effort} effort${RESET}${GRAY})${RESET}"
fi

# --- context window ---
ctx=""
if [ -n "$used_pct" ]; then
  used_rounded=$(printf '%.0f' "$used_pct")
  ctx_color=$(ge_color "$used_rounded")
  ctx="${GRAY}<${RESET}${ctx_color}${BOLD}C: ${used_rounded}%${RESET}${GRAY}>${RESET}"
elif [ -n "$remaining_pct" ]; then
  remaining_rounded=$(printf '%.0f' "$remaining_pct")
  used_rounded=$((100 - remaining_rounded))
  ctx_color=$(ge_color "$used_rounded")
  ctx="${GRAY}<${RESET}${ctx_color}${BOLD}C: ${used_rounded}%${RESET}${GRAY}>${RESET}"
fi

# --- 5h / weekly usage, via an undocumented oauth/usage endpoint ---
# Shared cache with a lock so multiple statuslines don't hammer the endpoint
# (it rate-limits hard). Refreshed at most once every 25s.
CACHE="$HOME/.cache/claude-usage/usage.json"
LOCK="$HOME/.cache/claude-usage/usage.lock"
mkdir -p "$HOME/.cache/claude-usage"

now=$(date +%s)
mtime=$( [ -f "$CACHE" ] && stat -c %Y "$CACHE" 2>/dev/null || echo 0)

if [ $((now - mtime)) -ge 25 ]; then
  (
    flock -n 9 || exit 0
    mtime=$( [ -f "$CACHE" ] && stat -c %Y "$CACHE" 2>/dev/null || echo 0)
    now=$(date +%s)
    [ $((now - mtime)) -lt 25 ] && exit 0

    token=$(jq -r '.claudeAiOauth.accessToken // empty' "$HOME/.claude/.credentials.json" 2>/dev/null)
    [ -z "$token" ] && exit 0

    curl -s -m 5 "https://api.anthropic.com/api/oauth/usage" \
      -H "Authorization: Bearer $token" \
      -H "anthropic-beta: oauth-2025-04-20" 2>/dev/null > "$CACHE.tmp"

    [ -s "$CACHE.tmp" ] && jq -e . "$CACHE.tmp" >/dev/null 2>&1 && mv "$CACHE.tmp" "$CACHE"
    rm -f "$CACHE.tmp"
  ) 9>"$LOCK"
fi

five_hour=$(jq -r '.five_hour.utilization // empty' "$CACHE" 2>/dev/null)
seven_day=$(jq -r '.seven_day.utilization // empty' "$CACHE" 2>/dev/null)

usage=""
if [ -n "$five_hour" ]; then
  d_rounded=$(printf '%.0f' "$five_hour")
  d_color=$(ge_color "$d_rounded")
  usage="${usage}${GRAY} ${RESET}${d_color}D: ${d_rounded}%${RESET}"
fi
if [ -n "$seven_day" ]; then
  w_rounded=$(printf '%.0f' "$seven_day")
  w_color=$(ge_color "$w_rounded")
  usage="${usage}${GRAY} ${RESET}${w_color}W: ${w_rounded}%${RESET}"
fi

right="$ctx$usage"

if [ -n "$right" ]; then
  printf "%b %b" "$right" "$left"
else
  printf "%b" "$left"
fi
