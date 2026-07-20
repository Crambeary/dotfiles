#!/bin/sh
# Companion to yazi's play-video.sh: run this on the machine you SSH FROM.
# Listens for streamed video pushed back through an SSH reverse tunnel
# and plays it in mpv. Pair with an ~/.ssh/config RemoteForward, e.g.:
#
#   Host myserver
#       RemoteForward 6600 localhost:6600

port=6600
while true; do
    ncat -l "$port" | mpv --loop --geometry=25%x25% --profile=gpu-hq -
done
