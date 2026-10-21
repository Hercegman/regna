import { describe, it, expect } from 'vitest';
import { createBattle, runBattle, stepBattle } from '../src/core/battle/sim';
import { buildBattle } from '../src/core/battle/setup';
import type { SideComposition } from '../src/core/battle/setup';
import type { Army, Regiment } from '../src/core/campaign/state';
import { armyId, distance, factionId, regionId, unitTypeId } from '../src/core/types';
import type { WallTier } from '../src/core/types';
import { getUnitType } from '../src/core/data/units';

function regiment(type: string, experience = 1): Regiment {
  const unit = getUnitType(unitTypeId(type));
  return { type: unit.id, soldiers: unit.soldiers, experience };
}

let serial = 0;
function side(faction: string, types: readonly string[]): SideComposition {
  serial += 1;
  const army: Army = {
    id: armyId(`walls-${serial}`),
    faction: factionId(faction),
    location: regionId('knin'),
    regiments: types.map((type) => regiment(type)),
    general: undefined,
    movement: 3,
    embarked: false,
  };
  return { faction: factionId(faction), armies: [army], fleets: [], garrison: [], command: 0 };
}

/** Two to one against a small garrison, which is the interesting case. */
const STORMERS = [
  'imperial_spearmen', 'imperial_spearmen', 'armoured_sergeants',
  'halberdiers', 'crossbow_militia', 'mailed_knights',
];
const GARRISON = ['town_militia', 'town_militia', 'levy_archers'];

function assault(
  walls: WallTier | undefined,
  seed: string,
  options: { readonly engines?: boolean } = {},
) {
  return buildBattle({
    seed,
    terrain: 'plains',
    isWinter: false,
    weather: 'clear',
    timeOfDay: 'day',
    attacker: side('hre', options.engines ? [...STORMERS, 'trebuchet', 'trebuchet'] : STORMERS),
    defender: side('england', GARRISON),
    ...(walls ? { walls } : {}),
  });
}

function stormed(walls: WallTier | undefined, options: { readonly engines?: boolean } = {}): {
  readonly taken: number;
  readonly cost: number;
} {
  let taken = 0;
  let cost = 0;
  const runs = 24;
  for (let i = 0; i < runs; i++) {
    const result = runBattle(assault(walls, `storm-${walls}-${i}`, options));
    if (result.outcome === 'attacker') taken += 1;
    cost += result.attackerLosses;
  }
  return { taken: taken / runs, cost: cost / runs };
}

describe('walls', () => {
  it('forms the garrison inside them rather than in a line across the field', () => {
    const state = createBattle(assault('stone', 'inside'));
    const works = state.settlement!;
    for (const unit of state.units) {
      if (unit.side !== 'defender') continue;
      expect(distance(unit.position, works.centre)).toBeLessThanOrEqual(works.radius);
    }
    // And the besieger is outside them, which is the other half of it.
    for (const unit of state.units) {
      if (unit.side !== 'attacker') continue;
      expect(distance(unit.position, works.centre)).toBeGreaterThan(works.radius);
    }
  });

  it('decides an assault that numbers alone would win', () => {
    // Six regiments against three take the place every time in the open.
    const open = stormed(undefined);
    expect(open.taken).toBeGreaterThan(0.9);
    // Behind stone the same six cannot do it, which is the whole medieval
    // argument for building the wall.
    const stone = stormed('stone');
    expect(stone.taken).toBeLessThan(0.2);
  });

  it('costs the man coming over it', () => {
    expect(stormed('stone').cost).toBeGreaterThan(stormed(undefined).cost * 2);
  });

  it('is worth more the better it is built', () => {
    const wooden = stormed('wooden');
    const epic = stormed('epic');
    expect(epic.taken).toBeLessThanOrEqual(wooden.taken);
    expect(epic.cost).toBeGreaterThan(wooden.cost * 0.9);
  });

  it('comes down to a siege train, and to nothing else', () => {
    const bare = stormed('stone');
    const withEngines = stormed('stone', { engines: true });
    expect(withEngines.taken).toBeGreaterThan(bare.taken + 0.5);
  });

  it('is battered by engines and by nothing else', () => {
    const quiet = createBattle(assault('stone', 'intact'));
    for (let i = 0; i < 3000 && !quiet.finished; i++) stepBattle(quiet);
    // An army with no engines can stand in front of a stone town all day.
    expect(quiet.settlement!.integrity).toBe(1);

    const battering = createBattle(assault('stone', 'battered', { engines: true }));
    for (let i = 0; i < 3000 && !battering.finished; i++) stepBattle(battering);
    expect(battering.settlement!.integrity).toBeLessThan(0.36);
  });

  it('leaves the setup it was built from alone', () => {
    // The works are worn down over the assault, so the state keeps a copy:
    // without it the second run of a battle would start on a broken wall.
    const setup = assault('stone', 'copy', { engines: true });
    const first = createBattle(setup);
    for (let i = 0; i < 3000 && !first.finished; i++) stepBattle(first);
    expect(first.settlement!.integrity).toBeLessThan(1);
    expect(setup.settlement!.integrity).toBe(1);
    const second = createBattle(setup);
    expect(second.settlement!.integrity).toBe(1);
  });
});
