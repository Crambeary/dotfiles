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
# Local mode: opens mpv directly, as before — mpv's own autoload.lua script
# builds the playlist from the real directory on disk.
# Remote mode: the file never exists on the client as a real path (it's a
# raw remux piped over the tunnel), so autoload.lua on the client has
# nothing to scan. Build the sibling playlist here instead, where the real
# directory is visible, and stream each file across in turn. Each stream is
# tagged with an 8-byte marker so the client knows whether to start a new
# playlist or append to the running one (see mpv-stream-listen.sh).
#
# The remux is necessary because most MP4s (e.g. screen recordings) store
# their index (moov atom) at the end of the file, which the demuxer
# normally seeks to read — impossible on a raw pipe. frag_keyframe+empty_moov
# rewrites the stream so it can be read forward only, at effectively zero
# cost since it's a stream copy, not a re-encode.

port=6600
file="$1"

video_ext() {
    case "$1" in
        *.[Mm][Kk][Vv]|*.[Mm][Pp]4|*.[Aa][Vv][Ii]|*.[Ww][Ee][Bb][Mm]|*.[Ff][Ll][Vv]|\
*.[Mm]2[Tt][Ss]|*.[Mm]4[Vv]|*.[Mm][Jj]2|*.[Mm][Oo][Vv]|*.[Mm][Pp][Ee][Gg]|\
*.[Mm][Pp][Gg]|*.[Oo][Gg][Vv]|*.[Rr][Mm][Vv][Bb]|*.[Ww][Mm][Vv]|*.[Yy]4[Mm]|\
*.3[Gg]2|*.3[Gg][Pp])
            return 0 ;;
        *)
            return 1 ;;
    esac
}

# Print the hovered file first, then its sibling videos in the same
# directory in sorted order, mirroring what autoload.lua would have done
# locally — so remote playback gets the same "starts here, continues
# through the folder" playlist local playback gets.
build_playlist() {
    dir=$(dirname -- "$file")
    printf '%s\n' "$file"
    ls -1 -- "$dir" 2>/dev/null | LC_ALL=C sort | while IFS= read -r name; do
        candidate="$dir/$name"
        [ "$candidate" = "$file" ] && continue
        video_ext "$candidate" && printf '%s\n' "$candidate"
    done
}

stream_one() {
    marker="$1"
    src="$2"
    { printf '%s' "$marker"; ffmpeg -v quiet -i "$src" -c copy -movflags frag_keyframe+empty_moov -f mp4 -; } \
        | ncat localhost "$port"
}

if ss -ltn "( sport = :$port )" 2>/dev/null | grep -q LISTEN; then
    first=1
    build_playlist | while IFS= read -r f; do
        if [ "$first" = 1 ]; then
            stream_one "REPLACE_" "$f"
            first=0
        else
            stream_one "APPEND__" "$f"
        fi
    done
else
    mpv --loop --geometry=25%x25% --profile=gpu-hq "$file"
fi
