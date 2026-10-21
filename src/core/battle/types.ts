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
import type { TimeOfDay, Weather } from './weather';

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
  /** Where the regiment came from, so losses are written back to it. */
  readonly source: 'army' | 'garrison' | 'fleet';
  /** Index of the regiment within that source's own ordering. */
  readonly sourceIndex: number;

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
  /**
   * What is falling out of the sky, and what hour it is.
   *
   * Rolled once from the battle's own seed, before anything moves, so that
   * replaying a campaign fights the same battle under the same sky. What
   * they are worth is in `weather.ts`, and the simulation reads it through
   * `BattleState.conditions` rather than switching on these directly.
   */
  readonly weather: Weather;
  readonly timeOfDay: TimeOfDay;
  /**
   * True when the sky was named rather than rolled, which also means it
   * holds for the day.
   *
   * A battle set up under a chosen sky is one somebody wants to look at or
   * to measure under that sky, and a squall arriving ten minutes in would
   * defeat both. A campaign battle never sets this, so a campaign day can
   * turn.
   */
  readonly fixedSky: boolean;
  /** True for a sea fight: open water, no cover, and nowhere to run. */
  readonly naval: boolean;
}

/**
 * One man, down.
 *
 * The simulation has always counted casualties and never placed them, which
 * is why the dead on screen were a scatter of bodies pinned to the regiment
 * that lost them and vanished the moment it marched off. This is the record
 * instead: where he fell, which way he was facing when he did, and when —
 * so that he can be drawn going down for the second it takes and then left
 * lying there for the rest of the day.
 *
 * It is kept only when somebody is watching. An auto-resolved battle runs
 * the identical model with the recording switched off, because a campaign
 * turn that resolves nine sieges has no use for forty thousand bodies and
 * the positions are derived rather than drawn, so leaving them out cannot
 * change the result.
 */
export interface Fallen {
  readonly x: number;
  readonly y: number;
  readonly faction: FactionId;
  readonly side: Side;
  /** Facing of the regiment he was standing in, in radians. */
  readonly facing: number;
  /** Battle seconds at which he was hit. */
  readonly at: number;
  /** Which of the two kits he was wearing, and which body he lies as. */
  readonly kit: number;
}

export type BattleOutcome = 'attacker' | 'defender' | 'draw';

/**
 * Why the fighting stopped.
 *
 * Worth recording because two of these are not defeats. An army that is
 * still standing when the light goes has not lost; it has run out of day,
 * which happened often enough that commanders planned around it.
 */
export type BattleEnding = 'rout' | 'nightfall' | 'stalemate' | 'time';

export interface BattleResult {
  readonly outcome: BattleOutcome;
  readonly ended: BattleEnding;
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
export const BATTLE_TIME_LIMIT = 60 * 30;
/**
 * If neither side has lost a man for this long, the armies have disengaged and
 * the day is over. Without this a stand-off runs to the time limit, which costs
 * the campaign a great deal of simulation for no result.
 */
export const STALEMATE_SECONDS = 60 * 5;
