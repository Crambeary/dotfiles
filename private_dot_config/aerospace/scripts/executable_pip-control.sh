#!/bin/sh
# Moves/resizes a Picture-in-Picture window (Zen, Safari, etc.) in place, via
# the same Accessibility technique as pip-nudge.sh (see that file's header
# for why: AeroSpace can't see these always-on-top NSPanels at all).
#
# This is a separate script rather than a shared refactor of pip-nudge.sh so
# that ctrl-p's corner-cycle behavior stays completely unchanged.
#
# Usage:
#   pip-control.sh move   <dx> <dy>    # pixels; +x right, +y down
#   pip-control.sh resize <dw> <dh>    # pixels; freeform, floored at 160x90
#   pip-control.sh scale  <percent>    # e.g. 10 or -10; keeps aspect ratio
#
# Bound in ~/.aerospace.toml under [mode.pip.binding] (entered with alt-p).

set -eu

ACTION="$1"
A="${2:-0}"
B="${3:-0}"

MIN_W=160
MIN_H=90

SCREEN_CACHE="${TMPDIR:-/tmp}/aerospace-screen-size"
if [ ! -s "$SCREEN_CACHE" ] || [ "$(tr -dc ',' < "$SCREEN_CACHE" | wc -c)" -ne 2 ]; then
    osascript -e '
use framework "AppKit"
use scripting additions
set aScreen to (current application'"'"'s NSScreen'"'"'s mainScreen())
set visSize to item 2 of (aScreen'"'"'s visibleFrame())
set fullSize to item 2 of (aScreen'"'"'s frame())
return ((item 1 of visSize) as integer as string) & "," & ((item 2 of visSize) as integer as string) & "," & ((item 2 of fullSize) as integer as string)
' > "$SCREEN_CACHE"
fi
SCREEN_W=$(cut -d, -f1 "$SCREEN_CACHE")
SCREEN_H_FULL=$(cut -d, -f3 "$SCREEN_CACHE")

# Known browsers that spawn a "Picture-in-Picture"-titled window; keep in
# sync with pip-nudge.sh's CANDIDATES list.
CANDIDATES="zen Safari"

for PROC in $CANDIDATES; do
    RESULT=$(osascript <<EOF
tell application "System Events"
    if not (exists process "$PROC") then return "notfound"
    tell process "$PROC"
        if not (exists window "Picture-in-Picture") then return "notfound"
        set pipWin to window "Picture-in-Picture"
        set {curX, curY} to position of pipWin
        set {curW, curH} to size of pipWin

        if "$ACTION" is "move" then
            set newX to curX + ($A)
            set newY to curY + ($B)
            set newW to curW
            set newH to curH
        else if "$ACTION" is "resize" then
            set newW to curW + ($A)
            set newH to curH + ($B)
            if newW < $MIN_W then set newW to $MIN_W
            if newH < $MIN_H then set newH to $MIN_H
            set newX to curX
            set newY to curY
        else
            set scaleFactor to 1 + (($A) / 100)
            set newW to curW * scaleFactor
            set newH to curH * scaleFactor
            if newW < $MIN_W then
                set newH to (curH / curW) * $MIN_W
                set newW to $MIN_W
            else if newH < $MIN_H then
                set newW to (curW / curH) * $MIN_H
                set newH to $MIN_H
            end if
            set newX to curX
            set newY to curY
        end if

        -- Clamp to the main screen's frame so the window can't be
        -- pushed/resized off-screen.
        if newX < 0 then set newX to 0
        if newY < 0 then set newY to 0
        if newX + newW > $SCREEN_W then set newX to $SCREEN_W - newW
        if newY + newH > $SCREEN_H_FULL then set newY to $SCREEN_H_FULL - newH

        set size of pipWin to {newW, newH}
        set position of pipWin to {newX, newY}
        return "found"
    end tell
end tell
EOF
)
    [ "$RESULT" = "found" ] && break
done
