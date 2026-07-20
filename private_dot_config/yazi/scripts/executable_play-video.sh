#!/bin/sh
# yazi video opener: plays locally, or streams to the local machine over SSH.
#
# Detects remote mode by checking whether sshd has the reverse-forwarded
# port bound in LISTEN state on this host, rather than trusting
# $SSH_CONNECTION (which can be stale/unset inside tmux or screen sessions
# that outlive the SSH connection that spawned them). This is a passive
# check — it doesn't open a connection, so it can't race with or consume
# the single-shot listener on the client side.
#
# Local mode: opens mpv directly, as before.
# Remote mode: remuxes the file into a fragmented, seek-free MP4 and pipes
# it through the tunnel to mpv-stream-listen.sh running on the client
# machine; requires the RemoteForward entry in ~/.ssh/config for this host
# (see config.d/chezmoi). The remux is necessary because most MP4s (e.g.
# screen recordings) store their index (moov atom) at the end of the file,
# which the demuxer normally seeks to read — impossible on a raw pipe.
# frag_keyframe+empty_moov rewrites the stream so it can be read forward
# only, at effectively zero cost since it's a stream copy, not a re-encode.

port=6600
file="$1"

if ss -ltn "( sport = :$port )" 2>/dev/null | grep -q LISTEN; then
    ffmpeg -v quiet -i "$file" -c copy -movflags frag_keyframe+empty_moov -f mp4 - | ncat localhost "$port"
else
    mpv --loop --geometry=25%x25% --profile=gpu-hq "$file"
fi
