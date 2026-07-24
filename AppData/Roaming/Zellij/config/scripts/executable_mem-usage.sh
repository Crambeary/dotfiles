#!/bin/sh
if [ "$(uname)" = "Darwin" ]; then
    total=$(sysctl -n hw.memsize)
    psize=$(vm_stat | awk '/page size of/ {print $8}')
    freepages=$(vm_stat | awk '/Pages (free|inactive|speculative)/ {gsub(/\./,"",$NF); sum+=$NF} END {print sum}')
    awk -v t="$total" -v ps="$psize" -v f="$freepages" 'BEGIN {fb=f*ps; printf "%.0f%%", (t-fb)/t*100}'
else
    free -m | awk '/^Mem:/ {printf "%.0f%%", $3/$2*100}'
fi
