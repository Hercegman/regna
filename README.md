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
| Sea zones | 35, from the Norwegian Sea to the Niger |
| Trade roads | 19, from the Silk Road to the English wool trade |
| Mercenary pools | 16, each in the country that bred the company |
| Unit types | 95 land, 14 ship classes, 8 hire-only companies |
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
`src/core/campaign/actions.ts` or `naval.ts` that the AI calls. The AI cannot do
anything the player cannot, and anything it cannot do is a missing order rather
than a cheat.

**Mercenaries are found, not raised.** A company exists in the country that
bred it, in limited numbers. Hiring one ignores your own roster entirely and
denies it to everyone else until the country furnishes another. It joins at
once, costs nearly twice a levy to keep, and is the first thing to leave when
the pay stops.

**Trade is a wager, not an allowance.** A trade road is an ordered path of real
provinces. Sending a caravan along one costs money now and pays more on
arrival, less a toll to every lord whose land it crosses. War shuts a road
rather than taxing it, and an army standing where a caravan stands takes the
whole cargo.

**Two layers to the map.** Provinces are the land and sea zones are the water.
A harbour opens onto one or more zones; fleets move from zone to zone. A
squadron standing between two harbours closes the trade along that lane and
stops an army crossing it, and shutting a harbour outright needs every approach
closed, which is why Constantinople with three seas in front of it is so much
harder to invest than Zadar with one.

**Data over special cases.** Factions, units, buildings and provinces are
tables. Balance work means editing numbers in one file.

## Playing

```
npm install
npm run dev        # http://localhost:5173
```

Choose a faction, then: click a province to select it, click open water to see
the fleets in it, drag to pan, scroll to zoom, `L` to force every province name
on. The panel on the right has the province, its building, recruitment and
shipbuilding options, diplomacy and the state of the realm.

Select your army, press **March**, and click one of the highlighted provinces.
Moving into a defended enemy province offers battle, which you can fight
yourself or leave to your captains.

At sea: lay down hulls at a harbour from the **Ships** tab, select the squadron
and press **Sail**, then click a water or a harbour. Load an army with
**Embark** and put it on a hostile coast with **Land at**. Sailing into water a
hostile squadron holds brings on a sea battle. Keep a fleet at sea through the
winter and the gales will take hulls from it.

Companies for hire appear on the **Province** panel wherever any are standing
about, including in towns you do not own. They join an army of yours in the
province if one is there, and the garrison otherwise.

On the roads: the **Trade** tab lists every trade road through the province,
what a caravan would cost and what it is expected to fetch, and sends one.
Press `T` to draw every road on the map. A road through a province you hold
pays you a toll whoever sent the caravan.

**Save** stores the campaign in the browser; **Export** downloads it as a file.
Both are offered again on the faction select screen.

## Development

```
npm test           # vitest, 199 tests
npm run typecheck  # tsc --noEmit, strict
npm run build      # typecheck then bundle
```

URL parameters open a known state without a sequence of clicks:
`?faction=croatia`, `?turns=60`, `?tab=trade`, `?demo=battle&play=1`,
`?demo=sea`.

## Layout

```
src/core/            simulation: deterministic, no DOM
  data/              factions, units, ships, mercenaries, buildings, regions,
                     adjacency, seas, trade roads
  campaign/          turn loop, economy, recruitment, diplomacy, navy, trade,
                     mercenaries, AI, saves
  battle/            deployment, the tick simulation, battle AI, terrain
src/render/          projection, campaign map, battlefield
src/ui/              screens, panels, persistence
tests/               vitest suites
docs/                design notes
```

## Extending it

Adding a faction is one entry in `src/core/data/factions.ts` plus, if it enters
play after 1080, one line in `EMERGENCE_SEATS`. Adding a province is one row in
`regions.ts` and its borders in `adjacency.ts`; if it has a harbour, add it to a
zone in `seas.ts`. The tests will tell you if the result is inconsistent: they
assert that every faction can field melee, ranged, cavalry and siege troops,
that the map is fully reachable, that sea crossings join two harbours, that the
island landmasses are exactly the expected ones, that every harbour has water to
sail into, that every trade road is contiguous, and that a hull is never found
in an army or on a town wall.

See `docs/design.md` for how the simulation fits together and `docs/history.md`
for the historical decisions behind the data.
