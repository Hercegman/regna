/**
 * Battle AI.
 *
 * One planner serves both sides and the player's auto-resolved battles. It is
 * intentionally a doctrine rather than a search: hold a line with the heavy
 * foot, shoot with everything that can, and use cavalry against whatever is
 * exposed. That produces recognisable medieval battles and is cheap enough to
 * run every few seconds of battle time.
 */
import type { Point } from '../types';
import { distance, UNIT_ROLE } from '../types';
import { getUnitType } from '../data/units';
import type { BattleState } from './sim';
import type { BattleUnit, Side } from './types';
import { FIELD_DEPTH } from './types';

export type { BattleOrder } from './types';

function active(unit: BattleUnit): boolean {
  return unit.stance !== 'destroyed' && unit.stance !== 'routing' && !unit.fled;
}

function centreOfMass(units: readonly BattleUnit[]): Point | undefined {
  let x = 0;
  let y = 0;
  let weight = 0;
  for (const unit of units) {
    if (!active(unit)) continue;
    x += unit.position.x * unit.soldiers;
    y += unit.position.y * unit.soldiers;
    weight += unit.soldiers;
  }
  return weight === 0 ? undefined : { x: x / weight, y: y / weight };
}

function nearest(
  from: Point,
  candidates: readonly BattleUnit[],
  filter: (unit: BattleUnit) => boolean = () => true,
): BattleUnit | undefined {
  let best: BattleUnit | undefined;
  let bestGap = Infinity;
  for (const candidate of candidates) {
    if (!active(candidate) || !filter(candidate)) continue;
    const gap = distance(from, candidate.position);
    if (gap < bestGap) {
      bestGap = gap;
      best = candidate;
    }
  }
  return best;
}

/**
 * A target worth a cavalry charge: something that cannot easily turn to meet
 * it. Missile troops and units already fighting someone else come first.
 */
function chargeTarget(
  unit: BattleUnit,
  enemies: readonly BattleUnit[],
  sight: number,
): BattleUnit | undefined {
  let best: BattleUnit | undefined;
  let bestScore = -Infinity;
  for (const enemy of enemies) {
    if (!active(enemy)) continue;
    const type = getUnitType(enemy.type);
    const role = UNIT_ROLE[type.unitClass];
    const gap = distance(unit.position, enemy.position);
    let score = -gap / 150;
    // Picking the exposed flank out of a line is a thing a captain does with
    // his eyes. In fog or in the dark he can see the regiment in front of
    // him and no further, so the choice collapses back to whatever is
    // nearest — which is how cavalry was wasted on nights like Barnet.
    const seen = gap <= sight;
    if (seen && role === 'missile') score += 3;
    if (seen && role === 'siege') score += 3.5;
    if (seen && enemy.engagedWith.length > 0) score += 2.2;
    if (type.unitClass === 'pikemen' || type.abilities.includes('anti_cavalry')) score -= 4;
    if (type.unitClass === 'spearmen') score -= 1.5;
    if (score > bestScore) {
      bestScore = score;
      best = enemy;
    }
  }
  return best;
}

/** Assigns orders to every unit on one side. */
export function planSide(state: BattleState, side: Side): void {
  const own = state.units.filter((unit) => unit.side === side);
  const enemies = state.units.filter((unit) => unit.side !== side);
  const enemyCentre = centreOfMass(enemies);
  if (!enemyCentre) {
    for (const unit of own) if (active(unit)) unit.order = { kind: 'hold' };
    return;
  }

  const attacking = side === state.setup.attacker ? true : side === 'attacker';
  const ownCentre = centreOfMass(own) ?? enemyCentre;

  // A side that has lost most of its army stops trying to win and withdraws.
  const morale = sideCohesion(state, side);
  if (morale < 0.25) {
    for (const unit of own) if (active(unit)) unit.order = { kind: 'withdraw' };
    return;
  }

  for (const unit of own) {
    if (!active(unit)) continue;
    const type = getUnitType(unit.type);
    const role = UNIT_ROLE[type.unitClass];

    if (type.unitClass === 'general') {
      // The general stays behind the line and only commits late.
      const threatened = nearest(unit.position, enemies, (enemy) => distance(unit.position, enemy.position) < 110);
      if (threatened) unit.order = { kind: 'attack', targetUnit: threatened.id };
      else if (morale < 0.55) {
        const target = chargeTarget(unit, enemies, state.conditions.visibility);
        unit.order = target ? { kind: 'attack', targetUnit: target.id } : { kind: 'hold' };
      } else {
        unit.order = { kind: 'move', target: reservePosition(side, ownCentre) };
      }
      continue;
    }

    if (role === 'siege') {
      unit.order = { kind: 'hold' };
      continue;
    }

    if (role === 'missile') {
      const closing = nearest(
        unit.position,
        enemies,
        (enemy) => UNIT_ROLE[getUnitType(enemy.type).unitClass] !== 'siege',
      );
      if (closing && distance(unit.position, closing.position) < 55) {
        // Caught by melee: skirmishers get away, the rest must fight.
        unit.order = type.abilities.includes('skirmish')
          ? { kind: 'skirmish', targetUnit: closing.id }
          : { kind: 'attack', targetUnit: closing.id };
      } else if (closing) {
        unit.order = { kind: 'skirmish', targetUnit: closing.id };
      } else {
        unit.order = { kind: 'hold' };
      }
      continue;
    }

    if (role === 'cavalry') {
      const target = chargeTarget(unit, enemies, state.conditions.visibility);
      if (target) {
        unit.order = { kind: 'attack', targetUnit: target.id };
      } else {
        unit.order = { kind: 'move', target: flankPosition(side, enemyCentre, unit) };
      }
      continue;
    }

    // Heavy and light foot: form and hold the line, or advance on it.
    const engaged = nearest(unit.position, enemies, (enemy) => distance(unit.position, enemy.position) < 140);
    if (engaged) {
      unit.order = { kind: 'attack', targetUnit: engaged.id };
    } else if (attacking) {
      const target = nearest(unit.position, enemies) ?? undefined;
      unit.order = target
        ? { kind: 'attack', targetUnit: target.id }
        : { kind: 'move', target: enemyCentre };
    } else {
      unit.order = { kind: 'hold' };
    }
  }
}

/** How much of a side is still in good order, 0 to 1. */
export function sideCohesion(state: BattleState, side: Side): number {
  let start = 0;
  let standing = 0;
  for (const unit of state.units) {
    if (unit.side !== side) continue;
    start += unit.startingSoldiers;
    if (active(unit)) standing += unit.soldiers;
  }
  return start === 0 ? 0 : standing / start;
}

/** Where a general or reserve waits: behind its own centre. */
function reservePosition(side: Side, ownCentre: Point): Point {
  const back = side === 'attacker' ? 90 : -90;
  return { x: ownCentre.x, y: Math.max(20, Math.min(FIELD_DEPTH - 20, ownCentre.y + back)) };
}

/** A wide position from which cavalry can come round the enemy's flank. */
function flankPosition(side: Side, enemyCentre: Point, unit: BattleUnit): Point {
  // Half the cavalry goes left and half right, decided by the unit id so the
  // choice is stable across re-planning instead of oscillating.
  const left = hashSign(unit.id) < 0;
  const offset = left ? -340 : 340;
  const depth = side === 'attacker' ? -60 : 60;
  return {
    x: Math.max(40, Math.min(1360, enemyCentre.x + offset)),
    y: Math.max(20, Math.min(FIELD_DEPTH - 20, enemyCentre.y + depth)),
  };
}

function hashSign(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return hash % 2 === 0 ? 1 : -1;
}
