#!/bin/bash
# Claude Code statusline: context, 5h/weekly usage, model, and effort
# Kept short and put context/usage first: narrow panes can lose content,
# so the important numbers go first with minimal escape overhead.
#
# Context % and 5h/weekly (D/W) usage both come straight from fields
# Claude Code already includes on stdin (context_window, rate_limits) —
# no network calls, no external tools (ccusage etc.) needed.

input=$(cat)

model=$(echo "$input" | jq -r '.model.display_name // "unknown"')
effort=$(echo "$input" | jq -r '.effort.level // empty')

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
# Prefer computing this ourselves from raw token counts (matches what
# oh-my-claude does) rather than trusting a precomputed percentage field.
used_rounded=$(echo "$input" | jq -r '
  (.context_window.current_usage // empty) as $u
  | if $u == null then empty else
      (($u.input_tokens // 0) + ($u.cache_creation_input_tokens // 0) + ($u.cache_read_input_tokens // 0)) as $current
      | (.context_window.context_window_size // 0) as $size
      | if $size == 0 then empty else (($current * 100 / $size) | round) end
    end
' 2>/dev/null)

if [ -z "$used_rounded" ]; then
  # Fall back to Claude Code's own precomputed fields if current_usage isn't present
  used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
  remaining_pct=$(echo "$input" | jq -r '.context_window.remaining_percentage // empty')
  if [ -n "$used_pct" ]; then
    used_rounded=$(printf '%.0f' "$used_pct")
  elif [ -n "$remaining_pct" ]; then
    remaining_rounded=$(printf '%.0f' "$remaining_pct")
    used_rounded=$((100 - remaining_rounded))
  fi
fi

ctx=""
if [ -n "$used_rounded" ]; then
  ctx_color=$(ge_color "$used_rounded")
  ctx="${ctx_color}${BOLD}C:${used_rounded}%${RESET}"
fi

# --- 5h / weekly usage: straight from Claude Code's own rate_limits field ---
five_hour=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
seven_day=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')

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
