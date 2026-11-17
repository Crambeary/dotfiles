"""Run the real saver under a PTY with a broken shim and an installed binary."""
import os
from pathlib import Path
import pty
import select
import signal
import subprocess
import time

root = Path(__file__).resolve().parents[2]
fixture = root / '.scratch/omarchy-fixes/launch-fixture'
shim = fixture / '.local/bin/tuiffects'
binary = fixture / '.local/share/mise/installs/go/test/bin/tuiffects'
for path, body in [(shim, '#!/bin/sh\necho broken-shim >&2\nexit 1\n'),
                   (binary, '#!/bin/sh\n[ "$1" = --version ] && exit 0\nprintf ANIMATION_STARTED\ncat >/dev/null\n')]:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)
    path.chmod(0o755)
frame = fixture / 'frame.ans'
frame.write_text('test-nonce\nInbox text\n')
master, slave = pty.openpty()
proc = subprocess.Popen(['/bin/bash', str(root / 'private_dot_config/herdr-app/mods/screensaver/saver.sh'),
                         str(frame), 'test-nonce', 'random', '', '0'],
                        stdin=slave, stdout=slave, stderr=slave,
                        env={**os.environ, 'HOME': str(fixture)}, start_new_session=True)
os.close(slave)
output = b''
try:
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline and b'ANIMATION_STARTED' not in output:
        ready, _, _ = select.select([master], [], [], 0.1)
        if ready:
            output += os.read(master, 65536)
    assert b'ANIMATION_STARTED' in output, f'animation never started: {output!r}'
    print('PASS screensaver launches the installed binary despite a broken shim')
finally:
    os.killpg(proc.pid, signal.SIGKILL)
    proc.wait()
    os.close(master)
