/**
 * Diplomacy.
 *
 * Attitude is a single number per ordered pair, moved by shared faith, shared
 * borders, relative strength and what each side has actually done. Stance is
 * the formal relationship, and changing it has cooldowns so that nobody can
 * declare war and sue for peace in the same decade.
 */
import type { DiplomaticStance, FactionId, Relation } from '../types';
import { clamp, RELIGION_FAMILY } from '../types';
import type { CampaignState } from './state';
import { logEvent, provincesOf } from './state';
import { factionName, tryGetFaction, INDEPENDENT_ID } from '../data/factions';
import { landNeighbours, seaNeighbours } from '../data/adjacency';
import { militaryStrength } from './actions';
import type { Rng } from '../rng';

const NEUTRAL: Relation = { stance: 'neutral', attitude: 0, since: 0 };

export function relation(state: CampaignState, from: FactionId, to: FactionId): Relation {
  return state.factions.get(from)?.relations.get(to) ?? NEUTRAL;
}

function setRelation(
  state: CampaignState,
  from: FactionId,
  to: FactionId,
  next: Relation,
): void {
  state.factions.get(from)?.relations.set(to, next);
}

/** Writes a stance to both sides, which is the only way a stance should change. */
export function setStance(
  state: CampaignState,
  a: FactionId,
  b: FactionId,
  stance: DiplomaticStance,
): void {
  // The independents are a label for unclaimed provinces, not a state: they
  // cannot be allied with, nor formally at war, nor sued for peace.
  if (a === INDEPENDENT_ID || b === INDEPENDENT_ID) return;
  for (const [from, to] of [
    [a, b],
    [b, a],
  ] as const) {
    const current = relation(state, from, to);
    setRelation(state, from, to, { stance, attitude: current.attitude, since: state.turn });
  }
}

export function adjustAttitude(
  state: CampaignState,
  from: FactionId,
  to: FactionId,
  delta: number,
): void {
  const current = relation(state, from, to);
  setRelation(state, from, to, {
    stance: current.stance,
    attitude: clamp(current.attitude + delta, -100, 100),
    since: current.since,
  });
}

/**
 * The attitude two factions start with, from faith, culture and the simple
 * fact of being neighbours. Everyone begins neutral in stance.
 */
export function initialAttitude(a: FactionId, b: FactionId): number {
  const left = tryGetFaction(a);
  const right = tryGetFaction(b);
  if (!left || !right) return 0;
  let attitude = 0;
  if (left.religion === right.religion) attitude += 12;
  else if (RELIGION_FAMILY[left.religion] === RELIGION_FAMILY[right.religion]) attitude += 4;
  else attitude -= 10;
  if (left.culture === right.culture) attitude += 6;
  attitude += (left.traits.diplomacy ?? 0) / 2;
  attitude += (right.traits.diplomacy ?? 0) / 2;
  return clamp(attitude, -100, 100);
}

export function initialiseRelations(state: CampaignState): void {
  for (const [a, factionA] of state.factions) {
    if (a === INDEPENDENT_ID) continue;
    for (const b of state.factions.keys()) {
      if (b === a || b === INDEPENDENT_ID) continue;
      factionA.relations.set(b, {
        stance: 'neutral',
        attitude: initialAttitude(a, b),
        since: 0,
      });
    }
  }
}

/** Do the two factions share a border anywhere? */
export function shareBorder(state: CampaignState, a: FactionId, b: FactionId): boolean {
  for (const region of state.regions.values()) {
    if (region.owner !== a) continue;
    for (const other of landNeighbours(region.id)) {
      if (state.regions.get(other)?.owner === b) return true;
    }
  }
  return false;
}

/** Shared sea lanes matter for the maritime republics. */
export function shareSeaLane(state: CampaignState, a: FactionId, b: FactionId): boolean {
  for (const region of state.regions.values()) {
    if (region.owner !== a) continue;
    for (const other of seaNeighbours(region.id)) {
      if (state.regions.get(other)?.owner === b) return true;
    }
  }
  return false;
}

export const WAR_COOLDOWN = 8;
export const PEACE_COOLDOWN = 6;

export function canDeclareWar(state: CampaignState, a: FactionId, b: FactionId): boolean {
  if (a === INDEPENDENT_ID || b === INDEPENDENT_ID || a === b) return false;
  const current = relation(state, a, b);
  if (current.stance === 'war') return false;
  if (current.stance === 'ceasefire' && state.turn - current.since < PEACE_COOLDOWN) return false;
  if (current.stance === 'alliance' && state.turn - current.since < WAR_COOLDOWN) return false;
  return true;
}

export function declareWar(state: CampaignState, a: FactionId, b: FactionId): boolean {
  if (!canDeclareWar(state, a, b)) return false;
  setStance(state, a, b, 'war');
  adjustAttitude(state, b, a, -35);
  adjustAttitude(state, a, b, -15);
  // Breaking an alliance is noticed by everyone, not only the injured party.
  for (const third of state.factions.keys()) {
    if (third === a || third === b || third === INDEPENDENT_ID) continue;
    const toB = relation(state, third, b);
    if (toB.stance === 'alliance') adjustAttitude(state, third, a, -12);
  }
  logEvent(
    state,
    a,
    `${factionName(a)} declares war on ${factionName(b)}.`,
  );
  return true;
}

export function canMakePeace(state: CampaignState, a: FactionId, b: FactionId): boolean {
  if (a === INDEPENDENT_ID || b === INDEPENDENT_ID || a === b) return false;
  const current = relation(state, a, b);
  return current.stance === 'war' && state.turn - current.since >= 3;
}

export function makePeace(state: CampaignState, a: FactionId, b: FactionId): boolean {
  if (!canMakePeace(state, a, b)) return false;
  setStance(state, a, b, 'ceasefire');
  adjustAttitude(state, a, b, 8);
  adjustAttitude(state, b, a, 8);
  logEvent(state, a, `${factionName(a)} and ${factionName(b)} agree a truce.`);
  return true;
}

export function proposeTrade(state: CampaignState, a: FactionId, b: FactionId): boolean {
  if (a === INDEPENDENT_ID || b === INDEPENDENT_ID || a === b) return false;
  const current = relation(state, a, b);
  if (current.stance === 'war' || current.stance === 'alliance') return false;
  if (relation(state, b, a).attitude < 10) return false;
  setStance(state, a, b, 'trade');
  adjustAttitude(state, a, b, 6);
  adjustAttitude(state, b, a, 6);
  return true;
}

/** Nobody binds themselves to everyone: an alliance is meant to cost something. */
export const MAX_ALLIANCES = 2;

export function countAlliances(state: CampaignState, id: FactionId): number {
  const faction = state.factions.get(id);
  if (!faction) return 0;
  let total = 0;
  for (const [other, rel] of faction.relations) {
    if (other === INDEPENDENT_ID) continue;
    if (rel.stance === 'alliance' && state.factions.get(other)?.alive) total += 1;
  }
  return total;
}

export function proposeAlliance(state: CampaignState, a: FactionId, b: FactionId): boolean {
  if (a === INDEPENDENT_ID || b === INDEPENDENT_ID || a === b) return false;
  const current = relation(state, a, b);
  if (current.stance === 'war') return false;
  if (relation(state, b, a).attitude < 62) return false;
  if (countAlliances(state, a) >= MAX_ALLIANCES) return false;
  if (countAlliances(state, b) >= MAX_ALLIANCES) return false;
  setStance(state, a, b, 'alliance');
  adjustAttitude(state, a, b, 10);
  adjustAttitude(state, b, a, 10);
  logEvent(state, a, `${factionName(a)} and ${factionName(b)} conclude an alliance.`);
  return true;
}

/**
 * How badly faction `a` wants a war with `b`, 0 to 1. Opportunity plus grudge
 * minus the restraint that shared faith and a strong enemy impose.
 */
export function warDesire(state: CampaignState, a: FactionId, b: FactionId): number {
  const left = tryGetFaction(a);
  const right = tryGetFaction(b);
  if (!left || !right) return 0;
  if (!shareBorder(state, a, b) && !shareSeaLane(state, a, b)) return 0;

  const attitude = relation(state, a, b).attitude;
  const ourStrength = militaryStrength(state, a) + 1;
  const theirStrength = militaryStrength(state, b) + 1;
  const ratio = ourStrength / theirStrength;

  let desire = 0;
  desire += clamp(-attitude / 100, -0.5, 0.5);
  desire += clamp((ratio - 1) * 0.35, -0.4, 0.5);
  if (RELIGION_FAMILY[left.religion] !== RELIGION_FAMILY[right.religion]) desire += 0.2;
  if (left.religion === right.religion) desire -= 0.15;

  // A faction already fighting two wars is not looking for a third.
  const wars = countWars(state, a);
  desire -= wars * 0.18;

  // Small powers are cautious; large ones are not.
  const provinces = provincesOf(state, a).length;
  if (provinces <= 2) desire -= 0.2;

  return clamp(desire, 0, 1);
}

export function countWars(state: CampaignState, id: FactionId): number {
  const faction = state.factions.get(id);
  if (!faction) return 0;
  let wars = 0;
  for (const [other, rel] of faction.relations) {
    if (other === INDEPENDENT_ID) continue;
    if (rel.stance === 'war' && state.factions.get(other)?.alive) wars += 1;
  }
  return wars;
}

/** Per-turn drift: attitudes move towards what circumstances imply. */
export function driftRelations(state: CampaignState, rng: Rng): void {
  for (const [a, factionA] of state.factions) {
    if (a === INDEPENDENT_ID || !factionA.alive) continue;
    for (const [b, rel] of factionA.relations) {
      const other = state.factions.get(b);
      if (!other?.alive) continue;
      let delta = 0;
      switch (rel.stance) {
        case 'war':
          delta -= 2;
          break;
        case 'alliance':
          delta += rel.attitude < 85 ? 1.2 : 0;
          break;
        case 'trade':
          // Trade warms a relationship towards friendly, not towards devotion.
          delta += rel.attitude < 65 ? 0.7 : -0.2;
          break;
        case 'ceasefire':
          delta += 0.5;
          break;
        default:
          // Neutral relations decay towards the baseline the two states' faith
          // and culture imply, rather than towards zero.
          delta += Math.sign(initialAttitude(a, b) - rel.attitude) * 0.4;
      }
      // Neighbours rub along worse than distant powers.
      if (rel.stance !== 'alliance' && shareBorder(state, a, b)) delta -= 0.4;
      delta += rng.float(-0.3, 0.3);
      adjustAttitude(state, a, b, delta);
    }
  }
}

/** Every faction currently at war with the given one. */
export function enemiesOf(state: CampaignState, id: FactionId): FactionId[] {
  const faction = state.factions.get(id);
  if (!faction) return [];
  const result: FactionId[] = [];
  for (const [other, rel] of faction.relations) {
    if (other === INDEPENDENT_ID) continue;
    if (rel.stance === 'war' && state.factions.get(other)?.alive) result.push(other);
  }
  return result;
}
