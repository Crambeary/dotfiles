#!/bin/sh
# Companion to yazi's play-video.sh: run this on the machine you SSH FROM.
# Listens for streamed video pushed back through an SSH reverse tunnel
# and plays it in mpv. Pair with an ~/.ssh/config RemoteForward, e.g.:
#
#   Host myserver
#       RemoteForward 6600 localhost:6600

port=6600
while true; do
    # Buffer the full stream to a temp file first rather than piping
    # straight into mpv: a live pipe can't be seeked back to the start,
    # so --loop fails immediately ("Cannot seek backward in linear
    # streams!"). Once it's a real file on disk, looping works normally.
    tmpfile=$(mktemp --suffix=.mp4)
    ncat -l "$port" > "$tmpfile"
    mpv --loop --geometry=25%x25% --profile=gpu-hq "$tmpfile"
    rm -f "$tmpfile"
done
