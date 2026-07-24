#!/bin/sh
if [ "$(uname)" = "Darwin" ]; then
    # No built-in fan reading on macOS; needs istats (brew). Prints nothing otherwise.
    if command -v istats >/dev/null 2>&1; then
        istats fan speed --value-only 2>/dev/null | awk 'NR==1 {printf "%.0f RPM", $1}'
    fi
else
    sensors -A applesmc-isa-0300 2>/dev/null | awk -F: '/Exhaust/ {gsub(/RPM.*/,"",$2); gsub(/^ +| +$/,"",$2); print $2 " RPM"}'
fi
