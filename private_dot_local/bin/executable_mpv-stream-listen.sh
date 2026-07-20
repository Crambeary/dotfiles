#!/bin/sh
# Companion to yazi's play-video.sh: run this on the machine you SSH FROM.
# Listens for streamed video pushed back through an SSH reverse tunnel
# and plays it in mpv. Pair with an ~/.ssh/config RemoteForward, e.g.:
#
#   Host myserver
#       RemoteForward 6600 localhost:6600

port=6600
while true; do
    # No --loop here: stdin from ncat is a non-seekable pipe, and mpv
    # looping requires seeking back to the start, which fails fast on
    # short clips ("Cannot seek backward in linear streams!").
    ncat -l "$port" | mpv --geometry=25%x25% --profile=gpu-hq -
done
