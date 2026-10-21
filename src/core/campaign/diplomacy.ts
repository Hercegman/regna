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
import { isFairGame, noteWarDeclared } from './faith';

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
  // A ruler under censure has no peace to break: his co-religionists may fall
  // on him at once, which is what the sentence was for.
  if (isFairGame(state, b, a)) return true;
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
  noteWarDeclared(state, a, b);
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

/**
 * How much two courts must like each other before an alliance is possible.
 *
 * Above where goodwill on its own can carry them. Trade warms a relationship
 * and stops short of this on purpose: commerce makes a treaty of commerce,
 * and it took something else to make a treaty of alliance.
 */
export const ALLIANCE_ATTITUDE = 72;

/** An alliance with nothing left holding it together lapses at this. */
const ALLIANCE_LAPSES = 45;

/**
 * Why two realms are bound to each other.
 *
 * A medieval alliance was not the natural end of a warm correspondence. It
 * was made for a reason and it lasted as long as the reason did: a marriage
 * between the two houses, a war both were already fighting against the same
 * man, or a holy war both had sworn to. Leagues made against somebody
 * dissolved when that somebody did, which is why so few of them outlived the
 * war they were made for.
 *
 * Without one of these, two realms that like each other are two realms that
 * like each other.
 */
export type AllianceCause = 'marriage' | 'common enemy' | 'holy war';

export function allianceCause(
  state: CampaignState,
  a: FactionId,
  b: FactionId,
): AllianceCause | undefined {
  if (marriedInto(state, a, b) || marriedInto(state, b, a)) return 'marriage';

  const theirs = state.factions.get(b);
  if (theirs) {
    const ours = militaryStrength(state, a);
    const yours = militaryStrength(state, b);
    for (const enemy of enemiesOf(state, a)) {
      if (theirs.relations.get(enemy)?.stance !== 'war') continue;
      // A league is made against somebody worth making one against. Two
      // kings who happen to be fighting the same small neighbour have a
      // coincidence, not a cause, and with two hundred wars declared in a
      // century the coincidence is common enough to have been carrying
      // every alliance in Europe on its own.
      const threat = militaryStrength(state, enemy);
      if (threat > ours || threat > yours) return 'common enemy';
    }
  }

  const war = state.faith.holyWar;
  if (war && war.participants.includes(a) && war.participants.includes(b)) return 'holy war';
  return undefined;
}

/**
 * Is there a bride at this court who was born in that realm?
 *
 * `bornIn` is the whole of the bond a marriage makes between two houses, so
 * it is the whole of the question here.
 */
function marriedInto(state: CampaignState, court: FactionId, from: FactionId): boolean {
  const faction = state.factions.get(court);
  if (!faction) return false;
  return faction.characters.some((person) => person.bornIn === from);
}

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
  if (relation(state, b, a).attitude < ALLIANCE_ATTITUDE) return false;
  if (countAlliances(state, a) >= MAX_ALLIANCES) return false;
  if (countAlliances(state, b) >= MAX_ALLIANCES) return false;
  const cause = allianceCause(state, a, b);
  if (!cause) return false;
  setStance(state, a, b, 'alliance');
  adjustAttitude(state, a, b, 10);
  adjustAttitude(state, b, a, 10);
  logEvent(state, a, `${factionName(a)} and ${factionName(b)} conclude an alliance: ${cause}.`);
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
  // Collected rather than applied in the loop, because an alliance lapsing
  // writes to both sides' relations and the loop is reading them.
  const lapsed: [FactionId, FactionId][] = [];
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
        case 'alliance': {
          // An alliance holds while the thing that made it holds. Once the
          // common enemy has been beaten, the bride is dead and the crusade
          // is over, the treaty is two courts being polite to each other,
          // and it cools until it lapses.
          const cause = allianceCause(state, a, b);
          delta += cause ? (rel.attitude < 85 ? 1.2 : 0) : -1.8;
          if (!cause && rel.attitude < ALLIANCE_LAPSES) lapsed.push([a, b]);
          break;
        }
        case 'trade':
          // Trade warms a relationship towards friendly and stops there.
          // Commerce makes a treaty of commerce; it took a marriage or a
          // common enemy to make a treaty of alliance, and this ceiling is
          // deliberately below the bar for one.
          delta += rel.attitude < 55 ? 0.7 : -0.2;
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
  for (const [a, b] of lapsed) {
    if (relation(state, a, b).stance !== 'alliance') continue;
    setStance(state, a, b, 'trade');
    logEvent(state, a, `The alliance of ${factionName(a)} and ${factionName(b)} lapses.`);
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
