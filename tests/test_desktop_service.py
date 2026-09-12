import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from opensmash_melee.native_service import NativeService

ROOT = Path(__file__).resolve().parents[1]


class DesktopServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        (root / "runtime").mkdir()
        (root / "build").mkdir()
        (root / "runtime/launch-options.json").write_bytes(
            (ROOT / "runtime/launch-options.json").read_bytes()
        )
        import hashlib

        (root / "engine").write_bytes(b"fixture")
        digest = hashlib.sha256(b"fixture").hexdigest()
        (root / "runtime.json").write_text(
            json.dumps(
                {
                    "protocol": 1,
                    "runner": "engine",
                    "module": "engine",
                    "controllers": "engine",
                    "sha256": {"engine": digest},
                }
            )
        )
        self.service = NativeService(root, {}, SimpleNamespace(ready=False), root)
        self.plan = {
            "mode": 0,
            "stage": 31,
            "level": 5,
            "stocks": 4,
            "minutes": 8,
            "ports": [
                {"device": d, "fighter": 8, "color": 0}
                for d in ["keyboard", "cpu", "off", "off"]
            ],
            "costumes": [],
        }

    def test_app_update_removes_stale_code_but_preserves_game_data(self):
        from desktop.backend_entry import refresh_code

        root = self.service.root
        payload = root / "payload"
        workspace = root / "workspace"
        for name in ["opensmash_melee", "tools", "runtime", "web"]:
            (payload / name).mkdir(parents=True)
            (payload / name / "current.txt").write_text("new")
            (workspace / name).mkdir(parents=True)
            (workspace / name / "removed.py").write_text("old")
        (workspace / "assets").mkdir()
        (workspace / "assets/user-save").write_text("keep")
        refresh_code(payload, workspace)
        self.assertEqual((workspace / "assets/user-save").read_text(), "keep")
        self.assertFalse((workspace / "tools/removed.py").exists())
        self.assertEqual((workspace / "tools/current.txt").read_text(), "new")

    def test_launch_requires_verified_disc(self):
        with self.assertRaisesRegex(ValueError, "verify your ISO"):
            self.service.launch(
                {**self.plan, "session": "00000000-0000-0000-0000-000000000001"}
            )

    def test_windows_render_worker_has_bounded_gpu_lead(self):
        import configparser

        for system in ["win32", "darwin"]:
            with self.subTest(system=system), patch(
                "opensmash_melee.native_service.sys.platform", system
            ), patch("opensmash_melee.native_service.subprocess.run", return_value=SimpleNamespace(stdout="")):
                self.service.controllers(self.plan["ports"])
                config = configparser.ConfigParser()
                config.read(self.service.user / "Config/Dolphin.ini")
                self.assertEqual(config.getboolean("Core", "CPUThread"), system == "win32")
                if system == "win32":
                    self.assertTrue(config.getboolean("Core", "SyncGPU"))
                    self.assertEqual(config.getint("Core", "SyncGpuMaxDistance"), 1000000)

    def test_embedded_launch_rejects_old_runtime_before_spawning_window(self):
        with patch.dict("os.environ", {"OPENSMASH_SURFACE_SERVICE": "test-surface"}):
            with self.assertRaisesRegex(ValueError, "embedded-display update"):
                self.service.launch({**self.plan, "session": "00000000-0000-0000-0000-000000000001"})

    def test_stale_close_does_not_stop_new_game(self):
        self.service.session = "00000000-0000-0000-0000-000000000002"

        class Process:
            def poll(self):
                return None

            def terminate(self):
                raise AssertionError("Stopped unrelated game")

        self.service.process = Process()
        self.assertTrue(
            self.service.stop("00000000-0000-0000-0000-000000000001")["running"]
        )

    def test_cancel_before_launch(self):
        sid = "00000000-0000-0000-0000-000000000001"
        self.service.stop(sid)
        with self.assertRaisesRegex(ValueError, "cancelled"):
            self.service.launch({**self.plan, "session": sid})

    def test_stop_requests_cache_flush_before_terminating(self):
        stop_file = self.service.root / "stop-request"
        self.service.stop_file = stop_file

        class Process:
            returncode = None

            def poll(self):
                return self.returncode

            def wait(self, timeout=None):
                self_test.assertTrue(stop_file.exists())
                self.returncode = 0
                return 0

            def terminate(self):
                raise AssertionError("Terminated before the engine could save caches")

        self_test = self
        self.service.process = Process()
        self.assertFalse(self.service.stop()["running"])
        self.assertFalse(stop_file.exists())

    def test_stop_kills_unresponsive_engine_after_grace_period(self):
        import subprocess
        from unittest.mock import Mock

        process = Mock()
        process.poll.side_effect = [None, -9, -9]
        process.wait.side_effect = [subprocess.TimeoutExpired("engine", 8), -9]
        self.service.process = process
        self.service.stop_file = self.service.root / "stop-request"
        self.service.stop()
        process.terminate.assert_not_called()
        process.kill.assert_called_once()

    def test_replacement_cancels_preparation_and_stale_cleanup_is_harmless(self):
        first = "00000000-0000-0000-0000-000000000001"
        second = "00000000-0000-0000-0000-000000000002"
        self.service.begin(first)
        self.service.begin(second)
        self.service.stop(first)
        self.assertEqual(self.service.session, second)
        self.assertNotIn(second, self.service.cancelled)
        with self.assertRaisesRegex(ValueError, "cancelled"):
            self.service.launch({**self.plan, "session": first})

    def test_reload_cancels_a_reserved_launch(self):
        sid = "00000000-0000-0000-0000-000000000001"
        self.service.begin(sid)
        self.service.stop()
        with self.assertRaisesRegex(ValueError, "cancelled"):
            self.service.launch({**self.plan, "session": sid})

    def test_keyboard_launch_does_not_probe_gamepads(self):
        with patch("opensmash_melee.native_service.subprocess.run") as probe:
            self.service.controllers(self.plan["ports"])
        probe.assert_not_called()

    def test_packed_ports_are_derived_not_trusted(self):
        self.plan["packedPorts"] = [999] * 4
        packed, _ = self.service.validate(self.plan)
        self.assertEqual(packed, [8, 264, 776, 776])

    def test_malformed_and_duplicate_players(self):
        for ports in [
            [None] * 4,
            [{"device": "keyboard", "fighter": 8, "color": 0}] * 4,
        ]:
            with self.assertRaises(ValueError):
                self.service.validate({**self.plan, "ports": ports})

    def test_runtime_integrity(self):
        (self.service.runtime / "engine").write_bytes(b"modified")
        with self.assertRaisesRegex(ValueError, "integrity"):
            NativeService(self.service.root, {}, None, self.service.runtime)

    @unittest.skipUnless(os.name == "nt", "Windows paths are case insensitive")
    def test_runtime_path_uses_canonical_casing(self):
        runtime = Path(str(self.service.runtime).swapcase())
        service = NativeService(self.service.root, {}, None, runtime)
        self.assertEqual(str(service.runtime), str(self.service.runtime.resolve()))


if __name__ == "__main__":
    unittest.main()
