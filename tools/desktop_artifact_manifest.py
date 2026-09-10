"""Identify downloadable builds without tying the app version to the engine cache."""

import hashlib, json, os
from pathlib import Path

root = Path(__file__).resolve().parents[1]
out = root / "build/desktop-artifacts"
artifacts = sorted([*out.glob("*.zip"), *out.glob("*.tar.gz")])
if not artifacts:
    raise SystemExit("No desktop archives were built")
manifest = {
    "version": json.loads((root / "desktop/package.json").read_text())["version"],
    "sourceCommit": os.environ.get("GITHUB_SHA"),
    "runtimeRelease": "desktop-runtime-v1",
    "characterRelease": "desktop-characters-v1",
    "files": {},
}
for path in artifacts:
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    manifest["files"][path.name] = {"bytes": path.stat().st_size, "sha256": digest}
(out / "build-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
(out / "SHA256SUMS.txt").write_text(
    "".join(
        info["sha256"] + "  " + name + "\n" for name, info in manifest["files"].items()
    )
)
