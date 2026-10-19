/**
 * How an army forms up.
 *
 * A line of battle is continuous: regiments stand shoulder to shoulder, the
 * wings are on the ends of the centre rather than off on their own, and the
 * whole thing is on the field. These are the properties the renderer relies
 * on to draw a line that looks like a line, and the ones the simulation
 * relies on for flanking to mean anything.
 */
import { describe, it, expect } from 'vitest';
import { buildBattle } from '../src/core/battle/setup';
import type { SideComposition } from '../src/core/battle/setup';
import { frontageOf } from '../src/core/battle/sim';
import type { Army, Regiment } from '../src/core/campaign/state';
import { armyId, factionId, regionId, unitTypeId, UNIT_ROLE } from '../src/core/types';
import { getUnitType } from '../src/core/data/units';
import { FIELD_WIDTH } from '../src/core/battle/types';

function regiment(type: string): Regiment {
  const unit = getUnitType(unitTypeId(type));
  return { type: unit.id, soldiers: unit.soldiers, experience: 0 };
}

let serial = 0;
function side(faction: string, types: readonly string[]): SideComposition {
  serial += 1;
  const host: Army = {
    id: armyId(`deploy-${serial}`),
    faction: factionId(faction),
    location: regionId('knin'),
    regiments: types.map(regiment),
    general: undefined,
    movement: 3,
    embarked: false,
  };
  return { faction: factionId(faction), armies: [host], fleets: [], garrison: [], command: 0 };
}

const LINE = [
  'town_militia', 'peasant_levy', 'armoured_sergeants', 'armoured_sergeants',
  'halberdiers', 'crossbow_militia', 'levy_archers', 'mailed_knights', 'mailed_knights',
];

function deploy(types: readonly string[] = LINE) {
  return buildBattle({
    seed: 'deployment-test',
    terrain: 'plains',
    isWinter: false,
    attacker: side('france', types),
    defender: side('hre', types),
  });
}

describe('deployment', () => {
  it('keeps every regiment on the field', () => {
    for (const unit of deploy().units) {
      expect(unit.position.x).toBeGreaterThanOrEqual(0);
      expect(unit.position.x).toBeLessThanOrEqual(FIELD_WIDTH);
    }
  });

  it('forms the centre as a continuous line rather than a row of islands', () => {
    const units = deploy().units.filter((unit) => unit.side === 'attacker');
    // The foot of the centre: everything that is neither cavalry nor missile.
    const centre = units
      .filter((unit) => {
        const type = getUnitType(unit.type);
        return UNIT_ROLE[type.unitClass] === 'melee' && type.unitClass !== 'general';
      })
      .sort((a, b) => a.position.x - b.position.x);
    expect(centre.length).toBeGreaterThan(2);

    for (let i = 1; i < centre.length; i++) {
      const left = centre[i - 1]!;
      const right = centre[i]!;
      const gap =
        right.position.x -
        frontageOf(right.type, right.soldiers) / 2 -
        (left.position.x + frontageOf(left.type, left.soldiers) / 2);
      // Touching, give or take the interval the drill leaves between files.
      expect(gap).toBeGreaterThanOrEqual(-1);
      expect(gap).toBeLessThan(20);
    }
  });

  it('posts the wings on the flanks of the centre, not across the county', () => {
    const units = deploy().units.filter((unit) => unit.side === 'attacker');
    const horse = units.filter((unit) => {
      const type = getUnitType(unit.type);
      return UNIT_ROLE[type.unitClass] === 'cavalry' && type.unitClass !== 'general';
    });
    const foot = units.filter((unit) => UNIT_ROLE[getUnitType(unit.type).unitClass] === 'melee');
    expect(horse.length).toBeGreaterThan(0);

    const left = Math.min(...foot.map((unit) => unit.position.x));
    const right = Math.max(...foot.map((unit) => unit.position.x));
    for (const rider of horse) {
      const distance =
        rider.position.x < left
          ? left - rider.position.x
          : rider.position.x > right
            ? rider.position.x - right
            : 0;
      expect(distance).toBeLessThan(220);
    }
  });

  it('squeezes rather than marching off the field when the host is too wide', () => {
    const huge = Array.from({ length: 20 }, () => 'armoured_sergeants');
    for (const unit of deploy(huge).units) {
      expect(unit.position.x).toBeGreaterThan(0);
      expect(unit.position.x).toBeLessThan(FIELD_WIDTH);
    }
  });

  it('gives the two sides the same frontage for the same order of battle', () => {
    const units = deploy().units;
    const span = (which: 'attacker' | 'defender'): number => {
      const xs = units.filter((unit) => unit.side === which).map((unit) => unit.position.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(Math.abs(span('attacker') - span('defender'))).toBeLessThan(1);
  });
});
