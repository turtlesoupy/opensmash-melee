# WASM region chaining — September 13, 2026

Independent pass after [WASM_INDEPENDENT_HANDOFF.md](WASM_INDEPENDENT_HANDOFF.md).
The ISO is unchanged. No emulated work is skipped and no gate was loosened.

## Baseline and diagnosis

The retained `f60b3f3bbd856e7f` runtime reproduced the slow mode on the heavy
Fountain lineup (`5,1,4,13`, stage 2): six strict windows at 51.40, 51.94,
56.13, 53.86, 50.52 and 56.17 FPS, all failing (`build/independent-heavy-fountain-01`).

Per-thread CPU sampling of the Chrome renderer (`ps -M`, 8-second deltas)
during that run showed the emulated-CPU pthread at 96–97% and the GPU thread at
about 78%, with no busy V8 compile threads. Chrome with `--js-flags=--no-liftoff`
(TurboFan only, `MELEE_CHROME_ARGS` in the harness) still measured 46.37,
50.57 and 53.74 FPS (`build/independent-fountain-noliftoff-01`), so the
compiler tier does not explain slow mode. The renderer's worker threads run at
macOS QoS 37; efficiency-core scheduling was not directly measurable without
elevated tools and is not excluded, but the CPU thread had no idle time, so
reducing its work per frame is the only lever that does not depend on the host.

A V8 CPU profile of the normal (unprofiled) build restricted to the CPU thread
over a 30-second window (`build/independent-fountain-cpuprofile-01`) attributed:

| CPU-thread self time (30 s at ~53 FPS) | Seconds |
| --- | --- |
| Recompiled game regions | 14.79 |
| `StaticRecompCore::Run` (dispatch loop, inlined dispatcher) | 5.88 |
| PPC helpers | 2.28 |
| FIFO write path (`opensmash_pc_write32`, `HookExternalWrite`, `UpdateGatherPipe`, `RunGpu`) | 2.89 |
| Host-call lambda in `main.cpp`, called from every dispatch | 0.71 |

The generated code returns to the C++ run loop at every cross-region call,
return and branch: about 267,000 dispatches per frame for roughly 5.1 million
guest cycles. The loop and the per-dispatch hook probe were about 22% of the
thread.

## Change: chained region exits

`tools/chain_browser_chunks.py` rewrites the generated regions (after math and
entry specialization, into `generated/chained/`) so that a static exit
(`bl`, cross-region `b`, conditional branch, region fall-through) or a dynamic
exit (`blr`, `bctr`, the return-dispatch default) calls the target region
directly when the run loop would have re-dispatched it anyway:

- the CPUState is the run loop's registered context (other users of the
  dispatcher, such as the skinning oracle and the tests, keep single-region
  dispatch);
- no exception is pending;
- the accumulated charge is within the dispatch's chain budget, which the run
  loop sets to the cycles left in the CoreTiming slice (capped at the existing
  256-cycle loop budget). A chain therefore ends at the first transfer after
  the slice expires, the same boundary per-region dispatch used, so external
  interrupts are delivered at the same guest positions;
- as in the run loop, a transfer that charged nothing since the previous one
  charges one cycle, so zero-charge loops end;
- the target is not a host-call (patch or hook) address or a configured idle
  loop address, which the run loop must observe;
- the target region is verified by the chassis SMC guard and is not one the
  chassis forces through the interpreter.

Exits use an ordinary call whose depth is bounded by the cycle budget (at most
one frame per transfer, at most 256 transfers). The check is one out-of-line
call per exit so the module stays small: 130,838,076 bytes versus 128,890,072.
Patch `0005-wasm-region-chaining.patch` publishes the run loop's context,
region states, forced regions and slice budget, verifies the generated region
table against the module's, and stops chains at the idle addresses. `main.cpp`
publishes a copy of the dense host-call bitmap.

### Correctness evidence

- `tools/validate_browser_chain.py`: for every region, 4 random entries and 6
  scenarios (FP disabled, paired-single disabled with journaling, MMIO operands,
  EXRAM operands with journaling, random GQR/FPSCR and computed returns, budget
  edge with journaling), one chained dispatch must equal the unchained sequence
  of single-region dispatches under the same continuation rule: full CPU state,
  RAM, EXRAM and callback trace. 91,032 cases, 58,100 exercising a chain,
  longest chain 251 transfers. Report: `build/moderngekko-validation/browser-chain-wasm.json`.
- `tools/validate_browser_entries.py` still passes 1,835,008 cases on the chained
  archive (the specialized entries keep their retained originals).
- Gameplay, replay and audio gates ran through the existing harness; no runtime
  errors or audio underruns in any completed run.

### Failed variants (removed)

- Wasm tail calls (`musttail`, `-mtail-call`): a node timing of the chain
  oracle first suggested chained dispatch was 8x slower, but the same figure
  appeared with ordinary calls and an order-swapped bench showed it was a
  first-run artifact of the bench, so neither variant was shown slow in
  isolation. Tail calls were dropped anyway: with the budget bounding call depth
  they add nothing, and the flag is one less toolchain requirement.
- Fixed 256-cycle chain budget: chains started where the previous one ended,
  so slice boundaries phase-locked to one instruction of the OS idle loop inside
  an interrupt-disabled window and the VI interrupt was never delivered. The game
  stalled at the preparation hold (`build/independent-chain-stall-profile-02`).
- Refusing to chain while MSR.EE is clear: every boundary then landed in
  interrupt-disabled windows (OSDisableInterrupts/OSRestoreInterrupts polling
  around memory-card I/O) and the game stalled after launch
  (`build/independent-chain-stall-profile-03`). Replaced by the slice-based budget.
- Inlined chain checks: a 192 MB module whose hot regions took much longer to
  reach TurboFan; first windows measured 30–38 FPS.

## Measurements

All on the same Apple M5, headed Chrome 152, fresh profile per run, heavy
Fountain lineup, three 30-second windows. The machine was in a slower state in
the evening than in the morning baseline; comparisons are interleaved.

TurboFan-only (`--js-flags=--no-liftoff`), inlined-check build, alternating:

| Run | FPS windows |
| --- | --- |
| chained | 33.45, 51.07, 53.53 |
| f60 control | 40.36, 42.46, 44.32 |
| chained | 34.45, 49.30, 50.76 |

Normal tiering, final out-of-line build (`3017755535d32d1f`), alternating with
the f60 control on port 8788, with renderer thread sampling
(`build/independent-{chain,control}-series-{1,2,3}`):

| Run | FPS windows | CPU-thread ms per frame (windows 2–3) |
| --- | --- | --- |
| chained 1 | 52.6, 55.2, 43.9 | 17.5, 21.4 |
| control 1 | 38.5, 41.9, 38.6 | 22.3, 24.3 |
| chained 2 | 45.2, 47.9, 46.0 | 19.7, 20.7 |
| control 2 | 41.2, 36.8, 39.9 | 25.3, 23.1 |
| chained 3 | 47.5, 50.7, 56.1 | 18.9, 17.0 |
| control 3 | 48.8, 49.1, 46.2 | 19.7, 20.6 |

Medians over windows 2–3: chained 49.3 FPS and 19.3 ms of CPU-thread time per
frame; control 40.9 FPS and 22.7 ms. An earlier alternating triple under normal
tiering measured chained 57.32, 58.03, 58.07; control 54.19, 58.58, 54.87;
chained 49.73, 56.46, 54.74 (WindowServer at 90% during the last run).

A final six-window strict run with replay on the chained runtime
(`build/independent-chain-heavy-fountain-01`, Music.app active at about 38%
CPU) measured 49.47, 52.84, 49.20, 44.58, 46.13 and 51.65 FPS with no audio
underruns and a successful replay; every window failed the gate, as the control
did in the same machine state.

This is a demonstrated reduction of about 15% in CPU-thread work per frame on
the hardest case. It is not a universal 60 FPS result: on the evening machine
state neither build passed the strict gate, and the roster sweep has not been
rerun on the chained runtime.

## Tooling changes

- `tools/validate_local_disc.cjs`: `MELEE_CHROME_ARGS` passes diagnostic Chrome
  flags; with `MELEE_TRACE=1` the trace starts at launch and is saved even when
  the run fails.
- Per-thread renderer sampling and profile analysis were done with ad-hoc
  scripts (`ps -M` deltas; V8 `ProfileChunk` events resolved through the symbol
  map and restricted to the CPU thread).
