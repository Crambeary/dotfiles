#!/bin/bash
# Registers herdr's per-agent hooks (~/.claude/hooks/herdr-agent-state.sh,
# ~/.config/opencode/plugins/herdr-agent-state.js, etc.) so herdr can report
# and resume agent sessions across a `herdr server` restart. Without this,
# resume_agents_on_restore in herdr's config.toml has nothing to resume.
# Best-effort: a machine without herdr installed just skips it.
set -uo pipefail

integrations=(claude opencode)

if ! command -v herdr >/dev/null 2>&1; then
  echo "herdr: not installed — skipping integration setup" >&2
  exit 0
fi

for integration in "${integrations[@]}"; do
  echo "herdr: installing ${integration} integration"
  herdr integration install "${integration}" || {
    echo "herdr: ${integration} integration install failed — skipping" >&2
  }
done
