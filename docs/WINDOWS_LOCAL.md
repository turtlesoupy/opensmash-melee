# Local Windows development

Use a short checkout path such as `D:\projects\opensmash-melee`.
The Windows preview source is on `release/windows-preview`.

## Launcher

Install Node.js 22.13 or newer and Python 3.12, then run in PowerShell:

```powershell
py -3.12 -m venv .venv
$env:PYTHONUTF8 = '1'
.\.venv\Scripts\python.exe -m pip install -r desktop/requirements.txt
npm.cmd --prefix web ci
npm.cmd --prefix desktop ci
```

Prepare the versioned runtime and character inputs as described in
[DESKTOP_RELEASE.md](DESKTOP_RELEASE.md). When reproducing an existing preview,
its extracted `resources/runtime` and `resources/characters` directories can be
copied to `build/desktop-runtime` and `build/desktop-characters`. This builds the
launcher against that exact precompiled engine; it does not rebuild the engine.

```powershell
.\tools\dev-desktop-windows.ps1
```

For an unpacked distributable:

```powershell
$env:PYTHONUTF8 = '1'
npm.cmd --prefix web run build
.\.venv\Scripts\python.exe tools/build_desktop_payload.py
npm.cmd --prefix desktop run pack
.\.venv\Scripts\python.exe tools/verify_desktop_package.py build/desktop-artifacts/win-unpacked/resources
```

The executable is `build/desktop-artifacts/win-unpacked/OpenSmash Melee.exe`.
The development launcher and packaged app use the existing `%APPDATA%/OpenSmash
Melee` profile. Back up this profile before tests that change saves. Automated
package verification creates its own temporary profile.

## Native engine

Install Visual Studio C++ Build Tools with a Windows SDK, LLVM (clang-cl), and
the Python `cmake` and `ninja` packages. Activate the x64 Visual Studio developer
environment, put the virtual environment's Scripts directory and LLVM's bin
directory first on PATH, and set `CC=clang-cl`, `CXX=clang-cl`, `PYTHONUTF8=1`.

Download the private `native-inputs-v3.tar.gz` asset from `desktop-inputs-v3`.
Then run:

```powershell
python tools/build_desktop_runtime.py build/desktop-inputs/native-inputs-v3.tar.gz --output build/desktop-runtime-local
```

This output is separate from the known preview engine. Keep benchmark results
and the original engine until a replacement has passed gameplay checks.

## Validation

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests
node --test tests/embedded_frame.cjs tests/launch_options.test.mjs
```

A clean package smoke check verifies startup, all catalog entries, session
authentication and the ISO gate. It does not certify gameplay or performance.
