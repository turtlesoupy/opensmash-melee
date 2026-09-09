# Local browser performance — September 9, 2026

The optimized browser skinning path is the local play default. Six moveset samples passed the sustained two-fighter combat gate at 960×720 in Codex’s in-app browser on an Apple M5. The Fox sample is the largest source mesh in the 1,067-character audit: Rob Zombie, 3,670 vertices. This is not a mobile, four-player, all-stage or complete OpenSmash parity certificate.

## Measured combat windows

All observed 30-second-window FPS values are retained below, including failed windows. The last three windows of each run passed: FPS ≥58.5, p95 ≤20 ms, p99 ≤33.34 ms, zero audio underrun samples, and actual audio rendering for at least 95% of the expected 48 kHz samples. Only active CPU-versus-CPU benchmark runs without runtime errors qualify.

| Moveset / character | Every measured window (FPS) | Last-three worst p95 / p99 (ms) | Audio underruns | Result |
|---|---|---|---|---|
| Mario / Alan Turing | 58.46, 59.84, 59.71, 60.13, 59.84 | 18.08 / 21.52 | 0 | Pass |
| Luigi / 50 Cent | 59.93, 59.94, 59.9 | 17.89 / 20.43 | 0 | Pass |
| Captain Falcon / Abraham Lincoln | 59.93, 59.87, 59.87 | 17.75 / 21.86 | 0 | Pass |
| Fox / Rob Zombie | 60.0, 59.09, 59.0 | 19.66 / 24.96 | 0 | Pass |
| Marth / Alex Ovechkin | 59.94, 59.61, 59.84 | 19.05 / 21.29 | 0 | Pass |
| Link / Al Capone | 59.37, 58.43, 59.94, 59.74, 59.6, 59.81 | 18.14 / 23.45 | 0 | Pass |

Mario’s initial window and one Link effects-heavy window failed. Both later passed three consecutive windows. Brief first-use/effect stutters remain visible; the result should be described as near-60-FPS combat, not a perfect frame lock.

## What changed

The former custom costume layout emitted hundreds of GX draw batches (337 for Alan Turing). The browser now skins the same vertices and original blended weights once per draw using the live Melee joint transforms, then submits one batch for these meshes. Melee still runs animation, physics, collisions, camera, materials and projection. The original GX path remains available with `?skin=gx`.

Four live matrix comparisons per moveset (draws 1, 120, 600 and 1200) checked every weight envelope against the actual PPC matrix routines. Position matrices matched exactly; the largest normal-matrix error was about 0.000012. Measurement windows restart after the final comparison, so oracle work is excluded. Exact concat/FMA specializations also pass independent full-CPU-state and RAM regression oracles.

The longer tests found and fixed a lazy-FPU context-switch failure and fresh-save Luigi/Marth availability. The unoptimized GX combat path averaged roughly 33.5 FPS initially and 41–43 FPS after math/FIFO work; the one-batch browser layout supplied the larger improvement.

## Reproduce

Start the local asset server and Vite as described in [LOCAL_RUNTIME.md](LOCAL_RUNTIME.md). Open `http://127.0.0.1:5174/?profile=skin&benchmark=1`, choose a character, and keep the tab active with sound enabled. Do not run compilers during measurement. Wait for the four matrix checks followed by three complete 30-second windows. Normal play at the bare local URL uses a human first player, four stocks, and the same optimized renderer.

```sh
python3 tools/report_browser_fps.py --output build/moderngekko-validation/browser-fps-summary.json
python3 -m unittest discover -s tests
npm run build --prefix web
```

Raw evidence remains local: `build/moderngekko-validation/browser-trace.jsonl`, `browser-fps-summary.json`, and `browser-skin-oracle.json`. Historical failed development runs are intentionally retained.

## Build and session identities

- Mario / Alan Turing: Wasm `d2a7cd42236b5abd`, session `56383e4b-2d19-475d-8e35-ad58c44d33ee`.
- Luigi / 50 Cent: Wasm `33ce0b953e2bf704`, session `600d52fe-d12d-4e09-8915-61f36ffe9fb0`.
- Captain Falcon / Abraham Lincoln: Wasm `33ce0b953e2bf704`, session `2b6d372c-4b89-40a8-80f7-37b2c81f8745`.
- Fox / Rob Zombie: Wasm `33ce0b953e2bf704`, session `2e1dd73f-3b18-46d4-903e-6daf40b42e83`.
- Marth / Alex Ovechkin: Wasm `33ce0b953e2bf704`, session `c1e90e9e-15a4-4a87-9317-1a0a255817cd`.
- Link / Al Capone: Wasm `33ce0b953e2bf704`, session `54213466-e055-4e6c-91d1-b8751e1de678`.

The newer build differs from the Mario performance build only by initializing the local roster’s character-unlock mask before character select. Both use the same validated skinning code. Builds use the fast O1 link; compiled game/runtime functions retain their configured optimizations. No claims are inferred from a different optimized-link build.

## Normal-play check

After enabling the optimized default, a bare-URL Alan Turing/Mario match launched
with a human P1, four stocks and the host skinning path (Wasm `33ce0b953e2bf704`).
Keyboard Enter visibly opened and closed P1 Pause. Jump and special inputs were
sent; P1 moved onto a platform and Peach’s damage rose from 0% to 6%. The visible
FPS readout was around 60. This interaction check is separate from the automated
CPU-versus-CPU performance gate. The match was closed back to the local roster.

## Startup optimization regression

Build `89141b6f6fb549b5` adds sized bulk file reads, fast-disc mode, startup-only
unthrottling, and one parked engine. It restores normal pacing at the first
combat callback. See [STARTUP.md](STARTUP.md) for click timings and cold/warm
definitions. All six movesets reached actual matches through the new slot path.

The live matrix oracle passed through pose 1200 for Luigi, Link, Captain Falcon,
Fox and Marth after slot padding. The independent archive check also preserves
all original data bytes, relocations and symbols for every tested slot. Mario's
human session had a passing 59.36 FPS window and working pause input.

The largest mesh, Rob Zombie/Fox, recorded 59.97, **58.03 (failed)**, 60.03,
58.52 and 59.03 FPS. The final three windows passed the existing gate, with zero
audio underruns. Alex Ovechkin/Marth recorded 59.94, 59.93 and 59.97 FPS, also
with zero underruns. These completed windows preceded the native compiler work;
the browser match was closed before the larger native build started. As before,
occasional effect-related stalls remain and this is not a locked-60 guarantee.

Regression sessions:

- Mario: `856160c7-6a1c-4ae1-bead-f5692cb8616c` (human).
- Luigi: `1d1ce66e-7cda-4d62-99dd-0fab659f85c8` (oracle).
- Link: `ef146338-5fa0-40f8-bc25-af8079f8d3b3` (oracle and one passing window).
- Captain Falcon/Achilles: `d99f2ce8-35fc-487f-81e9-22c14006648c` (first conversion and oracle).
- Fox: `8032ef7f-a41d-4a19-9f3d-b571b4027117` (oracle and sustained gate).
- Marth: `fd64a686-71be-4215-a68a-16772e1078b8` (oracle and sustained gate).

The earlier full six-moveset sustained runs remain the broader coverage;
this startup change did not repeat three clean windows for every character.

## Five-mode renderer build (September 9)

Build `649124c7433b0adb` (O3) corrects WebGL depth handling and adds launch modes,
four-port lineups and independent costume slots. The four-player Battlefield
sample (Alan Turing, Abraham Lincoln, standard Mario, Achilles) recorded
46.19, 46.77, 46.16 and 48.19 FPS over four consecutive 30–31-second windows.
All had zero audio underruns, but this **fails sustained 60 FPS**. Its warmed
multi-costume click took 3.90 seconds. Do not apply the older two-player FPS/startup
results to this four-player case.

Native four-player custom combat was approximately 31–34 FPS in isolated GUI
samples. Reducing internal resolution did not remove the CPU bottleneck;
bounded GPU threading varied around 32–42 FPS and did not meet the target.

Current trace and report: `browser-trace.jsonl` and `launch-mode-fps-all.json`
under `build/moderngekko-validation/`. Launch-mode functionality is implemented;
four-player performance parity is still open in both builds.

The final two-player Alan Turing/Peach comparison recorded 59.73, 57.13 and
60.03 FPS. The middle window had p95 24.61 ms and 256 audio-underrun samples;
therefore the final renderer also does **not** receive a sustained-60 pass for
that run. The earlier six-moveset results remain historical evidence, not a
certificate for this changed renderer. These failures are retained in
`launch-modes-browser-performance.json`.
