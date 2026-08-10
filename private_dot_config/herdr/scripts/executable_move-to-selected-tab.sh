#!/usr/bin/env bash
set -euo pipefail
source "${BASH_SOURCE[0]%/*}/lib-herdr.sh"
target=$(herdr_json tab list --workspace "$HERDR_ACTIVE_WORKSPACE_ID" \
  | jq -r --arg cur "$HERDR_ACTIVE_TAB_ID" \
    '.result.tabs[] | select(.tab_id != $cur) | "\(.tab_id)\t#\(.label)  (\(.pane_count) panes, \(.agent_status))"' \
  | fzf --with-nth=2.. --delimiter='\t' --prompt="move pane to tab > " \
  | cut -f1)

if [[ -n "${target:-}" ]]; then
  herdr_json pane move "$HERDR_ACTIVE_PANE_ID" --tab "$target" --split right --focus
fi
