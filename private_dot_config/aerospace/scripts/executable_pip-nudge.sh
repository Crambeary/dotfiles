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
# Regenerate if missing/empty, or a stale cache from an older 2-field version
# of this script (width,height) is sitting there instead of the current
# 3-field one (width,visibleHeight,fullHeight).
if [ ! -s "$SCREEN_CACHE" ] || [ "$(tr -dc ',' < "$SCREEN_CACHE" | wc -c)" -ne 2 ]; then
    # visibleFrame's height excludes the Dock's reserved strip, which pushed
    # the bottom corners up above it. We're fine going behind an auto-hidden
    # Dock, so bottom corners use the full screen frame height instead.
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
SCREEN_H=$(cut -d, -f2 "$SCREEN_CACHE")
SCREEN_H_FULL=$(cut -d, -f3 "$SCREEN_CACHE")

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
        -- Window position is in absolute screen coordinates, but SCREEN_W/H
        -- come from NSScreen visibleFrame, which already excludes the
        -- sketchybar strip at the top. A plain margin from y=0 would sit
        -- under (or through) the bar, so top corners get their own margin
        -- that clears the 32pt bar plus a bit of breathing room, landing
        -- just below it, in line with the AeroSpace top gap.
        set topMargin to 45

        if $CORNER is 0 then
            set targetPos to {margin, topMargin}
        else if $CORNER is 1 then
            set targetPos to {$SCREEN_W - winW - margin, topMargin}
        else if $CORNER is 2 then
            set targetPos to {$SCREEN_W - winW - margin, $SCREEN_H_FULL - winH - margin}
        else
            set targetPos to {margin, $SCREEN_H_FULL - winH - margin}
        end if

        set position of pipWin to targetPos
        return "found"
    end tell
end tell
EOF
)
    [ "$RESULT" = "found" ] && break
done
