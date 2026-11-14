"""Show Hermes in Herdr's agents list by reporting its state as OSC 7501.

Herdr-core reads a program's own status from `ESC ] 7501 ; app=..:state=.. BEL`
written to its terminal. Two ways to reach that terminal:

* The session has a controlling terminal (classic CLI, Hermes in Docker through
  `docker exec -it`): write to /dev/tty.
* The session runs in the shared gateway, which has none (the host TUI). The client
  sends HC_TERMINAL_ID (listed in terminal.client_env_passthrough); `hc get` names the
  terminal's foreground process, and that process's stdin is the terminal to write to.

With neither (cron, messaging platforms) every report is skipped.
"""

from __future__ import annotations

import json
import os
import subprocess

try:
    from agent.session_client_env import bound_client_env
except ImportError:  # Hermes before the shared gateway
    bound_client_env = None

_HC = os.path.expanduser("~/.local/bin/hc")
_last: dict[str, str] = {}  # terminal key -> last state sent
_ttys: dict[str, str | None] = {}  # herdr terminal id -> pty path


def _pty_of(terminal_id: str) -> str | None:
    if terminal_id in _ttys:
        return _ttys[terminal_id]
    path = None
    try:
        out = subprocess.run([_HC, "get", terminal_id], capture_output=True, timeout=2, check=False).stdout
        data = json.loads(out)
        data = data.get("terminal", data)
        pid = (data.get("foreground") or {}).get("pid") or data.get("pid")
        path = os.readlink(f"/proc/{pid}/fd/0") if pid else None
        if path and not path.startswith("/dev/pts/"):
            path = None
    except Exception:
        path = None
    _ttys[terminal_id] = path
    return path


def _target() -> tuple[str, str] | None:
    """(key, device) to write to, or None."""
    client = bound_client_env() if bound_client_env else None
    terminal_id = (client or {}).get("HC_TERMINAL_ID")
    if terminal_id:
        pty = _pty_of(terminal_id)
        return (terminal_id, pty) if pty else None
    if os.path.exists("/dev/tty"):
        return ("tty", "/dev/tty")
    return None


def _report(state: str) -> None:
    try:
        target = _target()
        if target is None:
            return
        key, device = target
        if _last.get(key) == state:
            return
        fd = os.open(device, os.O_WRONLY | os.O_NOCTTY)
        try:
            os.write(fd, f"\x1b]7501;app=hermes:state={state}\x07".encode())
        finally:
            os.close(fd)
        _last[key] = state
    except Exception:
        pass


def _state(state: str):
    def hook(**_kwargs) -> None:
        _report(state)

    return hook


def register(ctx):
    ctx.register_hook("on_session_start", _state("idle"))
    ctx.register_hook("pre_llm_call", _state("working"))
    ctx.register_hook("pre_tool_call", _state("working"))
    ctx.register_hook("post_tool_call", _state("working"))
    ctx.register_hook("pre_approval_request", _state("blocked"))
    ctx.register_hook("post_approval_response", _state("working"))
    ctx.register_hook("post_llm_call", _state("done"))
    ctx.register_hook("on_session_end", _state("idle"))
