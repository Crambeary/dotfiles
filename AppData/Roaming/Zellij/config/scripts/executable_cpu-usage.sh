#!/bin/sh
if [ "$(uname)" = "Darwin" ]; then
    top -l 1 | awk '/CPU usage/ {gsub(/%/,"",$(NF-1)); printf "%.0f%%", 100-$(NF-1)}'
else
    top -bn1 | awk '/^%Cpu/ {printf "%.0f%%", 100-$8}'
fi
