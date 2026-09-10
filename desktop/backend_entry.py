"""Frozen Python service; owned source files stay separate from user game data."""

import argparse, json, os, runpy, shutil, sys, tempfile
from pathlib import Path

# Collected into the frozen interpreter; project code loads from the versioned payload.
import numpy, PIL.Image, scipy.spatial, scipy.optimize


def refresh_code(payload, workspace):
    """Replace owned code completely; never merge stale modules into a new app."""
    with tempfile.TemporaryDirectory(
        prefix=".launcher-update-", dir=workspace
    ) as staging:
        staging = Path(staging)
        names = ["opensmash_melee", "tools", "runtime", "web"]
        for name in names:
            shutil.copytree(payload / name, staging / name)
        for name in names:
            destination = workspace / name
            previous = staging / (name + ".previous")
            if destination.exists():
                destination.rename(previous)
            try:
                (staging / name).rename(destination)
            except OSError:
                if previous.exists():
                    previous.rename(destination)
                raise


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "-m":
        name = sys.argv[2]
        if name != "opensmash_melee":
            raise SystemExit("Unsupported worker module")
        sys.argv = sys.argv[2:]
        sys.path.insert(0, os.getcwd())
        runpy.run_module(name, run_name="__main__")
        return
    if len(sys.argv) > 1 and sys.argv[1].endswith(".py"):
        script = Path(sys.argv[1]).resolve()
        root = Path(os.environ["OPENSMASH_WORKSPACE"]).resolve()
        if not script.is_relative_to(root / "tools"):
            raise SystemExit("Unsupported worker script")
        sys.argv = sys.argv[1:]
        sys.path.insert(0, str(root))
        runpy.run_path(str(script), run_name="__main__")
        return
    p = argparse.ArgumentParser()
    p.add_argument("--development", action="store_true")
    p.add_argument("--desktop", type=Path, required=True)
    p.add_argument("--resources", type=Path, required=True)
    a = p.parse_args()
    workspace = a.desktop / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    payload = a.resources / ("desktop-payload" if a.development else "payload")
    runtime = a.resources / ("desktop-runtime" if a.development else "runtime")
    characters = a.resources / ("desktop-characters" if a.development else "characters")
    web = a.resources.parent / "web/dist" if a.development else a.resources / "web"
    # Only application-owned code/config folders are refreshed. assets/ and build/ persist.
    refresh_code(payload, workspace)
    os.environ["OPENSMASH_WORKSPACE"] = str(workspace)
    os.environ["OPENSMASH_RUNTIME"] = str(runtime)
    os.environ["OPENSMASH_CHARACTER_ROOT"] = str(characters)
    os.environ["OPENSMASH_WEB_DIST"] = str(web)
    os.chdir(workspace)
    sys.path.insert(0, str(workspace))
    sys.path.insert(0, str(workspace / "tools"))
    sys.argv = ["serve_melee.py", "--port", "0", "--desktop"]
    runpy.run_path(str(workspace / "tools/serve_melee.py"), run_name="__main__")


if __name__ == "__main__":
    main()
