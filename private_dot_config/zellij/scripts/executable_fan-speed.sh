#!/bin/sh
sensors -A applesmc-isa-0300 2>/dev/null | awk -F: '/Exhaust/ {gsub(/RPM.*/,"",$2); gsub(/^ +| +$/,"",$2); print $2 " RPM"}'
