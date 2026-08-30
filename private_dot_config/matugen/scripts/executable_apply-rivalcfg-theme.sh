#!/usr/bin/env bash
set -euo pipefail

# The Aerox 3 Wireless Gen 2 (1038:1890) isn't in any rivalcfg release yet
# (latest PyPI is 4.17.0) -- it only exists on the upstream
# device_aerox3_wireless_gen2 branch, checked out at
# ~/ghq/github.com/flozz/rivalcfg on the device_aerox3_wireless_gen2 branch,
# with its own venv. Swap this back to a plain `rivalcfg` once Gen 2 support
# ships in a release.
rivalcfg="$HOME/ghq/github.com/flozz/rivalcfg/rivalcfg.venv/bin/rivalcfg"
theme="$HOME/.config/rivalcfg/matugen-theme.sh"

[[ -x "$rivalcfg" && -f "$theme" ]] || exit 0
source "$theme"

# matugen's Material You palette is often low-saturation (pale wallpapers
# yield pale schemes), which reads as near-white on the LED strip. Boost
# saturation for the mouse only -- hue and brightness stay true to the
# theme, other matugen targets (herdr, helix, ...) are untouched.
boost_saturation() {
  python3 -c '
import colorsys, sys

hex_color = sys.argv[1]
boost = 2.0
floor = 0.5

r, g, b = (int(hex_color[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
h, s, v = colorsys.rgb_to_hsv(r, g, b)
s = min(1.0, max(s * boost, floor))
r, g, b = colorsys.hsv_to_rgb(h, s, v)
print(f"{round(r * 255):02x}{round(g * 255):02x}{round(b * 255):02x}")
' "$1"
}

Z1_COLOR="$(boost_saturation "$Z1_COLOR")"
Z2_COLOR="$(boost_saturation "$Z2_COLOR")"
Z3_COLOR="$(boost_saturation "$Z3_COLOR")"

# Best-effort: the mouse may be off, asleep, or on a different dongle slot.
"$rivalcfg" --top-color "$Z1_COLOR" --middle-color "$Z2_COLOR" --bottom-color "$Z3_COLOR" >/dev/null 2>&1 || true
