#!/bin/bash
# Keep GNOME's top-bar clock in the form "Mon Aug 10 9:23 PM".
# Re-runs via run_onchange whenever these settings change.
set -euo pipefail

command -v gsettings >/dev/null 2>&1 || exit 0

schema=org.gnome.desktop.interface
gsettings writable "$schema" clock-format >/dev/null 2>&1 || exit 0

gsettings set "$schema" clock-format '12h'
gsettings set "$schema" clock-show-date true
gsettings set "$schema" clock-show-weekday true
gsettings set "$schema" clock-show-seconds false
