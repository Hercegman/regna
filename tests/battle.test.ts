import { describe, it, expect } from 'vitest';
import { runBattle, createBattle, stepBattle } from '../src/core/battle/sim';
import { buildBattle } from '../src/core/battle/setup';
import type { SideComposition } from '../src/core/battle/setup';
import type { Army, Regiment } from '../src/core/campaign/state';
import { armyId, factionId, regionId, unitTypeId } from '../src/core/types';
import { getUnitType } from '../src/core/data/units';
import { TICK, BATTLE_TIME_LIMIT } from '../src/core/battle/types';

function regiment(type: string, soldiers?: number, experience = 0): Regiment {
  const unit = getUnitType(unitTypeId(type));
  return { type: unit.id, soldiers: soldiers ?? unit.soldiers, experience };
}

let serial = 0;
function army(faction: string, regiments: Regiment[]): Army {
  serial += 1;
  return {
    id: armyId(`test-army-${serial}`),
    faction: factionId(faction),
    location: regionId('knin'),
    regiments,
    general: undefined,
    movement: 3,
    embarked: false,
  };
}

function side(faction: string, regiments: Regiment[], command = 0): SideComposition {
  return { faction: factionId(faction), armies: [army(faction, regiments)], fleets: [], garrison: [], command };
}

function battle(
  attacker: SideComposition,
  defender: SideComposition,
  options: { seed?: string; terrain?: 'plains' | 'hills' | 'forest' | 'marsh' | 'mountains' } = {},
) {
  return buildBattle({
    seed: options.seed ?? 'battle-test',
    terrain: options.terrain ?? 'plains',
    isWinter: false,
    // The weather is pinned here and tried in `weather.test.ts`. Left to the
    // seed, every test in this file would be measuring melee and missiles
    // through whatever sky that particular battle happened to roll — and one
    // of them did, silently, until a seed came up fog and the archers stopped
    // being able to see what they were shooting at.
    weather: 'clear',
    timeOfDay: 'day',
    attacker,
    defender,
  });
}

describe('battle simulation', () => {
  it('is deterministic for the same seed and forces', () => {
    const make = () =>
      battle(
        side('france', [regiment('feudal_knights'), regiment('armoured_sergeants')]),
        side('england', [regiment('longbowmen'), regiment('billmen')]),
      );
    const a = runBattle(make());
    const b = runBattle(make());
    expect(a.outcome).toBe(b.outcome);
    expect(a.attackerLosses).toBeCloseTo(b.attackerLosses, 6);
    expect(a.defenderLosses).toBeCloseTo(b.defenderLosses, 6);
    expect(a.duration).toBeCloseTo(b.duration, 6);
  });

  it('diverges for a different seed', () => {
    const one = runBattle(
      battle(
        side('france', [regiment('feudal_knights'), regiment('armoured_sergeants')]),
        side('england', [regiment('longbowmen'), regiment('billmen')]),
        { seed: 'alpha' },
      ),
    );
    const two = runBattle(
      battle(
        side('france', [regiment('feudal_knights'), regiment('armoured_sergeants')]),
        side('england', [regiment('longbowmen'), regiment('billmen')]),
        { seed: 'omega' },
      ),
    );
    // The same forces may well produce the same winner; the detail must differ.
    expect(
      one.attackerLosses !== two.attackerLosses || one.duration !== two.duration,
    ).toBe(true);
  });

  it('always terminates and reports finite numbers', () => {
    const result = runBattle(
      battle(
        side('hre', [regiment('imperial_spearmen'), regiment('crossbow_militia')]),
        side('poland', [regiment('slavic_levy'), regiment('slavic_axemen')]),
      ),
    );
    expect(Number.isFinite(result.duration)).toBe(true);
    expect(result.duration).toBeLessThanOrEqual(BATTLE_TIME_LIMIT + TICK);
    expect(Number.isFinite(result.attackerLosses)).toBe(true);
    expect(Number.isFinite(result.defenderLosses)).toBe(true);
    expect(result.attackerLosses).toBeGreaterThanOrEqual(0);
    expect(result.defenderLosses).toBeGreaterThanOrEqual(0);
    for (const unit of result.units) {
      expect(Number.isFinite(unit.soldiers)).toBe(true);
      expect(unit.soldiers).toBeGreaterThanOrEqual(0);
      expect(unit.soldiers).toBeLessThanOrEqual(unit.startingSoldiers);
      expect(Number.isFinite(unit.position.x)).toBe(true);
      expect(Number.isFinite(unit.position.y)).toBe(true);
    }
  });

  it('lets a much larger army win', () => {
    const big = side('hre', [
      regiment('gothic_knights'),
      regiment('gothic_knights'),
      regiment('zweihander'),
      regiment('zweihander'),
      regiment('crossbow_militia'),
      regiment('crossbow_militia'),
    ]);
    const small = side('ireland', [regiment('kerns'), regiment('peasant_levy')]);
    const result = runBattle(battle(big, small));
    expect(result.outcome).toBe('attacker');
    expect(result.defenderLosses).toBeGreaterThan(result.attackerLosses);
  });

  it('lets elite troops beat levies of the same number', () => {
    let eliteWins = 0;
    for (let i = 0; i < 6; i++) {
      const result = runBattle(
        battle(
          side('byzantium', [regiment('varangian_guard'), regiment('kataphraktoi')]),
          side('cumans', [regiment('peasant_levy'), regiment('peasant_levy')]),
          { seed: `elite-${i}` },
        ),
      );
      if (result.outcome === 'attacker') eliteWins += 1;
    }
    expect(eliteWins).toBeGreaterThanOrEqual(5);
  });

  it('makes pikemen a bad target for cavalry', () => {
    const cavalryVsPikes = runBattle(
      battle(
        side('france', [regiment('feudal_knights'), regiment('feudal_knights')]),
        side('switzerland', [regiment('swiss_pikemen'), regiment('swiss_pikemen')]),
        { seed: 'pikes' },
      ),
    );
    const cavalryVsArchers = runBattle(
      battle(
        side('france', [regiment('feudal_knights'), regiment('feudal_knights')]),
        side('england', [regiment('levy_archers'), regiment('levy_archers')]),
        { seed: 'pikes' },
      ),
    );
    // The same cavalry should fare measurably worse against the pike wall.
    const pikeLossRatio = cavalryVsPikes.attackerLosses / cavalryVsPikes.defenderLosses || 99;
    const archerLossRatio = cavalryVsArchers.attackerLosses / cavalryVsArchers.defenderLosses || 0;
    expect(pikeLossRatio).toBeGreaterThan(archerLossRatio);
  });

  it('gives missile troops the advantage at range before contact', () => {
    const state = createBattle(
      battle(
        side('hre', [regiment('imperial_spearmen')]),
        side('england', [regiment('longbowmen')]),
        { seed: 'volley' },
      ),
    );
    const spearmen = state.units.find((unit) => unit.side === 'attacker')!;
    const before = spearmen.soldiers;
    // The lines start 500 metres apart and the longbow reaches 190, so the
    // spearmen must march for several minutes before they are even shot at.
    // Run until contact and check they paid for the approach.
    for (let i = 0; i < 2000 && !state.finished && spearmen.stance !== 'melee'; i++) {
      stepBattle(state);
    }
    expect(spearmen.soldiers).toBeLessThan(before);
  });

  it('breaks a hopeless unit instead of fighting to the last man', () => {
    const result = runBattle(
      battle(
        side('mongols', [
          regiment('keshik'),
          regiment('keshik'),
          regiment('mongol_heavy_lancers'),
          regiment('mongol_heavy_lancers'),
        ]),
        side('ireland', [regiment('peasant_levy')]),
        { seed: 'rout' },
      ),
    );
    const levy = result.units.find((unit) => unit.side === 'defender')!;
    expect(['routing', 'destroyed']).toContain(levy.stance);
    // Most of a routed unit gets away rather than dying on the field.
    if (levy.stance === 'routing') expect(levy.soldiers).toBeGreaterThan(0);
  });

  it('spends ammunition and then stops shooting', () => {
    const state = createBattle(
      battle(
        side('england', [regiment('longbowmen')]),
        side('france', [regiment('french_men_at_arms')]),
        { seed: 'ammo' },
      ),
    );
    const archers = state.units.find((unit) => unit.side === 'attacker')!;
    const startingAmmo = archers.ammunition;
    expect(startingAmmo).toBeGreaterThan(0);
    for (let i = 0; i < 3000 && !state.finished; i++) stepBattle(state);
    expect(archers.ammunition).toBeLessThan(startingAmmo);
    expect(archers.ammunition).toBeGreaterThanOrEqual(0);
  });

  it('tires troops out as the battle goes on', () => {
    const state = createBattle(
      battle(
        side('hre', [regiment('armoured_sergeants')]),
        side('poland', [regiment('slavic_axemen')]),
        { seed: 'fatigue' },
      ),
    );
    for (let i = 0; i < 300 && !state.finished; i++) stepBattle(state);
    const anyTired = state.units.some((unit) => unit.fatigue > 0);
    expect(anyTired).toBe(true);
    for (const unit of state.units) expect(unit.fatigue).toBeLessThanOrEqual(1);
  });

  it('rewards the defender for holding high ground', () => {
    // What a ridge buys is a better exchange, not a cheaper battle: a fight
    // uphill takes longer and costs both sides more men in total. So the thing
    // to measure is how many of the enemy the defender takes with him, over
    // enough seeds that one unlucky melee cannot decide it.
    const exchange = (terrain: 'hills' | 'plains', seed: string): number => {
      const result = runBattle(
        battle(
          side('france', [regiment('feudal_knights'), regiment('armoured_sergeants')]),
          side('scotland', [regiment('highland_pikes'), regiment('kerns')]),
          { seed, terrain },
        ),
      );
      return result.attackerLosses / Math.max(1, result.defenderLosses);
    };

    const seeds = ['ground', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'];
    let better = 0;
    let hillsTotal = 0;
    let plainsTotal = 0;
    for (const seed of seeds) {
      const hills = exchange('hills', seed);
      const plains = exchange('plains', seed);
      hillsTotal += hills;
      plainsTotal += plains;
      if (hills > plains) better += 1;
    }
    expect(hillsTotal / seeds.length).toBeGreaterThan(plainsTotal / seeds.length);
    expect(better).toBeGreaterThanOrEqual(seeds.length * 0.75);
  });

  it('handles a battle where one side has nothing', () => {
    const result = runBattle(
      battle(side('france', [regiment('feudal_knights')]), side('england', [])),
    );
    expect(result.outcome).toBe('attacker');
    expect(result.defenderLosses).toBe(0);
  });
});
