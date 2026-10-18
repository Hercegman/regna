/**
 * Battle model.
 *
 * A battle is a fixed-timestep simulation on a flat field measured in metres.
 * The same simulation serves both presentations: the player watches it tick in
 * real time, and an auto-resolved battle is the identical model run to the end
 * without drawing it. There is no second set of rules for the AI, so the odds
 * the player is shown are the odds that actually apply.
 */
import type { FactionId, Point, Terrain, UnitTypeId, WallTier } from '../types';

export type Side = 'attacker' | 'defender';

export type UnitStance =
  | 'forming'    // deployed, not yet ordered forward
  | 'advancing'  // moving to a position
  | 'holding'    // standing on a position
  | 'charging'   // closing at speed, charge bonus pending
  | 'melee'      // in contact
  | 'skirmishing'// keeping distance while shooting
  | 'routing'    // broken, running for the edge
  | 'rallying'   // stopped running, recovering
  | 'destroyed';

export interface BattleOrder {
  readonly kind: 'hold' | 'move' | 'attack' | 'skirmish' | 'withdraw';
  /** Destination for move orders. */
  readonly target?: Point;
  /** Target unit for attack orders. */
  readonly targetUnit?: string;
}

export interface BattleUnit {
  readonly id: string;
  readonly side: Side;
  readonly faction: FactionId;
  readonly type: UnitTypeId;
  /** Index of the originating regiment in its army, for applying losses back. */
  readonly sourceIndex: number;
  /** True when the regiment came from a settlement garrison. */
  readonly fromGarrison: boolean;

  soldiers: number;
  readonly startingSoldiers: number;
  experience: number;

  position: Point;
  /** Facing in radians; 0 points along +x. */
  facing: number;
  /** Frontage in metres, derived from soldiers and formation depth. */
  width: number;

  stance: UnitStance;
  order: BattleOrder;
  /** Accumulated morale shock. The unit breaks when this passes its threshold. */
  shock: number;
  /** 0 fresh to 1 exhausted. */
  fatigue: number;
  ammunition: number;
  /** Ticks remaining of the charge bonus after contact. */
  chargeTicks: number;
  /** Ticks this unit has been in melee, for fatigue and for the AI. */
  meleeTicks: number;
  /** Ids of units currently in contact. */
  engagedWith: string[];
  /** True once the unit has left the field entirely. */
  fled: boolean;
}

export interface BattleTerrain {
  readonly kind: Terrain;
  /**
   * Height in metres at a point, used for uphill and downhill modifiers and
   * for missile range. A single ridge is enough to make ground matter.
   */
  height(point: Point): number;
}

export interface BattleSettlement {
  readonly walls: WallTier;
  /** Centre of the settlement on the field. */
  readonly centre: Point;
  /** Radius of the walled area in metres. */
  readonly radius: number;
  /** Wall integrity 0-1; breached below 0.35. */
  integrity: number;
}

export interface BattleSetup {
  readonly seed: string;
  readonly terrain: Terrain;
  /** Present when the battle is an assault on a settlement. */
  readonly settlement: BattleSettlement | undefined;
  readonly attacker: FactionId;
  readonly defender: FactionId;
  readonly units: readonly BattleUnit[];
  /** Command rating of each side's general, 0-10, 0 when none is present. */
  readonly attackerCommand: number;
  readonly defenderCommand: number;
  readonly isWinter: boolean;
}

export type BattleOutcome = 'attacker' | 'defender' | 'draw';

export interface BattleResult {
  readonly outcome: BattleOutcome;
  /** Seconds of battle time elapsed. */
  readonly duration: number;
  readonly attackerLosses: number;
  readonly defenderLosses: number;
  /** Final state of every unit, for applying casualties back to the campaign. */
  readonly units: readonly BattleUnit[];
}

/** Field dimensions in metres. */
export const FIELD_WIDTH = 1400;
export const FIELD_DEPTH = 1000;
/** Simulation timestep in seconds. */
export const TICK = 0.25;
/** A battle is a draw if neither side breaks within this many seconds. */
export const BATTLE_TIME_LIMIT = 60 * 45;
