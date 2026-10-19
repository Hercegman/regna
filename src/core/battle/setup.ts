/**
 * Deployment: turning campaign armies into a battle.
 *
 * Both sides are drawn up the way a medieval commander would: heavy foot in the
 * centre, missile troops behind them, cavalry on the wings, engines at the back
 * and the general with the reserve. The player can redeploy before the battle
 * begins; the AI fights from this arrangement.
 */
import type { FactionId, Terrain, UnitTypeId, WallTier } from '../types';
import { UNIT_ROLE } from '../types';
import { getUnitType } from '../data/units';
import type { Army, Fleet, Regiment } from '../campaign/state';
import type { BattleSetup, BattleUnit, Side } from './types';
import { FIELD_DEPTH, FIELD_WIDTH } from './types';

export interface SideComposition {
  readonly faction: FactionId;
  /** Field armies taking part, in order. */
  readonly armies: readonly Army[];
  /** Fleets taking part. Their hulls fight; their cargo does not. */
  readonly fleets: readonly Fleet[];
  /** Garrison regiments taking part, for an assault on a settlement. */
  readonly garrison: readonly Regiment[];
  /** Command rating of the general or admiral present, 0 when none is. */
  readonly command: number;
}

export interface BattleParams {
  readonly seed: string;
  readonly terrain: Terrain;
  readonly isWinter: boolean;
  readonly attacker: SideComposition;
  readonly defender: SideComposition;
  /** Set for an assault on a walled settlement. */
  readonly walls?: WallTier;
}

/** The front line each side forms up on. */
const DEFENDER_LINE = FIELD_DEPTH * 0.28;
const ATTACKER_LINE = FIELD_DEPTH * 0.78;

export interface Slot {
  readonly regiment: Regiment;
  readonly source: 'army' | 'garrison' | 'fleet';
  readonly sourceIndex: number;
}

/** The regiments of a side, in the exact order deployment indexes them. */
export function flattenSide(side: SideComposition): Slot[] {
  const slots: Slot[] = [];
  let armyIndex = 0;
  for (const army of side.armies) {
    for (const regiment of army.regiments) {
      if (regiment.soldiers <= 0) continue;
      slots.push({ regiment, source: 'army', sourceIndex: armyIndex });
      armyIndex += 1;
    }
  }
  let fleetIndex = 0;
  for (const fleet of side.fleets) {
    for (const ship of fleet.ships) {
      if (ship.soldiers <= 0) continue;
      slots.push({ regiment: ship, source: 'fleet', sourceIndex: fleetIndex });
      fleetIndex += 1;
    }
  }
  let garrisonIndex = 0;
  for (const regiment of side.garrison) {
    if (regiment.soldiers <= 0) continue;
    slots.push({ regiment, source: 'garrison', sourceIndex: garrisonIndex });
    garrisonIndex += 1;
  }
  return slots;
}

type Lane = 'centre' | 'rear' | 'left' | 'right' | 'reserve';

function laneFor(type: UnitTypeId, ordinal: number): Lane {
  const unit = getUnitType(type);
  if (unit.unitClass === 'general') return 'reserve';
  // At sea the fighting hulls form the line and the carriers stay behind it.
  if (unit.unitClass === 'warship') return 'centre';
  if (unit.unitClass === 'transport') return 'rear';
  const role = UNIT_ROLE[unit.unitClass];
  if (role === 'siege') return 'rear';
  if (role === 'missile') return 'rear';
  if (role === 'cavalry') return ordinal % 2 === 0 ? 'left' : 'right';
  return 'centre';
}

function isAfloat(type: UnitTypeId): boolean {
  const unit = getUnitType(type);
  return unit.unitClass === 'warship' || unit.unitClass === 'transport';
}

function deploySide(side: SideComposition, which: Side): BattleUnit[] {
  const slots = flattenSide(side);
  const lanes: Record<Lane, Slot[]> = { centre: [], rear: [], left: [], right: [], reserve: [] };
  let cavalryOrdinal = 0;
  for (const slot of slots) {
    const unit = getUnitType(slot.regiment.type);
    const lane =
      UNIT_ROLE[unit.unitClass] === 'cavalry' && unit.unitClass !== 'general'
        ? laneFor(slot.regiment.type, cavalryOrdinal++)
        : laneFor(slot.regiment.type, 0);
    lanes[lane].push(slot);
  }

  const frontY = which === 'defender' ? DEFENDER_LINE : ATTACKER_LINE;
  // The defender faces towards increasing y, the attacker towards decreasing y.
  const facing = which === 'defender' ? Math.PI / 2 : -Math.PI / 2;
  const depthSign = which === 'defender' ? -1 : 1;

  const units: BattleUnit[] = [];
  let serial = 0;
  const place = (slot: Slot, x: number, y: number): void => {
    const type = getUnitType(slot.regiment.type);
    serial += 1;
    units.push({
      id: `${which}-${serial}`,
      side: which,
      faction: side.faction,
      type: slot.regiment.type,
      source: slot.source,
      sourceIndex: slot.sourceIndex,
      soldiers: slot.regiment.soldiers,
      startingSoldiers: slot.regiment.soldiers,
      experience: slot.regiment.experience,
      position: {
        x: Math.max(40, Math.min(FIELD_WIDTH - 40, x)),
        y: Math.max(20, Math.min(FIELD_DEPTH - 20, y)),
      },
      facing,
      width: Math.max(6, type.soldiers / 3),
      stance: 'forming',
      order: { kind: 'hold' },
      shock: 0,
      fatigue: 0,
      ammunition: type.ammunition,
      chargeTicks: 0,
      meleeTicks: 0,
      engagedWith: [],
      fled: false,
    });
  };

  // A fleet forms line abreast across most of the water, because there is no
  // flank to refuse and no ground worth holding: sea room is the whole of it.
  const afloat = slots.length > 0 && slots.every((slot) => isAfloat(slot.regiment.type));
  const centreFrom = afloat ? FIELD_WIDTH * 0.12 : FIELD_WIDTH * 0.32;
  const centreTo = afloat ? FIELD_WIDTH * 0.88 : FIELD_WIDTH * 0.68;

  // Centre: an even line across the middle third of the field.
  spread(lanes.centre, centreFrom, centreTo, (slot, x) => place(slot, x, frontY));
  // Second line: missiles and engines behind the centre.
  spread(lanes.rear, FIELD_WIDTH * 0.34, FIELD_WIDTH * 0.66, (slot, x) =>
    place(slot, x, frontY + depthSign * 70),
  );
  // Wings.
  spread(lanes.left, FIELD_WIDTH * 0.08, FIELD_WIDTH * 0.26, (slot, x) =>
    place(slot, x, frontY + depthSign * 30),
  );
  spread(lanes.right, FIELD_WIDTH * 0.74, FIELD_WIDTH * 0.92, (slot, x) =>
    place(slot, x, frontY + depthSign * 30),
  );
  // The general and his retinue sit behind everything.
  spread(lanes.reserve, FIELD_WIDTH * 0.45, FIELD_WIDTH * 0.55, (slot, x) =>
    place(slot, x, frontY + depthSign * 130),
  );

  return units;
}

function spread(
  slots: readonly Slot[],
  from: number,
  to: number,
  place: (slot: Slot, x: number) => void,
): void {
  if (slots.length === 0) return;
  if (slots.length === 1) {
    place(slots[0]!, (from + to) / 2);
    return;
  }
  const step = (to - from) / (slots.length - 1);
  slots.forEach((slot, index) => place(slot, from + step * index));
}

export function buildBattle(params: BattleParams): BattleSetup {
  const attackerUnits = deploySide(params.attacker, 'attacker');
  const defenderUnits = deploySide(params.defender, 'defender');
  return {
    seed: params.seed,
    terrain: params.terrain,
    settlement:
      params.walls && params.walls !== 'none'
        ? {
            walls: params.walls,
            centre: { x: FIELD_WIDTH / 2, y: DEFENDER_LINE - 90 },
            radius: 150,
            integrity: 1,
          }
        : undefined,
    attacker: params.attacker.faction,
    defender: params.defender.faction,
    units: [...attackerUnits, ...defenderUnits],
    attackerCommand: params.attacker.command,
    defenderCommand: params.defender.command,
    isWinter: params.isWinter,
  };
}
