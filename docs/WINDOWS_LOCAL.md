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

Use Visual Studio 2022 C++ Build Tools 17.8 or newer, a Windows 11 SDK,
LLVM (clang-cl), and the Python `cmake` and `ninja` packages. Older toolsets
can lack `<expected>` or contain C++/WinRT headers that require obsolete
coroutine support. The helper activates the x64 developer environment and
sets the compiler, PATH, and UTF-8 mode:

Download the private `native-inputs-v3.tar.gz` asset from `desktop-inputs-v3`.
Then run:

```powershell
.\tools\dev-native-windows.ps1
# After initial configuration, rebuild the engine and run its native tests:
.\tools\dev-native-windows.ps1 -EngineOnly
```

This output is separate from the known preview engine. Keep benchmark results
and the original engine until a replacement has passed gameplay checks.

`-EngineOnly` uses the existing CMake configuration and does not assemble a
runtime payload. Run the full command again when changing toolchains or
preparing a complete payload. It retains the portable, baseline CPU module;
AVX2 is not required by the performance fixes.

On machines with an older installed toolset, the helper can use extracted
Microsoft packages through the ignored `build/windows-toolchain.json`:

```json
{
  "toolset": "D:/toolchains/VC/Tools/MSVC/14.44.35207",
  "compatibilityVersion": "19.44",
  "winrtHeaders": "D:/toolchains/winrt-headers",
  "redist": "D:/toolchains/VC/Redist/MSVC/14.44.35112"
}
```

`winrtHeaders` contains the generated `winrt` directory from Microsoft's
C++/WinRT tool. The full builder also respects `CXXFLAGS` for these header
paths. Keep the compiler libraries and bundled redistributables from the
same toolset generation.

Windows launches use separate CPU and rendering workers with `SyncGPU` and
a 1,000,000-cycle maximum lead. Do not enable unconstrained dual-core mode:
the runtime documents FIFO corruption when guest execution runs too far ahead.
Runtimes advertising `gracefulShutdown: "file-v1"` receive a stop request
before the launcher waits for exit, allowing caches and saves to be flushed.
An unresponsive engine is still killed after eight seconds.

## Validation

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests
node --test tests/embedded_frame.cjs tests/launch_options.test.mjs
```

A clean package smoke check verifies startup, all catalog entries, session
authentication and the ISO gate. It does not certify gameplay or performance.


## Local performance measurements (2026-09-11)

On a Ryzen 9 3950X / RTX 5090, an isolated profile running the custom Obama
fighter against CPU Peach on Battlefield measured about 43 FPS with the
preview runtime and 54.8 FPS with this engine and bounded dual-core setting.
The final run reached combat in 11 seconds, versus approximately 41 seconds
before the asset verification changes. Gameplay was measured for 45 seconds
after a 15-second warmup; CPU behavior varies between runs, so these are
observations rather than a deterministic benchmark or a steady-60-FPS claim.

The changes cache the native-skin environment setting and avoid unnecessary
mod lookup probes. Windows SHA-256 uses BCrypt, and directory verification
resolves each relative path once instead of during every sort comparison.
Every asset is still hashed. Native tests check known file/directory digests,
hook collisions, return hooks, and mod reload behavior.

Before the JIT change below, CPU phase profiling showed simulation as the limiting factor (roughly
18 ms per frame). Lower rendering resolution and experimental AVX2 / inline
FP changes did not establish an improvement; those experiments are excluded.
The tested local package retains the original portable game module and uses
the rebuilt engine, controllers, and launch mod. Graceful exit was verified
with exit code zero and saved shader caches. Cold shader compilation, every
character/mode are not certified by those initial measurements.


## Windows JIT execution and freeze regression

Windows offline matches now use the runtime's existing JIT engine while keeping
native mod hooks and the portable module used by custom skinning. Other platforms
keep their previous default. Netplay, lockstep validation, and runtimes without a
JIT retain static execution. Set `OPENSMASH_CPU_BACKEND=static` to compare the old
execution path; the override does not change the netplay/lockstep guards.

The initial JIT experiment exposed an optimizer bailout bug. Failed constant
assumptions were recorded on the outer static core, while its child JIT compiled
the blocks. The child could keep executing the same failing guard without
charging cycles (observed at guest PC `0x802fbd14`), freezing presentation and
preventing shutdown. Exception profiling and invalidation now target the actual
compiling engine. Startup mod callbacks also run before the first guest
instruction when execution enters through the JIT's address probe.

After that correction, the custom Obama versus CPU Peach test completed a full
180-second measurement at 59.8 FPS, with no frozen seconds and a clean exit.
Seven one-second windows were below 58 frames; the slowest contained 54 frames.
A second, warmed-cache 120-second run measured 59.93 FPS, also with a clean exit;
four one-second windows had 57 frames. This preserves the existing rendering
settings. Whole-module optimization was
also tested (56.1 FPS on the static path) and is not included in the package.

Reproduce a measurement using a prepared lineup and initialized memory card:

```powershell
$gameWorkspace = Join-Path $env:APPDATA 'OpenSmash Melee/workspace'
.\.venv\Scripts\python.exe tools/benchmark_native_windows.py `
  --runtime build/desktop-runtime `
  --game "$gameWorkspace/build/native-lineup" `
  --user-template "$gameWorkspace/build/native-user" `
  --output build/benchmarks/windows-current `
  --measure 180 --timeout 240
```

The default match is CPU Link versus CPU Peach on Battlefield; the measured
lineup supplies the custom Obama costume for Link. The output directory must be
new. The harness copies the profile, records binary
hashes, allows 15 seconds of warmup, and reports FPS over the **entire** requested
window. A frozen tail must count as missing frames; dividing only by the time
between the first and last delivered frames previously hid a stall. Regression
tests cover that case and the backend/profiling-target selection rules. Use
`--single-core` for a comparison; the default uses bounded dual-core execution,
as the launcher does. The benchmark is a native embedded-surface test and does
not measure the Electron renderer itself.
