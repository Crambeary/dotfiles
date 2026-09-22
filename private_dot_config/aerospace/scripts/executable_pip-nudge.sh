#!/bin/sh
# Cycles a Picture-in-Picture window (Zen, Safari, etc. all title it
# "Picture-in-Picture") between the four corners of the main screen.
#
# AeroSpace can't tile or move PIP windows itself: they're always-on-top
# NSPanels, invisible to its window model (see
# https://github.com/nikitabobko/AeroSpace/issues/4, open since 2023). This
# repositions the panel directly via Accessibility instead.
#
# First run will prompt macOS to grant /usr/bin/osascript Accessibility
# access under System Settings > Privacy & Security > Accessibility.
#
# Two things made this slow enough to notice (~0.85s, sometimes 1.5s+):
# System Events enumerating every running process's windows to find the PIP
# one, and loading the AppKit framework every run just to read the screen
# size. Querying a specific process's windows directly is ~0.1s regardless
# of total process count, so we try a short list of known PIP-hosting
# browsers by name instead of scanning everything. Screen size is cached to
# disk since it doesn't change between runs.
#
# Bound to ctrl-p in ~/.aerospace.toml.

STATE_FILE="${TMPDIR:-/tmp}/aerospace-pip-corner"
CORNER=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
NEXT=$(( (CORNER + 1) % 4 ))
echo "$NEXT" > "$STATE_FILE"

SCREEN_CACHE="${TMPDIR:-/tmp}/aerospace-screen-size"
if [ ! -s "$SCREEN_CACHE" ]; then
    osascript -e '
use framework "AppKit"
use scripting additions
set screenFrame to (current application'"'"'s NSScreen'"'"'s mainScreen()'"'"'s visibleFrame())
set frameSize to item 2 of screenFrame
return ((item 1 of frameSize) as integer as string) & "," & ((item 2 of frameSize) as integer as string)
' > "$SCREEN_CACHE"
fi
SCREEN_W=$(cut -d, -f1 "$SCREEN_CACHE")
SCREEN_H=$(cut -d, -f2 "$SCREEN_CACHE")

# Known browsers that spawn a "Picture-in-Picture"-titled window. Add more
# process names here (as they'd appear in `osascript -e 'tell application
# "System Events" to get name of every process'`) if you pick up another one.
CANDIDATES="zen Safari"

for PROC in $CANDIDATES; do
    RESULT=$(osascript <<EOF
tell application "System Events"
    if not (exists process "$PROC") then return "notfound"
    tell process "$PROC"
        if not (exists window "Picture-in-Picture") then return "notfound"
        set pipWin to window "Picture-in-Picture"
        set {winW, winH} to size of pipWin
        set margin to 20

        if $CORNER is 0 then
            set targetPos to {margin, margin}
        else if $CORNER is 1 then
            set targetPos to {$SCREEN_W - winW - margin, margin}
        else if $CORNER is 2 then
            set targetPos to {$SCREEN_W - winW - margin, $SCREEN_H - winH - margin}
        else
            set targetPos to {margin, $SCREEN_H - winH - margin}
        end if

        set position of pipWin to targetPos
        return "found"
    end tell
end tell
EOF
)
    [ "$RESULT" = "found" ] && break
done
