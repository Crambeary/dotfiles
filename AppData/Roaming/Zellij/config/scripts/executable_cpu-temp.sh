#!/bin/sh
if [ "$(uname)" = "Darwin" ]; then
    # No built-in CPU temp on macOS; needs osx-cpu-temp or istats (brew).
    # Prints nothing if neither is installed.
    if command -v osx-cpu-temp >/dev/null 2>&1; then
        osx-cpu-temp | awk '{printf "%.0f°C", $1}'
    elif command -v istats >/dev/null 2>&1; then
        istats cpu temp --value-only 2>/dev/null | awk 'NR==1 {printf "%.0f°C", $1}'
    fi
else
    sensors -A coretemp-isa-0000 2>/dev/null | awk -F'+|°' '/Package id 0/ {printf "%.0f°C", $2}'
fi
