/**
 * Battle simulation.
 *
 * One tick resolves, in order: orders and movement, missile fire, melee,
 * morale, and finally the victory check. Keeping that order fixed is what makes
 * the simulation reproducible, and every random draw comes from the battle's
 * own generator so that two runs of the same battle are identical.
 */
import type { Point } from '../types';
import { clamp, distance, UNIT_ROLE } from '../types';
import { Rng } from '../rng';
import { getUnitType } from '../data/units';
import type {
  BattleResult,
  BattleSetup,
  BattleUnit,
  Side,
} from './types';
import { BATTLE_TIME_LIMIT, FIELD_DEPTH, FIELD_WIDTH, STALEMATE_SECONDS, TICK } from './types';
import { flatTerrain, ridgeTerrain } from './terrain';
import { planSide } from './ai';

export interface BattleState {
  readonly setup: BattleSetup;
  units: BattleUnit[];
  time: number;
  rng: Rng;
  finished: boolean;
  result: BattleResult | undefined;
  terrainHeight: (point: Point) => number;
  /** Units by id. A battle resolves thousands of ticks; a scan per lookup is
   *  the difference between a campaign turn taking milliseconds and seconds. */
  readonly byId: ReadonlyMap<string, BattleUnit>;
  /** Share of each side that has broken, sampled once at the start of a tick
   *  so that the order units are processed in cannot change their morale. */
  routed: { attacker: number; defender: number };
  /** Total soldiers standing when a casualty was last inflicted, and when. */
  lastCasualtyAt: number;
  lastTotal: number;
  /** True once the first casualty has been inflicted. */
  engaged: boolean;
}

export function createBattle(setup: BattleSetup): BattleState {
  const terrain =
    setup.terrain === 'hills' || setup.terrain === 'mountains'
      ? ridgeTerrain(setup.terrain)
      : flatTerrain(setup.terrain);
  const units = setup.units.map((unit) => ({ ...unit, engagedWith: [...unit.engagedWith] }));
  return {
    setup,
    units,
    time: 0,
    rng: new Rng(setup.seed),
    finished: false,
    result: undefined,
    terrainHeight: (point) => terrain.height(point),
    byId: new Map(units.map((unit) => [unit.id, unit])),
    routed: { attacker: 0, defender: 0 },
    lastCasualtyAt: 0,
    lastTotal: units.reduce((sum, unit) => sum + unit.soldiers, 0),
    engaged: false,
  };
}

// ---------------------------------------------------------------------------
// Derived unit properties
// ---------------------------------------------------------------------------

function isMounted(unit: BattleUnit): boolean {
  return getUnitType(unit.type).mounted;
}

function has(unit: BattleUnit, ability: string): boolean {
  return (getUnitType(unit.type).abilities as readonly string[]).includes(ability);
}

/** Frontage the unit occupies, from its surviving strength. */
export function frontage(unit: BattleUnit): number {
  const type = getUnitType(unit.type);
  const perMan = type.mounted ? 1.6 : 0.9;
  const ranks = type.unitClass === 'pikemen' || type.unitClass === 'spearmen' ? 4 : 3;
  return Math.max(6, (unit.soldiers / ranks) * perMan);
}

/** Effective melee attack after experience, fatigue, ground and charge. */
function attackPower(state: BattleState, unit: BattleUnit, against: BattleUnit): number {
  const type = getUnitType(unit.type);
  let power = type.attack + unit.experience * 0.5;
  if (unit.chargeTicks > 0) power += type.charge;
  // Fatigue costs up to a third of fighting power.
  power *= 1 - unit.fatigue * 0.33;
  // Uphill fighters have the advantage of weight and reach.
  const slope = state.terrainHeight(unit.position) - state.terrainHeight(against.position);
  power *= 1 + clamp(slope / 40, -0.15, 0.2);
  if (has(unit, 'anti_cavalry') && isMounted(against)) power *= 1.35;
  if (has(unit, 'armour_piercing')) power *= 1.15;
  const terrain = state.setup.terrain;
  if (isMounted(unit) && (terrain === 'forest' || terrain === 'marsh' || terrain === 'mountains')) {
    power *= 0.7;
  }
  if (has(unit, 'forest_fighter') && terrain === 'forest') power *= 1.2;
  if (has(unit, 'mountaineer') && (terrain === 'mountains' || terrain === 'hills')) power *= 1.2;
  return Math.max(0.5, power);
}

/** Effective defence, counting the shield only against frontal attacks. */
function defencePower(state: BattleState, unit: BattleUnit, from: BattleUnit): number {
  const type = getUnitType(unit.type);
  let power = type.defence + type.armour + unit.experience * 0.5;
  if (isFrontal(unit, from.position)) power += type.shield;
  power *= 1 - unit.fatigue * 0.25;
  if (has(unit, 'shield_wall') && unit.stance === 'melee') power *= 1.1;
  if (has(unit, 'schiltron') && isMounted(from)) power *= 1.4;
  const slope = state.terrainHeight(unit.position) - state.terrainHeight(from.position);
  power *= 1 + clamp(slope / 50, -0.12, 0.15);
  return Math.max(0.5, power);
}

/** Is an attack from this position hitting the unit's front or left? */
function isFrontal(unit: BattleUnit, from: Point): boolean {
  const angleToAttacker = Math.atan2(from.y - unit.position.y, from.x - unit.position.x);
  let delta = angleToAttacker - unit.facing;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta) < Math.PI / 2;
}

/** Morale the unit can absorb before breaking. */
export function moraleThreshold(state: BattleState, unit: BattleUnit): number {
  const type = getUnitType(unit.type);
  let threshold = type.morale + unit.experience * 0.4;
  const command =
    unit.side === 'attacker' ? state.setup.attackerCommand : state.setup.defenderCommand;
  threshold += command * 0.6;
  // Troops that have seen their own side break lose heart.
  threshold -= state.routed[unit.side] * 8;
  if (has(unit, 'berserk')) threshold += 6;
  if (has(unit, 'highly_trained')) threshold += 2;
  if (state.setup.isWinter) threshold -= 1;
  return Math.max(3, threshold);
}

function sampleRouted(state: BattleState): void {
  state.routed = {
    attacker: routedFraction(state, 'attacker'),
    defender: routedFraction(state, 'defender'),
  };
}

function routedFraction(state: BattleState, side: Side): number {
  let total = 0;
  let broken = 0;
  for (const unit of state.units) {
    if (unit.side !== side) continue;
    total += 1;
    if (unit.stance === 'routing' || unit.stance === 'destroyed') broken += 1;
  }
  return total === 0 ? 0 : broken / total;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

function speedOf(state: BattleState, unit: BattleUnit): number {
  const type = getUnitType(unit.type);
  let speed = type.speed;
  speed *= 1 - unit.fatigue * 0.3;
  if (unit.stance === 'charging') speed *= 1.35;
  if (unit.stance === 'routing') speed *= 1.25;
  const terrain = state.setup.terrain;
  if (terrain === 'marsh') speed *= 0.65;
  else if (terrain === 'forest') speed *= 0.8;
  else if (terrain === 'mountains') speed *= 0.7;
  else if (terrain === 'desert') speed *= 0.9;
  if (has(unit, 'mountaineer') && (terrain === 'mountains' || terrain === 'hills')) speed /= 0.7;
  if (has(unit, 'desert_hardy') && terrain === 'desert') speed /= 0.9;
  return Math.max(0.2, speed);
}

function moveTowards(state: BattleState, unit: BattleUnit, target: Point, dt: number): void {
  const dx = target.x - unit.position.x;
  const dy = target.y - unit.position.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.5) return;
  const step = Math.min(length, speedOf(state, unit) * dt);
  unit.position = {
    x: clamp(unit.position.x + (dx / length) * step, 0, FIELD_WIDTH),
    y: clamp(unit.position.y + (dy / length) * step, 0, FIELD_DEPTH),
  };
  // Turning to face the direction of march, but not instantly.
  const desired = Math.atan2(dy, dx);
  unit.facing = turnTowards(unit.facing, desired, dt * 1.6);
}

function turnTowards(current: number, desired: number, maxDelta: number): number {
  let delta = desired - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + clamp(delta, -maxDelta, maxDelta);
}

/** The edge a routing unit runs for. */
function escapePoint(unit: BattleUnit): Point {
  return { x: unit.position.x, y: unit.side === 'attacker' ? FIELD_DEPTH : 0 };
}

// ---------------------------------------------------------------------------
// Combat phases
// ---------------------------------------------------------------------------

function contactDistance(a: BattleUnit, b: BattleUnit): number {
  return Math.max(12, (frontage(a) + frontage(b)) / 6);
}

function applyMovement(state: BattleState, dt: number): void {
  for (const unit of state.units) {
    if (unit.stance === 'destroyed' || unit.fled) continue;

    if (unit.stance === 'routing') {
      const escape = escapePoint(unit);
      moveTowards(state, unit, escape, dt);
      const atEdge = unit.side === 'attacker'
        ? unit.position.y >= FIELD_DEPTH - 1
        : unit.position.y <= 1;
      if (atEdge) unit.fled = true;
      continue;
    }

    if (unit.stance === 'melee') continue;

    const order = unit.order;
    if (order.kind === 'attack' && order.targetUnit) {
      const target = state.byId.get(order.targetUnit);
      if (target && target.stance !== 'destroyed' && !target.fled) {
        const gap = distance(unit.position, target.position);
        const reach = contactDistance(unit, target);
        if (gap <= reach) {
          unit.stance = 'melee';
          if (unit.chargeTicks === 0 && unit.meleeTicks === 0) {
            // A charge that connects gets its bonus for a short while.
            unit.chargeTicks = Math.round(6 / TICK);
          }
        } else {
          unit.stance = gap < 90 ? 'charging' : 'advancing';
          moveTowards(state, unit, target.position, dt);
        }
        continue;
      }
    }

    if (order.kind === 'skirmish' && order.targetUnit) {
      const target = state.byId.get(order.targetUnit);
      if (target && target.stance !== 'destroyed' && !target.fled) {
        const type = getUnitType(unit.type);
        const gap = distance(unit.position, target.position);
        const preferred = type.range * 0.8;
        if (gap < preferred * 0.6) {
          // Back away rather than be caught.
          const away = {
            x: unit.position.x - (target.position.x - unit.position.x),
            y: unit.position.y - (target.position.y - unit.position.y),
          };
          unit.stance = 'skirmishing';
          moveTowards(state, unit, away, dt);
        } else if (gap > preferred) {
          unit.stance = 'advancing';
          moveTowards(state, unit, target.position, dt);
        } else {
          unit.stance = 'skirmishing';
          unit.facing = turnTowards(
            unit.facing,
            Math.atan2(target.position.y - unit.position.y, target.position.x - unit.position.x),
            dt * 2,
          );
        }
        continue;
      }
    }

    if (order.kind === 'move' && order.target) {
      const gap = distance(unit.position, order.target);
      if (gap > 2) {
        unit.stance = 'advancing';
        moveTowards(state, unit, order.target, dt);
      } else {
        unit.stance = 'holding';
      }
      continue;
    }

    if (order.kind === 'withdraw') {
      moveTowards(state, unit, escapePoint(unit), dt);
      const atEdge = unit.side === 'attacker'
        ? unit.position.y >= FIELD_DEPTH - 1
        : unit.position.y <= 1;
      if (atEdge) unit.fled = true;
      continue;
    }

    if (unit.stance !== 'holding') unit.stance = 'holding';
  }
}

function applyMissiles(state: BattleState, dt: number): void {
  for (const shooter of state.units) {
    if (shooter.stance === 'destroyed' || shooter.fled) continue;
    if (shooter.stance === 'routing' || shooter.stance === 'melee') continue;
    const type = getUnitType(shooter.type);
    if (type.range <= 0 || shooter.ammunition <= 0) continue;

    const target = pickMissileTarget(state, shooter);
    if (!target) continue;
    const gap = distance(shooter.position, target.position);
    if (gap > type.range) continue;

    // Rate of fire: bows shoot faster than crossbows, guns slower still.
    const shotsPerSecond =
      type.unitClass === 'archers' || type.unitClass === 'horse_archers'
        ? 0.14
        : type.unitClass === 'crossbowmen'
          ? 0.07
          : type.unitClass === 'gunpowder_infantry'
            ? 0.05
            : type.unitClass === 'siege_engine'
              ? 0.03
              : 0.2;

    const volleys = shotsPerSecond * dt;
    const rounds = Math.min(shooter.ammunition, volleys);
    if (rounds <= 0) continue;
    shooter.ammunition -= rounds;

    // Accuracy falls off with range and improves with experience.
    const rangeFactor = 1 - 0.55 * (gap / type.range);
    const skill = 0.5 + shooter.experience * 0.04;
    const targetType = getUnitType(target.type);
    const protection = 1 / (1 + (targetType.armour + targetType.shield * 0.5) * 0.22);
    const density = isMounted(target) ? 0.8 : 1.0;

    // Volleys vary: wind, nerves and how closely the target is packed. The
    // draw comes from the battle's own generator, so the variation is
    // reproducible but the same matchup is not a foregone conclusion.
    const variance = state.rng.float(0.82, 1.18);
    const hits =
      shooter.soldiers * rounds * rangeFactor * skill * protection * density *
      (type.missileAttack / 11) * 0.09 * variance;

    const kills = Math.min(target.soldiers, Math.max(0, hits));
    target.soldiers -= kills;
    // Being shot at is demoralising out of proportion to the casualties.
    target.shock += (kills / Math.max(1, target.startingSoldiers)) * 26;
  }
}

function pickMissileTarget(state: BattleState, shooter: BattleUnit): BattleUnit | undefined {
  const type = getUnitType(shooter.type);
  let best: BattleUnit | undefined;
  let bestScore = -Infinity;
  for (const candidate of state.units) {
    if (candidate.side === shooter.side) continue;
    if (candidate.stance === 'destroyed' || candidate.fled) continue;
    const gap = distance(shooter.position, candidate.position);
    if (gap > type.range) continue;
    // Prefer close, large, unarmoured targets, and avoid shooting into our own
    // melee unless there is nothing else.
    let score = -gap / 100 + candidate.soldiers / 120;
    if (candidate.stance === 'melee') score -= 2.5;
    if (candidate.stance === 'routing') score -= 3;
    if (isMounted(candidate) && candidate.stance === 'charging') score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function applyMelee(state: BattleState, dt: number): void {
  // Rebuild contact lists from positions, so a unit that moved away disengages.
  for (const unit of state.units) unit.engagedWith = [];
  for (let i = 0; i < state.units.length; i++) {
    const a = state.units[i]!;
    if (a.stance === 'destroyed' || a.fled || a.stance === 'routing') continue;
    for (let j = i + 1; j < state.units.length; j++) {
      const b = state.units[j]!;
      if (b.side === a.side) continue;
      if (b.stance === 'destroyed' || b.fled || b.stance === 'routing') continue;
      if (distance(a.position, b.position) <= contactDistance(a, b)) {
        a.engagedWith.push(b.id);
        b.engagedWith.push(a.id);
      }
    }
  }

  for (const unit of state.units) {
    if (unit.engagedWith.length > 0 && unit.stance !== 'routing' && unit.stance !== 'destroyed') {
      unit.stance = 'melee';
      unit.meleeTicks += 1;
    } else if (unit.stance === 'melee') {
      unit.stance = 'holding';
      unit.meleeTicks = 0;
      unit.chargeTicks = 0;
    }
  }

  for (const unit of state.units) {
    if (unit.stance !== 'melee') continue;
    for (const otherId of unit.engagedWith) {
      const other = state.byId.get(otherId);
      if (!other || other.stance === 'destroyed') continue;

      const attack = attackPower(state, unit, other);
      const defend = defencePower(state, other, unit);
      // Soldiers actually in contact, limited by the narrower frontage.
      const contact = Math.min(unit.soldiers, other.soldiers, Math.min(frontage(unit), frontage(other)) / 0.9);
      const share = 1 / unit.engagedWith.length;

      const killRate = 0.055 * (attack / (attack + defend));
      let kills = contact * killRate * dt * share * state.rng.float(0.85, 1.15);

      // Being hit in the flank or the rear is far worse than a frontal fight.
      if (!isFrontal(other, unit.position)) kills *= 1.8;
      // Outnumbered units are surrounded and cut down faster.
      if (other.engagedWith.length > 1) kills *= 1 + (other.engagedWith.length - 1) * 0.25;

      kills = Math.min(other.soldiers, Math.max(0, kills));
      other.soldiers -= kills;
      other.shock += (kills / Math.max(1, other.startingSoldiers)) * 34;
      if (!isFrontal(other, unit.position)) other.shock += 0.35;
    }
    // Melee is exhausting; armour makes it worse.
    const type = getUnitType(unit.type);
    const burden = 1 + type.armour * 0.06;
    unit.fatigue = clamp(unit.fatigue + 0.0022 * burden * dt * (has(unit, 'hardy') ? 0.6 : 1), 0, 1);
    if (unit.chargeTicks > 0) unit.chargeTicks -= 1;
  }

  // Movement also tires troops, less than fighting does.
  for (const unit of state.units) {
    if (unit.stance === 'advancing' || unit.stance === 'charging' || unit.stance === 'routing') {
      unit.fatigue = clamp(unit.fatigue + 0.00055 * dt * (has(unit, 'hardy') ? 0.6 : 1), 0, 1);
    } else if (unit.stance === 'holding' || unit.stance === 'forming') {
      unit.fatigue = clamp(unit.fatigue - 0.0006 * dt, 0, 1);
    }
  }
}

function applyMorale(state: BattleState, dt: number): void {
  for (const unit of state.units) {
    if (unit.fled) continue;
    if (unit.soldiers <= 0.5) {
      unit.soldiers = 0;
      unit.stance = 'destroyed';
      continue;
    }
    if (unit.stance === 'destroyed') continue;

    // Shock bleeds off when nothing is happening.
    const recovery = unit.stance === 'melee' ? 0.02 : 0.35;
    const discipline = getUnitType(unit.type).discipline;
    unit.shock = Math.max(0, unit.shock - recovery * dt * (1 + discipline * 0.04));

    // Losing most of the regiment breaks it regardless of accumulated shock.
    const remaining = unit.soldiers / unit.startingSoldiers;
    if (remaining < 0.22 && unit.stance !== 'routing') {
      unit.shock += 0.8 * dt * 10;
    }

    const threshold = moraleThreshold(state, unit);
    if (unit.stance === 'routing') {
      // A broken unit may rally once it is clear of the fighting.
      if (unit.shock < threshold * 0.5 && unit.engagedWith.length === 0) {
        if (state.rng.chance(0.004 * dt * (1 + discipline * 0.12))) {
          unit.stance = 'rallying';
          unit.shock = threshold * 0.4;
        }
      }
      continue;
    }
    if (unit.stance === 'rallying') {
      if (unit.shock > threshold) unit.stance = 'routing';
      else if (state.rng.chance(0.02 * dt)) unit.stance = 'holding';
      continue;
    }
    if (unit.shock > threshold && !has(unit, 'berserk')) {
      unit.stance = 'routing';
      unit.chargeTicks = 0;
      unit.meleeTicks = 0;
      // One regiment breaking shakes the units standing beside it.
      for (const neighbour of state.units) {
        if (neighbour.side !== unit.side || neighbour === unit) continue;
        if (distance(neighbour.position, unit.position) < 120) neighbour.shock += 1.6;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Victory
// ---------------------------------------------------------------------------

function sideStrength(state: BattleState, side: Side): number {
  let total = 0;
  for (const unit of state.units) {
    if (unit.side !== side) continue;
    if (unit.stance === 'routing' || unit.stance === 'destroyed' || unit.fled) continue;
    total += unit.soldiers;
  }
  return total;
}

function startingStrength(setup: BattleSetup, side: Side): number {
  let total = 0;
  for (const unit of setup.units) if (unit.side === side) total += unit.startingSoldiers;
  return total;
}

function checkVictory(state: BattleState): void {
  const attacker = sideStrength(state, 'attacker');
  const defender = sideStrength(state, 'defender');

  // Track whether anyone is still being hurt. Armies that have drawn apart and
  // stopped killing each other have ended the battle, whatever the clock says.
  const total = state.units.reduce((sum, unit) => sum + unit.soldiers, 0);
  if (total < state.lastTotal - 0.5) {
    state.lastTotal = total;
    state.lastCasualtyAt = state.time;
    state.engaged = true;
  }
  // The rule applies only after the armies have actually come to blows. Two
  // lines half a kilometre apart are marching towards each other, not standing
  // off, and cutting the battle short there would end it before it began.
  const stalled = state.engaged && state.time - state.lastCasualtyAt > STALEMATE_SECONDS;

  if (attacker > 0 && defender > 0 && state.time < BATTLE_TIME_LIMIT && !stalled) return;

  const outcome =
    attacker <= 0 && defender <= 0
      ? 'draw'
      : attacker <= 0
        ? 'defender'
        : defender <= 0
          ? 'attacker'
          : // Time ran out: the side that kept more of its army holds the field.
            scoreSide(state, 'attacker') > scoreSide(state, 'defender')
            ? 'attacker'
            : scoreSide(state, 'defender') > scoreSide(state, 'attacker')
              ? 'defender'
              : 'draw';

  state.finished = true;
  state.result = {
    outcome,
    duration: state.time,
    attackerLosses: startingStrength(state.setup, 'attacker') - remainingSoldiers(state, 'attacker'),
    defenderLosses: startingStrength(state.setup, 'defender') - remainingSoldiers(state, 'defender'),
    units: state.units,
  };
}

function scoreSide(state: BattleState, side: Side): number {
  const start = startingStrength(state.setup, side) || 1;
  return sideStrength(state, side) / start;
}

function remainingSoldiers(state: BattleState, side: Side): number {
  let total = 0;
  for (const unit of state.units) {
    if (unit.side !== side) continue;
    // A unit that ran off the field is lost to the battle but mostly survives.
    total += unit.fled ? unit.soldiers * 0.8 : unit.soldiers;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Driving the simulation
// ---------------------------------------------------------------------------

/** Advances the battle by one fixed tick. */
export function stepBattle(state: BattleState): void {
  if (state.finished) return;
  const dt = TICK;

  // Both sides re-plan at a human interval rather than every tick.
  if (Math.abs((state.time / 4) % 1) < 1e-9) {
    planSide(state, 'attacker');
    planSide(state, 'defender');
  }

  sampleRouted(state);
  applyMovement(state, dt);
  applyMissiles(state, dt);
  applyMelee(state, dt);
  applyMorale(state, dt);
  state.time += dt;
  checkVictory(state);
}

/** Runs the battle to its conclusion and returns the result. */
export function runBattle(setup: BattleSetup): BattleResult {
  const state = createBattle(setup);
  let guard = 0;
  const maxTicks = Math.ceil(BATTLE_TIME_LIMIT / TICK) + 10;
  while (!state.finished && guard < maxTicks) {
    stepBattle(state);
    guard += 1;
  }
  if (!state.result) {
    // Safety net: the loop guard tripped, so settle it on remaining strength.
    state.time = BATTLE_TIME_LIMIT;
    checkVictory(state);
  }
  return state.result!;
}

export { sideStrength, scoreSide, UNIT_ROLE };
