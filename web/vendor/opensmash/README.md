# Original Smash.fun presentation

Copied from `turtlesoupy/opensmash`, `web-prototype/`, local checkout at
`419d195` (September 9, 2026). This is the starting point for the Melee page,
rather than a separate approximation of the design.

- `site-shell.css`: original `visual/site-shell.css`; only font/stone URLs changed.
- `social.css`: original social navigation rules from `src/styles.css`.
- `roster-caption.js`, `roster-layout.js`: original shared modules; metrics import relocated. Caption expansion is
  also copied from `visual/grid-replica.js`.
- `smash-caption-metrics.js`: original font metrics, unchanged.
- `roster-rules.js`: original pure border sampling/rendering functions extracted
  from `visual/grid-replica.js`, with constants and exports; no pixel changes.
- `../../lib/roster-order.json`: slug order from `config/characters.json`.
- Search texture/icon and original caption fonts are in `../../public/brand/`.

`app/RosterGrid.tsx` binds those rendering primitives to the Melee roster.
`app/melee-shell.css` contains the Melee-specific adapters. Keep upstream
presentation updates here distinguishable from those adapters.

The original N64 launch runtime, 3D glove, animated logo and CRT compositor are
not loaded. The shared introduction trailer is embedded credentiallessly so
that Melee keeps cross-origin isolation. Selecting a fighter unmounts the trailer
and pauses roster decoration; it starts a human-controlled Melee session in the
same frame. Settings retain all five launch modes and all four player ports.
The original Create cell is currently a functional Random cell: the Melee
picker imports characters from the OpenSmash pipeline, and does not implement
the original hosted character-generation/account service.
