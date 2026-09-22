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
# Bound to ctrl-p in ~/.aerospace.toml.

STATE_FILE="${TMPDIR:-/tmp}/aerospace-pip-corner"
CORNER=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
NEXT=$(( (CORNER + 1) % 4 ))
echo "$NEXT" > "$STATE_FILE"

osascript <<EOF
use framework "AppKit"
use scripting additions

set screenFrame to (current application's NSScreen's mainScreen()'s visibleFrame())
set frameSize to item 2 of screenFrame
set screenW to (item 1 of frameSize) as integer
set screenH to (item 2 of frameSize) as integer
set margin to 20

tell application "System Events"
    set pipWin to missing value
    repeat with proc in processes
        try
            repeat with w in windows of proc
                if name of w contains "Picture-in-Picture" then
                    set pipWin to w
                    exit repeat
                end if
            end repeat
        end try
        if pipWin is not missing value then exit repeat
    end repeat

    if pipWin is missing value then return

    set {winW, winH} to size of pipWin

    if $CORNER is 0 then
        set targetPos to {margin, margin}
    else if $CORNER is 1 then
        set targetPos to {screenW - winW - margin, margin}
    else if $CORNER is 2 then
        set targetPos to {screenW - winW - margin, screenH - winH - margin}
    else
        set targetPos to {margin, screenH - winH - margin}
    end if

    set position of pipWin to targetPos
end tell
EOF
