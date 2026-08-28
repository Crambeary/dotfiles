#!/usr/bin/env bash
set -euo pipefail

command -v vicinae >/dev/null 2>&1 || exit 0
vicinae theme set matugen >/dev/null 2>&1 || true
