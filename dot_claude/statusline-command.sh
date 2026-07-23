#!/bin/bash
# Claude Code statusline: model, effort, and context window usage

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

left="${BOLD}${CYAN}${model}${RESET}"

if [ -n "$effort" ]; then
  case "$effort" in
    high|max|xhigh) effort_color="$MAGENTA" ;;
    medium)         effort_color="$YELLOW" ;;
    *)               effort_color="$GRAY" ;;
  esac
  left="$left ${GRAY}(${RESET}${effort_color}${effort} effort${RESET}${GRAY})${RESET}"
fi

right=""
if [ -n "$used_pct" ]; then
  used_rounded=$(printf '%.0f' "$used_pct")
  if [ "$used_rounded" -ge 85 ]; then
    ctx_color="$RED"
  elif [ "$used_rounded" -ge 60 ]; then
    ctx_color="$YELLOW"
  else
    ctx_color="$GREEN"
  fi
  right="${GRAY}<${RESET}${ctx_color}${BOLD}C: ${used_rounded}%${RESET}${GRAY}>${RESET}"
elif [ -n "$remaining_pct" ]; then
  remaining_rounded=$(printf '%.0f' "$remaining_pct")
  used_rounded=$((100 - remaining_rounded))
  if [ "$used_rounded" -ge 85 ]; then
    ctx_color="$RED"
  elif [ "$used_rounded" -ge 60 ]; then
    ctx_color="$YELLOW"
  else
    ctx_color="$GREEN"
  fi
  right="${GRAY}<${RESET}${ctx_color}${BOLD}C: ${used_rounded}%${RESET}${GRAY}>${RESET}"
fi

if [ -n "$right" ]; then
  printf "%b %b" "$right" "$left"
else
  printf "%b" "$left"
fi
