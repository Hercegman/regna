/**
 * Factions entering and leaving play.
 *
 * Polities that did not exist in 1080 are not backdated onto the start map.
 * They appear in their own year, in the province that was historically their
 * seat, by rising against whoever holds it. That way the campaign timeline
 * stays honest: the Ottomans cannot be fought in the eleventh century, and
 * Burgundy is a fifteenth-century problem.
 */
import type { FactionId, RegionId } from '../types';
import type { CampaignState } from './state';
import { factionState, givenName, logEvent, nameRuler, newArmyId, newCharacter } from './state';
import { foundCourt } from './dynasty';
import { FACTIONS, getFaction, INDEPENDENT_ID } from '../data/factions';
import { generalUnitFor } from '../data/roster';
import { getRegion } from '../data/regions';
import { landRosterFor } from '../data/roster';
import type { Rng } from '../rng';
import { initialAttitude, setStance, adjustAttitude } from './diplomacy';

/**
 * Where each later faction first appears. Each is the polity's historical
 * seat at the moment it became a state in its own right.
 */
export const EMERGENCE_SEATS: Readonly<Record<string, string>> = {
  florence: 'florence',
  portugal: 'porto',
  burgundy: 'dijon',
  austria: 'vienna',
  switzerland: 'schwyz',
  lithuania: 'vilnius',
  teutonic_order: 'prussia',
  novgorod: 'novgorod',
  muscovy: 'moscow',
  bulgaria: 'tarnovo',
  bosnia: 'vrhbosna',
  wallachia: 'targoviste',
  albania: 'kruje',
  trebizond: 'trebizond',
  jerusalem: 'jerusalem',
  antioch: 'antioch',
  hospitallers: 'rhodes',
  cyprus: 'nicosia',
  ayyubids: 'cairo',
  mamluks: 'cairo',
  ottomans: 'nicaea',
  khwarazm: 'derbent',
  almohads: 'marrakesh',
  granada: 'granada',
  hafsids: 'tunis',
  marinids: 'fez',
  mongols: 'donets',
  golden_horde: 'azov',
  timurids: 'saksin',
  crimean_khanate: 'soldaia',
  mali: 'niani',
  ethiopia: 'adefa',
};

/** Factions due to appear this year, in a stable order. */
export function dueThisYear(state: CampaignState): readonly FactionId[] {
  return FACTIONS.filter((faction) => {
    if (faction.appearsIn !== state.year) return false;
    const existing = state.factions.get(faction.id);
    return !!existing && !existing.alive && existing.joinedOn < 0;
  }).map((faction) => faction.id);
}

/** Brings one faction into play, if its seat can be taken from its holder. */
export function emerge(state: CampaignState, id: FactionId, rng: Rng): boolean {
  const seatId = EMERGENCE_SEATS[id as string];
  if (!seatId) return false;
  const seat = state.regions.get(seatId as RegionId);
  if (!seat) return false;

  const faction = factionState(state, id);
  const definition = getFaction(id);
  const previousOwner = seat.owner;

  seat.owner = id;
  seat.ownedSince = state.turn;
  seat.siege = undefined;
  seat.construction = undefined;
  seat.recruitQueue = [];
  seat.governor = undefined;
  // A new state begins with its people unsettled but not in revolt.
  seat.unrest = Math.min(100, seat.unrest + 15);

  faction.alive = true;
  faction.joinedOn = state.turn;
  faction.capital = seat.id;
  faction.treasury = 1800;

  // Relations start from the baseline its faith and culture imply, except with
  // the power it just rose against.
  for (const other of state.factions.keys()) {
    if (other === id || other === INDEPENDENT_ID) continue;
    faction.relations.set(other, {
      stance: 'neutral',
      attitude: initialAttitude(id, other),
      since: state.turn,
    });
    const otherState = state.factions.get(other);
    otherState?.relations.set(id, {
      stance: 'neutral',
      attitude: initialAttitude(other, id),
      since: state.turn,
    });
  }
  if (
    previousOwner !== id &&
    previousOwner !== INDEPENDENT_ID &&
    state.factions.get(previousOwner)?.alive
  ) {
    setStance(state, id, previousOwner, 'war');
    adjustAttitude(state, previousOwner, id, -40);
    adjustAttitude(state, id, previousOwner, -25);
  }

  // A founding army and a leader.
  const leader = newCharacter(state, id, {
    sex: 'm',
    leader: true,
    name: nameRuler(faction, givenName(id, 'm', rng)),
    command: rng.int(4, 8),
    governance: rng.int(3, 7),
    guile: rng.int(2, 7),
    age: rng.int(28, 46),
  });
  faction.crowned.push(leader.id as string);
  faction.characters.push(leader);
  foundCourt(state, id, leader, rng);
  // He rides with the founding army rather than sitting in the seat he has
  // just taken; one man cannot do both, and the court will post a governor.

  // Land regiments only: a new state's founding army marches, it does not sail,
  // and the full roster includes its hulls.
  const roster = landRosterFor(definition, state.year).filter(
    (unit) => unit.unitClass !== 'general' && unit.tier <= 3,
  );
  const general = generalUnitFor(definition);
  const regiments = [
    { type: general.id, soldiers: general.soldiers, experience: 2 },
    ...Array.from({ length: 5 }, () => {
      const unit = rng.pick(roster.length > 0 ? roster : [general]);
      return { type: unit.id, soldiers: unit.soldiers, experience: rng.int(0, 2) };
    }),
  ];
  const armyKey = newArmyId(state);
  state.armies.set(armyKey, {
    id: armyKey,
    faction: id,
    location: seat.id,
    regiments,
    general: leader,
    movement: 0,
    embarked: false,
  });

  logEvent(
    state,
    id,
    `${definition.name} rises at ${getRegion(seat.id).settlement}.`,
  );
  return true;
}

/** Marks factions with no provinces left as destroyed. */
export function reapDeadFactions(state: CampaignState): void {
  const held = new Set<FactionId>();
  for (const region of state.regions.values()) held.add(region.owner);
  for (const [id, faction] of state.factions) {
    if (!faction.alive || faction.destroyedOn !== undefined) continue;
    if (held.has(id)) continue;
    // Still alive while it has an army in the field: a landless faction can
    // reconquer, which is how more than one medieval state survived.
    const hasArmy = [...state.armies.values()].some((army) => army.faction === id);
    if (hasArmy) continue;
    faction.alive = false;
    faction.destroyedOn = state.turn;
    // Everything the state was running stops with it. A man in the field for a
    // prince who no longer exists has nobody to report to and nobody to pay
    // him, and leaving him standing there was letting dead realms go on
    // converting provinces and buying out merchants.
    for (const [key, agent] of [...state.agents]) {
      if (agent.faction === id) state.agents.delete(key);
    }
    for (const [key, caravan] of [...state.caravans]) {
      if (caravan.faction === id) state.caravans.delete(key);
    }
    logEvent(state, id, `${getFaction(id).name} ceases to exist.`);
  }
}
