/**
 * Campaign AI.
 *
 * One routine per faction per turn, in four stages: money, diplomacy, defence,
 * offence. It plays by exactly the player's rules, through the same order
 * functions, so anything the AI does the player can do and anything it cannot
 * do is a missing order rather than a cheat.
 */
import type { BuildingId, FactionId, RegionId } from '../types';
import { SETTLEMENT_ORDER, UNIT_ROLE } from '../types';
import type { Army, CampaignState, RegionState } from './state';
import type { Fleet } from './state';
import { factionState, fleetCapacity, fleetsInZone, fleetsOf, isAtWar, provincesOf, strengthOf } from './state';
import {
  appointGeneral,
  availableBuildings,
  mergeArmies,
  movementBudget,
  setGovernor,
  unassignedCharacters,
  sortieFromGarrison,
  militaryStrength,
  moveArmy,
  recruitCost,
  recruitableUnits,
  startConstruction,
  startRecruitment,
  disbandRegiment,
  transferProvince,
  beginSiege,
  MAX_RECRUIT_QUEUE,
  MAX_GARRISON_REGIMENTS,
  MAX_ARMY_REGIMENTS,
} from './actions';
import { annualNet, factionFinances } from './economy';
import { getBuildingType } from '../data/buildings';
import { getUnitType } from '../data/units';
import { tryGetFaction, INDEPENDENT_ID } from '../data/factions';
import { landNeighbours, seaNeighbours } from '../data/adjacency';
import {
  allianceCause,
  canMakePeace,
  countWars,
  declareWar,
  enemiesOf,
  makePeace,
  proposeAlliance,
  proposeTrade,
  relation,
  shareBorder,
  shareSeaLane,
  warDesire,
} from './diplomacy';
import { applyBattleResult, autoResolve, planBattle, planNavalBattle, assaultOdds } from './resolve';
import {
  buildableShips,
  disembark,
  embark,
  moveFleet,
  nextLegTowards,
  reachableWaters,
  routeOverSea,
  shipCost,
  startShipbuilding,
} from './naval';
import type { SeaZoneId } from '../data/seas';
import { SEA_ZONE_IDS, getSeaZone, zonesOffPort, zoneServesPort } from '../data/seas';
import {
  canHire,
  canPoach,
  hireMercenary,
  isMercenary,
  mercenaryUpkeep,
  offersAt,
  poachCompany,
  poachable,
} from './mercenaries';
import type { Poach } from './mercenaries';
import { estimatedGarrison, watchedProvinces } from './sight';
import {
  canMarry,
  marriageOdds,
  marriageable,
  marriedTo,
  proposeMarriage,
} from './dynasty';
import type { Agent } from './state';
import type { AgentKind } from '../data/agents';
import { getAgentType } from '../data/agents';
import type { MissionKind, MissionOffer } from './agents';
import {
  MAX_AGENTS,
  agentsAt,
  agentsOf,
  attemptMission,
  canRecruitAgent,
  merchantIncome,
  missionsFor,
  moveAgent,
  victimAt,
  recruitAgent,
} from './agents';
import {
  absolutionPrice,
  canJoinHolyWar,
  donate,
  holyWarHolder,
  isCensured,
  isSworn,
  joinHolyWar,
  seekAbsolution,
  standingOf,
} from './faith';
import type { TradeRoute } from '../data/trade';
import {
  activeRoutesThrough,
  canDispatch,
  caravanOutlay,
  dispatchCaravan,
  expectedReturn,
} from './caravans';
import { getRegion } from '../data/regions';
import type { Rng } from '../rng';

export function takeAiTurn(state: CampaignState, id: FactionId, rng: Rng): void {
  manageEconomy(state, id, rng);
  manageTrade(state, id, rng);
  manageDiplomacy(state, id, rng);
  manageArmies(state, id, rng);
  manageNavy(state, id, rng);
  manageMercenaries(state, id, rng);
  poachCompanies(state, id, rng);
  manageFaith(state, id, rng);
  manageCourt(state, id);
  manageMarriages(state, id, rng);
  manageAgents(state, id, rng);
}

/**
 * Marrying the house off.
 *
 * A marriage is the cheapest instrument in the game: it costs nothing but a
 * daughter and it buys twenty-five points of goodwill from a neighbour who
 * might otherwise have invaded. Realms therefore marry the people they are
 * most worried about, which is what they did.
 */
function manageMarriages(state: CampaignState, id: FactionId, rng: Rng): void {
  const faction = factionState(state, id);
  if (marriageable(faction).length === 0) return;
  // One offer a year at most. These were not made lightly and the refusals
  // cost something.
  if (state.season !== 'summer' || !rng.chance(0.3)) return;

  const offers: { other: FactionId; worth: number }[] = [];
  for (const [other, theirs] of state.factions) {
    if (other === id || other === INDEPENDENT_ID || !theirs.alive) continue;
    if (!canMarry(state, id, other).ok) continue;
    if (marriedTo(state, id, other)) continue;
    const bond = relation(state, id, other);
    // Worth most with a strong neighbour we are not yet sure of, and nothing
    // at all with somebody we already have a treaty and a marriage with.
    let worth = marriageOdds(state, id, other) * 100;
    if (shareBorder(state, id, other)) worth += 40;
    if (bond.stance === 'alliance') worth -= 20;
    worth += Math.min(40, militaryStrength(state, other) / 400);
    offers.push({ other, worth });
  }
  offers.sort((a, b) => b.worth - a.worth);
  const best = offers[0];
  if (!best || best.worth < 40) return;
  proposeMarriage(state, id, best.other, rng);
}

// ---------------------------------------------------------------------------
// The court
// ---------------------------------------------------------------------------

/**
 * Giving the king's men something to do.
 *
 * Characters existed from the first commit and were almost never posted
 * anywhere: one army in seventy-five had a commander and one province in two
 * hundred had a governor, so command and governance ratings were being rolled,
 * saved and ignored. A man is worth more at the head of a field army than
 * sitting at court, and worth more governing a rich province than a poor one,
 * so that is the order they go out in.
 */
function manageCourt(state: CampaignState, id: FactionId): void {
  const armies = [...state.armies.values()]
    .filter((army) => army.faction === id && !army.general)
    .sort((a, b) => strengthOf(b.regiments) - strengthOf(a.regiments));
  const provinces = provincesOf(state, id)
    .filter((province) => !province.governor)
    .sort((a, b) => b.population - a.population);

  for (const army of armies) {
    // A escort of two regiments does not need a king's son at its head.
    if (army.regiments.length < 3) continue;
    const free = unassignedCharacters(state, id);
    if (free.length === 0) return;
    const best = [...free].sort((a, b) => b.command - a.command)[0]!;
    // A man with no talent for it is better left governing.
    if (best.command < 3 && provinces.length > 0) break;
    appointGeneral(state, army.id, best.id as string);
  }

  for (const province of provinces) {
    const free = unassignedCharacters(state, id);
    if (free.length === 0) return;
    const best = [...free].sort((a, b) => b.governance - a.governance)[0]!;
    setGovernor(state, province.id, best.id as string);
  }
}

// ---------------------------------------------------------------------------
// Men who are not soldiers
// ---------------------------------------------------------------------------

/**
 * The establishment abroad.
 *
 * A ruler raises a few men when he can afford them, sends each towards the
 * work his kind is for, and uses him when he gets there. The doctrine is
 * deliberately plain, because what makes agents interesting is not clever play
 * but that both sides are doing it: the player's spy is caught by somebody's
 * counter-spy, not by a die roll.
 */
function manageAgents(state: CampaignState, id: FactionId, rng: Rng): void {
  const faction = factionState(state, id);
  const provinces = provincesOf(state, id);
  if (provinces.length === 0) return;

  const mine = agentsOf(state, id);
  // A realm keeps roughly one man abroad for every three provinces, and never
  // starves its army to do it.
  const wanted = Math.min(MAX_AGENTS, 1 + Math.floor(provinces.length / 3));
  if (mine.length < wanted) raiseAgent(state, id, provinces, rng);

  for (const agent of agentsOf(state, id)) {
    employAgent(state, faction.id, agent, rng);
  }
}

/**
 * Whether the realm can carry one more man.
 *
 * An agent is not judged the way a regiment is. A regiment is a standing
 * charge against a revenue; an agent is a purchase out of the treasury with a
 * small charge after it, and in the case of a factor a charge that is
 * negative — he sends home more than he costs. Running agents through the
 * army's reserve test is what kept all but a handful of realms out of the
 * business entirely.
 */
function canCarryAgent(state: CampaignState, id: FactionId, kind: AgentKind): boolean {
  const faction = factionState(state, id);
  const type = getAgentType(kind);
  // The purchase, with something left over afterwards.
  if (faction.treasury < type.cost + 250) return false;
  if (kind === 'merchant') return true;
  // The charge, against a year's revenue. A small deficit is survivable; the
  // retrenchment pass will pay off a regiment before it dismisses a priest.
  return annualNet(state, id) - type.upkeep > -25;
}

function raiseAgent(
  state: CampaignState,
  id: FactionId,
  provinces: readonly RegionState[],
  rng: Rng,
): void {
  const have = agentsOf(state, id);
  // What the realm is short of. A state with a province of the wrong faith
  // wants a priest; one with neighbours wants an envoy and a spy; everybody
  // wants a merchant, because a merchant pays for himself.
  const want: AgentKind[] = [];
  const own = tryGetFaction(id)?.religion;
  const has = (kind: AgentKind): boolean => have.some((agent) => agent.kind === kind);

  if (own && provinces.some((province) => province.religion !== own) && !has('priest')) {
    want.push('priest');
  }
  // An envoy is worth having the moment somebody is ill disposed towards us,
  // which is almost always.
  if (!has('envoy') && illDisposed(state, id)) want.push('envoy');
  if (!has('spy') && countWars(state, id) > 0) want.push('spy');
  if (!has('merchant')) want.push('merchant');
  if (own && provinces.some((province) => province.religion !== own)) want.push('priest');
  if (!has('spy')) want.push('spy');
  // Factors pay for themselves, so without a check a realm ends up with
  // nothing else. No prince staffed his whole establishment with merchants.
  const factors = have.filter((agent) => agent.kind === 'merchant').length;
  if (factors <= have.length / 2) want.push('merchant');
  want.push('spy', 'envoy');

  for (const kind of want) {
    if (!canCarryAgent(state, id, kind)) continue;
    for (const province of provinces) {
      if (!canRecruitAgent(state, province.id, kind).ok) continue;
      recruitAgent(state, province.id, kind, rng);
      return;
    }
  }
}

/** True when some realm we can reach thinks ill of us. */
function illDisposed(state: CampaignState, id: FactionId): boolean {
  for (const [other, faction] of state.factions) {
    if (other === id || other === INDEPENDENT_ID || !faction.alive) continue;
    if (relation(state, other, id).attitude < 0) return true;
  }
  return false;
}

/** Sends one man one step towards his work, and sets him to it when he arrives. */
function employAgent(state: CampaignState, id: FactionId, agent: Agent, rng: Rng): void {
  // First, do whatever can be done where he stands.
  const here = missionsFor(state, agent.id);
  const choice = chooseMission(state, agent, here, rng);
  if (choice) {
    attemptMission(state, agent.id, choice, rng);
    return;
  }

  // Otherwise walk towards somewhere he would be useful. One step a turn
  // towards the nearest province that wants his trade is enough: agents are
  // slow on purpose, and a man in transit is a commitment already made.
  const target = postingFor(state, id, agent);
  if (!target) return;
  while (agent.movement > 0 && agent.location !== target) {
    const step = agentStep(agent.location, target);
    if (!step) return;
    if (!moveAgent(state, agent.id, step).ok) return;
  }
  const arrived = missionsFor(state, agent.id);
  const next = chooseMission(state, agent, arrived, rng);
  if (next) attemptMission(state, agent.id, next, rng);
}

function chooseMission(
  state: CampaignState,
  agent: Agent,
  offers: readonly MissionOffer[],
  rng: Rng,
): MissionKind | undefined {
  if (offers.length === 0) return undefined;
  const faction = factionState(state, agent.faction);
  const region = state.regions.get(agent.location);
  if (!region) return undefined;
  const atWar = region.owner !== agent.faction && isAtWar(state, agent.faction, region.owner);

  const worth = (offer: MissionOffer): number => {
    if (offer.cost > faction.treasury) return -1;
    // Nobody spends a man on a long shot.
    if (offer.chance < 0.35) return -1;
    let value = offer.chance * 100;
    switch (offer.kind) {
      case 'unmask':
      case 'preach':
        break;
      case 'sabotage':
        value += region.siege?.besieger === agent.faction ? 60 : atWar ? 20 : -40;
        break;
      case 'incite': {
        // There is no point stirring a province that is already in uproar.
        const room = Math.max(0, 85 - region.unrest) / 85;
        value += (atWar ? 35 : -45) * room - (1 - room) * 25;
        break;
      }
      case 'assassinate': {
        const victim = victimAt(state, region);
        if (!victim) {
          value -= 80;
          break;
        }
        // Killing the man commanding an army in the field is worth the risk
        // and the insult; murdering a governor in peacetime is not.
        value += atWar ? (victim.commanding ? 70 : 25) : -70;
        break;
      }
      case 'treat':
        value += 20;
        break;
      case 'bribe':
        // Buying goodwill is for a realm that has money to spare for it.
        value += faction.treasury > offer.cost * 6 ? 10 : -50;
        break;
      case 'buy_out':
        value += faction.treasury > offer.cost * 5 ? 25 : -40;
        break;
    }
    // A man sent on a mission that is likely to lose him is a man wasted.
    value -= offer.peril * (1 - offer.chance) * 120;
    return value;
  };

  const ranked = offers
    .map((offer) => ({ offer, score: worth(offer) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) return undefined;
  // A little hesitation, so two realms with the same doctrine do not act in
  // lockstep every single turn.
  if (rng.next() > 0.8) return undefined;
  return best.offer.kind;
}

/**
 * One step along the shortest way there, over any border at all.
 *
 * Deliberately not the army pathfinder: an agent crosses a closed frontier,
 * takes passage on somebody else's ship, and walks through a war. That is what
 * he is for.
 */
function agentStep(from: RegionId, goal: RegionId): RegionId | undefined {
  if (from === goal) return undefined;
  const seen = new Set<RegionId>([from]);
  let frontier: { id: RegionId; first: RegionId }[] = [];
  for (const id of anyNeighbours(from)) {
    if (seen.has(id)) continue;
    seen.add(id);
    frontier.push({ id, first: id });
  }
  for (let depth = 0; depth < 14 && frontier.length > 0; depth++) {
    for (const entry of frontier) if (entry.id === goal) return entry.first;
    const next: { id: RegionId; first: RegionId }[] = [];
    for (const entry of frontier) {
      for (const neighbour of anyNeighbours(entry.id)) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        next.push({ id: neighbour, first: entry.first });
      }
    }
    frontier = next;
  }
  return undefined;
}

function anyNeighbours(id: RegionId): readonly RegionId[] {
  return [...landNeighbours(id), ...seaNeighbours(id)];
}

/**
 * Roughly how far apart two provinces are, in degrees of travel. Good enough
 * to rank postings, and far cheaper than a search from every candidate.
 */
function apart(a: RegionId, b: RegionId): number {
  const from = getRegion(a);
  const to = getRegion(b);
  const scale = Math.cos(((from.lat + to.lat) / 2) * (Math.PI / 180));
  return Math.hypot((from.lon - to.lon) * scale, from.lat - to.lat);
}

/** Where this man ought to be standing. */
function postingFor(state: CampaignState, id: FactionId, agent: Agent): RegionId | undefined {
  const own = tryGetFaction(id)?.religion;
  let best: RegionId | undefined;
  let bestScore = 0;
  for (const region of state.regions.values()) {
    const foreign = region.owner !== id;
    let score = 0;
    switch (agent.kind) {
      case 'priest':
        // The nearest province of the wrong faith, ours first.
        if (own && region.religion !== own) score = foreign ? 40 : 70;
        break;
      case 'merchant': {
        const worth = merchantIncome(state, { ...agent, location: region.id });
        score = worth;
        break;
      }
      case 'spy': {
        if (region.siege?.besieger === id) score = 120;
        else if (foreign && isAtWar(state, id, region.owner)) score = 60;
        else if (!foreign && agentsAt(state, region.id).some((a) => a.faction !== id)) score = 80;
        // An enemy commander standing somewhere reachable is the one target
        // worth crossing a kingdom for.
        const victim = victimAt(state, region);
        if (victim && victim.commanding && isAtWar(state, id, victim.faction)) score += 90;
        break;
      }
      case 'envoy':
        if (foreign && region.owner !== INDEPENDENT_ID && state.factions.get(region.owner)?.capital === region.id) {
          score = 40 + Math.max(0, -relation(state, id, region.owner).attitude);
        }
        break;
    }
    if (score <= 0) continue;
    // Distance is the whole cost of an agent's life, so it dominates.
    score -= apart(agent.location, region.id) * 3.5;
    if (score > bestScore) {
      bestScore = score;
      best = region.id;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The authority of the faith
// ---------------------------------------------------------------------------

/**
 * A ruler's dealings with the authority of his own faith: take the cross when
 * it is preached and he can reach the place, buy absolution when he is under
 * censure and can afford it, and give to the church when he is in bad odour
 * and rich.
 */
function manageFaith(state: CampaignState, id: FactionId, rng: Rng): void {
  const faction = factionState(state, id);

  // 1. Under censure, the first business is getting out from under it.
  if (isCensured(state, id)) {
    const price = absolutionPrice(state, id);
    if (faction.treasury > price * 2 && rng.chance(0.5)) seekAbsolution(state, id);
    return;
  }

  // 2. A ruler in bad odour and in funds gives to the church, as they did.
  if (standingOf(state, id) < -20 && faction.treasury > 6000 && rng.chance(0.3)) {
    donate(state, id, Math.min(2500, Math.floor(faction.treasury / 4)));
  }

  // 3. Taking the cross. The vow commits a realm to a war, so it is only worth
  // making when the place can actually be reached.
  if (!state.faith.holyWar) return;
  if (!canJoinHolyWar(state, id).ok) return;
  const holder = holyWarHolder(state);
  if (!holder || holder === id) return;

  const reachable =
    shareBorder(state, id, holder) ||
    shareSeaLane(state, id, holder) ||
    fleetsOf(state, id).some((fleet) => fleetCapacity(fleet) > 0);
  if (!reachable) return;
  // A realm already fighting on two fronts has no men to spare for a vow.
  if (countWars(state, id) > 1 && !rng.chance(0.25)) return;
  if (!rng.chance(0.45)) return;

  if (joinHolyWar(state, id).ok) {
    // Taking the cross is a declaration of war on whoever holds the place.
    if (!isAtWar(state, id, holder)) declareWar(state, id, holder);
  }
}

// ---------------------------------------------------------------------------
// Hired companies
// ---------------------------------------------------------------------------

/**
 * Mercenaries are what a realm buys when it needs soldiers now and cannot wait
 * four turns for a muster, or when it has money and no men. The AI hires under
 * exactly those conditions and not otherwise, because a company costs nearly
 * twice a levy to keep.
 */
/**
 * Buying somebody else's soldiers out from under him.
 *
 * Only possible against a realm that has stopped paying, which is the whole
 * point: it turns an enemy's bankruptcy into an immediate military loss and
 * gives a solvent realm something to spend its money on besides more of its
 * own troops. Worth most when the company is standing somewhere we are
 * fighting.
 */
function poachCompanies(state: CampaignState, id: FactionId, rng: Rng): void {
  const faction = factionState(state, id);
  const offers = poachable(state, id)
    .filter((offer) => canPoach(state, id, offer).ok)
    .sort((a, b) => value(state, id, b) - value(state, id, a));
  // Judged as a purchase with a wage after it, not against the reserve an
  // army is planned from: a company bought out is bought today and paid for
  // from here on, and running it through the standing-charge test meant no
  // realm ever bought one.
  const revenue = annualNet(state, id);
  let bought = 0;
  for (const offer of offers) {
    if (bought >= 2) break;
    if (faction.treasury < offer.cost + 400) continue;
    if (revenue - mercenaryUpkeep(offer.regiment.type) < -40) continue;
    // Not every season and not every company: a realm that took every offer
    // the moment it appeared would strip a bankrupt enemy bare in one turn,
    // which is neither interesting nor what happened.
    if (!rng.chance(0.4)) continue;
    if (!poachCompany(state, id, offer).ok) continue;
    bought += 1;
  }
}

/** What a company is worth to us where it is standing. */
function value(state: CampaignState, id: FactionId, offer: Poach): number {
  const type = getUnitType(offer.regiment.type);
  let worth = type.cost + type.tier * 60;
  // A company standing in or beside something of ours is worth most, because
  // taking it away is also taking it off our frontier.
  const here = state.regions.get(offer.where);
  if (here?.owner === id) worth += 200;
  else if (landNeighbours(offer.where).some((next) => state.regions.get(next)?.owner === id)) {
    worth += 100;
  }
  return worth;
}

function manageMercenaries(state: CampaignState, id: FactionId, rng: Rng): void {
  const wars = countWars(state, id);
  if (wars === 0) return;

  const faction = factionState(state, id);
  const reserve = Math.max(600, annualNet(state, id) * 2);
  let headroom = spendingPower(state, id, reserve);
  if (headroom <= 0) return;

  // Where we need them: a threatened province of ours, or an army in the field.
  const places: RegionId[] = [];
  for (const province of provincesOf(state, id)) {
    if (isThreatened(state, province)) places.push(province.id);
  }
  for (const army of state.armies.values()) {
    if (army.faction === id && !places.includes(army.location)) places.push(army.location);
  }

  let hired = 0;
  for (const region of places) {
    if (hired >= 2) break;
    const offers = offersAt(state, region)
      .filter((offer) => canHire(state, region, offer.pool.id, id).ok)
      .sort((a, b) => getUnitType(b.unit).tier - getUnitType(a.unit).tier);
    for (const offer of offers) {
      if (hired >= 2) break;
      if (faction.treasury - offer.cost < reserve) continue;
      if (headroom - offer.upkeep <= 0) continue;
      // A company is a stopgap, not a standing establishment.
      if (!rng.chance(0.5)) continue;
      if (hireMercenary(state, region, offer.pool.id, id).ok) {
        headroom -= offer.upkeep;
        hired += 1;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Trade
// ---------------------------------------------------------------------------

/**
 * Sending a caravan is an investment: money now against more money later, if
 * the road holds. The AI takes the wager when the odds are clearly in its
 * favour and leaves it alone when the road is cut, which is the same judgement
 * the player is being asked to make.
 */
function manageTrade(state: CampaignState, id: FactionId, rng: Rng): void {
  const faction = factionState(state, id);
  const provinces = provincesOf(state, id);
  if (provinces.length === 0) return;

  const reserve = Math.max(400, annualNet(state, id) * 2);
  let sent = 0;
  const limit = 2;

  // Consider the best wager available in each province, richest road first.
  const offers: { region: RegionId; route: TradeRoute; gain: number; outlay: number }[] = [];
  for (const province of provinces) {
    for (const route of activeRoutesThrough(state, province.id)) {
      if (!canDispatch(state, province.id, route.id).ok) continue;
      const outlay = caravanOutlay(route);
      const gain = expectedReturn(state, id, route, province.id);
      if (gain <= outlay * 1.35) continue;
      offers.push({ region: province.id, route, gain, outlay });
    }
  }
  offers.sort((a, b) => b.gain - b.outlay - (a.gain - a.outlay));

  for (const offer of offers) {
    if (sent >= limit) break;
    if (faction.treasury - offer.outlay < reserve) continue;
    // A merchant state trades more readily than a landed one.
    const appetite = (tryGetFaction(id)?.traits.trade ?? 0) > 0.2 ? 0.9 : 0.55;
    if (!rng.chance(appetite)) continue;
    if (dispatchCaravan(state, offer.region, offer.route.id).ok) sent += 1;
  }
}

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

/**
 * What a realm can commit to this turn beyond its income.
 *
 * A prince with a full treasury can keep a larger establishment than his
 * annual revenue supports, for as long as the hoard lasts. Without this the AI
 * spent income only and never capital, so a rich state sat on its money while
 * its neighbours out-built it.
 */
function spendingPower(state: CampaignState, id: FactionId, reserve: number): number {
  const treasury = factionState(state, id).treasury;
  const spare = Math.max(0, treasury - reserve);
  // Willing to fund about twenty-five turns of extra upkeep out of savings.
  return annualNet(state, id) + spare / 25;
}

/**
 * What the AI wants to spend on. It keeps a reserve proportional to its army,
 * builds in its best provinces first, and recruits when it is at war or weak.
 */
function manageEconomy(state: CampaignState, id: FactionId, rng: Rng): void {
  const faction = factionState(state, id);
  const finances = factionFinances(state, id);
  const provinces = provincesOf(state, id);
  if (provinces.length === 0) return;

  // Before spending anything, pay off what the realm can no longer afford. A
  // commander who is losing provinces reduces his establishment; waiting for
  // the treasury to hit zero and having regiments taken away is the failure
  // state, not the plan.
  retrench(state, id);

  const atWar = countWars(state, id) > 0;
  // Keep enough in hand to pay upkeep for several turns.
  const winterShortfall = Math.max(0, -factionFinances(state, id, 'winter').net);
  const reserve = Math.max(
    500,
    (finances.armyUpkeep + finances.garrisonUpkeep) * 3,
    winterShortfall * 6,
  );

  // --- recruitment first when threatened, building first when safe
  const threatened = provinces.filter((province) => isThreatened(state, province));
  const recruitBias = atWar ? 0.7 : 0.25;

  if (rng.chance(recruitBias)) {
    recruitWhereNeeded(state, id, threatened.length > 0 ? threatened : provinces, reserve, rng);
    buildSomething(state, id, provinces, reserve, rng);
  } else {
    buildSomething(state, id, provinces, reserve, rng);
    recruitWhereNeeded(state, id, threatened.length > 0 ? threatened : provinces, reserve, rng);
  }

  // A faction sitting on a fortune and nothing to do raises more troops.
  if (faction.treasury > reserve * 4) {
    recruitWhereNeeded(state, id, provinces, reserve, rng);
  }
}

/**
 * Disbands the troops the realm cannot pay for, cheapest establishment first:
 * garrison regiments in quiet provinces before anything in the field.
 */
function retrench(state: CampaignState, id: FactionId): void {
  let budget = annualNet(state, id);
  if (budget >= 0) return;
  const faction = factionState(state, id);
  // A realm with money in hand can run a deficit for a while before cutting.
  const grace = faction.treasury / 8;
  if (budget + grace >= 0) return;

  const candidates: { upkeep: number; priority: number; disband: () => void }[] = [];
  for (const province of provincesOf(state, id)) {
    const exposed = isThreatened(state, province);
    province.garrison.forEach((regiment, index) => {
      // Never strip a settlement completely: that invites revolt and capture.
      if (province.garrison.length <= 2) return;
      candidates.push({
        upkeep: getUnitType(regiment.type).upkeep,
        // Hired companies are paid off before anything of our own, and a
        // threatened province gives up its troops only when nothing else is
        // left to cut.
        priority: isMercenary(regiment) ? -1 : exposed ? 2 : 0,
        disband: () => disbandRegiment(state, province.id, index),
      });
    });
  }
  // Field regiments are the last to go: an army in being is what keeps the
  // realm's remaining provinces its own.
  for (const army of state.armies.values()) {
    if (army.faction !== id) continue;
    if (army.regiments.length <= 2) continue;
    army.regiments.forEach((regiment, index) => {
      const type = getUnitType(regiment.type);
      if (type.unitClass === 'general') return;
      candidates.push({
        upkeep: type.upkeep,
        priority: isMercenary(regiment) ? 1 : 3,
        disband: () => {
          army.regiments.splice(index, 1);
        },
      });
    });
  }
  candidates.sort((a, b) => a.priority - b.priority || b.upkeep - a.upkeep);
  for (const candidate of candidates) {
    if (budget >= 0) break;
    candidate.disband();
    budget += candidate.upkeep;
  }
  // Paying off the last regiment of a command dissolves the command.
  for (const [armyId, army] of [...state.armies]) {
    if (army.faction === id && army.regiments.length === 0) state.armies.delete(armyId);
  }
}

function isThreatened(state: CampaignState, province: RegionState): boolean {
  if (province.siege) return true;
  for (const neighbour of [...landNeighbours(province.id), ...seaNeighbours(province.id)]) {
    const other = state.regions.get(neighbour);
    if (!other) continue;
    if (other.owner !== province.owner && isAtWar(state, province.owner, other.owner)) return true;
    for (const army of state.armies.values()) {
      if (army.location === neighbour && isAtWar(state, province.owner, army.faction)) return true;
    }
  }
  return false;
}

/** Scores a building by what the province actually needs. */
function buildingScore(state: CampaignState, province: RegionState, building: BuildingId): number {
  const type = getBuildingType(building);
  const effects = type.effects;
  let score = 0;
  score += (effects.trade ?? 0) * 0.05;
  score += (effects.farming ?? 0) * 25;
  score += (effects.mining ?? 0) * 0.04;
  score += (effects.growth ?? 0) * 300;
  score += (effects.order ?? 0) * (province.unrest > 45 ? 6 : 2);
  score += (effects.garrison ?? 0) * (isThreatened(state, province) ? 5 : 1.5);
  score += (effects.conversion ?? 0) * (province.religion !== tryGetFaction(province.owner)?.religion ? 7 : 0.5);
  score += (effects.recruitExperience ?? 0) * 3;
  if (effects.walls) score += isThreatened(state, province) ? 10 : 4;
  if (effects.port) score += 5;
  score += (effects.roads ?? 0) * 12;
  // Cheap things first when money is short.
  return score / Math.sqrt(type.cost);
}

function buildSomething(
  state: CampaignState,
  id: FactionId,
  provinces: readonly RegionState[],
  reserve: number,
  rng: Rng,
): void {
  const faction = factionState(state, id);
  const candidates = provinces.filter((province) => !province.construction && !province.siege);
  if (candidates.length === 0) return;

  // A state with an idle province and money in the treasury starts something
  // there. Building in only one province a turn is what let the AI accumulate
  // a fortune it never used.
  const ranked: { province: RegionState; building: BuildingId; score: number }[] = [];
  for (const province of candidates) {
    let best: { province: RegionState; building: BuildingId; score: number } | undefined;
    for (const building of availableBuildings(state, province.id)) {
      const score = buildingScore(state, province, building) + rng.float(0, 0.3);
      if (!best || score > best.score) best = { province, building, score };
    }
    if (best) ranked.push(best);
  }
  ranked.sort((a, b) => b.score - a.score);
  // A building is a standing charge as much as a regiment is. The AI tracks
  // what it has left to spend as it commits, instead of judging every project
  // against the same untouched balance and then finding it cannot pay for any
  // of them.
  let headroom = spendingPower(state, id, reserve);
  for (const entry of ranked) {
    const type = getBuildingType(entry.building);
    if (faction.treasury - type.cost < reserve) continue;
    if (headroom - type.upkeep <= 0) continue;
    if (startConstruction(state, entry.province.id, entry.building).ok) {
      headroom -= type.upkeep;
    }
  }
}

function recruitWhereNeeded(
  state: CampaignState,
  id: FactionId,
  provinces: readonly RegionState[],
  reserve: number,
  rng: Rng,
): void {
  const faction = factionState(state, id);
  // Affordable means more than having the cash today: a regiment is a standing
  // charge, and raising one that tips the realm into deficit only leads to
  // disbanding it again a few turns later.
  let headroom = spendingPower(state, id, reserve);

  const targets = [...provinces]
    .filter(
      (province) =>
        !province.siege &&
        province.recruitQueue.length < MAX_RECRUIT_QUEUE &&
        province.garrison.length + province.recruitQueue.length < MAX_GARRISON_REGIMENTS,
    )
    .sort((a, b) => strengthOf(a.garrison) - strengthOf(b.garrison));

  for (const province of targets) {
    const options = recruitableUnits(state, province.id);
    if (options.length === 0) continue;
    // Prefer a balanced garrison: whatever role is thinnest here.
    const have = { melee: 0, missile: 0, cavalry: 0, siege: 0 };
    for (const regiment of province.garrison) {
      const unit = getUnitType(regiment.type);
      if (unit.unitClass === 'general') continue;
      have[UNIT_ROLE[unit.unitClass]] += 1;
    }
    const wanted = (['melee', 'missile', 'cavalry'] as const).reduce(
      (min, role) => (have[role] < have[min] ? role : min),
      'melee' as 'melee' | 'missile' | 'cavalry',
    );
    const affordable = options.filter((unit) => {
      if (faction.treasury - recruitCost(id, unit) < reserve) return false;
      return headroom - getUnitType(unit).upkeep > 0;
    });
    if (affordable.length === 0) continue;
    const matching = affordable.filter(
      (unit) => UNIT_ROLE[getUnitType(unit).unitClass] === wanted,
    );
    const pool = matching.length > 0 ? matching : affordable;
    // The best unit it can afford, with a little variation.
    const pick = rng.weighted(pool, (unit) => {
      const type = getUnitType(unit);
      return Math.pow(type.tier, 2.2);
    });
    if (startRecruitment(state, province.id, pick).ok) {
      headroom -= getUnitType(pick).upkeep;
    }
  }
}

// ---------------------------------------------------------------------------
// The navy
// ---------------------------------------------------------------------------

/**
 * How many hulls a realm wants, given how much coast it has to defend and how
 * much of its living comes from the sea. A landlocked duchy wants none; Venice
 * wants as many as it can pay for.
 */
function desiredHulls(state: CampaignState, id: FactionId): number {
  const harbours = provincesOf(state, id).filter((province) => getRegion(province.id).port);
  if (harbours.length === 0) return 0;
  const traits = tryGetFaction(id)?.traits ?? {};
  const maritime = (traits.trade ?? 0) >= 0.25;
  const base = Math.min(10, 1 + Math.floor(harbours.length / 2));
  // A rich thalassocracy spends its money on hulls. Without this a merchant
  // republic with one province and a fortune has nothing at all to buy, and
  // simply accumulates.
  const wealth = Math.floor(factionState(state, id).treasury / 4000);
  return Math.min(24, (maritime ? base + 4 : base) + (maritime ? wealth : Math.floor(wealth / 2)));
}

function manageNavy(state: CampaignState, id: FactionId, rng: Rng): void {
  buildShips(state, id, rng);
  for (const fleet of fleetsOf(state, id)) {
    if (!state.fleets.has(fleet.id)) continue;
    if (fleet.ships.length === 0) continue;
    sailFleet(state, fleet, rng);
  }
}

function buildShips(state: CampaignState, id: FactionId, rng: Rng): void {
  const want = desiredHulls(state, id);
  if (want === 0) return;
  let have = 0;
  for (const fleet of fleetsOf(state, id)) have += fleet.ships.length;
  for (const province of provincesOf(state, id)) have += province.shipyardQueue.length;
  if (have >= want) return;

  const faction = factionState(state, id);
  let headroom = spendingPower(state, id, 400);
  const harbours = provincesOf(state, id)
    .filter((province) => getRegion(province.id).port && !province.siege)
    .sort((a, b) => b.population - a.population);

  for (const province of harbours) {
    if (have >= want) return;
    const options = buildableShips(state, province.id);
    if (options.length === 0) continue;
    // The best hull the yard and the budget allow, with a little variation.
    const affordable = options.filter((ship) => {
      if (faction.treasury - shipCost(id, ship) < 400) return false;
      return headroom - getUnitType(ship).upkeep > 0;
    });
    if (affordable.length === 0) continue;
    const pick = rng.weighted(affordable, (ship) => Math.pow(getUnitType(ship).tier, 2));
    if (startShipbuilding(state, province.id, pick).ok) {
      headroom -= getUnitType(pick).upkeep;
      have += 1;
    }
  }
}

/**
 * Fleet doctrine: fight a weaker enemy squadron, close an enemy harbour if the
 * water is otherwise empty, carry an army to a hostile shore, and otherwise
 * come home. In winter it comes home regardless unless it is blockading, which
 * is what medieval fleets actually did.
 */
function sailFleet(state: CampaignState, fleet: Fleet, rng: Rng): void {
  if (fleet.movement <= 0) return;
  const hulls = strengthOf(fleet.ships);
  const options = reachableWaters(state, fleet);

  // 1. An enemy squadron we can beat.
  for (const zone of options.zones) {
    const enemies = fleetsInZone(state, zone).filter((other) =>
      isAtWar(state, fleet.faction, other.faction),
    );
    if (enemies.length === 0) continue;
    const theirs = enemies.reduce((sum, other) => sum + strengthOf(other.ships), 0);
    // Do not take a loaded transport fleet into a sea fight.
    if (fleet.cargo.length > 0) continue;
    if (hulls < theirs * 1.25) continue;
    const result = moveFleet(state, fleet.id, { kind: 'sea', zone });
    if (result.kind === 'battle') {
      const defenders = result.fleets
        .map((other) => state.fleets.get(other))
        .filter((other): other is Fleet => other !== undefined);
      const plan = planNavalBattle(state, zone, [fleet], defenders);
      applyBattleResult(state, plan, autoResolve(plan));
    }
    return;
  }

  // 2. Put an army ashore, if one is waiting at this harbour and there is a
  // hostile coast within reach.
  if (fleet.location.kind === 'port' && fleet.cargo.length === 0) {
    const home = fleet.location.region;
    const waiting = [...state.armies.values()].find(
      (army) => army.faction === fleet.faction && army.location === home && army.regiments.length > 1,
    );
    const room = fleetCapacity(fleet);
    if (waiting && room > 0 && countWars(state, fleet.faction) > 0) {
      const take = Math.min(room, waiting.regiments.length - 1);
      if (take > 0 && rng.chance(0.75)) {
        const indices = Array.from({ length: take }, (_, index) => index);
        if (embark(state, fleet.id, waiting.id, indices).ok) return;
      }
    }
  }
  if (fleet.cargo.length > 0) {
    // An invasion is worth crossing a sea for, so the fleet navigates towards
    // the objective rather than only looking at the water it is already in.
    const target = landingTarget(state, fleet);
    if (target) {
      if (fleet.location.kind === 'sea' && zoneServesPort(fleet.location.zone, target)) {
        disembark(state, fleet.id, target);
        return;
      }
      const leg = nextLegTowards(state, fleet, (zone) => zoneServesPort(zone, target));
      if (leg) {
        moveFleet(state, fleet.id, { kind: 'sea', zone: leg });
        return;
      }
    } else {
      // Nothing to invade: put the men back ashore at home rather than keeping
      // them at sea for ever.
      const home =
        fleet.location.kind === 'port'
          ? fleet.location.region
          : options.ports.find((port) => state.regions.get(port)?.owner === fleet.faction);
      if (home) disembark(state, fleet.id, home);
      return;
    }
  }

  // 3. Close an enemy harbour, sailing to reach one if necessary.
  if (countWars(state, fleet.faction) > 0 && fleet.cargo.length === 0) {
    const enemyWater = (zone: SeaZoneId): boolean =>
      getSeaZone(zone).ports.some((port) => {
        const province = state.regions.get(port);
        return province !== undefined && isAtWar(state, fleet.faction, province.owner);
      });
    if (state.season === 'summer' || rng.chance(0.4)) {
      // Already on station: stay there and keep the blockade.
      if (fleet.location.kind === 'sea' && enemyWater(fleet.location.zone)) return;
      const leg = nextLegTowards(state, fleet, enemyWater);
      if (leg) {
        moveFleet(state, fleet.id, { kind: 'sea', zone: leg });
        return;
      }
    }
  }

  // 4. Otherwise make for home, especially before the winter gales.
  if (fleet.location.kind === 'sea') {
    const refuge = options.ports.find((port) => state.regions.get(port)?.owner === fleet.faction);
    if (refuge && (state.season === 'winter' || countWars(state, fleet.faction) === 0)) {
      moveFleet(state, fleet.id, { kind: 'port', region: refuge });
    }
  }
}

/**
 * The shore this invasion is for: the weakest hostile harbour the fleet can
 * navigate to, preferring one the cargo can actually take.
 */
function landingTarget(state: CampaignState, fleet: Fleet): RegionId | undefined {
  const troops = strengthOf(fleet.cargo);
  const watched = watchedProvinces(state, fleet.faction);
  let best: { port: RegionId; score: number } | undefined;
  for (const zone of SEA_ZONE_IDS) {
    if (!routeExists(fleet, zone)) continue;
    for (const port of getSeaZone(zone).ports) {
      const province = state.regions.get(port);
      if (!province || province.owner === fleet.faction) continue;
      if (!isAtWar(state, fleet.faction, province.owner)) continue;
      // The one place the AI judges ground it may never have looked at. It
      // uses the same estimate a player would be given: the size of the place
      // and the height of its walls.
      const defenders = estimatedGarrison(state, fleet.faction, province, watched);
      if (defenders > troops * 2) continue;
      const score = troops / Math.max(1, defenders) + province.population / 10;
      if (!best || score > best.score) best = { port, score };
    }
  }
  return best?.port;
}

/** Can this fleet get to that water at all within a few turns' sailing? */
function routeExists(fleet: Fleet, zone: SeaZoneId): boolean {
  if (fleet.location.kind === 'sea' && fleet.location.zone === zone) return true;
  if (fleet.location.kind === 'port' && zonesOffPort(fleet.location.region).includes(zone)) {
    return true;
  }
  return routeOverSea(fleet, (candidate) => candidate === zone) !== undefined;
}

// ---------------------------------------------------------------------------
// Diplomacy
// ---------------------------------------------------------------------------

function manageDiplomacy(state: CampaignState, id: FactionId, rng: Rng): void {
  const others = [...state.factions.keys()].filter(
    (other) => other !== id && other !== INDEPENDENT_ID && state.factions.get(other)?.alive,
  );

  // Sue for peace when a war is going badly or there are too many of them.
  for (const enemy of enemiesOf(state, id)) {
    if (!canMakePeace(state, id, enemy)) continue;
    const ours = militaryStrength(state, id) + 1;
    const theirs = militaryStrength(state, enemy) + 1;
    const losing = ours / theirs < 0.7;
    const overextended = countWars(state, id) > 2;
    if ((losing || overextended) && rng.chance(0.4)) makePeace(state, id, enemy);
  }

  // Trade and alliances with those who already like us.
  for (const other of others) {
    const current = relation(state, id, other);
    if (current.stance === 'neutral' || current.stance === 'ceasefire') {
      if (relation(state, other, id).attitude > 15 && rng.chance(0.25)) {
        proposeTrade(state, id, other);
      }
    }
    // An alliance is asked for when there is a reason for one, and a court
    // that has a reason does not sit on it for five years: the low chance
    // that used to be here was carrying the whole of the restraint, and it
    // carried it badly — over two centuries a one-in-twenty chance a turn is
    // a certainty, so every trading partner in Europe ended up an ally.
    if (current.stance === 'trade' && allianceCause(state, id, other) && rng.chance(0.3)) {
      proposeAlliance(state, id, other);
    }
  }

  // And a war, if the opportunity is good enough.
  if (countWars(state, id) >= 3) return;
  let bestTarget: FactionId | undefined;
  let bestDesire = 0.45;
  for (const other of others) {
    const desire = warDesire(state, id, other);
    if (desire > bestDesire) {
      bestDesire = desire;
      bestTarget = other;
    }
  }
  if (bestTarget && rng.chance(bestDesire * 0.5)) declareWar(state, id, bestTarget);
}

// ---------------------------------------------------------------------------
// Armies
// ---------------------------------------------------------------------------

function manageArmies(state: CampaignState, id: FactionId, rng: Rng): void {
  raiseFieldArmies(state, id);
  consolidateArmies(state, id);
  const armies = [...state.armies.values()].filter((army) => army.faction === id);
  for (const army of armies) {
    if (!state.armies.has(army.id)) continue;
    if (army.regiments.length === 0) continue;
    actWithArmy(state, army, rng);
  }
}

/** Garrison a province needs for itself, before anything can march away. */
function garrisonFloor(state: CampaignState, province: RegionState): number {
  const rank = SETTLEMENT_ORDER.indexOf(province.tier) + 1;
  const base = 120 + rank * 70;
  return isThreatened(state, province) ? base * 2 : base;
}

/**
 * Marches the surplus of a garrison into the field. A medieval state kept its
 * towns held and campaigned with what it could spare, and until the AI did the
 * same its field armies never grew beyond their original escort.
 */
function raiseFieldArmies(state: CampaignState, id: FactionId): void {
  // Before spending anything, pay off what the realm can no longer afford. A
  // commander who is losing provinces reduces his establishment; waiting for
  // the treasury to hit zero and having regiments taken away is the failure
  // state, not the plan.
  retrench(state, id);

  const atWar = countWars(state, id) > 0;
  for (const province of provincesOf(state, id)) {
    if (province.siege) continue;
    const floor = garrisonFloor(state, province);
    const strength = strengthOf(province.garrison);
    if (strength <= floor) continue;
    // In peacetime a state keeps a wider margin before it musters a field army.
    if (!atWar && strength <= floor * 1.8) continue;

    // Send the best troops and leave the militia on the walls.
    const spare: number[] = [];
    let remaining = strength - floor;
    const ordered = province.garrison
      .map((regiment, index) => ({ regiment, index }))
      .sort((a, b) => getUnitType(b.regiment.type).tier - getUnitType(a.regiment.type).tier);
    for (const entry of ordered) {
      if (entry.regiment.soldiers > remaining) continue;
      spare.push(entry.index);
      remaining -= entry.regiment.soldiers;
      if (remaining <= 0) break;
    }
    if (spare.length === 0) continue;
    sortieFromGarrison(state, province.id, spare);
  }
}

/** Two of our armies standing in the same province become one. */
function consolidateArmies(state: CampaignState, id: FactionId): void {
  const byLocation = new Map<RegionId, Army[]>();
  for (const army of state.armies.values()) {
    if (army.faction !== id) continue;
    const list = byLocation.get(army.location) ?? [];
    list.push(army);
    byLocation.set(army.location, list);
  }
  for (const armies of byLocation.values()) {
    if (armies.length < 2) continue;
    const [first, ...rest] = armies;
    if (!first) continue;
    for (const other of rest) {
      if (first.regiments.length + other.regiments.length > MAX_ARMY_REGIMENTS) continue;
      mergeArmies(state, first.id, other.id);
    }
  }
}

function actWithArmy(state: CampaignState, army: Army, rng: Rng): void {
  const own = strengthOf(army.regiments);
  if (own === 0) return;

  // 0. An army that is already besieging a place either storms it or stays to
  // starve it out. Marching off to the next province, as it used to, left a
  // trail of abandoned sieges and almost nothing ever fell.
  const here = state.regions.get(army.location);
  if (here?.siege && here.siege.besieger === army.faction) {
    const odds = assaultOdds(state, army.location, army.faction, army.regiments);
    const defenders = strengthOf(here.garrison);
    const impatient = here.siege.turns >= 6;
    if (own > defenders * (2 + odds * 4) && (impatient || rng.chance(0.35))) {
      const plan = planBattle(state, army.location, [army], [], { isAssault: true });
      applyBattleResult(state, plan, autoResolve(plan));
    }
    return;
  }

  // 0.5. An enemy across water is reached only by taking ship. If a fleet with
  // room is waiting in one of our harbours and there is no land route to the
  // war, march to the quayside.
  const quay = embarkationPort(state, army);
  if (quay) {
    if (quay === army.location) return; // wait here to be taken aboard
    const leg = stepTowardsProvince(state, army, quay);
    if (leg) {
      attemptMove(state, army, leg, rng);
      return;
    }
  }

  // 1. Relieve a besieged province of our own, if one is next door.
  const besieged = [...state.regions.values()].find(
    (province) =>
      province.owner === army.faction &&
      province.siege &&
      (province.id === army.location || landNeighbours(army.location).includes(province.id)),
  );
  if (besieged && besieged.id !== army.location) {
    attemptMove(state, army, besieged.id, rng);
    return;
  }

  // 2. Take an undefended or weakly held enemy province.
  const targets = candidateTargets(state, army);
  if (targets.length > 0) {
    const scored = targets
      .map((target) => ({ target, score: targetScore(state, army, target) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    if (scored.length > 0) {
      attemptMove(state, army, scored[0]!.target, rng);
      return;
    }
  }

  // 3. Relieve the most threatened province we can reach in one march.
  const home = [...state.regions.values()]
    .filter((province) => province.owner === army.faction && isThreatened(state, province))
    .sort((a, b) => strengthOf(a.garrison) - strengthOf(b.garrison))[0];
  if (home && home.id !== army.location && landNeighbours(army.location).includes(home.id)) {
    attemptMove(state, army, home.id, rng);
    return;
  }

  // 3.5. A sworn ruler marches for the place he swore to take, wherever it is.
  if (isSworn(state, army.faction) && state.faith.holyWar) {
    const objective = state.faith.holyWar.target;
    if (objective !== army.location) {
      const leg = stepTowardsProvince(state, army, objective);
      if (leg) {
        attemptMove(state, army, leg, rng);
        return;
      }
    }
  }

  // 4. Otherwise march towards the nearest enemy province. An army that only
  // ever considers its immediate neighbours never reaches the war.
  const step = stepTowardsEnemy(state, army);
  if (step) attemptMove(state, army, step, rng);
}

/**
 * The first province on the shortest land route to the nearest enemy. A
 * breadth-first search over at most a dozen provinces, which is cheap enough
 * to run for every army every turn.
 */
function stepTowardsEnemy(state: CampaignState, army: Army): RegionId | undefined {
  const hostile = (id: RegionId): boolean => {
    const province = state.regions.get(id);
    if (!province || province.owner === army.faction) return false;
    return province.owner === INDEPENDENT_ID || isAtWar(state, army.faction, province.owner);
  };
  return stepTowards(state, army, hostile);
}

/** The first province on the shortest route to a province we already hold. */
function stepTowardsProvince(
  state: CampaignState,
  army: Army,
  target: RegionId,
): RegionId | undefined {
  return stepTowards(state, army, (id) => id === target);
}

function stepTowards(
  state: CampaignState,
  army: Army,
  isGoal: (id: RegionId) => boolean,
): RegionId | undefined {
  const seen = new Set<RegionId>([army.location]);
  // Each entry remembers the first step that led to it.
  let frontier: { id: RegionId; first: RegionId }[] = landNeighbours(army.location).map((id) => ({
    id,
    first: id,
  }));
  for (const entry of frontier) seen.add(entry.id);

  for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
    for (const entry of frontier) {
      if (isGoal(entry.id)) return entry.first;
    }
    const next: { id: RegionId; first: RegionId }[] = [];
    for (const entry of frontier) {
      // Do not plan a route through a province we would have to fight for.
      const province = state.regions.get(entry.id);
      if (!province || province.owner !== army.faction) continue;
      for (const neighbour of landNeighbours(entry.id)) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        next.push({ id: neighbour, first: entry.first });
      }
    }
    frontier = next;
  }
  return undefined;
}

/**
 * The harbour this army should march to in order to be shipped to the war, or
 * undefined if the war can be walked to.
 */
function embarkationPort(state: CampaignState, army: Army): RegionId | undefined {
  const enemies = enemiesOf(state, army.faction);
  if (enemies.length === 0) return undefined;
  // If any enemy can be reached by land, the army has no business at sea.
  const overseasOnly = enemies.every((enemy) => !shareBorder(state, army.faction, enemy));
  if (!overseasOnly) return undefined;

  let best: { port: RegionId; room: number } | undefined;
  for (const fleet of fleetsOf(state, army.faction)) {
    if (fleet.location.kind !== 'port') continue;
    const room = fleetCapacity(fleet) - fleet.cargo.length;
    if (room < 1) continue;
    const province = state.regions.get(fleet.location.region);
    if (!province || province.owner !== army.faction) continue;
    if (!best || room > best.room) best = { port: fleet.location.region, room };
  }
  return best?.port;
}

function candidateTargets(state: CampaignState, army: Army): RegionId[] {
  const result: RegionId[] = [];
  for (const neighbour of landNeighbours(army.location)) {
    const province = state.regions.get(neighbour);
    if (!province) continue;
    if (province.owner === army.faction) continue;
    if (province.owner === INDEPENDENT_ID || isAtWar(state, army.faction, province.owner)) {
      result.push(neighbour);
    }
  }
  return result;
}

/** How attractive a province is as a target, given what it would cost. */
function targetScore(state: CampaignState, army: Army, target: RegionId): number {
  const province = state.regions.get(target);
  if (!province) return 0;
  const own = strengthOf(army.regiments);
  const defenders =
    strengthOf(province.garrison) +
    [...state.armies.values()]
      .filter((other) => other.location === target && other.faction !== army.faction)
      .reduce((sum, other) => sum + strengthOf(other.regiments), 0);

  // Walls make an assault expensive; the AI respects that.
  const penalty = assaultOdds(state, target, army.faction, army.regiments);
  const ratio = own / Math.max(1, defenders);
  if (ratio < 1.15 + penalty) return 0;

  let score = (SETTLEMENT_ORDER.indexOf(province.tier) + 1) * 2 + province.population / 4;
  score += ratio;
  score -= penalty * 10;
    // No great power takes offence when an independent town is annexed.
  if (province.owner === INDEPENDENT_ID) score += 3;
  return score;
}

/**
 * The pretenders.
 *
 * Their armies belong to nobody, because from everyone else's point of view
 * that is what a rising is: ground and men the king no longer controls. They
 * are the one exception to the rule that independents do not manoeuvre, and
 * they have exactly one idea, which is the only one a pretender needed — go
 * to the capital and take it.
 */
export function movePretenders(state: CampaignState, rng: Rng): void {
  for (const war of [...state.civilWars.values()]) {
    const crown = state.factions.get(war.crown);
    const capital = crown?.capital;
    if (!capital) continue;
    for (const id of [...war.armies]) {
      const army = state.armies.get(id);
      if (!army || army.regiments.length === 0) continue;
      army.movement = movementBudget(state, army);
      marchOnTheCapital(state, army, capital, rng);
    }
  }
}

function marchOnTheCapital(
  state: CampaignState,
  army: Army,
  capital: RegionId,
  rng: Rng,
): void {
  // A host that has been cut to pieces sits down in what it still holds
  // rather than throwing itself at walls.
  if (strengthOf(army.regiments) < 200) return;

  for (let step = 0; step < 3 && army.movement > 0; step++) {
    if (army.location === capital) return;
    const next = towardsProvince(army.location, capital);
    if (!next) return;
    const before = army.location;
    attemptMove(state, army, next, rng);
    // A move that produced a battle or a siege is the end of the season.
    if (army.location === before) return;
  }
}

/** One step along the shortest land route, through anybody's ground. */
function towardsProvince(from: RegionId, goal: RegionId): RegionId | undefined {
  if (from === goal) return undefined;
  const seen = new Set<RegionId>([from]);
  let frontier: { id: RegionId; first: RegionId }[] = [];
  for (const id of landNeighbours(from)) {
    if (seen.has(id)) continue;
    seen.add(id);
    frontier.push({ id, first: id });
  }
  for (let depth = 0; depth < 16 && frontier.length > 0; depth++) {
    for (const entry of frontier) if (entry.id === goal) return entry.first;
    const next: { id: RegionId; first: RegionId }[] = [];
    for (const entry of frontier) {
      for (const neighbour of landNeighbours(entry.id)) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        next.push({ id: neighbour, first: entry.first });
      }
    }
    frontier = next;
  }
  return undefined;
}

function attemptMove(state: CampaignState, army: Army, to: RegionId, rng: Rng): void {
  const result = moveArmy(state, army.id, to);
  switch (result.kind) {
    case 'moved':
    case 'blocked':
      return;
    case 'captured':
      transferProvince(state, to, army.faction);
      army.location = to;
      return;
    case 'siege': {
      const province = state.regions.get(to)!;
      const odds = assaultOdds(state, to, army.faction, army.regiments);
      const own = strengthOf(army.regiments);
      const defenders = strengthOf(province.garrison);
      // Storm it when the odds are good, otherwise settle down to starve it out.
      if (own > defenders * (2 + odds * 4) && rng.chance(0.6)) {
        const plan = planBattle(state, to, [army], [], { isAssault: true });
        applyBattleResult(state, plan, autoResolve(plan));
      } else {
        beginSiege(state, army.id, to);
      }
      return;
    }
    case 'battle': {
      const defenders = result.defendingArmies
        .map((armyId) => state.armies.get(armyId))
        .filter((candidate): candidate is Army => candidate !== undefined);
      const plan = planBattle(state, to, [army], defenders);
      applyBattleResult(state, plan, autoResolve(plan));
      return;
    }
  }
}
