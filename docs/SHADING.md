# Fighter lighting validation

Custom costumes use Melee's textured diffuse lighting (`0x14`) and Mario's
neutral material colors (`0xb3b3b3ff` ambient and diffuse), with diffuse texture
replacement (`0x50010`). Their existing
textures, normal arrays, geometry, head fit and animation are preserved.
Specular is disabled for the single-material costume so skin and clothing do
not acquire a uniform plastic gloss.

The old exporter wrote `0x15`. This is not an additive combination of working
lighting flags: `HSD_SetupChannelMode` in `melee/src/sysdolphin/baselib/state.c`
switches on `rendermode & 7`. Only case 4 selects the ambient/directional diffuse
lights; case 5 falls through to the unlit channel. Original Mario's body
materials use `0x14`. His occasional shiny details use separate materials.

The diffuse texture must also use `TEX_COLORMAP_REPLACE`, as do 54 of Mario's
textured body draw objects. `TEX_COLORMAP_MODULATE` (`0x40010`) multiplies the
texture by the material's 179/255 diffuse color before lighting. Leaving that
operation in the first lighting fix dimmed the retarget by another 30%.
Replacement removes this extra attenuation while retaining Melee's directional
and ambient lighting. It does not add a global exposure adjustment or specular.

`opensmash_melee/materials.py` migrates only the exact unlit and first-lit exporter signatures.
The local asset server migrates previously prepared native/browser caches on
selection. Native packaging migrates cached source costumes before making
color-slot variants. Already-correct archives return byte-for-byte unchanged.
The source-only native builder includes this dependency without requiring NumPy.

## Repeat the isolated comparison

After building the native app and the Alan Turing Mario retarget locally, run
these cases sequentially, using a new output directory for each review:

```sh
python3 tools/validate_shading.py --costume build/characters/alanturing-mario-game-v1/PlMrNr.dat --case mario --frames 300 --output build/shading-comparison
python3 tools/validate_shading.py --costume build/characters/alanturing-mario-game-v1/PlMrNr.dat --case before --frames 300 --output build/shading-comparison
python3 tools/validate_shading.py --costume build/characters/alanturing-mario-game-v1/PlMrNr.dat --case after --frames 300 --output build/shading-comparison
python3 tools/render_shading_review.py build/shading-comparison
```

Each case boots the verified USA 1.02 executable on Battlefield, with two human
Mario ports. The tool confirms the fresh memory-card prompt through its own
controller pipe. It retains the engine's lights, textures, skinning, normals,
and projection. A validation-only mod tracks P1 with a fixed close camera,
hides the HUD/magnifier, and holds the first idle pose by stopping HSD animation
playback. `game.log` records the motion and animation frame. `capture.png` is
an actual native framebuffer dump; `capture.json` identifies its source frame.
The `before` case reconstructs the old material on the exact same retarget
archive; `after` runs the production migration on it.

The mod is not included in either playable build. Its hooks and frame dumping
make this an image-quality check, not an FPS benchmark. Use the ordinary local
browser/native launch for combat and performance validation. Existing CPU-only
shape previews are unlit and cannot validate this bug.

The initial September 9 local comparison in `build/shading-comparison/` verified idle
frame 0 in all three captures. The migration changed exactly seven material
bytes in each of 26 prepared native/browser archives. The rebuilt native app
passed signature and asset-hash verification for all 39 costume slots across
eight custom characters. Two browser combat windows (Alan Turing versus CPU
Mario on Battlefield) measured 59.97 and 59.55 FPS over 30 and 31 seconds,
respectively, with zero audio underruns; the second window had two frames over
33 ms. Warm click-to-match was 1.82 seconds. These samples do not establish
four-player or all-roster performance parity.

The follow-up in `build/shading-texture-response/` compares original Mario,
the first lighting fix, and corrected texture replacement, all at idle frame 0
with identical camera settings. The original and previous captures are reused
unchanged with their provenance recorded in `reference.json`. Upgrading a
first-lit costume changes exactly one texture-operation byte. The generated
mesh's albedo, detailed texture work, and authored normals still differ from
Mario's artwork; matching the material response does not make those identical.

The follow-up migrated 26 cached costumes by one byte each, and the rebuilt
native package passed signature and bundled-asset verification. All 34 Python
and 7 Node tests passed. A fresh local browser combat sample ran at 28.87 FPS
over 31 seconds with no audio underruns; it failed the 60 FPS target. Other
Chrome processes were busy during that sample, but this does not establish the
cause. The earlier 60 FPS result must not be treated as validation of this run.

The change restores the shared lighting response. It does not replace source
artwork, add detailed Mario-style cloth textures, smooth authored normals, or
claim that every generated character has identical art direction.

Regression checks:

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
node --test tests/*.test.mjs
```
