# Shared desktop launcher

The React launcher in `web/` serves both browser and desktop. `desktop/main.cjs`
is a thin Electron shell: a native disc picker, an isolated renderer, and process
lifetime management. The local Python service owns ISO verification, conversions,
and launching the game. No platform-specific UI is needed for roster or mode edits.

## Frequent launcher changes

Install `desktop/requirements.txt`, run `npm --prefix web ci` and
`npm --prefix desktop ci`, and prepare the versioned runtime and character inputs
once with `tools/prepare_desktop_release.py`. Then run:

```sh
python tools/dev_desktop.py
```

This refreshes the shared UI and application code without rebuilding the engine
or freezing Python. Rerun it after code changes. Development and packaged desktop
use the same service and launch protocol. User assets, converted characters, and
saves live in Electron's per-user application-data directory, separate from app
resources. Replacing an app does not overwrite those folders.

## Build layers

- `desktop-runtime.yml`: manually builds the native engine, generated game module,
  extraction tool and controller helper for macOS Apple Silicon/Intel, Windows
  x64 and Linux x64. Its private `desktop-runtime-v1` release is the engine cache.
- `desktop-characters-v1`: one shared generated character source library. It
  includes 1,063 complete entries; four incomplete local entries are excluded.
  It excludes original source photos and prompts.
- `desktop-app.yml`: on launcher changes, downloads those two versioned inputs,
  builds React, freezes the service, and packages native apps. It never compiles
  the engine. Artifacts remain private and are retained for 30 days.

Increment the runtime tag when changing native code or the protocol. Increment
the character-library tag when publishing a new source library. UI changes only
need the app workflow. Update `desktop/package.json` for release versions.

## Disc and release checks

No ISO or extracted game filesystem is bundled. On first launch, select a full
Melee USA 1.02 ISO/GCM. The service checks the complete disc hash before extraction
and verifies its saved asset receipt on subsequent launches. Native game modules
and internal compiler inputs contain game-derived code; private build inputs are
not a public source distribution.

macOS archives are currently unsigned/ad-hoc development builds; Windows archives
are unsigned. Signing/notarization credentials are a separate release step.
Linux targets x64 on Ubuntu 24.04-compatible systems. A successful CI build is not
proof of gameplay on Windows or Linux; record platform smoke tests before calling
those platforms release-validated. The first native run also asks Melee to create
its local memory-card save; accept that once in the game window.

## Validation recorded during development

The Apple Silicon packaged app passed clean-profile ISO gating, invalid-disc
rejection and local-session authentication checks. The shared launcher reached
Classic selection and custom-character combat at approximately 60 FPS. A four
custom-character lineup also reached 180 combat frames. Large lineups use the
existing 256-pixel texture budget and shared host skinning to stay within Melee's
preload memory limits. Mode preferences are stored outside the changing service
origin and survive app restarts.

The common launcher currently exposes the web roster's six standard retarget
families. The earlier macOS picker and its separately built experimental retarget
variants remain in the repository; those experimental variant controls have not
yet been moved into the shared launcher.
