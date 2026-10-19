/**
 * Roster resolution: which units a given faction may recruit in a given year.
 *
 * A unit is available when
 *   - it names the faction explicitly in `factions`, or
 *   - it has no `factions` restriction and one of its `pools` matches the
 *     faction's culture or one of its roster tags,
 * and the year falls inside the unit's `fromYear`..`untilYear` window.
 *
 * The pseudo-pool `universal_settled` matches every faction that is not a
 * nomadic horde: peasant levies and town militia exist wherever there are
 * towns to levy them from.
 */
import type { Faction } from './factions';
import { UNIT_TYPES } from './units';
import type { UnitType, UnitClass } from '../types';
import { UNIT_ROLE } from '../types';

const UNIVERSAL_SETTLED = 'universal_settled';

/** Cultures with no settled towns of their own at campaign start. */
const NOMADIC_CULTURES = new Set(['steppe']);

function poolsFor(faction: Faction): ReadonlySet<string> {
  const pools = new Set<string>([faction.culture, ...faction.rosterTags]);
  // Nomadic cultures raise no town militia of their own. A few steppe states
  // (Volga Bulgaria, the Crimean Khanate) were genuinely urbanised and carry
  // the explicit `settled` tag to opt back in.
  const settled = !NOMADIC_CULTURES.has(faction.culture) || faction.rosterTags.includes('settled');
  if (settled) pools.add(UNIVERSAL_SETTLED);
  return pools;
}

function inEra(unit: UnitType, year: number): boolean {
  if (unit.fromYear !== undefined && year < unit.fromYear) return false;
  if (unit.untilYear !== undefined && year > unit.untilYear) return false;
  return true;
}

/** Is this a hull rather than a regiment? */
export function isShip(unit: UnitType): boolean {
  return unit.unitClass === 'warship' || unit.unitClass === 'transport';
}

/** Every unit type the faction could ever recruit, ignoring the year. */
export function fullRoster(faction: Faction): readonly UnitType[] {
  const pools = poolsFor(faction);
  return UNIT_TYPES.filter((unit) => {
    if (unit.factions) return unit.factions.includes(faction.id);
    return unit.pools.some((pool) => pools.has(pool));
  });
}

/** The units the faction may recruit in the given campaign year. */
export function rosterFor(faction: Faction, year: number): readonly UnitType[] {
  return fullRoster(faction).filter((unit) => inEra(unit, year));
}

/** The land regiments the faction may raise in the given year. */
export function landRosterFor(faction: Faction, year: number): readonly UnitType[] {
  return rosterFor(faction, year).filter((unit) => !isShip(unit));
}

/** The ships the faction may build in the given year. */
export function navalRosterFor(faction: Faction, year: number): readonly UnitType[] {
  return rosterFor(faction, year).filter(isShip);
}

/** The faction's general bodyguard unit. */
export function generalUnitFor(faction: Faction): UnitType {
  const general = fullRoster(faction).find((unit) => unit.unitClass === 'general');
  if (!general) throw new Error(`Faction ${faction.id} has no general bodyguard unit`);
  return general;
}

export type RosterRole = 'melee' | 'missile' | 'cavalry' | 'siege';

/** Groups a roster by battlefield role, for the AI and the recruitment UI. */
export function rosterByRole(
  units: readonly UnitType[],
): Readonly<Record<RosterRole, readonly UnitType[]>> {
  const groups: Record<RosterRole, UnitType[]> = {
    melee: [],
    missile: [],
    cavalry: [],
    siege: [],
  };
  for (const unit of units) {
    // Generals are not a line of battle, and ships are not an army at all:
    // counting a galley as melee would hide a faction with no infantry.
    if (unit.unitClass === 'general' || isShip(unit)) continue;
    groups[UNIT_ROLE[unit.unitClass]].push(unit);
  }
  return groups;
}

/** Counts how many distinct unit classes a roster covers, as a variety metric. */
export function rosterClasses(units: readonly UnitType[]): ReadonlySet<UnitClass> {
  return new Set(units.map((unit) => unit.unitClass));
}
