# OpenSmash Melee

A separate, experimental Melee backend for the OpenSmash custom-character
concept: generate a rigged character, fit it to a base fighter, keep that
fighter's gameplay, and supply the character's own presentation assets.

**Status: real Melee combat now runs in the local browser; full OpenSmash parity
is unfinished.** Character selection boots the statically recompiled game with
the selected costume. WebGL rendering, keyboard input, and a custom-character
Battlefield match have been exercised. The earlier browser skinning build passed near-60-FPS checks across six movesets
on Apple M5. The new renderer passes functional launch checks but has recorded
FPS failures, especially in four-player matches; performance parity remains open.
Warmed character clicks reach the match in about 1.4–2.4 seconds; see
[startup evidence](docs/STARTUP.md) and [performance limits](docs/PERFORMANCE.md).
[Native ROM-first build scripts](docs/NATIVE.md) target Apple Silicon Macs.
Both launchers now expose the five OpenSmash launch modes, stage/rule settings,
four controller ports, and custom opponents with distinct costume slots. See
[launch-mode validation and remaining limits](docs/LAUNCH_MODES.md).
Library validation still has 1,064
source-shape/export passes and 3 review flags.

Start with [the local runtime](docs/LOCAL_RUNTIME.md) and
[parity acceptance](docs/PARITY.md). The [older browser lab](docs/BROWSER_PORT.md)
contains isolated animation/skinning evidence, not the playable frontend.

Upstream is pinned as the `melee/` submodule to
`64fccd19a0e7c8d54a1da6c56235016b659c354f` from
[doldecomp/melee](https://github.com/doldecomp/melee). The original OpenSmash
checkouts are not modified by this project.

For a fresh clone, dependencies, and local source assets, see
[checkout instructions](docs/CHECKOUT.md).

## Implemented

- Import existing generation artifacts: rigged GLB, metadata, portrait, stock,
  emblem, announcer audio. Content hashes detect later changes.
- Read embedded GLB skin weights, inverse bind matrices, interleaved and
  normalized attributes, and material-selected base-color textures.
- Inspect HSD costume archives and archived joint inverse bind matrices.
- Conform meshes through an explicit bone map and optional bone-axis
  corrections, preserving blended weights rather than splitting rigid parts.
- Write HSD envelope polygons, native GX display lists, and tiled RGBA8
  textures. Reorder opaque triangles to reuse ten-entry matrix palettes.
- Preserve existing joint and DObj counts/ordering when replacing geometry.
- Prepare a user-provided game image and check the upstream matching build.

## Local setup

```sh
git submodule update --init
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r requirements.txt
python3 -m opensmash_melee doctor
python3 -m unittest discover -s tests -v
```

The local NTSC-U 1.02 ISO passed the known MD5 check
`0e63d4223b01d9aba596259dc155a174`. The Docker Linux build completed
and its DOL matches upstream SHA-1 `08e0bf20134dfcb260699671004527b2d6bb1a45`.
See `build/disc-validation.json` and `build/engine-verification.json`.
On this macOS host, use `tools/build_engine_docker.sh` to avoid Wine.

Prepare your **unmodified NTSC-U 1.02** image or an extracted directory
containing `sys/` and `files/`:

```sh
python3 -m opensmash_melee prepare-game /path/to/your/melee.iso
tools/build_engine_docker.sh
```

`prepare-game` first requires the known disc MD5 for ISO/GCM input,
uses upstream decomp-toolkit, copies into `assets/game`, checks
the game ID and original DOL SHA-1, then stages that DOL for the matching build.
It refuses to replace an existing extraction. Source images remain untouched.
Game files and local character artifacts are ignored by Git.

## Character conversion

An existing character has already been imported locally at
`assets/characters/rowanatkinson`. To import another:

```sh
python3 -m opensmash_melee import-character \
  ../opensmash/pipeline/play/ui/stevejobs assets/characters/stevejobs
```

Inspect a costume, choose its actual public joint symbol, then inspect the
joint hierarchy. No Melee bone indices are guessed or copied from SSB64:

```sh
python3 -m opensmash_melee inspect-dat assets/game/files/PlMrNr.dat
python3 -m opensmash_melee inspect-dat assets/game/files/PlMrNr.dat \
  --symbol SYMBOL_FROM_PREVIOUS_COMMAND --out build/mario-skeleton.json
```

Author a reviewed profile with:

| Field | Meaning |
|---|---|
| `costume_sha256` | SHA-256 of the exact source costume; prevents stale mappings |
| `symbol` | Archive public joint symbol |
| `joint_map` | Every weighted GLB bone name mapped to a target joint traversal index |
| `mesh_joint` | Existing model owner index; currently must have HSD `SKELETON_ROOT` and a DObj |
| `mesh_dobj` | Existing DObj ordinal on that owner; defaults to zero |
| `bone_scale` | Positive scale applied in bone-local space; defaults to one |
| `bone_corrections` | Optional source bone name to affine 4x4 correction matrix |
| `texture_size` | Power of two, 4–1024; defaults to 256 |

The Mario profile has initial in-game smoke coverage, but no production
Melee profile has completed the full acceptance suite. The owner restriction is
intentional: other owners require runtime matrix capture to avoid applying
their animation twice. A real costume may require extending that path.

```sh
python3 -m opensmash_melee convert assets/characters/rowanatkinson \
  --costume assets/game/files/PlMrNr.dat --profile profiles/mario.json \
  --out build/rowanatkinson/PlMrNr.dat
```

This emits an experimental costume DAT and provenance report, **not a game
image or verified playable character**. It never overwrites the source costume.
The profile above is a workflow description. A local experimental Mario fit
is available at `build/rowanatkinson-mario/profile.json`, generated by
`tools/fit_mario_profile.py`. It is pinned to the source mesh and costume
hashes and still requires visual/gameplay review.

## Verification and remaining work

```sh
python3 tests/verify_existing_characters.py ../opensmash/pipeline/play/ui
```

This roundtrips Rowan Atkinson, Steve Jobs, and Count Dracula through synthetic
HSD skeleton descriptors built from their GLB inverse binds. It independently
decodes the generated display lists, checks every triangle/UV/weight, and
compares animated vertex positions against a CPU skinning oracle.
It validates interchange only: these are **not Melee skeletons or animations**.
Results are saved to `build/source-interchange-verification.json`.

See [docs/PARITY.md](docs/PARITY.md) for the acceptance target and
[docs/ENGINE-NOTES.md](docs/ENGINE-NOTES.md) for the engine integration points.
Neither source-level tests nor the upstream matching build establishes visual,
gameplay, or performance parity.

## Floating Dolphin verification

```sh
python3 tools/launch_dolphin.py build/rowanatkinson-mario/game/sys/main.dol
```

The launcher uses isolated `build/dolphin-user` settings, a 960×720 game
viewport, and places Dolphin in floating layout on Codex's AeroSpace workspace.
The outer window is 960×808 including native titlebar and toolbar. This is a
separate window on the same workspace. The user's AeroSpace config has a
Dolphin-only floating rule, with a dated backup beside the original config.

`tools/stage_costume.py` stages a separate extracted game and validates that
the costume preserves the original skeleton. The source ISO and extraction
remain unchanged. Dolphin 2606a loaded the revised Rowan costume in the Adventure stage.
Idle, post-movement, crouch, and shield screenshots are in
`build/rowanatkinson-mario/evidence`; the precise scope is recorded in
`build/rowanatkinson-mario/gameplay-verification.json`. This is a smoke test,
not complete gameplay, presentation, or performance acceptance.
The isolated profile has save slot 2 at Mario character selection and slot 3
in custom gameplay. Load slot 2 to test a newly staged costume; slot 3 already
contains the previous costume in RAM.

## One-command existing-character build

```sh
python3 tools/build_character.py /path/to/generated/character --id my-character --stage
python3 tools/launch_dolphin.py build/characters/my-character/game/sys/main.dol
```

This imports the source artifacts, generates the Mario fit, converts the
weighted mesh, and stages the verified decomp executable with the costume.
Identifiers are immutable; choose a new identifier for each revision.
The current target is Mario's default costume. It does not yet register a
new roster slot or install the copied portraits and announcer audio.
Steve Jobs and Count Dracula were built locally under `build/characters/`;
they have conversion validation but have not yet been reviewed in-game.

See [docs/VALIDATION.md](docs/VALIDATION.md) for the September 8 library audit,
head-proportion fix, combat clips, and exact coverage limits.

The default Mario fit preserves the source head shape and head/body ratio. Use
`--head-style uniform` with the fit/build tools for the optional geometry-matched
head. Head shape is a style choice, not an export-validity requirement.

Use [the isolated shape loop](docs/SHAPE_VALIDATION.md) before combat review.
Revision 6 passes source-shape checks for 1,064 rigs; three unusual rigs need
manual review. Earlier binary-only passes are not appearance certificates.
