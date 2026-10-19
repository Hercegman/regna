/**
 * The shared definition helper for everything that fights.
 *
 * Land regiments and ships are the same kind of thing to the battle
 * simulation: a block of men with an attack, a defence, a morale and possibly
 * a bow. Keeping one builder for both means a sea fight runs the same code as
 * a land one instead of a parallel set of rules that can drift from it.
 */
import type { UnitAbility, UnitClass, UnitType } from '../types';
import { unitTypeId, factionId, buildingId } from '../types';

export type UnitSpec = {
  id: string;
  name: string;
  unitClass: UnitClass;
  tier: 1 | 2 | 3 | 4 | 5;
  soldiers?: number;
  attack: number;
  charge?: number;
  defence: number;
  armour: number;
  shield?: number;
  morale: number;
  discipline?: number;
  speed?: number;
  range?: number;
  missileAttack?: number;
  ammunition?: number;
  mounted?: boolean;
  abilities?: readonly UnitAbility[];
  cost: number;
  upkeep?: number;
  minSettlement?: UnitType['minSettlement'];
  requires?: string;
  capacity?: number;
  waters?: 'river' | 'sea' | 'any';
  mercenary?: boolean;
  pools: readonly string[];
  factions?: readonly string[];
  fromYear?: number;
  untilYear?: number;
  description: string;
};

/**
 * Fills in the derived and defaulted fields. Upkeep defaults to a fixed
 * fraction of cost so that the economy stays predictable when units are added.
 */
export function defineUnit(spec: UnitSpec): UnitType {
  const mounted = spec.mounted ?? false;
  const afloat = spec.unitClass === 'warship' || spec.unitClass === 'transport';
  const soldiers = spec.soldiers ?? (mounted ? 40 : 120);
  const base: UnitType = {
    id: unitTypeId(spec.id),
    name: spec.name,
    unitClass: spec.unitClass,
    tier: spec.tier,
    soldiers,
    attack: spec.attack,
    charge: spec.charge ?? (mounted ? 6 : afloat ? 0 : 2),
    defence: spec.defence,
    armour: spec.armour,
    shield: spec.shield ?? 0,
    morale: spec.morale,
    discipline: spec.discipline ?? 10,
    speed: spec.speed ?? (mounted ? 4.2 : 1.3),
    range: spec.range ?? 0,
    missileAttack: spec.missileAttack ?? 0,
    ammunition: spec.ammunition ?? 0,
    mounted,
    abilities: spec.abilities ?? [],
    cost: spec.cost,
    upkeep: spec.upkeep ?? Math.round(spec.cost / 9),
    pools: spec.pools,
    description: spec.description,
  };
  // Optional properties are attached conditionally: exactOptionalPropertyTypes
  // forbids assigning an explicit undefined.
  return {
    ...base,
    ...(spec.minSettlement ? { minSettlement: spec.minSettlement } : {}),
    ...(spec.requires ? { requires: buildingId(spec.requires) } : {}),
    ...(spec.capacity !== undefined ? { capacity: spec.capacity } : {}),
    ...(spec.waters ? { waters: spec.waters } : {}),
    ...(spec.mercenary ? { mercenary: true } : {}),
    ...(spec.factions ? { factions: spec.factions.map(factionId) } : {}),
    ...(spec.fromYear !== undefined ? { fromYear: spec.fromYear } : {}),
    ...(spec.untilYear !== undefined ? { untilYear: spec.untilYear } : {}),
  };
}
