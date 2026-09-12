# Local Melee runtime

The playable port lives in `web/` and uses a pinned MeleePad/ModernGekko runtime,
with Emscripten adaptations recorded in `runtime/patches/browser/`. The older
`browser-port/` skinning lab is a separate validation tool, not the game engine.
No hosting or deployment is needed.

## Run

From this project:

```sh
python3 tools/prepare_moderngekko.py --help
python3 tools/build_recomp_browser.py
python3 tools/serve_melee.py --iso "$MELEE_ISO"
npm install --prefix web
npm run dev --prefix web
```

Open http://127.0.0.1:5174 and select your USA 1.02 ISO in the browser. The browser
verifies its SHA-256, parses its file table, and reads game files directly from
the selected file through WORKERFS. The ISO is never uploaded. Only requested
file slices enter the runtime; the whole disc is not copied into Wasm memory.
Writable costume/menu slots overlay the read-only disc, preserving the original.
Select the ISO again after a page refresh. Returning to the roster and replaying
reuses the same verified File object without hashing the full disc again.

The asset service is still required for custom-costume conversion, menu artwork,
announcer clips and character imports. Its extracted game inputs are prepared by
the command above; selecting a browser ISO does not populate the server's files.
This is a local-disc browser trial, not a server-free static distribution.
`?disc=server` retains the previous extracted-file transport for comparisons.
Desktop disc setup continues to use its existing local installation flow.

Game files and generated costumes stay local and ignored by Git. Character selection converts the selected
OpenSmash source mesh into the assigned Melee costume, then boots the actual game.
One engine preboots while the roster is visible; measured warmed clicks reach
the match in about 1.4–2.4 seconds. See [STARTUP.md](STARTUP.md) for cold-launch
timings, the measurement boundary, and the verification loop.
For ROM-first Apple Silicon app builds, see [NATIVE.md](NATIVE.md).

## Browser changes

- Static PPC recompilation, with 256-instruction compilation regions to avoid
  pathological Wasm compiler time on large irreducible control-flow graphs.
- WebGL 2 renderer with a separate capability-probe canvas; the real canvas moves
  directly to the CPU/GPU worker. Explicit ImageBitmap presentation lets the game
  retain its synchronous loop without blocking the browser UI.
- WebGL-compatible staging readbacks and live-size streaming uploads. Uploading
  into the desktop 48/64 MB stores caused approximately 700 ms GPU stalls on M5;
  using only live upload bytes reduced the measured commit to about 0.2 ms.
- Browser keyboard/gamepad input, verified-disc filesystem, bounded resource fetch
  concurrency, and runtime errors reported to the UI.
- Shared five-mode routing: immediate Free-for-All, VS Menu, VS character select,
  Classic character select and Full Boot. Four-port lineup, stage, rules and
  costume-color allocation are available under Launch settings.
- WebGL depth ranges, depth comparisons and regional clears use a consistent
  convention; VS/Classic menus and stage scenes are checked visually.

## Validation status

The browser runs actual Battlefield combat with custom characters, damage,
stocks, respawns, items and sound. An earlier browser skinning build passed sustained
combat checks for all six movesets on the local Apple M5. The current launch-mode
renderer has recorded FPS failures in two- and four-player tests. See [PERFORMANCE.md](PERFORMANCE.md)
for per-character windows, effect-related dips and exact build identities. This is a two-fighter test, not a
four-player or mobile performance certificate.

Browser keyboard taps and persisted save reuse were verified. The roster launch
unlocks fighters in the local virtual game so Luigi and Marth are available on a
fresh save. All-roster gameplay and remaining OpenSmash feature parity gates are
open. Native performance is separate and is not certified by the browser result.

Evidence is local in `build/moderngekko-validation/`. `browser-trace.jsonl`
contains startup failures and successive development runs as well as 30-second
frame summaries; do not treat it as one clean benchmark. The worker reports mean
FPS, p95/p99 frame intervals, frames over 33.34 ms, and the engine phase CSV.

## Combat performance loop (September 9)

The baseline optimized browser combat run averaged 33.53 FPS. Exact matrix
specialization, hot-function LTO and FIFO upload improvements brought repeated
combat windows to roughly 41–43 FPS. This still fails the 60 FPS gate.

`tools/report_browser_fps.py` groups 30-second combat windows by the actual Wasm
SHA-256 and character. In CPU-versus-CPU benchmark mode, three consecutive windows must each average at least 58.5 FPS,
with p95 <= 20 ms, p99 <= 33.34 ms and no audio underruns. Windows containing profiling work cannot pass. The skin oracle finishes after
draw 1200; a fresh measurement window starts only after its final comparison.
Audio must actually render at least 95% of the expected 48 kHz samples. Startup/menu frames are excluded. The live FPS display turns amber below
the target. Original geometry and skin weights have not been quantized.

The browser now defaults to the one-draw skinning layout. It keeps exact source
weights and fitted proportions. Developer-only `?profile=skin` compares every
envelope against the game's PPC matrix routines on several live poses. The
original GX layout remains available with `?skin=gx`.
Add `&benchmark=1` for a 20-stock CPU-versus-CPU stress match. Normal play uses
a human first player and four stocks. Do not benchmark during compiler builds.

Arithmetic regression commands:

```sh
python3 tools/validate_browser_math.py --wasm
python3 tools/validate_browser_math.py --wasm --scaled
python3 tools/validate_browser_fma.py
python3 tools/report_browser_fps.py
```

The concatenation oracle compares full CPU state and RAM across 12,000 cases;
the FMA oracle compares full CPU state across 960,000 cases against pinned,
unmodified runtime source. Reports stay in `build/moderngekko-validation/`.

## Local-disc validation and runtime delivery

The headed Chrome check uses a fresh profile, rejects `/api/setup` and `/api/game`
requests, and requires three consecutive passing 30-second combat windows, allowing up to
250 seconds for warm-up. It explicitly activates audio and records AudioContext state. It retains frame-time,
audio, network and screenshot evidence, including failed windows:

```sh
NODE_PATH=/path/to/playwright/node_modules node tools/validate_local_disc.cjs "$MELEE_ISO" build/local-disc-validation/two-player 2
NODE_PATH=/path/to/playwright/node_modules node tools/validate_local_disc.cjs "$MELEE_ISO" build/local-disc-validation/four-player 4
```

Set `MELEE_CHECK_INVALID=1` to test a truncated disc and a full-size corrupted
image before recovering with the valid ISO. `MELEE_REPLAY=1` also checks replay
without a repeated full-disc hash. `MELEE_LINEUP=default` uses Turing, stock Fox, Lincoln and Obama.
`MELEE_LINEUP=custom` uses Turing, Trump,
Lincoln and Obama instead of the mixed Turing/Fox/Link/Peach four-player case.
`MELEE_TEST_URL` selects another local server. For attribution only,
`MELEE_TRACE=1` with a URL containing `?benchmark=1&profile=phases` records a CPU
trace and phase counters; profiled runs cannot certify frame rate.

The browser build produces gzip sidecars at build time. The local server serves
those to supporting clients with the original MIME type. Runtime URLs carry a
cache identity covering the Wasm and JavaScript files; matching versions are
immutable, while the build manifest remains uncached. Stale version requests
fail rather than mixing a new binary with old glue. The September 12 baseline
Wasm is 118,615,393 bytes uncompressed and 17,963,498 bytes over gzip (17.1 MiB).
Range reads retain the original uncompressed byte offsets.

Region-size experiments run with `tools/build_recomp_browser.py
--chunk-instructions 1024`. They use separate generated code and build directories,
leaving the default 256-instruction build intact. Point `MELEE_BROWSER_BUILD` at
an experimental output directory when launching the local server. This is an
AOT code-layout experiment; native ARM/x86 JIT machine code cannot be reused by
the browser runtime. Guest instructions, floating-point behavior, timing checks
and mod callbacks remain required validation boundaries.

The browser now follows native's compact texture policy when a match contains
three or more custom costumes. Preparation and download both select
`browser-compact` assets (256-pixel textures); source mesh geometry and weights
are retained. This prevents the guest heap allocation failure in the tested
Turing/Fox/Lincoln/Obama lineup.

`--hot-lto` is another opt-in compiler experiment, publishing to a separate
`-hot` output folder. Neither expanded LTO nor 1024-instruction regions met the
four-player frame-rate target in the September 12 tests. The default remains
256-instruction regions with the existing exact math specializations.
