#!/bin/sh
# Companion to yazi's play-video.sh: run this on the machine you SSH FROM.
# Listens for streamed video pushed back through an SSH reverse tunnel
# and plays it in mpv. Pair with an ~/.ssh/config RemoteForward, e.g.:
#
#   Host myserver
#       RemoteForward 6600 localhost:6600
#
# play-video.sh streams one or more files back-to-back, each prefixed with
# an 8-byte marker: "REPLACE_" starts a fresh mpv playlist, "APPEND__" adds
# to the one already playing. This lets a single yazi keypress hand back a
# whole folder's worth of siblings (the real directory only exists on the
# server, so mpv's own autoload can't see it from here).
#
# Temp files are kept (not deleted per-file) since mpv may still have them
# queued later in the playlist; the whole batch dir is removed once that
# mpv instance exits.

port=6600
mpv_pid=""
tmpdir=""
sock=""

cleanup_batch() {
    [ -n "$mpv_pid" ] && kill "$mpv_pid" 2>/dev/null
    [ -n "$tmpdir" ] && rm -rf "$tmpdir"
    mpv_pid=""
    tmpdir=""
    sock=""
}
trap cleanup_batch EXIT INT TERM

while true; do
    fifo=$(mktemp -u --suffix=.fifo)
    mkfifo "$fifo"
    ncat -l "$port" > "$fifo" &
    ncat_pid=$!

    marker=$(dd if="$fifo" bs=8 count=1 2>/dev/null)

    # No mpv running for this batch yet (first file of a new "p" press) —
    # start one now so REPLACE_ has something to reset.
    if [ "$marker" != "APPEND__" ] || [ -z "$mpv_pid" ] || ! kill -0 "$mpv_pid" 2>/dev/null; then
        cleanup_batch
        tmpdir=$(mktemp -d)
        sock="$tmpdir/mpv.sock"
        mpv --idle=yes --keep-open=no --geometry=25%x25% --profile=gpu-hq \
            --input-ipc-server="$sock" >/dev/null 2>&1 &
        mpv_pid=$!
        # Give mpv a moment to create the IPC socket before we talk to it.
        for _ in 1 2 3 4 5 6 7 8 9 10; do
            [ -S "$sock" ] && break
            sleep 0.2
        done
    fi

    tmpfile=$(mktemp -p "$tmpdir" --suffix=.mp4)
    dd if="$fifo" of="$tmpfile" bs=1M 2>/dev/null
    wait "$ncat_pid" 2>/dev/null
    rm -f "$fifo"

    if [ "$marker" = "APPEND__" ]; then
        printf '{"command": ["loadfile", "%s", "append-play"]}\n' "$tmpfile" | ncat -U "$sock"
    else
        printf '{"command": ["loadfile", "%s", "replace"]}\n' "$tmpfile" | ncat -U "$sock"
    fi
done
