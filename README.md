# Regna: Age of Kingdoms

An original turn-based grand strategy game with real-time battles, set in Europe,
the Mediterranean and the Near East between 1080 and 1530.

It is written from scratch in TypeScript. It is not a port, a decompilation or a
reimplementation of any existing game: no commercial binary was disassembled and
no third-party game data, art or text is included. The genre is the inspiration;
the code, the data and the prose are this project's own.

## Design goals

- **73 historical factions**, every one a real polity, against the 21 of the
  genre's best-known entry. Polities that did not exist in 1080 enter play in
  their own year rather than being backdated.
- **Deterministic core.** `src/core/` contains no DOM access and never calls
  `Math.random`. The same seed and the same orders always produce the same
  campaign and the same battle, which makes the simulation testable and makes
  replays and lockstep multiplayer possible.
- **Data over special cases.** Factions, units, buildings and regions are tables.
  Balance work means editing numbers, not branching logic.
- **Tested history.** The data layer has tests that assert every faction can
  field a coherent army and that documented historical exceptions stay
  documented.

## Layout

```
src/core/      simulation: deterministic, no DOM
  data/        factions, units, buildings, regions
  campaign/    turn loop, economy, recruitment, diplomacy, AI
  battle/      real-time battle resolution
src/render/    canvas drawing
src/ui/        screens and panels
tests/         vitest suites
```

## Development

```
npm install
npm test          # vitest
npm run typecheck # tsc --noEmit, strict
npm run dev       # vite dev server
```
