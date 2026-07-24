#!/bin/bash
# Claude Code statusline: context, cache age, 5h/weekly usage + time-to-reset, model, effort
# Kept short and put context/usage first: narrow panes can lose content,
# so the important numbers go first with minimal escape overhead.
#
# Context %, 5h/weekly (D/W) usage, and their reset countdowns all come
# straight from fields Claude Code already includes on stdin
# (context_window, rate_limits.*.used_percentage/resets_at) —
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

# fmt_tokens <count> -> "76k", "999k", "1m", "1.2m"
fmt_tokens() {
  local n="$1"
  if [ "$n" -ge 1000000 ]; then
    awk -v n="$n" 'BEGIN { v = n / 1000000; if (v == int(v)) printf "%dm", v; else printf "%.1fm", v }'
  else
    echo "$((n / 1000))k"
  fi
}

# fmt_remaining <seconds> -> "Xh Ym" or "Xd Yh" duration string
fmt_remaining() {
  local secs="$1"
  if [ "$secs" -le 0 ]; then
    echo "0m"
    return
  fi
  local days=$((secs / 86400))
  local hours=$(((secs % 86400) / 3600))
  local mins=$(((secs % 3600) / 60))
  local sec=$((secs % 60))
  if [ "$days" -gt 0 ]; then
    echo "${days}d${hours}h"
  elif [ "$hours" -gt 0 ]; then
    echo "${hours}h${mins}m"
  elif [ "$mins" -gt 0 ]; then
    echo "${mins}m${sec}s"
  else
    echo "${sec}s"
  fi
}

# fmt_remaining_until <resets_at epoch> -> countdown to an absolute epoch
fmt_remaining_until() {
  local resets_at="$1"
  local now
  now=$(date +%s)
  fmt_remaining $((resets_at - now))
}

# --- context window ---
# Prefer computing this ourselves from raw token counts (matches what
# oh-my-claude does) rather than trusting a precomputed percentage field.
current=$(echo "$input" | jq -r '
  (.context_window.current_usage // empty) as $u
  | if $u == null then empty else
      (($u.input_tokens // 0) + ($u.cache_creation_input_tokens // 0) + ($u.cache_read_input_tokens // 0))
    end
' 2>/dev/null)
ctx_size=$(echo "$input" | jq -r '.context_window.context_window_size // empty' 2>/dev/null)

transcript_path=$(echo "$input" | jq -r '.transcript_path // empty')

# Anthropic's statusline payload has stopped reliably including
# context_window (anthropics/claude-code#16087) — fall back to reading
# token usage straight out of the transcript's last assistant turn. We grab
# this regardless of whether the live field is present since the cache-age
# indicator below needs the same last-usage record.
last_usage=""
if [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
  last_usage=$(tail -n 300 "$transcript_path" 2>/dev/null | jq -c 'select(.type == "assistant" and .message.usage != null) | {ts: .timestamp, usage: .message.usage}' 2>/dev/null | tail -1)
fi

if [ -z "$current" ] && [ -n "$last_usage" ]; then
  current=$(echo "$last_usage" | jq -r '.usage | (.input_tokens // 0) + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0)')
  # Real window size isn't exposed via the transcript, so assume the
  # standard 200k window (Claude Code doesn't surface 1M-beta status here).
  ctx_size=200000
fi

used_rounded=""
if [ -n "$current" ] && [ -n "$ctx_size" ] && [ "$ctx_size" -gt 0 ]; then
  used_rounded=$((current * 100 / ctx_size))
fi

if [ -z "$used_rounded" ]; then
  # Fall back further to Claude Code's own precomputed percentage fields.
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
  if [ -n "$current" ] && [ -n "$ctx_size" ]; then
    cur_fmt=$(fmt_tokens "$current")
    size_fmt=$(fmt_tokens "$ctx_size")
    ctx="${ctx_color}${BOLD}C:${cur_fmt}/${size_fmt}(${used_rounded}%)${RESET}"
  else
    ctx="${ctx_color}${BOLD}C:${used_rounded}%${RESET}"
  fi
fi

# --- prompt-cache age ---
# Claude Code's context cache expires 5m (or 1h, with extended ephemeral
# caching) after the last turn; once it expires the next turn pays full
# price to rebuild it instead of a cache hit. Surface a countdown so a lull
# is visible before it gets expensive.
cache_age=""
if [ -n "$last_usage" ]; then
  last_ts=$(echo "$last_usage" | jq -r '.ts // empty')
  uses_1h=$(echo "$last_usage" | jq -r '(.usage.cache_creation.ephemeral_1h_input_tokens // 0) > 0')
  if [ -n "$last_ts" ]; then
    last_epoch=$(echo "\"$last_ts\"" | jq -r 'sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601' 2>/dev/null)
    if [ -n "$last_epoch" ]; then
      ttl=300
      [ "$uses_1h" = "true" ] && ttl=3600
      now_epoch=$(date +%s)
      remaining=$((ttl - (now_epoch - last_epoch)))
      if [ "$remaining" -gt 0 ]; then
        cache_color="$GREEN"
        [ "$remaining" -lt 60 ] && cache_color="$YELLOW"
        cache_age=" ${GRAY}cache:${RESET}${cache_color}$(fmt_remaining "$remaining")${RESET}"
      else
        cache_age=" ${GRAY}cache:${RESET}${RED}stale${RESET}"
      fi
    fi
  fi
fi

# --- 5h / weekly usage: straight from Claude Code's own rate_limits field ---
five_hour=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
seven_day=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
five_hour_resets=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
seven_day_resets=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')

usage=""
if [ -n "$five_hour" ]; then
  d_rounded=$(printf '%.0f' "$five_hour")
  d_color=$(ge_color "$d_rounded")
  d_left=""
  if [ -n "$five_hour_resets" ]; then
    d_left="${GRAY}(${RESET}$(fmt_remaining_until "$five_hour_resets")${GRAY})${RESET}"
  fi
  usage="${usage} ${d_color}D:${d_rounded}%${RESET}${d_left}"
fi
if [ -n "$seven_day" ]; then
  w_rounded=$(printf '%.0f' "$seven_day")
  w_color=$(ge_color "$w_rounded")
  w_left=""
  if [ -n "$seven_day_resets" ]; then
    w_left="${GRAY}(${RESET}$(fmt_remaining_until "$seven_day_resets")${GRAY})${RESET}"
  fi
  usage="${usage} ${w_color}W:${w_rounded}%${RESET}${w_left}"
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

# --- credit-burn indicator ---
# Only shown once a window is fully maxed (>=100%). Native rate_limits tells
# us we're maxed but not $ spent on credits past the cap, so once maxed we
# shell out to ccusage (global install) for today's cost. Cached to a file
# with a short TTL since ccusage parses local JSONL logs (~1-3s), which is
# too slow to re-run on every statusline refresh.
# at_cap <pct> -> success when a window is genuinely at/over 100%. Compared in
# awk rather than via printf '%.0f', which rounds — 99.6% would read as maxed.
at_cap() {
  [ -n "$1" ] && awk -v v="$1" 'BEGIN { exit !(v >= 100) }'
}

maxed=0
at_cap "$five_hour" && maxed=1
at_cap "$seven_day" && maxed=1

credit=""
if [ "$maxed" -eq 1 ] && command -v ccusage >/dev/null 2>&1; then
  # Per-user temp dir where available: /tmp is world-writable and sticky on
  # Linux, so a fixed filename there can be squatted by another user, leaving
  # the cache permanently unwritable (and every refresh paying ccusage's 1-3s).
  cache_dir="${TMPDIR:-/tmp}"
  cache_file="${cache_dir%/}/.claude-credit-burn-cache"
  cache_ttl=90
  now_epoch=$(date +%s)
  cached_cost=""
  if [ -f "$cache_file" ]; then
    cache_mtime=$(stat -f %m "$cache_file" 2>/dev/null || stat -c %Y "$cache_file" 2>/dev/null)
    if [ -n "$cache_mtime" ] && [ $((now_epoch - cache_mtime)) -lt "$cache_ttl" ]; then
      cached_cost=$(cat "$cache_file")
    fi
  fi
  if [ -z "$cached_cost" ]; then
    today_cost=$(ccusage daily --json --since "$(date +%Y%m%d)" 2>/dev/null | jq -r '.totals.totalCost // empty')
    if [ -n "$today_cost" ]; then
      cached_cost=$(printf '%.2f' "$today_cost")
      echo "$cached_cost" > "$cache_file" 2>/dev/null
    fi
  fi
  if [ -n "$cached_cost" ]; then
    credit=" ${RED}${BOLD}Extra:\$${cached_cost}${RESET}"
  fi
elif [ "$maxed" -eq 1 ]; then
  # Maxed with no ccusage on PATH: say so instead of omitting the line, so an
  # unprovisioned machine doesn't look like it's burning nothing past the cap.
  credit=" ${RED}${BOLD}Extra:?${RESET}${GRAY}(ccusage)${RESET}"
fi

stats="$ctx$cache_age$usage$credit"

if [ -n "$stats" ]; then
  printf "%b %b" "$stats" "$model_part"
else
  printf "%b" "$model_part"
fi
