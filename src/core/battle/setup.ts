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
import { frontageOf } from './sim';

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
  /** True when this is a fight between fleets. */
  readonly naval?: boolean;
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

  // A fleet forms line abreast with sea room between the hulls, because there
  // is no flank to refuse and no ground worth holding.
  const afloat = slots.length > 0 && slots.every((slot) => isAfloat(slot.regiment.type));
  const middle = FIELD_WIDTH / 2;

  // The centre forms first and the rest of the army is laid out against it,
  // so that the line is one line and the wings are on it rather than off on
  // their own somewhere.
  const centre = line(lanes.centre, middle, 'centre', afloat ? 70 : INTERVAL, (slot, x) =>
    place(slot, x, frontY),
  );
  // The second line: missiles and engines behind the centre.
  line(lanes.rear, middle, 'centre', INTERVAL, (slot, x) =>
    place(slot, x, frontY + depthSign * 70),
  );
  // The wings, posted on either flank of the centre and drawn up a little
  // forward of it, which is where a wing goes when it means to turn a flank.
  line(lanes.left, centre.from - WING_GAP, 'end', INTERVAL, (slot, x) =>
    place(slot, x, frontY + depthSign * 30),
  );
  line(lanes.right, centre.to + WING_GAP, 'start', INTERVAL, (slot, x) =>
    place(slot, x, frontY + depthSign * 30),
  );
  // The general and his retinue sit behind everything.
  line(lanes.reserve, middle, 'centre', INTERVAL, (slot, x) =>
    place(slot, x, frontY + depthSign * 130),
  );

  return units;
}

/** The interval left between neighbouring regiments in a line, in metres. */
const INTERVAL = 10;

/** The ground left between the centre and a wing, in metres. */
const WING_GAP = 45;

/** Where a formed line begins and ends, in metres along the field. */
interface Extent {
  readonly from: number;
  readonly to: number;
}

/**
 * Forms a line of regiments and reports the ground it covers.
 *
 * Regiments stand shoulder to shoulder, each taking up the ground its own
 * numbers need, with a short interval between them. A line of battle is
 * continuous: gaps in it are an invitation, and a commander who leaves them
 * loses. `anchor` is the middle, the left end or the right end of the line
 * depending on `align`, and the whole is shifted back onto the field if it
 * would otherwise form off the edge of it.
 */
function line(
  slots: readonly Slot[],
  anchor: number,
  align: 'centre' | 'start' | 'end',
  interval: number,
  place: (slot: Slot, x: number) => void,
): Extent {
  if (slots.length === 0) return { from: anchor, to: anchor };

  const widths = slots.map((slot) => frontageOf(slot.regiment.type, slot.regiment.soldiers));
  const span = widths.reduce((sum, width) => sum + width, 0) + interval * (slots.length - 1);

  const EDGE = 40;
  let from = align === 'centre' ? anchor - span / 2 : align === 'start' ? anchor : anchor - span;
  // A line too wide for the field is packed tighter rather than hanging off it.
  const room = FIELD_WIDTH - EDGE * 2;
  if (span > room) {
    const squeeze = room / span;
    let x = EDGE;
    slots.forEach((slot, index) => {
      const width = widths[index]! * squeeze;
      place(slot, x + width / 2);
      x += width + interval * squeeze;
    });
    return { from: EDGE, to: FIELD_WIDTH - EDGE };
  }
  from = Math.max(EDGE, Math.min(FIELD_WIDTH - EDGE - span, from));

  let x = from;
  slots.forEach((slot, index) => {
    const width = widths[index]!;
    place(slot, x + width / 2);
    x += width + interval;
  });
  return { from, to: from + span };
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
    naval: params.naval ?? false,
  };
}
