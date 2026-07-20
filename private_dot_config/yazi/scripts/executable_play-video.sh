#!/bin/sh
# yazi video opener: plays locally, or streams to the local machine over SSH.
#
# Local mode: opens mpv directly, as before.
# SSH mode: pipes the file into a reverse-tunneled port; requires a listener
# running on the client machine (see mpv-stream-listen.sh) and either
# `ssh -R 6600:localhost:6600` on connect, or a RemoteForward entry in
# ~/.ssh/config for this host.

port=6600
file="$1"

if [ -n "$SSH_CONNECTION" ]; then
    cat "$file" | ncat localhost "$port"
else
    mpv --loop --geometry=25%x25% --profile=gpu-hq "$file"
fi
