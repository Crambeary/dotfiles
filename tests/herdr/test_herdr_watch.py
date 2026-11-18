"""Contract tests; all subprocesses use a stub core and repo-local scratch."""

import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "private_dot_local/bin/executable_herdr-watch"
SCRATCH = ROOT / ".scratch/herdr-watch-tests"
SCRATCH.mkdir(parents=True, exist_ok=True)
loader = importlib.machinery.SourceFileLoader("herdr_watch", str(SCRIPT))
spec = importlib.util.spec_from_loader(loader.name, loader)
watch = importlib.util.module_from_spec(spec)
loader.exec_module(watch)

STUB = '''#!PYTHON
import fcntl, json, os, sys
from pathlib import Path
state = Path(os.environ["STUB_STATE"])
with state.open("r+") as stream:
    fcntl.flock(stream, fcntl.LOCK_EX)
    data = json.load(stream)
    args = sys.argv[1:]
    assert args[1] == "t-test", args
    if args[0] == "get":
        assert args == ["get", "t-test", "--json"]
        print(json.dumps(data["terminal"]))
    elif args[0] == "label":
        data["writes"].append(args)
        for item in args[2:]:
            key, value = item.split("=", 1)
            if value:
                data["terminal"]["labels"][key] = value
            else:
                data["terminal"]["labels"].pop(key, None)
        stream.seek(0)
        json.dump(data, stream)
        stream.truncate()
    else:
        sys.exit(2)
'''


class ContractTests(unittest.TestCase):
    def setUp(self):
        # Retain fixtures as inspectable evidence, including failed runs.
        self.base = Path(tempfile.mkdtemp(prefix="case-", dir=SCRATCH))
        self.state = self.base / "state.json"
        self.stub = self.base / "hc"
        self.stub.write_text(STUB.replace("#!PYTHON", "#!" + sys.executable))
        self.stub.chmod(0o755)
        self.env = {**os.environ, "HC": str(self.stub), "HC_TERMINAL_ID": "t-test",
                    "STUB_STATE": str(self.state), "HOME": str(self.base)}
        self.save({"terminal": {"turn": 12, "status": {"state": "working"},
                                "labels": {"other": "kept"}}, "writes": []})

    def save(self, data):
        self.state.write_text(json.dumps(data))

    def data(self):
        return json.loads(self.state.read_text())

    def run_cli(self, *args, env=None):
        return subprocess.run([sys.executable, str(SCRIPT), *args],
                              env=env or self.env, capture_output=True, text=True)

    def start(self, ref=None):
        args = ["start", "--subject", "Waiting = ready? café"]
        if ref:
            args += ["--ref", ref]
        result = self.run_cli(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def event(self, name, command="glab ci status --live", **extra):
        return {"hook_event_name": name, "session_id": "session-1", "tool_use_id": "tool-1",
                "tool_name": "Bash", "tool_input": {"command": command}, **extra}

    def hook(self, payload, env=None):
        result = subprocess.run([sys.executable, str(SCRIPT), "hook"],
                                input=json.dumps(payload), env=env or self.env,
                                capture_output=True, text=True)
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, "", ""))

    def test_start_is_one_atomic_seven_key_write(self):
        before = time.time_ns() // 1_000_000
        identity = self.start("https://gitlab.example/group/sub/project/-/merge_requests/31")
        data = self.data()
        labels = data["terminal"]["labels"]
        self.assertEqual(labels["waiting.id"], identity)
        self.assertTrue(watch.live(labels))
        self.assertEqual(labels["waiting"], "1")
        self.assertEqual(labels["waiting.stamp"], "12:1")
        self.assertEqual(labels["waiting.subject"], "Waiting = ready? café")
        self.assertLessEqual(before, int(labels["waiting.since"]))
        self.assertLessEqual(int(labels["waiting.since"]), time.time_ns() // 1_000_000)
        self.assertEqual(len(data["writes"]), 1)
        self.assertEqual(len(data["writes"][0][2:]), 7)
        self.assertNotIn("waiting.ended", labels)
        self.assertEqual(labels["other"], "kept")

    def test_replace_removes_ref_and_tombstone(self):
        old = self.start("https://gitlab.example/g/p/-/pipelines/1")
        self.assertEqual(self.run_cli("clear", "--id", old).returncode, 0)
        data = self.data()
        data["terminal"]["status"]["state"] = "idle"
        self.save(data)
        new = self.start()
        self.assertNotEqual(old, new)
        labels = self.data()["terminal"]["labels"]
        self.assertNotIn("waiting.ref", labels)
        self.assertNotIn("waiting.ended", labels)
        self.assertEqual(labels["waiting.stamp"], "12:0")

    def test_unreported_terminal_stamps_zero_turn_not_working(self):
        data = self.data()
        data["terminal"].update(turn=0, status=None)
        self.save(data)
        self.start()
        self.assertEqual(self.data()["terminal"]["labels"]["waiting.stamp"], "0:0")

    def test_absent_watch_guarded_clear_is_harmless(self):
        result = self.run_cli("clear", "--id", "old-declaration")
        self.assertEqual(result.returncode, 0)
        self.assertFalse(watch.live(self.data()["terminal"]["labels"]))
        self.start()
        self.assertTrue(watch.live(self.data()["terminal"]["labels"]))

    def test_plain_clear_removes_all_seven_in_one_call(self):
        identity = self.start("https://gitlab.example/g/p/-/pipelines/1")
        self.run_cli("clear", "--id", identity)
        self.assertEqual(self.run_cli("clear").returncode, 0)
        data = self.data()
        self.assertEqual(data["terminal"]["labels"], {"other": "kept"})
        self.assertEqual(set(data["writes"][-1][2:]), {key + "=" for key in watch.KEYS})
        self.assertEqual(self.run_cli("clear").returncode, 0)

    def test_guarded_clear_tombstones_only_and_old_completion_preserves_replacement(self):
        old = self.start()
        self.run_cli("clear", "--id", old)
        self.assertFalse(watch.live(self.data()["terminal"]["labels"]))
        self.assertEqual(self.data()["writes"][-1][2:], ["waiting.ended=" + old])
        new = self.start()
        self.run_cli("clear", "--id", old)  # completion decided before replacement
        labels = self.data()["terminal"]["labels"]
        self.assertEqual(labels["waiting.id"], new)
        self.assertTrue(watch.live(labels))
        self.run_cli("clear", "--id", new)
        self.assertFalse(watch.live(self.data()["terminal"]["labels"]))

    def test_concurrent_old_completion_never_erases_new_start(self):
        for _ in range(8):
            old = self.start()
            with subprocess.Popen([sys.executable, str(SCRIPT), "clear", "--id", old],
                                  env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as cleaner:
                new = self.start()
                cleaner.communicate(timeout=5)
                self.assertEqual(cleaner.returncode, 0)
            labels = self.data()["terminal"]["labels"]
            self.assertEqual(labels["waiting.id"], new)
            self.assertTrue(watch.live(labels))

    def test_bad_input_never_writes_or_echoes_credential_url(self):
        self.start()
        baseline = self.data()
        for args in (("start", "--subject", " "), ("start", "--subject", "line\nbreak"),
                     ("clear", "--id", ""), ("clear", "--terminal", "other"),
                     ("start",), ("start", "--subject", "s", "--ref", "https://u:SECRET@h/g/p/-/pipelines/1")):
            with self.subTest(args=args):
                result = self.run_cli(*args)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("SECRET", result.stderr)
                self.assertEqual(self.data(), baseline)

    def test_missing_identity_core_and_failed_get_leave_labels_alone(self):
        self.start()
        baseline = self.data()
        for changes in ({"HC_TERMINAL_ID": ""}, {"HC": "/nonexistent/hc"},
                        {"HC": "/usr/bin/false"}):
            result = self.run_cli("start", "--subject", "wait", env={**self.env, **changes})
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(self.data(), baseline)

    def test_resolves_path_and_fallback_and_override(self):
        with patch.dict(os.environ, self.env, clear=True):
            self.assertEqual(watch.Watch().hc, str(self.stub))
            del os.environ["HC"]
            os.environ["PATH"] = str(self.base)
            self.assertEqual(watch.Watch().hc, str(self.stub))
            self.stub.rename(self.base / "core-stub")
            fallback = self.base / ".local/share/herdr-core/current/Contents/MacOS/herdr-core"
            fallback.parent.mkdir(parents=True)
            fallback.symlink_to(self.base / "core-stub")
            self.assertEqual(watch.Watch().hc, str(fallback))
            fallback.unlink()
            with self.assertRaises(ValueError):
                watch.Watch()

    def test_hooks_complete_and_fail_only_their_own_watch(self):
        for ending in ("PostToolUse", "PostToolUseFailure"):
            self.hook(self.event("PreToolUse"))
            identity = self.data()["terminal"]["labels"]["waiting.id"]
            self.hook(self.event(ending, tool_response={"stdout": "done", "exit_code": 1}))
            labels = self.data()["terminal"]["labels"]
            self.assertEqual(labels["waiting.ended"], identity)
            self.assertFalse(watch.live(labels))

    def test_hooks_preserve_explicit_watch_and_its_reference(self):
        self.start("https://gitlab.example/g/p/-/merge_requests/1")
        before = self.data()
        self.hook(self.event("PreToolUse"))
        self.hook(self.event("PostToolUse"))
        self.assertEqual(self.data(), before)

    def test_old_hook_completion_preserves_new_explicit_watch(self):
        self.hook(self.event("PreToolUse"))
        new = self.start()
        self.hook(self.event("PostToolUseFailure"))
        labels = self.data()["terminal"]["labels"]
        self.assertEqual(labels["waiting.id"], new)
        self.assertTrue(watch.live(labels))

    def test_second_tool_does_not_clear_first_tools_watch(self):
        self.hook(self.event("PreToolUse"))
        before = self.data()
        self.hook(self.event("PreToolUse", tool_use_id="tool-2"))
        self.hook(self.event("PostToolUse", tool_use_id="tool-2"))
        self.assertEqual(self.data(), before)

    def test_background_transition_retains_watch(self):
        for response in ({"backgroundTaskId": "b1"}, {"session_id": 123},
                         "Command did not complete and was moved to the background",
                         "Process running with session ID 42"):
            self.hook(self.event("PreToolUse"))
            before = self.data()
            self.hook(self.event("PostToolUse", tool_response=response))
            self.assertEqual(self.data(), before)

    def test_background_launch_and_unsupported_tools_do_not_declare(self):
        before = self.data()
        self.hook(self.event("PreToolUse", tool_input={"command": "glab ci status --wait", "run_in_background": True}))
        self.hook(self.event("PreToolUse", tool_name="Monitor"))
        self.hook(self.event("PreToolUse", command="tecl fv run"))
        self.assertEqual(self.data(), before)

    def test_hook_errors_are_silent_success(self):
        for data in (None, {}, {"tool_name": "Bash", "tool_use_id": "x", "session_id": "s",
                                "hook_event_name": "PreToolUse", "tool_input": "bad"}):
            self.hook(data)
        self.hook(self.event("PreToolUse"), env={**self.env, "HC": "/nonexistent/hc"})
        result = subprocess.run([sys.executable, str(SCRIPT), "hook"], input="not JSON",
                                env=self.env, capture_output=True, text=True)
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, "", ""))

    def test_invalid_record_does_not_prevent_hook_declaration(self):
        self.start()
        data = self.data()
        data["terminal"]["labels"]["waiting.since"] = 12
        self.save(data)
        self.hook(self.event("PreToolUse"))
        self.assertTrue(watch.live(self.data()["terminal"]["labels"]))


class MatchingTests(unittest.TestCase):
    def test_all_product_aliases_and_operations(self):
        for product in ("fieldview", "fv", "tec360", "360", "focus", "fo"):
            for operation in ("download", "latest", "install", "install-latest"):
                with self.subTest(product=product, operation=operation):
                    self.assertIsNotNone(watch.subject_for("tecl {} {} --help".format(product, operation)))

    def test_glab_flag_order_and_quoted_args(self):
        for command in ("glab ci status --wait", "glab ci status --live -R g/p",
                        "glab ci status -R 'group/project' --wait", "glab ci status --branch main --live"):
            self.assertEqual(watch.subject_for(command), "Waiting for pipeline")

    def test_non_matching_commands(self):
        for command in ("glab ci status", "glab ci status --live=false", "glab ci view --live",
                        "echo glab ci status --live", "env glab ci status --live",
                        "bash -c 'glab ci status --live'", "rtk glab ci status --wait",
                        "glab ci status --live &", "glab ci status --wait | cat",
                        "glab ci status --live; echo done", "glab ci status --wait >out",
                        "glab ci status --wait\ntrue", "$(glab ci status --wait)",
                        "tecl fv run", "tecl fv list", "tecl fv cleanup", "tecl fv config",
                        "tecl unknown install", "tecl fv uninstall", "", "# glab ci status --wait"):
            with self.subTest(command=command):
                self.assertIsNone(watch.subject_for(command))

    def test_url_validation(self):
        for url in ("https://gitlab.com/g/p/-/merge_requests/1", "https://self.example:8443/g/sub/p/-/pipelines/25/"):
            self.assertTrue(watch.reference(url), url)
        for url in ("http://gitlab.com/g/p/-/pipelines/1", "https://h/g/p/-/jobs/1",
                    "https://user@h/g/p/-/pipelines/1", "https://u:p@h/g/p/-/pipelines/1",
                    "https://@h/g/p/-/pipelines/1", "https://u%40h/g/p/-/pipelines/1",
                    "https://h/g/p/-/pipelines/1?private_token=secret", "https://h/g/p/-/pipelines/1#token",
                    "https://h/g/p/-/pipelines/1?", "https://h/g/p/-/pipelines/1#",
                    "https://h:bad/g/p/-/pipelines/1", "https://h/g/p/-/pipelines/0",
                    "https:///g/p/-/pipelines/1", "https://h/p/-/pipelines/1",
                    "https://h/g/p/-/pipelines/1\n", "https://h/g/p/-/pipelines/1 extra"):
            self.assertFalse(watch.reference(url), url)


class ConfigTests(unittest.TestCase):
    def test_modifiers_preserve_existing_config_and_are_idempotent(self):
        template = (ROOT / ".chezmoitemplates/herdr-watch-hooks.py").read_text()
        for agent, source, events in (
            ("claude", "dot_claude/modify_settings.json.tmpl", ["PreToolUse", "PostToolUse", "PostToolUseFailure"]),
            ("codex", "private_dot_codex/modify_hooks.json.tmpl", ["PreToolUse", "PostToolUse"]),
        ):
            self.assertIn('template "herdr-watch-hooks.py" "' + agent + '"', (ROOT / source).read_text())
            script = template.replace("{{ . | toJson }}", json.dumps(agent))
            original = {"permissions": {"allow": ["Bash(echo *)"]}, "hooks": {
                "PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "existing-hook"}]}]}}
            def merge(value):
                result = subprocess.run([sys.executable, "-c", script], input=value,
                                        capture_output=True, text=True, check=True)
                return json.loads(result.stdout)
            result = merge(json.dumps(original))
            self.assertEqual(result["permissions"], original["permissions"])
            self.assertEqual(result["hooks"]["PreToolUse"][0], original["hooks"]["PreToolUse"][0])
            self.assertEqual(result, merge(json.dumps(result)))
            self.assertEqual(set(result["hooks"]), set(events))
            self.assertEqual(set(merge("")["hooks"]), set(events))
            # A missing script/interpreter cannot veto a tool invocation.
            command = result["hooks"]["PreToolUse"][-1]["hooks"][0]["command"]
            outcome = subprocess.run(["/bin/sh", "-c", command],
                                     env={"HOME": str(SCRATCH / "absent-home")},
                                     capture_output=True)
            self.assertEqual(outcome.returncode, 0)


if __name__ == "__main__":
    unittest.main()
