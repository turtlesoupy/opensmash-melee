# OpenSmash Melee

Super Smash Bros. Melee with custom fighters, from the same team that built [OpenSmash](https://github.com/turtlesoupy/opensmash). Pick a character from the roster or bring one over from [smash.fun](https://smash.fun), and play with a familiar Melee moveset.

**This is an alpha build.** Expect bugs, unfinished features, and performance issues. Some characters may look or move strangely, and larger matches can slow down.

## Download

Choose your platform, then download the matching archive from the release's **Assets** section. Extract it before opening OpenSmash Melee.

| Platform | Releases | File to choose |
| --- | --- | --- |
| Windows (64-bit) | [Download for Windows](https://github.com/turtlesoupy/opensmash-melee/releases) | `OpenSmash-Melee-…-win-x64.zip` |
| macOS (Apple Silicon) | [Download for Apple Silicon](https://github.com/turtlesoupy/opensmash-melee/releases) | `OpenSmash-Melee-…-mac-arm64.zip` |
| macOS (Intel) | [Download for Intel Mac](https://github.com/turtlesoupy/opensmash-melee/releases) | `OpenSmash-Melee-…-mac-x64.zip` |
| Linux (64-bit) | [Download for Linux](https://github.com/turtlesoupy/opensmash-melee/releases) | `OpenSmash-Melee-…-linux-x64.tar.gz` |

Availability varies by release; check its notes for platform requirements and known issues.

## Getting started

You'll need your own **unmodified Super Smash Bros. Melee USA 1.02 disc image** in ISO or GCM format. RVZ, NKit, and patched images aren't supported. No game disc is included.

1. Open OpenSmash Melee and choose your disc image when prompted. Setup stays on your computer and leaves the original image unchanged.
2. Wait for setup to finish, then pick a fighter from the roster.
3. Pick a fighter to face a random Melee fighter and two random custom characters. Open **Settings** to choose your opponents, stage, match rules, and controllers. Open **Controls** to see the button mappings light up as you press them, and to rebind keys or gamepad buttons.

Custom fighters use the moves of Mario, Luigi, Captain Falcon, Fox, Marth, or Link. You can jump into a match or use Settings to start from Melee's menus.

## Bring your own character

Create a character on [smash.fun](https://smash.fun). In its download panel, choose **Copy Melee import URL**. Open **Create** in OpenSmash Melee, paste the link, and choose a Melee moveset. Your character appears in the roster when the import finishes.

## How it works

A short tour for the curious. None of this is required to play.

**The game runs as recompiled code, not in an emulator.** At setup, the `main.dol` executable from your disc image is run through a PowerPC static recompiler that turns the game's machine code into a native module (or WebAssembly for the browser build). Around that module sits a host layer that stands in for the rest of the GameCube: a GX-to-OpenGL/WebGL renderer, DSP audio, controller input, and a virtual disc that serves files from the extracted image. That host layer is built from Dolphin's own video, audio, and hardware subsystems, trimmed down and embedded as a library, with Dolphin's PowerPC interpreter swapped out for the recompiled code. So this is not a source port in the style of the Zelda and Mario decomp ports. It is closer to the N64 recompilation projects: the original game binary, translated ahead of time, running inside a slimmed emulator core. We also use full Dolphin during development to record parity captures and check that our output matches frame for frame.

**Your disc is never modified.** Setup verifies that the image is an unmodified USA 1.02 copy, extracts its filesystem into a local folder, and hashes every file. Custom fighters are swapped into that folder as costume files, padded to fixed sizes so the file table stays stable, and small runtime mods hook into the game to route scenes and drive the expanded character select screen.

**Custom fighters are costumes on Melee skeletons.** An import fetches the rigged model and art from smash.fun, conforms the mesh onto the chosen fighter's skeleton using the game's own bind matrices, repairs hands and feet, bakes textures into a single atlas, and writes a genuine DAT costume file. Physics, hitboxes, and animations are untouched Melee data, which is why every custom fighter borrows one of six movesets.

**Making it fast took some surgery.** Off the shelf, the recompiled game ran at around 33 FPS with a few hundred GPU draw batches per character, so skinning was rewritten to run in one batch on the GPU and validated live against the original matrix routines. Startup dropped from nearly half a minute to about four seconds with a bulk file manifest and a pre-booted engine that waits in the background. On macOS and Windows the desktop app now defaults to a JIT backend, since the static path lost frames after a few seconds of four-player play while the JIT held steady at 60. Several rendering bugs, including double-dimmed lighting and menus that went blank because WebGL lacks depth clamping, needed fixes in the renderer.

**The desktop app is a shell around the native engine.** Electron hosts the same launcher UI as the web build and a bundled Python service handles setup and imports. The engine renders natively and its frames are shared into the window through IOSurface on macOS or shared memory elsewhere.

The [doldecomp/melee](https://github.com/doldecomp/melee) project was essential even though it isn't the runtime: it provides the disc extraction tooling, the file format knowledge, and the addresses our mods hook into.

## Feedback

Found a bug? [Open an issue](https://github.com/turtlesoupy/opensmash-melee/issues) with your platform, app version, and what happened. Screenshots or a short clip help, especially for character glitches.

Join the [OpenSmash Discord](https://discord.gg/qYBbGmwBhr) to share characters and talk about the alpha.

## Credits

Made by the team behind [OpenSmash](https://github.com/turtlesoupy/opensmash), with thanks to [doldecomp/melee](https://github.com/doldecomp/melee) and the Melee community.
