#!/bin/sh
sensors -A coretemp-isa-0000 2>/dev/null | awk -F'+|°' '/Package id 0/ {printf "%.0f°C", $2}'
