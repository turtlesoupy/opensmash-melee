"""Desktop protocol v1: validated launch plans, local costumes, and native processes."""

import hashlib, json, os, platform, re, shutil, subprocess, sys, threading, uuid
from pathlib import Path


class NativeService:
    def __init__(self, root, catalog, setup, runtime):
        self.root = Path(root)
        self.catalog = catalog
        self.setup = setup
        self.runtime = Path(runtime)
        self.schema = json.loads(
            (self.root / "runtime/launch-options.json").read_text()
        )
        self.manifest = json.loads((self.runtime / "runtime.json").read_text())
        self.session = None
        self.cancelled = set()
        self.process = None
        self.lock = threading.Lock()
        self.log = self.root / "build/native-session.log"
        self.user = self.root / "build/native-user"
        self.status_message = "Ready."
        if self.manifest.get("protocol") != 1:
            raise ValueError("Incompatible native runtime protocol")
        for key in ["runner", "module", "controllers"]:
            if self.manifest.get(key) not in self.manifest.get("sha256", {}):
                raise ValueError("Incomplete runtime manifest")
        for name, digest in self.manifest["sha256"].items():
            path = (self.runtime / name).resolve()
            if not path.is_relative_to(self.runtime.resolve()):
                raise ValueError("Invalid runtime manifest path")
            with path.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != digest:
                    raise ValueError("Runtime integrity check failed: " + name)

    def status(self):
        running = self.process is not None and self.process.poll() is None
        text = ""
        if self.log.exists():
            with self.log.open("rb") as stream:
                stream.seek(max(0, self.log.stat().st_size - 16000))
                text = stream.read().decode(errors="replace")
        ready = (
            "[opensmash] destination ready" in text
            or "[opensmash] combat started" in text
        )
        return {
            "protocol": 1,
            "session": self.session,
            "running": running,
            "ready": running and ready,
            "exitCode": self.process.poll() if self.process else None,
            "message": (
                "Game is running in its native window."
                if running and ready
                else "Starting Melee…" if running else self.status_message
            ),
        }

    def stop(self, session=None):
        with self.lock:
            if session is not None:
                if not isinstance(session, str) or not re.fullmatch(
                    r"[a-f0-9-]{36}", session
                ):
                    raise ValueError("Invalid launch session")
                self.cancelled.add(session)
                if session != self.session:
                    return self.status()
            if self.process and self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()
            self.status_message = "Game closed."
        return self.status()

    def validate(self, plan):
        def integer(x, lo, hi):
            return type(x) is int and lo <= x <= hi

        if not isinstance(plan, dict) or not integer(plan.get("mode"), 0, 4):
            raise ValueError("Invalid launch mode")
        if plan.get("stage") not in [
            s["id"] for s in self.schema["stages"] if s["id"] != -1
        ]:
            raise ValueError("Invalid stage")
        for key, lo, hi in [("level", 1, 9), ("stocks", 1, 99), ("minutes", 0, 99)]:
            if not integer(plan.get(key), lo, hi):
                raise ValueError("Invalid " + key)
        ports = plan.get("ports")
        packed = []
        devices = set()
        if not isinstance(ports, list) or len(ports) != 4:
            raise ValueError("Four ports are required")
        for p in ports:
            if not isinstance(p, dict):
                raise ValueError("Invalid player")
            d = p.get("device")
            f = p.get("fighter")
            c = p.get("color")
            if (
                d
                not in [
                    "keyboard",
                    "cpu",
                    "off",
                    "gamepad0",
                    "gamepad1",
                    "gamepad2",
                    "gamepad3",
                ]
                or not integer(f, 0, 25)
                or not integer(c, 0, 5)
            ):
                raise ValueError("Invalid player")
            if d not in ["cpu", "off"]:
                if d in devices:
                    raise ValueError("Each controller can only be assigned once")
                devices.add(d)
            packed.append(
                f | ((3 if d == "off" else 1 if d == "cpu" else 0) << 8) | (c << 16)
            )
        if plan["mode"] == 0 and sum(p["device"] != "off" for p in ports) < 2:
            raise ValueError("A match needs two players")
        if plan["mode"] == 3 and ports[0]["device"] in ["off", "cpu"]:
            raise ValueError("Classic needs a human player 1")
        costumes = plan.get("costumes", [])
        if not isinstance(costumes, list) or len(costumes) > 4:
            raise ValueError("Invalid costumes")
        kinds = {
            "mario": 8,
            "luigi": 7,
            "captain-falcon": 0,
            "fox": 2,
            "marth": 9,
            "link": 6,
        }
        paths = []
        for c in costumes:
            if not isinstance(c, dict):
                raise ValueError("Invalid costume")
            row = self.catalog.get(c.get("character"))
            if not row or c.get("fighter") != kinds.get(row["target"]):
                raise ValueError("Unknown custom character")
            slots = self.schema["costumes"][str(c["fighter"])]
            color = c.get("color")
            if (
                not integer(color, 0, len(slots) - 1)
                or c.get("filename") != slots[color]["filename"]
            ):
                raise ValueError("Invalid costume slot")
            ident = "web-v1-" + hashlib.sha256(row["slug"].encode()).hexdigest()[:16]
            source = (
                self.root
                / "build/characters"
                / ident
                / ("browser-compact" if len(costumes) >= 3 else "browser")
                / c["filename"]
            )
            if not source.is_file():
                raise ValueError("Prepare the character before launching")
            paths.append((source, c["filename"]))
        return packed, paths

    def controllers(self, ports):
        config = self.user / "Config"
        config.mkdir(parents=True, exist_ok=True)
        keyboard = (
            "Quartz/0/Keyboard & Mouse"
            if sys.platform == "darwin"
            else (
                "DInput/0/Keyboard Mouse"
                if os.name == "nt"
                else "XInput2/0/Virtual core pointer"
            )
        )
        helper = self.runtime / self.manifest["controllers"]
        result = subprocess.run(
            [str(helper)], capture_output=True, text=True, timeout=10
        )
        pads = [line for line in result.stdout.splitlines() if line.startswith("SDL/")]
        keyboard_bind = {
            "Buttons/A": "J",
            "Buttons/B": "K",
            "Buttons/X": "U | Space",
            "Buttons/Y": "I",
            "Buttons/Z": "O",
            "Buttons/Start": "Return",
            "Main Stick/Up": "W",
            "Main Stick/Down": "S",
            "Main Stick/Left": "A",
            "Main Stick/Right": "D",
            "C-Stick/Up": "`Up Arrow`",
            "C-Stick/Down": "`Down Arrow`",
            "C-Stick/Left": "`Left Arrow`",
            "C-Stick/Right": "`Right Arrow`",
            "Triggers/L": "Q",
            "Triggers/R": "E",
        }
        # Dolphin's backend key names differ even for Return/Space and arrows.
        if os.name == "nt":
            keyboard_bind["Buttons/Start"] = "RETURN"
            keyboard_bind["Buttons/X"] = "U | SPACE"
        elif sys.platform.startswith("linux"):
            keyboard_bind["Buttons/X"] = "U | space"
        if sys.platform != "darwin":
            for direction in ["Up", "Down", "Left", "Right"]:
                keyboard_bind["C-Stick/" + direction] = (
                    direction.upper() if os.name == "nt" else direction
                )
        keyboard_bind.update(
            {
                "Triggers/L-Analog": "Q",
                "Triggers/R-Analog": "E",
                "D-Pad/Up": "T",
                "D-Pad/Down": "G",
                "D-Pad/Left": "F",
                "D-Pad/Right": "H",
            }
        )
        pad_bind = {
            "Buttons/A": "`Button A`",
            "Buttons/B": "`Button B`",
            "Buttons/X": "`Button X`",
            "Buttons/Y": "`Button Y`",
            "Buttons/Z": "`Shoulder R`",
            "Buttons/Start": "Start",
            "Main Stick/Up": "`Left Y+`",
            "Main Stick/Down": "`Left Y-`",
            "Main Stick/Left": "`Left X-`",
            "Main Stick/Right": "`Left X+`",
            "C-Stick/Up": "`Right Y+`",
            "C-Stick/Down": "`Right Y-`",
            "C-Stick/Left": "`Right X-`",
            "C-Stick/Right": "`Right X+`",
            "Triggers/L": "`Trigger L`",
            "Triggers/R": "`Trigger R`",
            "Triggers/L-Analog": "`Trigger L`",
            "Triggers/R-Analog": "`Trigger R`",
        }
        pad_bind.update(
            {
                "D-Pad/Up": "`Pad N`",
                "D-Pad/Down": "`Pad S`",
                "D-Pad/Left": "`Pad W`",
                "D-Pad/Right": "`Pad E`",
            }
        )
        lines = []
        for i, p in enumerate(ports):
            lines.append("[GCPad%d]" % (i + 1))
            d = p["device"]
            if d in ["cpu", "off"]:
                continue
            if d.startswith("gamepad"):
                index = int(d[-1])
                if index >= len(pads):
                    raise ValueError(
                        "Gamepad %d is not connected. Connect it or choose Keyboard."
                        % (index + 1)
                    )
                device = pads[index]
                bindings = pad_bind
            else:
                device = keyboard
                bindings = keyboard_bind
            lines.append("Device = " + device)
            lines.extend(k + " = " + v for k, v in bindings.items())
            lines.extend(
                ["Main Stick/Calibration = 100.00", "C-Stick/Calibration = 100.00"]
            )
        (config / "GCPadNew.ini").write_text("\n".join(lines) + "\n")
        (config / "Dolphin.ini").write_text(
            "[Display]\nFullscreen = False\nRenderWindowWidth = 960\nRenderWindowHeight = 720\n[Interface]\nConfirmStop = False\n[Core]\nCPUThread = False\nFastDiscSpeed = True\n[Input]\nBackgroundInput = True\n"
        )

    def launch(self, plan):
        with self.lock:
            session = plan.get("session") if isinstance(plan, dict) else None
            if not isinstance(session, str) or not re.fullmatch(
                r"[a-f0-9-]{36}", session
            ):
                raise ValueError("Invalid launch session")
            if session in self.cancelled:
                raise ValueError("Launch was cancelled")
            if not self.setup.ready:
                raise ValueError("Choose and verify your ISO first")
            if self.process and self.process.poll() is None:
                raise ValueError("Close the current game first")
            packed, costumes = self.validate(plan)
            self.controllers(plan["ports"])
            game = self.root / "build/native-lineup"
            stage = game.with_name("native-lineup-" + uuid.uuid4().hex)

            def link_or_copy(source, target):
                try:
                    os.link(source, target)
                except OSError:
                    shutil.copy2(source, target)

            shutil.copytree(self.setup.game, stage, copy_function=link_or_copy)
            try:
                for source, name in costumes:
                    target = stage / "files" / name
                    target.unlink()
                    shutil.copy2(source, target)
                if game.exists():
                    shutil.rmtree(game)
                stage.rename(game)
            finally:
                if stage.exists():
                    shutil.rmtree(stage)
            module = self.runtime / self.manifest["module"]
            runner = self.runtime / self.manifest["runner"]
            environment = {
                **os.environ,
                "OPENSMASH_FIXED_WINDOW": "1",
                "OPENSMASH_MATCH": "1",
                "OPENSMASH_NATIVE_MODULE": str(module),
            }
            if sys.platform.startswith("linux") and os.environ.get("DISPLAY"):
                environment.setdefault("SDL_VIDEODRIVER", "x11")
            for key, name in [
                ("mode", "MODE"),
                ("stage", "STAGE"),
                ("level", "CPU_LEVEL"),
                ("stocks", "STOCKS"),
                ("minutes", "MINUTES"),
            ]:
                environment["OPENSMASH_" + name] = str(plan[key])
            for i, p in enumerate(packed):
                environment["OPENSMASH_PORT" + str(i)] = str(p)
            args = [
                str(runner),
                "--game",
                str(game),
                "--module",
                str(module),
                "--user-dir",
                str(self.user),
                "--title",
                "OpenSmash Melee",
                "--graphics",
                "Metal" if sys.platform == "darwin" else "Vulkan",
                "--audio",
                "Cubeb",
                "--mods",
                str(self.runtime / "Mods"),
            ]
            with self.log.open("w") as output:
                self.process = subprocess.Popen(
                    args,
                    cwd=self.runtime,
                    env=environment,
                    stdout=output,
                    stderr=subprocess.STDOUT,
                )
            self.session = session
            self.status_message = "Game finished."
        return self.status()
