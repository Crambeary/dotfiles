#!/bin/bash
# Claude Code statusline: context, 5h/weekly usage, model, and effort
# Kept short and put context/usage first: narrow panes can lose content,
# so the important numbers go first with minimal escape overhead.

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

# --- context window ---
ctx=""
if [ -n "$used_pct" ]; then
  used_rounded=$(printf '%.0f' "$used_pct")
elif [ -n "$remaining_pct" ]; then
  remaining_rounded=$(printf '%.0f' "$remaining_pct")
  used_rounded=$((100 - remaining_rounded))
fi
if [ -n "$used_rounded" ]; then
  ctx_color=$(ge_color "$used_rounded")
  ctx="${ctx_color}${BOLD}C:${used_rounded}%${RESET}"
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
  usage="${usage} ${d_color}D:${d_rounded}%${RESET}"
fi
if [ -n "$seven_day" ]; then
  w_rounded=$(printf '%.0f' "$seven_day")
  w_color=$(ge_color "$w_rounded")
  usage="${usage} ${w_color}W:${w_rounded}%${RESET}"
fi

# --- model + effort (single-letter code) ---
model_part="${BOLD}${CYAN}${model}${RESET}"

if [ -n "$effort" ]; then
  case "$effort" in
    low)    effort_code="l";  effort_color="$GRAY" ;;
    medium) effort_code="m";  effort_color="$YELLOW" ;;
    high)   effort_code="h";  effort_color="$MAGENTA" ;;
    xhigh)  effort_code="xh"; effort_color="$MAGENTA" ;;
    max)    effort_code="mx"; effort_color="$MAGENTA" ;;
    *)      effort_code="$effort"; effort_color="$GRAY" ;;
  esac
  model_part="${model_part}${GRAY}(${RESET}${effort_color}${effort_code}${RESET}${GRAY})${RESET}"
fi

stats="$ctx$usage"

if [ -n "$stats" ]; then
  printf "%b %b" "$stats" "$model_part"
else
  printf "%b" "$model_part"
fi
