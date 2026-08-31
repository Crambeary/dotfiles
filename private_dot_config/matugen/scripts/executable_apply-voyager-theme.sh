#!/usr/bin/env bash
set -euo pipefail

theme="$HOME/.config/voyager/matugen-theme.sh"
[[ -f "$theme" ]] || exit 0
source "$theme"

# Best-effort: keyboard may be unplugged or asleep. Sends ORYX_SET_BASE_LAYER_COLOR
# (cmd 13) over the Oryx raw HID interface -- see oryx-with-custom-qmk's
# patches/oryx-base-layer-color.patch. Recolors only the base layer; other
# layers keep their own ledmap-defined indicator colors untouched.
python3 - "$VOYAGER_COLOR" <<'PYEOF' >/dev/null 2>&1 || true
import colorsys
import sys

import hid

VID, PID = 0x3297, 0x1977
RAW_EPSIZE = 32
ORYX_SET_BASE_LAYER_COLOR = 13

hex_color = sys.argv[1]
r, g, b = (int(hex_color[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
h, s, v = colorsys.rgb_to_hsv(r, g, b)
h, s, v = round(h * 255), round(s * 255), round(v * 255)

path = next(
    d["path"] for d in hid.enumerate(VID, PID) if d.get("interface_number") == 1
)

dev = hid.device()
dev.open_path(path)
buf = [0x00, ORYX_SET_BASE_LAYER_COLOR, h, s, v] + [0] * (RAW_EPSIZE - 4)
dev.write(bytes(buf))
dev.close()
PYEOF
