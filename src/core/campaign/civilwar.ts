/**
 * Civil war.
 *
 * A disputed succession already cost a realm order in every province it held.
 * What it did not do was what a disputed succession actually was: somebody
 * else with a claim, provinces declaring for him, and an army marching on the
 * capital.
 *
 * The pretender is a real person — the man who had the better claim and did
 * not get the throne. He leaves the court, takes the provinces most willing to
 * have him, and goes for the crown. His provinces are held as the independent
 * lords hold theirs, because from everyone else's point of view that is
 * exactly what they are: ground the king no longer controls. The difference is
 * that this ground has a claimant standing on it, and if he reaches the
 * capital he takes the throne and the realm back with it.
 */
import type { ArmyId, FactionId, RegionId } from '../types';
import { unitTypeId } from '../types';
import type { Rng } from '../rng';
import type { Army, CampaignState, Character, Regiment, RegionState } from './state';
import { factionState, logEvent, newArmyId, strengthOf } from './state';
import { getFaction, tryGetFaction, INDEPENDENT_ID } from '../data/factions';
import { getRegion } from '../data/regions';
import { getUnitType } from '../data/units';
import { landRosterFor } from '../data/roster';
import { transferProvince } from './actions';
import { claimOf, isAdult } from './dynasty';
import { givenNameOf, nameRuler } from './state';

/** A realm needs this many provinces before a split is a war rather than a riot. */
export const MIN_PROVINCES_FOR_WAR = 3;

/** Above this, the realm believes in its king and nobody rises. */
export const LEGITIMACY_FOR_PEACE = 70;

/** Seasons a pretender has to make good his claim before the cause dies. */
export const PRETENDER_PATIENCE = 40;

/** Seasons after one war before a realm can be torn in two again. */
export const CIVIL_WAR_COOLDOWN = 20;

export interface CivilWar {
  /** The crown being fought for. */
  readonly crown: FactionId;
  /** The man fighting for it. He is no longer of the crown's court. */
  readonly claimant: Character;
  readonly declaredOn: number;
  /** When the cause is abandoned if he has not won. */
  readonly expires: number;
  /** Provinces that declared for him, in the order they did. */
  readonly provinces: RegionId[];
  /** His forces, held as the independent lords hold theirs. */
  readonly armies: ArmyId[];
}

/** The war being fought over a given crown, if there is one. */
export function civilWarAgainst(state: CampaignState, crown: FactionId): CivilWar | undefined {
  return state.civilWars.get(crown);
}

/** True while this army is a pretender's rather than an independent lord's. */
export function isPretenderArmy(state: CampaignState, army: ArmyId): boolean {
  for (const war of state.civilWars.values()) if (war.armies.includes(army)) return true;
  return false;
}

export function pretenderOf(state: CampaignState, army: ArmyId): CivilWar | undefined {
  for (const war of state.civilWars.values()) if (war.armies.includes(army)) return war;
  return undefined;
}

// ---------------------------------------------------------------------------
// The rising
// ---------------------------------------------------------------------------

/** Below this a king is weak enough that a strong subject does not need a claim. */
export const LEGITIMACY_FOR_OPPORTUNISM = 55;

/** A man of this much ability will try it on a king nobody believes in. */
export const AMBITION = 6;

/**
 * Whether anybody is in a position to raise a claim against this crown.
 *
 * Two kinds of man rose. The first had the better right — a king's son
 * passed over, a brother who thought the throne should have been his — and
 * the whole argument was about descent. The second had no right at all and
 * did not need one: a capable magnate looking at a king his own realm did not
 * believe in. Both happened constantly, and a model with only the first in it
 * produced almost no risings, because by the time a usurper is on the throne
 * the old house is usually the reason he is there.
 */
export function pretenderFor(state: CampaignState, crown: FactionId): Character | undefined {
  const faction = state.factions.get(crown);
  if (!faction?.alive) return undefined;
  const ruler = faction.characters.find((character) => character.leader);
  if (!ruler) return undefined;

  const rivals = faction.characters.filter(
    (character) => !character.leader && isAdult(character) && character.sex === 'm',
  );
  if (rivals.length === 0) return undefined;

  const sitting = claimOf(faction, ruler, ruler);
  const best = [...rivals].sort(
    (a, b) => claimOf(faction, b, ruler) - claimOf(faction, a, ruler),
  )[0]!;
  if (claimOf(faction, best, ruler) > sitting) return best;

  if (faction.legitimacy < LEGITIMACY_FOR_OPPORTUNISM) {
    // No better right, but a better sword and a king nobody is defending.
    const ambitious = [...rivals].sort((a, b) => b.command - a.command)[0]!;
    if (ambitious.command >= AMBITION) return ambitious;
  }
  return undefined;
}

/**
 * Each season, whether a realm with a shaky title comes apart.
 *
 * The chance is small and scales with how little the realm believes in its
 * ruler. A realm at full legitimacy is never at risk, and one that has just
 * survived a war gets a generation before the next.
 */
export function considerCivilWar(state: CampaignState, rng: Rng): void {
  for (const [crown, faction] of state.factions) {
    if (!faction.alive || crown === INDEPENDENT_ID) continue;
    if (state.civilWars.has(crown)) continue;
    if (faction.legitimacy >= LEGITIMACY_FOR_PEACE) continue;
    if (state.turn - faction.lastCivilWar < CIVIL_WAR_COOLDOWN) continue;

    const held = provincesHeld(state, crown);
    if (held.length < MIN_PROVINCES_FOR_WAR) continue;
    const claimant = pretenderFor(state, crown);
    if (!claimant) continue;

    // Discontent is the tinder: a realm whose provinces are quiet does not
    // split however little it thinks of its king.
    const restless = held.filter((province) => province.unrest > 30).length;
    const doubt = (LEGITIMACY_FOR_PEACE - faction.legitimacy) / 100;
    const chance = doubt * (0.08 + restless * 0.025);
    if (!rng.chance(Math.min(0.3, chance))) continue;

    raiseStandard(state, crown, claimant, held, rng);
  }
}

function provincesHeld(state: CampaignState, crown: FactionId): RegionState[] {
  return [...state.regions.values()].filter((province) => province.owner === crown);
}

/**
 * A pretender raises his standard.
 *
 * The provinces that declare for him are the ones with least reason to stay
 * loyal: the discontented and the recently conquered, and never the capital,
 * which is the thing he has to come and take.
 */
function raiseStandard(
  state: CampaignState,
  crown: FactionId,
  claimant: Character,
  held: readonly RegionState[],
  rng: Rng,
): void {
  const faction = factionState(state, crown);
  const capital = faction.capital;
  const willing = held
    .filter((province) => province.id !== capital)
    .sort((a, b) => b.unrest - a.unrest || b.ownedSince - a.ownedSince);
  // Up to a third of the realm, and at least one province, or there is
  // nothing to fight from.
  const count = Math.max(1, Math.min(willing.length, Math.round(held.length / 3)));
  const declared = willing.slice(0, count);
  if (declared.length === 0) return;

  // He leaves the court: a man who has raised his standard is no longer one
  // of the king's men.
  faction.characters = faction.characters.filter(
    (character) => character.id !== claimant.id,
  );
  for (const province of state.regions.values()) {
    if (province.governor?.id === claimant.id) province.governor = undefined;
  }
  for (const army of state.armies.values()) {
    if (army.general?.id === claimant.id) army.general = undefined;
  }

  const provinces: RegionId[] = [];
  for (const province of declared) {
    transferProvince(state, province.id, INDEPENDENT_ID);
    province.unrest = 35;
    provinces.push(province.id);
  }

  const host = musterFor(state, crown, declared[0]!, claimant, rng);
  state.civilWars.set(crown, {
    crown,
    claimant,
    declaredOn: state.turn,
    expires: state.turn + PRETENDER_PATIENCE,
    provinces,
    armies: host ? [host] : [],
  });
  faction.lastCivilWar = state.turn;
  // A realm at war with itself believes in its king less, not more.
  faction.legitimacy = Math.max(20, faction.legitimacy - 15);

  logEvent(
    state,
    crown,
    `${claimant.name} raises his standard against ${getFaction(crown).name} at ` +
      `${getRegion(declared[0]!.id).settlement}. ${declared.length} provinces declare for him.`,
  );
}

/** The army that follows a pretender out of the provinces that declared. */
function musterFor(
  state: CampaignState,
  crown: FactionId,
  seat: RegionState,
  claimant: Character,
  rng: Rng,
): ArmyId | undefined {
  const definition = tryGetFaction(crown);
  if (!definition) return undefined;
  const roster = landRosterFor(definition, state.year).filter(
    (unit) => unit.unitClass !== 'general' && unit.tier <= 3,
  );
  const fallback = getUnitType(unitTypeId('peasant_levy'));
  const regiments: Regiment[] = Array.from({ length: 6 }, () => {
    const unit = rng.pick(roster.length > 0 ? roster : [fallback]);
    return { type: unit.id, soldiers: unit.soldiers, experience: rng.int(0, 2) };
  });

  const id = newArmyId(state);
  const army: Army = {
    id,
    faction: INDEPENDENT_ID,
    location: seat.id,
    regiments,
    general: claimant,
    movement: 0,
    embarked: false,
  };
  state.armies.set(id, army);
  return id;
}

// ---------------------------------------------------------------------------
// How it ends
// ---------------------------------------------------------------------------

export type CivilWarOutcome = 'crown' | 'pretender' | 'abandoned';

/**
 * Checks every running war for an ending.
 *
 * Three ways out. The pretender reaches the capital and is king. The crown
 * takes back everything that declared and kills or scatters his armies. Or
 * nobody wins for a generation and the cause dies with its moment.
 */
export function progressCivilWars(state: CampaignState): void {
  for (const [crown, war] of [...state.civilWars]) {
    const faction = state.factions.get(crown);
    if (!faction?.alive) {
      // There is no crown left to fight over.
      finish(state, war, 'abandoned');
      continue;
    }
    // Armies that no longer exist are not his.
    const standing = war.armies.filter((id) => state.armies.has(id));
    war.armies.length = 0;
    war.armies.push(...standing);

    const capital = faction.capital;
    const holdsCapital =
      capital !== undefined && state.regions.get(capital)?.owner === INDEPENDENT_ID;
    if (holdsCapital) {
      finish(state, war, 'pretender');
      continue;
    }

    const stillDeclared = war.provinces.filter(
      (id) => state.regions.get(id)?.owner === INDEPENDENT_ID,
    );
    if (stillDeclared.length === 0 && standing.length === 0) {
      finish(state, war, 'crown');
      continue;
    }
    if (state.turn >= war.expires) {
      finish(state, war, 'abandoned');
    }
  }
}

function finish(state: CampaignState, war: CivilWar, outcome: CivilWarOutcome): void {
  state.civilWars.delete(war.crown);
  const faction = state.factions.get(war.crown);
  const realm = tryGetFaction(war.crown)?.name ?? 'the realm';

  if (outcome === 'pretender' && faction) {
    // He has the capital, so he has the crown. Everything that declared for
    // him comes with him, and the realm is whole again under a new king.
    for (const province of state.regions.values()) {
      const declared = war.provinces.includes(province.id);
      const capital = province.id === faction.capital;
      if ((declared || capital) && province.owner === INDEPENDENT_ID) {
        transferProvince(state, province.id, war.crown);
      }
    }
    // His forces become the realm's: they are the king's men now, which is
    // the whole of what he was fighting for. Faction is fixed on an army, so
    // each is re-raised under the crown.
    for (const id of war.armies) {
      const army = state.armies.get(id);
      if (!army) continue;
      state.armies.delete(id);
      const fresh = newArmyId(state);
      state.armies.set(fresh, { ...army, id: fresh, faction: war.crown });
    }
    // The old king is deposed. He does not stay at court as a private
    // gentleman: a deposed king is a pretender waiting to happen, and the men
    // who won did not leave him sitting there.
    const deposed = faction.characters.find((character) => character.leader);
    if (deposed) {
      faction.characters = faction.characters.filter(
        (character) => character.id !== deposed.id,
      );
      for (const province of state.regions.values()) {
        if (province.governor?.id === deposed.id) province.governor = undefined;
      }
      for (const army of state.armies.values()) {
        if (army.general?.id === deposed.id) army.general = undefined;
      }
      logEvent(state, war.crown, `${deposed.name} is deposed.`);
    }
    for (const character of faction.characters) character.leader = false;
    const king = { ...war.claimant, faction: war.crown, leader: true };
    king.name = nameRuler(faction, givenNameOf(war.claimant));
    faction.characters.push(king);
    faction.crowned.push(king.id as string);
    faction.legitimacy = 75;
    logEvent(state, war.crown, `${king.name} takes the capital, and with it ${realm}.`);
    return;
  }

  if (outcome === 'crown') {
    if (faction) faction.legitimacy = Math.min(100, faction.legitimacy + 20);
    logEvent(state, war.crown, `The rising against ${realm} is put down.`);
    return;
  }

  // Abandoned: the pretender's men go home and his provinces stay out of the
  // realm's hands, which is the worst of both for the crown.
  for (const id of war.armies) state.armies.delete(id);
  logEvent(state, war.crown, `${war.claimant.name}'s cause is abandoned.`);
}

/** Every province currently standing with a pretender. */
export function provincesInRevolt(state: CampaignState, crown: FactionId): RegionId[] {
  const war = state.civilWars.get(crown);
  if (!war) return [];
  return war.provinces.filter((id) => state.regions.get(id)?.owner === INDEPENDENT_ID);
}

/** How the war stands, for the panel. */
export function civilWarStanding(
  state: CampaignState,
  crown: FactionId,
): { held: number; declared: number; men: number; seasonsLeft: number } | undefined {
  const war = state.civilWars.get(crown);
  if (!war) return undefined;
  let men = 0;
  for (const id of war.armies) {
    const army = state.armies.get(id);
    if (army) men += strengthOf(army.regiments);
  }
  return {
    held: provincesHeld(state, crown).length,
    declared: provincesInRevolt(state, crown).length,
    men,
    seasonsLeft: Math.max(0, war.expires - state.turn),
  };
}
