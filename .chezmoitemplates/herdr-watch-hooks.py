#!/usr/bin/env python3
"""Merge only Waiting hooks; native integrations own the remaining config."""
import json
import sys

existing = sys.stdin.read()
config = json.loads(existing) if existing.strip() else {}
hooks = config.setdefault("hooks", {})
events = ["PreToolUse", "PostToolUse"]
if {{ . | toJson }} == "claude":
    events.append("PostToolUseFailure")
command = '"$HOME/.local/bin/herdr-watch" hook || true'
for event in events:
    groups = hooks.setdefault(event, [])
    if not any(handler.get("command") == command
               for group in groups for handler in group.get("hooks", [])):
        groups.append({"matcher": "Bash", "hooks": [
            {"type": "command", "command": command, "timeout": 3}]})
json.dump(config, sys.stdout, indent=2)
sys.stdout.write("\n")
