#!/bin/sh
top -bn1 | awk '/^%Cpu/ {printf "%.0f%%", 100-$8}'
