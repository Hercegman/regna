/**
 * Agents: the work a state does abroad without an army.
 *
 * Everything else in this game moves soldiers. Most of what a medieval state
 * actually did to its neighbours it did with four or five men and a purse: an
 * envoy to make a court willing to listen, a priest to turn a province's
 * faith, a merchant posted on someone else's silver mine, and a man of no
 * stated occupation to set fire to the works and open a gate.
 *
 * An agent goes where an army cannot. He crosses a closed border, he stands in
 * a hostile capital, and nobody declares war over him. What he risks instead
 * is himself: every mission on foreign ground can end with him taken, and a
 * man taken is gone — there is no ransom and no second attempt with the same
 * man.
 *
 * The resolution is one roll in one place. Skill against the guard on the
 * province, both known to the player before he commits, so a failed mission is
 * a gamble lost rather than a surprise.
 */
import type { AgentId, FactionId, RegionId } from '../types';
import { agentId, buildingId, clamp } from '../types';
import type { Rng } from '../rng';
import type { Agent, CampaignState, RegionState } from './state';
import { agentName, factionState, logEvent, regionState } from './state';
import type { AgentKind } from '../data/agents';
import { AGENT_TYPES, SCHOOLS, getAgentType } from '../data/agents';
import { getRegion } from '../data/regions';
import { getBuildingType } from '../data/buildings';
import { tryGetFaction, INDEPENDENT_ID } from '../data/factions';
import { neighbours } from '../data/adjacency';
import { adjustAttitude } from './diplomacy';
import { familyOf, adjustStanding } from './faith';

type Outcome = { ok: true } | { ok: false; reason: string };
const ok: Outcome = { ok: true };
const no = (reason: string): Outcome => ({ ok: false, reason });

/** Nobody keeps more than this many agents at once, whatever his revenues. */
export const MAX_AGENTS = 8;

/** An agent improves with work, but only so far, and only by doing it. */
export const MAX_SKILL = 10;

// ---------------------------------------------------------------------------
// Raising and keeping them
// ---------------------------------------------------------------------------

export function agentsOf(state: CampaignState, id: FactionId): Agent[] {
  return [...state.agents.values()].filter((agent) => agent.faction === id);
}

export function agentsAt(state: CampaignState, region: RegionId): Agent[] {
  return [...state.agents.values()].filter((agent) => agent.location === region);
}

/** What the whole establishment costs to keep, every turn. */
export function agentUpkeep(state: CampaignState, id: FactionId): number {
  let total = 0;
  for (const agent of state.agents.values()) {
    if (agent.faction === id) total += getAgentType(agent.kind).upkeep;
  }
  return Math.round(total);
}

/** The kinds a given settlement has the institution to produce. */
export function recruitableAgents(
  state: CampaignState,
  id: RegionId,
): readonly AgentKind[] {
  const region = state.regions.get(id);
  if (!region) return [];
  return AGENT_TYPES.filter((type) => region.buildings.has(type.requires)).map(
    (type) => type.kind,
  );
}

export function canRecruitAgent(
  state: CampaignState,
  id: RegionId,
  kind: AgentKind,
): Outcome {
  const region = state.regions.get(id);
  if (!region) return no('No such province.');
  if (region.owner === INDEPENDENT_ID) return no('Nobody there answers for it.');
  const type = getAgentType(kind);
  if (!region.buildings.has(type.requires)) {
    return no(`${getBuildingType(type.requires).name} first.`);
  }
  if (region.siege) return no('The place is invested.');
  const faction = factionState(state, region.owner);
  if (agentsOf(state, region.owner).length >= MAX_AGENTS) {
    return no(`No more than ${MAX_AGENTS} men in the field at once.`);
  }
  if (faction.treasury < type.cost) return no('Not enough money.');
  return ok;
}

export function recruitAgent(
  state: CampaignState,
  id: RegionId,
  kind: AgentKind,
  rng: Rng,
): Outcome {
  const allowed = canRecruitAgent(state, id, kind);
  if (!allowed.ok) return allowed;
  const region = regionState(state, id);
  const type = getAgentType(kind);
  const faction = factionState(state, region.owner);
  faction.treasury -= type.cost;

  state.nextAgentSerial += 1;
  const agent: Agent = {
    id: agentId(`agent-${state.nextAgentSerial}`),
    faction: region.owner,
    kind,
    name: agentName(region.owner, id, rng, agentsOf(state, region.owner).map((a) => a.name)),
    // A new man is competent, not expert. Expertise is earned in the field —
    // except that a place with schools in it turns out a better man to begin
    // with, which is most of what a university is for here.
    skill: Math.min(MAX_SKILL, rng.int(2, 5) + schooling(region)),
    location: id,
    // He is hired, not mustered: he is standing in the town the moment he is
    // paid, so he has his season's travel in hand like everybody else.
    movement: type.movement,
    age: rng.int(22, 40),
    missions: 0,
  };
  state.agents.set(agent.id, agent);
  logEvent(state, region.owner, `${agent.name} enters ${tryGetFaction(region.owner)?.name ?? 'the realm'}'s service as a ${type.name.toLowerCase()}.`);
  return ok;
}

/** How much the place a man was raised in improves him. */
function schooling(region: RegionState): number {
  let learned = 0;
  for (const id of SCHOOLS) if (region.buildings.has(id)) learned += 1;
  return learned;
}

export function dismissAgent(state: CampaignState, id: AgentId): Outcome {
  const agent = state.agents.get(id);
  if (!agent) return no('No such man.');
  state.agents.delete(id);
  logEvent(state, agent.faction, `${agent.name} is dismissed from service.`);
  return ok;
}

// ---------------------------------------------------------------------------
// Travel
// ---------------------------------------------------------------------------

/**
 * Where an agent can go next.
 *
 * Any neighbouring province, whoever holds it and whatever the border is: that
 * is the whole point of him. A sea crossing counts the same as a land one,
 * because he takes passage on somebody's ship and nobody asks.
 */
export function agentDestinations(state: CampaignState, id: AgentId): readonly RegionId[] {
  const agent = state.agents.get(id);
  if (!agent || agent.movement <= 0) return [];
  return adjacentTo(agent.location).filter((region) => state.regions.has(region));
}

/** Every province across a border of any kind, land or sea. */
function adjacentTo(from: RegionId): readonly RegionId[] {
  return neighbours(from).map((border) => (border.a === from ? border.b : border.a));
}

export function moveAgent(state: CampaignState, id: AgentId, to: RegionId): Outcome {
  const agent = state.agents.get(id);
  if (!agent) return no('No such man.');
  if (agent.movement <= 0) return no('He has gone as far as he can this season.');
  if (!state.regions.has(to)) return no('No such province.');
  if (!adjacentTo(agent.location).includes(to)) return no('Not from where he stands.');
  agent.location = to;
  agent.movement -= 1;
  return ok;
}

/** Agents get their travel back with everyone else. */
export function refreshAgents(state: CampaignState): void {
  for (const agent of state.agents.values()) {
    agent.movement = getAgentType(agent.kind).movement;
  }
}

// ---------------------------------------------------------------------------
// The odds
// ---------------------------------------------------------------------------

/**
 * How well watched a province is.
 *
 * A capital with a governor's palace and a counter-spy in it is a hard place
 * to work; a frontier village that changed hands last year is not. This is the
 * number an agent's skill is tried against, and the player is shown it before
 * he commits a man.
 */
export function guard(state: CampaignState, region: RegionState): number {
  let watch = 1;
  // The apparatus of government: a chancery notices things.
  for (const id of region.buildings) {
    const building = getBuildingType(id);
    if (building.chain === 'governance') watch += 1 + building.level;
  }
  // The owner's own spies, who are there precisely for this.
  for (const agent of state.agents.values()) {
    if (agent.kind !== 'spy') continue;
    if (agent.faction !== region.owner) continue;
    if (agent.location !== region.id) continue;
    watch += 2 + agent.skill * 0.4;
  }
  // A capital is watched; a discontented province is full of people willing
  // to look the other way for money.
  const faction = state.factions.get(region.owner);
  if (faction?.capital === region.id) watch += 2;
  watch -= region.unrest / 25;
  return Math.max(0, watch);
}

/** The chance a mission succeeds, between a long shot and a near certainty. */
export function odds(skill: number, against: number): number {
  return clamp(0.5 + (skill - against) * 0.07, 0.06, 0.93);
}

/** The chance a failed mission also costs the man his liberty. */
export function peril(agent: Agent, against: number): number {
  const base = agent.kind === 'spy' ? 0.42 : 0.3;
  return clamp(base + (against - agent.skill) * 0.04, 0.08, 0.8);
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

export type MissionKind =
  | 'sabotage'
  | 'incite'
  | 'assassinate'
  | 'unmask'
  | 'treat'
  | 'bribe'
  | 'preach'
  | 'buy_out';

export interface MissionReport {
  readonly ok: boolean;
  /** What happened, in a sentence, for the log and for the panel. */
  readonly text: string;
  /** True when the agent did not come back. */
  readonly lost: boolean;
}

export interface MissionOffer {
  readonly kind: MissionKind;
  readonly name: string;
  readonly description: string;
  /** What it costs in money on top of the risk. */
  readonly cost: number;
  readonly chance: number;
  readonly peril: number;
}

const BRIBE_COST = 600;
const BUY_OUT_COST = 500;

/** Every mission this man could attempt where he now stands. */
export function missionsFor(state: CampaignState, id: AgentId): readonly MissionOffer[] {
  const agent = state.agents.get(id);
  if (!agent || agent.movement <= 0) return [];
  const region = state.regions.get(agent.location);
  if (!region) return [];

  const foreign = region.owner !== agent.faction;
  const against = guard(state, region);
  const chance = odds(agent.skill, against);
  const risk = peril(agent, against);
  const offer = (
    kind: MissionKind,
    name: string,
    description: string,
    cost = 0,
    // Work among one's own people carries no risk of being taken.
    own = false,
  ): MissionOffer => ({
    kind,
    name,
    description,
    cost,
    chance: own ? Math.min(0.95, chance + 0.2) : chance,
    peril: own ? 0 : risk,
  });

  const offers: MissionOffer[] = [];
  switch (agent.kind) {
    case 'spy':
      if (foreign) {
        offers.push(
          offer('sabotage', 'Set a fire', 'Wreck whatever is being built here, or weaken the walls if we are besieging it.'),
          offer('incite', 'Put money about', 'Spend among the discontented and leave the province harder to hold.'),
          offer('assassinate', 'Have him killed', 'Kill whoever commands or governs here. The most dangerous thing he can be asked to do.'),
        );
      } else {
        offers.push(offer('unmask', 'Take the stranger', 'Find whoever is working here for somebody else, and stop him.', 0, true));
      }
      break;
    case 'envoy':
      if (foreign) {
        offers.push(
          offer('treat', 'Treat with the court', 'Make them better disposed towards us.'),
          offer('bribe', 'Open the purse', 'The same, bought outright.', BRIBE_COST),
        );
      }
      break;
    case 'priest':
      offers.push(
        offer(
          'preach',
          'Preach',
          'Turn the province towards our faith. A province of our own religion is far easier to hold.',
          0,
          !foreign,
        ),
      );
      break;
    case 'merchant':
      if (foreign && rivalMerchant(state, agent)) {
        offers.push(offer('buy_out', 'Buy him out', 'Take over a rival factor\'s business here.', BUY_OUT_COST));
      }
      break;
  }
  return offers;
}

function rivalMerchant(state: CampaignState, agent: Agent): Agent | undefined {
  for (const other of state.agents.values()) {
    if (other.id === agent.id) continue;
    if (other.kind !== 'merchant') continue;
    if (other.location !== agent.location) continue;
    if (other.faction === agent.faction) continue;
    return other;
  }
  return undefined;
}

/**
 * Sends a man on a mission.
 *
 * One roll decides it. Whatever happens, the attempt has used him up for the
 * season: an agent does one thing per turn, and travelling is one of them.
 */
export function attemptMission(
  state: CampaignState,
  id: AgentId,
  kind: MissionKind,
  rng: Rng,
): MissionReport {
  const agent = state.agents.get(id);
  if (!agent) return { ok: false, text: 'No such man.', lost: false };
  const offer = missionsFor(state, id).find((candidate) => candidate.kind === kind);
  if (!offer) return { ok: false, text: 'He cannot do that here.', lost: false };
  const faction = factionState(state, agent.faction);
  if (faction.treasury < offer.cost) {
    return { ok: false, text: 'Not enough money for it.', lost: false };
  }
  const region = regionState(state, agent.location);
  const owner = tryGetFaction(region.owner)?.name ?? 'the province';
  faction.treasury -= offer.cost;
  agent.movement = 0;
  agent.missions += 1;

  const succeeded = rng.next() < offer.chance;
  if (succeeded) {
    // A man learns his trade by plying it, and only by succeeding at it.
    if (agent.skill < MAX_SKILL && rng.next() < 0.3) agent.skill += 1;
    const text = succeed(state, agent, region, kind, rng);
    logEvent(state, agent.faction, text);
    return { ok: true, text, lost: false };
  }

  const lost = rng.next() < offer.peril;
  const text = lost
    ? `${agent.name} is taken in ${getRegion(region.id).settlement} and is not heard from again.`
    : `${agent.name} achieves nothing in ${getRegion(region.id).settlement}.`;
  if (lost) {
    state.agents.delete(agent.id);
    // Being caught at it is an insult the other court does not forget.
    if (region.owner !== agent.faction && region.owner !== INDEPENDENT_ID) {
      adjustAttitude(state, region.owner, agent.faction, -8);
      logEvent(
        state,
        region.owner,
        `A man of ${tryGetFaction(agent.faction)?.name ?? 'a foreign prince'} is taken in ${getRegion(region.id).settlement}.`,
      );
    }
  }
  logEvent(state, agent.faction, text);
  void owner;
  return { ok: false, text, lost };
}

function succeed(
  state: CampaignState,
  agent: Agent,
  region: RegionState,
  kind: MissionKind,
  rng: Rng,
): string {
  const place = getRegion(region.id).settlement;
  switch (kind) {
    case 'sabotage': {
      if (region.siege && region.siege.besieger === agent.faction) {
        // A siege is counted in seasons endured, and that is what the inside
        // man shortens: stores fired, a postern opened, a word to the right
        // officer. The place falls sooner than it should have.
        region.siege.turns += 3;
        region.unrest = Math.min(100, region.unrest + 10);
        return `${agent.name} works inside ${place}, and the siege is the shorter for it.`;
      }
      if (region.construction) {
        const lost = getBuildingType(region.construction.building).name;
        region.construction = undefined;
        return `${agent.name} burns the works at ${place}. The ${lost} is a loss.`;
      }
      // Nothing under construction: the next best thing is the stores.
      region.unrest = Math.min(100, region.unrest + 6);
      return `${agent.name} fires a storehouse in ${place}.`;
    }
    case 'incite': {
      const stirred = 8 + agent.skill * 1.5;
      region.unrest = Math.min(100, region.unrest + stirred);
      return `${agent.name} leaves ${place} harder to hold than he found it.`;
    }
    case 'assassinate': {
      const victim = victimAt(state, region);
      if (!victim) {
        region.unrest = Math.min(100, region.unrest + 5);
        return `${agent.name} finds nobody in ${place} worth killing.`;
      }
      removeCharacter(state, victim.faction, victim.name);
      adjustAttitude(state, victim.faction, agent.faction, -12);
      return `${victim.name} is killed at ${place}.`;
    }
    case 'unmask': {
      const caught = foreignAgentAt(state, region.id, agent.faction);
      if (!caught) return `${agent.name} finds no stranger in ${place}.`;
      state.agents.delete(caught.id);
      logEvent(state, caught.faction, `${caught.name} is taken in ${place}.`);
      adjustAttitude(state, agent.faction, caught.faction, -6);
      return `${agent.name} takes a man of ${tryGetFaction(caught.faction)?.name ?? 'a foreign prince'} in ${place}.`;
    }
    case 'treat':
    case 'bribe': {
      if (region.owner === INDEPENDENT_ID) return `${agent.name} finds no court at ${place}.`;
      const gain = kind === 'bribe' ? 10 + agent.skill : 4 + Math.round(agent.skill / 2);
      adjustAttitude(state, region.owner, agent.faction, gain);
      adjustAttitude(state, agent.faction, region.owner, Math.round(gain / 2));
      return `${agent.name} is well received at ${place}.`;
    }
    case 'preach': {
      const faith = tryGetFaction(agent.faction)?.religion;
      if (!faith) return `${agent.name} preaches at ${place} to no great effect.`;
      if (region.religion === faith) {
        // Preaching to the converted is not useless: it is what keeps them.
        region.unrest = Math.max(0, region.unrest - 4);
        if (familyOf(agent.faction)) adjustStanding(state, agent.faction, 1);
        return `${agent.name} preaches at ${place}, and the province is the quieter for it.`;
      }
      const won = 12 + agent.skill * 2.5;
      region.conversion += won;
      if (region.conversion >= 100) {
        region.religion = faith;
        region.conversion = 0;
        if (familyOf(agent.faction)) adjustStanding(state, agent.faction, 4);
        return `${place} comes over to the faith. ${agent.name} has his province.`;
      }
      return `${agent.name} makes converts at ${place}.`;
    }
    case 'buy_out': {
      const rival = rivalMerchant(state, agent);
      if (!rival) return `${agent.name} finds no rival left at ${place}.`;
      state.agents.delete(rival.id);
      logEvent(state, rival.faction, `${rival.name} is bought out of ${place} and comes home.`);
      return `${agent.name} buys out ${tryGetFaction(rival.faction)?.name ?? 'a rival'} at ${place}.`;
    }
  }
  void rng;
  return `${agent.name} does his work at ${place}.`;
}

/**
 * Who in this province is worth killing: its governor, or the commander of an
 * army standing in it. Exported so that a doctrine can see the difference
 * between a province with a king's son in it and one without.
 */
export function victimAt(
  state: CampaignState,
  region: RegionState,
): { faction: FactionId; name: string; commanding: boolean } | undefined {
  // A commander in the field is the better prize: an army without one fights
  // worse, and he is standing somewhere an agent can reach.
  for (const army of state.armies.values()) {
    if (army.location !== region.id) continue;
    if (army.general) {
      return { faction: army.faction, name: army.general.name, commanding: true };
    }
  }
  if (region.governor) {
    return { faction: region.owner, name: region.governor.name, commanding: false };
  }
  return undefined;
}

function removeCharacter(state: CampaignState, id: FactionId, name: string): void {
  const faction = state.factions.get(id);
  if (!faction) return;
  faction.characters = faction.characters.filter((character) => character.name !== name);
  for (const region of state.regions.values()) {
    if (region.governor?.name === name) region.governor = undefined;
  }
  for (const army of state.armies.values()) {
    if (army.general?.name === name) army.general = undefined;
  }
}

function foreignAgentAt(
  state: CampaignState,
  region: RegionId,
  owner: FactionId,
): Agent | undefined {
  for (const agent of state.agents.values()) {
    if (agent.location !== region) continue;
    if (agent.faction === owner) continue;
    return agent;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// What a merchant earns by standing still
// ---------------------------------------------------------------------------

/**
 * What a factor sends home each turn.
 *
 * A merchant posted on a foreign resource takes a cut of it. On his own
 * country's ground he is competing with his own countrymen and takes
 * considerably less, which is why they all went abroad.
 */
export function merchantIncome(state: CampaignState, agent: Agent): number {
  if (agent.kind !== 'merchant') return 0;
  const region = state.regions.get(agent.location);
  if (!region) return 0;
  const geography = getRegion(region.id);
  const worth = RESOURCE_WORTH[geography.resource] ?? 0;
  if (worth === 0) return 0;
  const abroad = region.owner !== agent.faction ? 1 : 0.4;
  const trade = region.buildings.has(MARKET) ? 1.25 : 1;
  return Math.round(worth * (0.6 + agent.skill * 0.08) * abroad * trade);
}

const MARKET = buildingId('market');

/** What a season on each resource is worth to a factor standing on it. */
const RESOURCE_WORTH: Readonly<Record<string, number>> = {
  none: 0,
  grain: 30,
  wine: 55,
  wool: 50,
  timber: 35,
  iron: 60,
  silver: 95,
  gold: 130,
  salt: 60,
  furs: 70,
  silk: 120,
  spices: 135,
  amber: 80,
  horses: 65,
  fish: 30,
  olives: 45,
  marble: 55,
  dyes: 85,
};

/**
 * Agents age, and an old agent retires rather than dying in a ditch.
 */
export function ageAgents(state: CampaignState, rng: Rng): void {
  for (const agent of [...state.agents.values()]) {
    agent.age += 0.5;
    if (agent.age < 62) continue;
    if (rng.next() > 0.12) continue;
    state.agents.delete(agent.id);
    logEvent(state, agent.faction, `${agent.name} retires from service.`);
  }
}
