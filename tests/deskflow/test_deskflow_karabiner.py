"""State-boundary tests using real temporary logs; no live input is injected."""

import datetime
import importlib.machinery
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / "private_dot_local/bin/executable_deskflow-karabiner"
loader = importlib.machinery.SourceFileLoader("deskflow_karabiner", str(HELPER))
spec = importlib.util.spec_from_loader(loader.name, loader)
helper = importlib.util.module_from_spec(spec)
loader.exec_module(helper)
START = datetime.datetime(2026, 10, 6, 12).timestamp()
SESSION = [42, START]


def event(message, second=1):
    stamp = datetime.datetime.fromtimestamp(START + second).isoformat(timespec="milliseconds")
    return "[{}] INFO: {}\n".format(stamp, message)


class WatcherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.log = Path(self.temp.name) / "deskflow.log"
        self.cache = Path(self.temp.name) / "cache/state.json"
        self.watcher = self.make_watcher()

    def make_watcher(self, session=SESSION):
        watcher = helper.Watcher("mac", self.log, session, cache=self.cache)
        self.addCleanup(watcher.reader.close)
        return watcher

    def append(self, text):
        with self.log.open("a") as stream:
            stream.write(text)
        return self.watcher.poll()

    def test_local_remote_other_remote_and_back(self):
        self.assertFalse(self.watcher.poll())
        self.assertTrue(self.append(event('switch from "mac" to "linux" at 10,20')))
        self.assertTrue(self.append(event('switch from "linux" to "windows" at 10,20')))
        self.assertFalse(self.append(event('switch from "windows" to "MAC" at 10,20')))

    def test_active_disconnect_jumps_home_but_unrelated_disconnect_does_not(self):
        self.append(event('switch from "mac" to "linux" at 10,20'))
        self.assertTrue(self.append(event('disconnecting client "windows"')))
        self.assertFalse(self.append(event('jump from "linux" to "mac" at 10,20')))

    def test_rejected_switch_reverts_to_source(self):
        self.append(event('switch from "mac" to "linux" at 10,20'))
        self.assertFalse(self.append(event("can't leave screen")))
        self.append(event('switch from "mac" to "linux" at 10,20'))
        self.append(event('switch from "linux" to "mac" at 10,20'))
        self.assertTrue(self.append(event("can't leave computer")))

    def test_suspend_stop_and_server_start_reset_to_local(self):
        for message in ("suspend", "stopped server", "started server, waiting for clients"):
            self.append(event('switch from "mac" to "linux" at 10,20'))
            self.assertFalse(self.append(event(message)))

    def test_old_sessions_and_malformed_lines_cannot_change_destination(self):
        self.assertFalse(self.append(event('switch from "mac" to "linux" at 10,20', second=-1)))
        self.assertFalse(self.append('[nonsense] INFO: switch from "mac" to "linux" at 10,20\n'))
        self.assertFalse(self.append('switch from "mac" to "linux" at 10,20\n'))

    def test_partial_line_is_not_consumed_until_complete(self):
        line = event('switch from "mac" to "linux" at 10,20')
        self.assertFalse(self.append(line[:40]))
        self.watcher = self.make_watcher()
        self.assertTrue(self.append(line[40:]))

    def test_replacement_and_missing_log_preserve_destination(self):
        self.append(event('switch from "mac" to "linux" at 10,20'))
        self.log.rename(self.log.with_suffix(".old"))
        self.assertTrue(self.watcher.poll())
        self.assertTrue(self.append(event('client "windows" has connected')))
        self.assertFalse(self.append(event('switch from "linux" to "mac" at 10,20')))

    def test_rotation_drains_unread_return_before_opening_replacement(self):
        self.append(event('switch from "mac" to "linux" at 10,20'))
        with self.log.open("a") as stream:
            stream.write(event('jump from "linux" to "mac" at 10,20'))
        self.log.unlink()
        self.log.write_text(event('client "windows" has connected'))
        self.assertFalse(self.watcher.poll())

    def test_oversized_line_cannot_hide_later_transitions(self):
        self.append(event('switch from "mac" to "linux" at 10,20'))
        self.assertFalse(self.append("x" * (600 * 1024) + "\n" + event('jump from "linux" to "mac" at 10,20')))

    def test_failed_checkpoint_does_not_override_detected_destination(self):
        with patch.object(Path, "mkdir", side_effect=PermissionError("cache is unwritable")):
            self.assertTrue(self.append(event('switch from "mac" to "linux" at 10,20')))
        self.watcher.cache_retry_after = 0
        self.assertTrue(self.watcher.poll())
        self.assertTrue(json.loads(self.cache.read_text())["remote"])

    def test_truncate_and_regrow_past_old_offset_is_detected(self):
        self.append(event('switch from "mac" to "linux" at 10,20'))
        self.log.write_text(event('jump from "linux" to "mac" at 10,20') + event("padding " * 100))
        self.assertFalse(self.watcher.poll())

    def test_helper_restart_after_log_rotation_uses_session_checkpoint(self):
        self.append(event('switch from "mac" to "linux" at 10,20'))
        self.log.unlink()
        self.watcher = self.make_watcher()
        self.assertTrue(self.watcher.poll())
        self.assertTrue(self.append(event('client "windows" has connected')))
        self.assertFalse(self.append(event('switch from "linux" to "mac" at 10,20')))

    def test_new_server_cannot_reuse_old_remote_checkpoint(self):
        self.append(event('switch from "mac" to "linux" at 10,20'))
        # Even a reused PID has a different birth time.
        self.watcher = self.make_watcher([42, START + 10])
        self.assertFalse(self.watcher.poll())
        self.assertTrue(self.append(event('switch from "mac" to "linux" at 10,20', second=11)))

    def test_startup_replays_log_to_current_destination_without_checkpoint(self):
        self.log.write_text(
            event('switch from "mac" to "linux" at 10,20')
            + event("unrelated message " * 10) * 2000
            + event('switch from "linux" to "mac" at 10,20')
        )
        self.assertFalse(self.watcher.poll())
        self.assertEqual(self.watcher.reader.offset, self.log.stat().st_size)

    def test_corrupt_cache_is_ignored(self):
        self.cache.parent.mkdir()
        for content in ("not json", "[]", "null"):
            self.cache.write_text(content)
            self.watcher = self.make_watcher()
            self.assertFalse(self.watcher.poll())


class IntegrationBoundaryTests(unittest.TestCase):
    def test_only_space_rules_have_destination_condition(self):
        config = json.loads((ROOT / "private_dot_config/private_karabiner/private_karabiner.json").read_text())
        rules = config["profiles"][0]["complex_modifications"]["rules"]
        voyager = next(rule for rule in rules if rule["description"].startswith("Voyager only:"))
        self.assertEqual(len(voyager["manipulators"]), 4)
        for rule in voyager["manipulators"]:
            gate = [c for c in rule["conditions"] if c.get("name") == "deskflow_remote"]
            if rule["from"]["key_code"] == "spacebar":
                self.assertEqual(gate, [{"type": "variable_if", "name": "deskflow_remote", "value": 0}])
            else:
                self.assertEqual(gate, [])

    @patch.object(helper.subprocess, "run")
    def test_server_process_detection_ignores_client_and_extracts_birth_time(self, run):
        run.side_effect = [
            subprocess.CompletedProcess([], 0, "7\n42\n"),
            subprocess.CompletedProcess([], 0,
                "7 Tue Oct 6 12:00:00 2026 /Applications/Deskflow.app/Contents/MacOS/deskflow-core client\n"
                "42 Tue Oct 6 12:00:00 2026 /Applications/Deskflow.app/Contents/MacOS/deskflow-core server\n"),
        ]
        self.assertEqual(helper.server_session(), SESSION)

    @patch.object(helper.subprocess, "run")
    @patch.object(helper.time, "monotonic")
    def test_publish_on_change_retry_failure_and_refresh_after_karabiner_restart(self, clock, run):
        publisher = helper.Publisher()
        clock.return_value = 100
        publisher.sync(False)
        self.assertIn('"deskflow_remote": 0', run.call_args.args[0][-1])
        publisher.sync(False)
        self.assertEqual(run.call_count, 1)
        clock.return_value = 101
        run.side_effect = subprocess.CalledProcessError(1, "karabiner_cli")
        publisher.sync(True)
        self.assertFalse(publisher.last_value)
        publisher.sync(True)
        self.assertEqual(run.call_count, 2)
        clock.return_value = 103
        run.side_effect = None
        publisher.sync(True)
        self.assertIn('"deskflow_remote": 1', run.call_args.args[0][-1])
        clock.return_value = 108
        publisher.sync(True)
        self.assertEqual(run.call_count, 4)


if __name__ == "__main__":
    unittest.main()
