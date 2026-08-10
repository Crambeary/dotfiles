# shellcheck shell=bash
# Shared error guard for the herdr keybinding scripts. Sourced, not executed.
#
# `set -euo pipefail` does abort these scripts when a CLI call fails (herdr
# exits 1-2 and prints {"error":{...}} on stdout), but herdr discards a shell
# binding's output, so the abort is invisible: the key does nothing and no log
# anywhere says why. The exit status alone was never the missing piece — the
# message was.
#
# The case that actually bites is protocol_mismatch: brew upgrades the herdr
# binary while the old server keeps running, and every CLI call fails until the
# server restarts. Routing calls through herdr_json turns that from "alt+h does
# nothing, for days" into a message that names the cause.
#
# Deliberately not in notify-watch.sh: that one is a long-running poll loop, so
# a transient error should be logged and retried, never fatal.

HERDR_SCRIPT_LOG="${HERDR_SCRIPT_LOG:-$HOME/.local/state/herdr/script-errors.log}"

herdr_script_fail() {
  local msg="$1"
  mkdir -p "${HERDR_SCRIPT_LOG%/*}"
  printf '[%s] %s: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "${0##*/}" "$msg" \
    >>"$HERDR_SCRIPT_LOG"
  echo "${0##*/}: $msg" >&2
  # Best-effort toast, last and non-fatal on purpose: the common failure is
  # "the CLI cannot reach the server", which is exactly when this cannot work.
  herdr notification show "${0##*/}: $msg" --sound none >/dev/null 2>&1 || true
  exit 1
}

# Run a herdr CLI command, echo its JSON, and abort loudly on any failure.
# Usage: result=$(herdr_json pane focus --direction left)
herdr_json() {
  local out rc=0
  out=$(herdr "$@" 2>&1) || rc=$?

  # Checked before the exit status: herdr reports a structured error *and* a
  # non-zero status, and the structured one is the half worth reading.
  if jq -e 'has("error")' >/dev/null 2>&1 <<<"$out"; then
    local code message hint=""
    code=$(jq -r '.error.code // "unknown"' <<<"$out")
    message=$(jq -r '.error.message // "no message"' <<<"$out")
    if [[ "$code" == "protocol_mismatch" ]]; then
      hint=" — restart the herdr server so it matches the upgraded binary"
    fi
    # The server's messages are multi-line; keep the first line for the toast.
    herdr_script_fail "herdr $* failed [$code]: ${message%%$'\n'*}$hint"
  fi

  if ((rc != 0)); then
    herdr_script_fail "herdr $* exited $rc: ${out:-no output}"
  fi

  # Non-JSON on success means the CLI answered with something no caller can
  # feed to jq — treat it as a failure rather than passing it down the pipe.
  if ! jq -e . >/dev/null 2>&1 <<<"$out"; then
    herdr_script_fail "herdr $* returned non-JSON: ${out:-empty}"
  fi

  printf '%s\n' "$out"
}
