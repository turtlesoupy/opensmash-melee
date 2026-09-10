# Experimental roster sweep

The local sweep exports Turing (hatless) and Lincoln (hat) onto all 27 fighter rigs, including separate Popo and Nana costumes. All 54 exports succeeded. This does not expand the shipping target picker.

Run from the repository:

```sh
python3 tools/probe_retarget_roster.py
python3 tools/probe_retarget_native.py --case ice-climbers --output build/retarget-roster-probe/native-texture-fixed
python3 -m unittest discover -s tests
```

Requires the locally extracted game, sibling opensmash character sources, existing animation Wasm, and installed native build. Native output directories must be new. Generated game data stays under ignored `build/`.

Open `build/retarget-roster-probe/index.html` for the overview, three detailed comparison sheets and JSON report. Columns compare bind, idle, run, jab and the second source character. Each row shares a camera across its poses; camera scale differs between rows. Pose sheets use texture-only CPU rendering and omit retained native equipment. They are geometry diagnostics, not lighting or performance evidence.

## Repairs and validation

- Added explicit experimental mappings for missing finger/hand endpoints, shared head anchors, and Kirby's different neutral skeleton.
- Collapsed target segments retain source volume rather than producing singular scales. Existing six-target fit positions remain unchanged in regression checks.
- Reapplied head proportion preservation after surface fitting. Maximum head-height fraction error across 54 fits is 0.55%.
- Retained Ice Climbers' hammers and selected Roy/Young Link equipment. Unbound rigid equipment is accepted only with unit-scale ancestry.
- Redirected original body texture animation frames to the replacement texture while preserving animation IDs/counts. Removing those animations caused a fighter initialization assertion; preserving and rebinding them passed the native check.
- All 54 Python tests pass; JavaScript syntax and diff whitespace checks pass.

## Native evidence

Pikachu boots and moves with Turing (`native/pikachu`). Ice Climbers spawns both retargeted actors and follows during movement, with correct blue body textures and both hammers (`native-texture-fixed/ice-climbers`). Actor telemetry records distinct Popo and Nana actors on both ports. Captures are on Battlefield, using the fixed native window. Frame dumping is not an FPS benchmark.

The earlier `native/ice-climbers` capture shows the overwritten body texture; `native-fixed/ice-climbers` records the rejected animation-removal attempt. Use `native-texture-fixed` for the successful result.

## Remaining judgement and coverage

Kirby and Jigglypuff stretch humanoid limbs during movement and need a different body-fit strategy. Pikachu/Pichu, Bowser and Mewtwo have intentionally unusual crouches/stances worth visual review. Samus still needs cannon state handling. Roy/Young Link equipment exports have not received full native mounting/combat validation. Game & Watch's 2D mechanics need native review with the 3D source mesh.

Other targets have sampled original-animation and export validation only. The matrix-only preview skips DK visibility channels and cannot decode Yoshi's selected aerial format. Global in-game sizing, attack coverage, transformations and all-character combat acceptance remain unverified.
