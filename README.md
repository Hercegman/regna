# Regna: Age of Kingdoms

A turn-based grand strategy game with real-time battles, set in Europe, the
Mediterranean and the Near East between 1080 and 1530.

It is written from scratch in TypeScript. It is not a port, a decompilation or
a reimplementation of any existing game: no commercial binary was disassembled,
and no third-party game data, art or text is included. The genre is the
inspiration; the code, the data and the prose are this project's own.

## What is in it

| | |
|---|---|
| Factions | 73, every one a real polity |
| Provinces | 222, each at its settlement's real coordinates |
| Unit types | 95, resolved to factions through recruitment pools |
| Buildings | 39, in 13 upgrade chains |
| Campaign | 1080 to 1530, two turns to the year |

Polities that did not exist in 1080 are not backdated onto the start map. They
enter play in their own year at their historical seat: the Teutonic Order in
1226, the Ottomans in 1299, Burgundy in 1363. The faction select screen shows
the year beside anything that cannot yet be played.

## Design

**Deterministic core.** `src/core/` contains no DOM access and never calls
`Math.random`. The same seed and the same orders always produce the same
campaign and the same battle. That makes the simulation testable, makes save
games exact, and leaves lockstep multiplayer possible later.

**One battle model.** The battle the player watches and the battle the campaign
resolves without them are the same simulation at the same timestep. There is no
separate auto-resolve formula, so the odds the player is shown are the odds that
actually apply.

**One order layer.** Every button in the interface calls the same function in
`src/core/campaign/actions.ts` that the AI calls. The AI cannot do anything the
player cannot, and anything it cannot do is a missing order rather than a cheat.

**Data over special cases.** Factions, units, buildings and provinces are
tables. Balance work means editing numbers in one file.

## Playing

```
npm install
npm run dev        # http://localhost:5173
```

Choose a faction, then: click a province to select it, drag to pan, scroll to
zoom, `L` to force every province name on. The panel on the right has the
province, its building and recruitment options, diplomacy and the state of the
realm. Select your army, press **March**, and click one of the highlighted
provinces. Moving into a defended enemy province offers battle, which you can
fight yourself or leave to your captains.

**Save** stores the campaign in the browser; **Export** downloads it as a file.
Both are offered again on the faction select screen.

## Development

```
npm test           # vitest, 117 tests
npm run typecheck  # tsc --noEmit, strict
npm run build      # typecheck then bundle
```

URL parameters open a known state without a sequence of clicks:
`?faction=croatia`, `?turns=60`, `?tab=realm`, `?demo=battle&play=1`.

## Layout

```
src/core/            simulation: deterministic, no DOM
  data/              factions, units, buildings, regions, adjacency
  campaign/          turn loop, economy, recruitment, diplomacy, AI, saves
  battle/            deployment, the tick simulation, battle AI, terrain
src/render/          projection, campaign map, battlefield
src/ui/              screens, panels, persistence
tests/               vitest suites
docs/                design notes
```

## Extending it

Adding a faction is one entry in `src/core/data/factions.ts` plus, if it enters
play after 1080, one line in `EMERGENCE_SEATS`. Adding a province is one row in
`regions.ts` and its borders in `adjacency.ts`. The tests will tell you if the
result is inconsistent: they assert that every faction can field melee, ranged,
cavalry and siege troops, that the map is fully reachable, that sea crossings
join two harbours, and that the island landmasses are exactly the expected ones.

See `docs/design.md` for how the simulation fits together and `docs/history.md`
for the historical decisions behind the data.
