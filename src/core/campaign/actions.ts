/**
 * Orders. Everything a player or the AI can decide to do in a turn goes through
 * these functions, each of which validates the order and returns a result
 * instead of throwing, so the UI and the AI can both ask "may I?" cheaply.
 */
import type { ArmyId, BuildingId, FactionId, RegionId, UnitTypeId } from '../types';
import { SETTLEMENT_ORDER } from '../types';
import type { Army, CampaignState, Regiment, RegionState } from './state';
import {
  factionState,
  hasPort,
  isAtWar,
  logEvent,
  newArmyId,
  regionState,
  strengthOf,
} from './state';
import { getBuildingType, BUILDING_TYPES } from '../data/buildings';
import { getRegion } from '../data/regions';
import { borderBetween, landNeighbours, seaNeighbours } from '../data/adjacency';
import { getUnitType } from '../data/units';
import { getFaction, tryGetFaction, INDEPENDENT_ID } from '../data/factions';
export { isAtWar } from './state';
import { seaLaneClosed } from './naval';
import { isShip, rosterFor } from '../data/roster';


export type Outcome = { ok: true } | { ok: false; reason: string };

const ok: Outcome = { ok: true };
const no = (reason: string): Outcome => ({ ok: false, reason });

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** Buildings the province could start right now. */
export function availableBuildings(state: CampaignState, id: RegionId): readonly BuildingId[] {
  const region = regionState(state, id);
  const tierIndex = SETTLEMENT_ORDER.indexOf(region.tier);
  return BUILDING_TYPES.filter((building) => {
    if (region.buildings.has(building.id)) return false;
    if (SETTLEMENT_ORDER.indexOf(building.minSettlement) > tierIndex) return false;
    if (building.requires && !region.buildings.has(building.requires)) return false;
    // Only one level of a chain at a time: the next level replaces it.
    const higherAlreadyBuilt = BUILDING_TYPES.some(
      (other) =>
        other.chain === building.chain &&
        other.level > building.level &&
        region.buildings.has(other.id),
    );
    return !higherAlreadyBuilt;
  }).map((building) => building.id);
}

export function startConstruction(
  state: CampaignState,
  id: RegionId,
  building: BuildingId,
): Outcome {
  const region = regionState(state, id);
  if (region.siege) return no('The settlement is under siege.');
  if (region.construction) return no('Something is already being built here.');
  if (!availableBuildings(state, id).includes(building)) {
    return no('That building cannot be started here.');
  }
  const type = getBuildingType(building);
  const faction = factionState(state, region.owner);
  if (faction.treasury < type.cost) return no('The treasury cannot pay for it.');
  faction.treasury -= type.cost;
  region.construction = { building, turnsLeft: type.turnsToBuild };
  return ok;
}

export function cancelConstruction(state: CampaignState, id: RegionId): Outcome {
  const region = regionState(state, id);
  if (!region.construction) return no('Nothing is being built here.');
  const type = getBuildingType(region.construction.building);
  // Half the money back: the stone is cut and the labour is spent.
  factionState(state, region.owner).treasury += Math.floor(type.cost / 2);
  region.construction = undefined;
  return ok;
}

// ---------------------------------------------------------------------------
// Recruitment
// ---------------------------------------------------------------------------

/** Units the province can recruit this turn. */
export function recruitableUnits(state: CampaignState, id: RegionId): readonly UnitTypeId[] {
  const region = regionState(state, id);
  const faction = tryGetFaction(region.owner);
  if (!faction) return [];
  const tierIndex = SETTLEMENT_ORDER.indexOf(region.tier);
  return rosterFor(faction, state.year)
    .filter((unit) => {
      if (unit.unitClass === 'general') return false;
      // Ships are built at a harbour, not mustered on a drill square.
      if (isShip(unit)) return false;
      // Companies that exist only for hire are found, not raised.
      if (unit.mercenary) return false;
      if (unit.minSettlement && SETTLEMENT_ORDER.indexOf(unit.minSettlement) > tierIndex) {
        return false;
      }
      if (unit.requires && !region.buildings.has(unit.requires)) return false;
      return true;
    })
    .map((unit) => unit.id);
}

/** Recruitment takes longer for better troops. */
export function recruitTurns(unit: UnitTypeId): number {
  return Math.max(1, Math.ceil(getUnitType(unit).tier / 2));
}

export function recruitCost(faction: FactionId, unit: UnitTypeId): number {
  const traits = tryGetFaction(faction)?.traits ?? {};
  return Math.round(getUnitType(unit).cost * (1 - (traits.recruitCost ?? 0)));
}

export const MAX_RECRUIT_QUEUE = 3;

/**
 * An army is a command, not a nation in arms. Twenty regiments is already a
 * very large medieval field army, and the cap also bounds the cost of
 * simulating a battle, which otherwise grows with the square of the units
 * present.
 */
export const MAX_ARMY_REGIMENTS = 20;
/** A settlement can only billet so many troops. */
export const MAX_GARRISON_REGIMENTS = 12;

export function startRecruitment(
  state: CampaignState,
  id: RegionId,
  unit: UnitTypeId,
): Outcome {
  const region = regionState(state, id);
  if (region.siege) return no('The settlement is under siege.');
  if (region.recruitQueue.length >= MAX_RECRUIT_QUEUE) return no('The muster queue is full.');
  if (region.garrison.length + region.recruitQueue.length >= MAX_GARRISON_REGIMENTS) {
    return no('The settlement cannot billet any more troops.');
  }
  if (!recruitableUnits(state, id).includes(unit)) return no('That unit cannot be raised here.');
  const faction = factionState(state, region.owner);
  const cost = recruitCost(region.owner, unit);
  if (faction.treasury < cost) return no('The treasury cannot pay for it.');
  faction.treasury -= cost;
  region.recruitQueue.push({ unit, turnsLeft: recruitTurns(unit) });
  return ok;
}

export function disbandRegiment(state: CampaignState, id: RegionId, index: number): Outcome {
  const region = regionState(state, id);
  const regiment = region.garrison[index];
  if (!regiment) return no('No such regiment.');
  // Disbanding returns a quarter of the recruitment cost as sold equipment.
  factionState(state, region.owner).treasury += Math.floor(
    getUnitType(regiment.type).cost / 4,
  );
  region.garrison.splice(index, 1);
  return ok;
}

// ---------------------------------------------------------------------------
// Armies and movement
// ---------------------------------------------------------------------------

/** Movement cost of entering a province, by its terrain. */
const TERRAIN_COST: Readonly<Record<string, number>> = {
  plains: 1.0,
  farmland: 1.0,
  coastal: 1.0,
  steppe: 0.9,
  hills: 1.4,
  forest: 1.5,
  desert: 1.6,
  marsh: 1.8,
  mountains: 2.2,
};

export const BASE_MOVEMENT = 3.0;
const SEA_CROSSING_COST = 2.0;

/** The movement budget an army gets at the start of a turn. */
export function movementBudget(state: CampaignState, army: Army): number {
  const traits = tryGetFaction(army.faction)?.traits ?? {};
  let budget = BASE_MOVEMENT * (1 + (traits.movement ?? 0));
  // Roads in the province the army starts from help it get going.
  const from = state.regions.get(army.location);
  if (from) {
    let roads = 0;
    for (const id of from.buildings) roads += getBuildingType(id).effects.roads ?? 0;
    budget *= 1 + roads;
  }
  // An army is only as fast as its slowest regiment.
  const slowest = army.regiments.reduce(
    (min, regiment) => Math.min(min, getUnitType(regiment.type).speed),
    Infinity,
  );
  if (Number.isFinite(slowest) && slowest < 1.0) budget *= 0.75;
  if (state.season === 'winter') budget *= 0.7;
  return budget;
}

export function moveCost(state: CampaignState, from: RegionId, to: RegionId): number | undefined {
  const border = borderBetween(from, to);
  if (!border) return undefined;
  if (border.kind === 'sea') return SEA_CROSSING_COST;
  const cost = TERRAIN_COST[getRegion(to).terrain] ?? 1.5;
  return state.season === 'winter' && getRegion(to).terrain === 'mountains' ? cost * 1.5 : cost;
}

/** Provinces this army could enter with the movement it has left. */
export function reachableNeighbours(state: CampaignState, army: Army): readonly RegionId[] {
  const result: RegionId[] = [];
  for (const to of landNeighbours(army.location)) {
    const cost = moveCost(state, army.location, to);
    if (cost !== undefined && cost <= army.movement) result.push(to);
  }
  const from = state.regions.get(army.location);
  if (from && hasPort(from)) {
    for (const to of seaNeighbours(army.location)) {
      const target = state.regions.get(to);
      if (!target || !hasPort(target)) continue;
      const cost = moveCost(state, army.location, to);
      if (cost !== undefined && cost <= army.movement) result.push(to);
    }
  }
  return result;
}

export type MoveResult =
  | { kind: 'moved' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'battle'; defender: FactionId; defendingArmies: readonly ArmyId[] }
  | { kind: 'siege'; defender: FactionId }
  | { kind: 'captured'; defender: FactionId };

/**
 * Moves an army into an adjacent province. If the province is hostile the move
 * does not complete: it produces a battle, a siege or an undefended capture,
 * which the caller resolves.
 */
export function moveArmy(state: CampaignState, id: ArmyId, to: RegionId): MoveResult {
  const army = state.armies.get(id);
  if (!army) return { kind: 'blocked', reason: 'No such army.' };
  if (army.regiments.length === 0) return { kind: 'blocked', reason: 'The army is empty.' };
  const cost = moveCost(state, army.location, to);
  if (cost === undefined) return { kind: 'blocked', reason: 'That province is not adjacent.' };
  if (cost > army.movement) return { kind: 'blocked', reason: 'Not enough movement left.' };

  const border = borderBetween(army.location, to)!;
  if (border.kind === 'sea') {
    const from = state.regions.get(army.location);
    const target = state.regions.get(to);
    if (!from || !hasPort(from)) return { kind: 'blocked', reason: 'No harbour to sail from.' };
    if (!target || !hasPort(target)) return { kind: 'blocked', reason: 'No harbour to land at.' };
    if (seaLaneClosed(state, army.faction, army.location, to)) {
      return { kind: 'blocked', reason: 'An enemy fleet holds the water in between.' };
    }
  }

  const target = regionState(state, to);
  const atWar = isAtWar(state, army.faction, target.owner);

  // Enemy field armies must be fought before the province can be entered.
  const defenders = [...state.armies.values()].filter(
    (other) => other.location === to && isAtWar(state, army.faction, other.faction),
  );
  if (defenders.length > 0) {
    army.movement -= cost;
    return {
      kind: 'battle',
      defender: defenders[0]!.faction,
      defendingArmies: defenders.map((other) => other.id),
    };
  }

  if (target.owner !== army.faction && atWar) {
    army.movement -= cost;
    if (strengthOf(target.garrison) === 0) return { kind: 'captured', defender: target.owner };
    return { kind: 'siege', defender: target.owner };
  }

  if (target.owner !== army.faction && target.owner !== INDEPENDENT_ID && !atWar) {
    return { kind: 'blocked', reason: 'Not at war with the owner of that province.' };
  }
  if (target.owner === INDEPENDENT_ID && strengthOf(target.garrison) > 0) {
    army.movement -= cost;
    return { kind: 'siege', defender: target.owner };
  }

  army.movement -= cost;
  army.location = to;
  army.embarked = border.kind === 'sea';
  return { kind: 'moved' };
}

/** Puts a province under siege by the given army. */
export function beginSiege(state: CampaignState, id: ArmyId, to: RegionId): Outcome {
  const army = state.armies.get(id);
  if (!army) return no('No such army.');
  const target = regionState(state, to);
  if (target.owner === army.faction) return no('That province is already ours.');
  if (target.siege && target.siege.besieger !== army.faction) {
    return no('Another faction is already besieging it.');
  }
  const alreadyOurs = target.siege?.besieger === army.faction;
  target.siege = { besieger: army.faction, turns: target.siege?.turns ?? 0 };
  army.location = to;
  // Only announce a siege that is actually beginning. Re-stating it every turn
  // the army stands there would bury the rest of the chronicle.
  if (!alreadyOurs) {
    logEvent(
      state,
      army.faction,
      `${getFaction(army.faction).adjective} forces lay siege to ${getRegion(to).settlement}.`,
    );
  }
  return ok;
}

export function liftSiege(state: CampaignState, to: RegionId): void {
  const target = regionState(state, to);
  target.siege = undefined;
}

/** Transfers a province, with the bookkeeping that ownership implies. */
export function transferProvince(
  state: CampaignState,
  id: RegionId,
  toFaction: FactionId,
): void {
  const region = regionState(state, id);
  const from = region.owner;
  region.owner = toFaction;
  region.ownedSince = state.turn;
  region.siege = undefined;
  region.construction = undefined;
  region.recruitQueue = [];
  region.governor = undefined;
  // Conquest is resented; the size of the shock scales with the settlement.
  region.unrest = Math.min(100, region.unrest + 25 + SETTLEMENT_ORDER.indexOf(region.tier) * 4);
  const faction = state.factions.get(toFaction);
  if (faction && !faction.capital) faction.capital = id;
  logEvent(
    state,
    toFaction,
    `${getRegion(id).settlement} passes from ${nameOf(from)} to ${nameOf(toFaction)}.`,
  );
}

function nameOf(id: FactionId): string {
  return tryGetFaction(id)?.name ?? 'the independents';
}

export function mergeArmies(state: CampaignState, into: ArmyId, from: ArmyId): Outcome {
  const target = state.armies.get(into);
  const source = state.armies.get(from);
  if (!target || !source) return no('No such army.');
  if (target.faction !== source.faction) return no('Those armies serve different lords.');
  if (target.location !== source.location) return no('The armies are not in the same province.');
  if (target.regiments.length + source.regiments.length > MAX_ARMY_REGIMENTS) {
    return no('An army that size cannot be kept in the field as one command.');
  }
  target.regiments.push(...source.regiments);
  if (!target.general && source.general) target.general = source.general;
  target.movement = Math.min(target.movement, source.movement);
  state.armies.delete(from);
  return ok;
}

/** Splits selected regiments out into a new army in the same province. */
export function splitArmy(state: CampaignState, id: ArmyId, indices: readonly number[]): Outcome {
  const army = state.armies.get(id);
  if (!army) return no('No such army.');
  const picked = [...new Set(indices)].sort((a, b) => b - a);
  if (picked.length === 0) return no('No regiments selected.');
  if (picked.length >= army.regiments.length) return no('An army cannot be entirely split away.');
  const moved: Regiment[] = [];
  for (const index of picked) {
    const regiment = army.regiments[index];
    if (!regiment) return no('No such regiment.');
    moved.push(regiment);
    army.regiments.splice(index, 1);
  }
  const fresh: Army = {
    id: newArmyId(state),
    faction: army.faction,
    location: army.location,
    regiments: moved.reverse(),
    general: undefined,
    movement: army.movement,
    embarked: army.embarked,
  };
  state.armies.set(fresh.id, fresh);
  return ok;
}

/** Moves garrison regiments into a field army, raising one if needed. */
export function sortieFromGarrison(
  state: CampaignState,
  id: RegionId,
  indices: readonly number[],
): Outcome {
  const region = regionState(state, id);
  const picked = [...new Set(indices)].sort((a, b) => b - a);
  if (picked.length === 0) return no('No regiments selected.');
  const moved: Regiment[] = [];
  for (const index of picked) {
    const regiment = region.garrison[index];
    if (!regiment) return no('No such regiment.');
    moved.push(regiment);
    region.garrison.splice(index, 1);
  }
  const existing = [...state.armies.values()].find(
    (army) =>
      army.location === id &&
      army.faction === region.owner &&
      army.regiments.length + moved.length <= MAX_ARMY_REGIMENTS,
  );
  if (existing) {
    existing.regiments.push(...moved.reverse());
    return ok;
  }
  const army: Army = {
    id: newArmyId(state),
    faction: region.owner,
    location: id,
    regiments: moved.reverse(),
    general: undefined,
    movement: 0,
    embarked: false,
  };
  army.movement = movementBudget(state, army);
  state.armies.set(army.id, army);
  return ok;
}

/** Puts field regiments back into the settlement's garrison. */
export function garrisonArmy(state: CampaignState, id: ArmyId): Outcome {
  const army = state.armies.get(id);
  if (!army) return no('No such army.');
  const region = regionState(state, army.location);
  if (region.owner !== army.faction) return no('That settlement is not ours.');
  if (region.garrison.length + army.regiments.length > MAX_GARRISON_REGIMENTS) {
    return no('The settlement cannot billet that many troops.');
  }
  region.garrison.push(...army.regiments);
  state.armies.delete(id);
  return ok;
}

export function setGovernor(state: CampaignState, id: RegionId, character: string): Outcome {
  const region = regionState(state, id);
  const faction = factionState(state, region.owner);
  const found = faction.characters.find((c) => (c.id as string) === character);
  if (!found) return no('No such character.');
  // A character governs one province at a time.
  for (const other of state.regions.values()) {
    if (other.governor && other.governor.id === found.id) other.governor = undefined;
  }
  region.governor = found;
  return ok;
}

// ---------------------------------------------------------------------------
// Diplomacy helpers used by the order layer
// ---------------------------------------------------------------------------

/** Total soldiers a faction has under arms, in the field and in garrison. */
export function militaryStrength(state: CampaignState, id: FactionId): number {
  let total = 0;
  for (const army of state.armies.values()) {
    if (army.faction === id) total += strengthOf(army.regiments);
  }
  for (const region of state.regions.values()) {
    if (region.owner === id) total += strengthOf(region.garrison);
  }
  return total;
}

/** Garrison regiments the province's buildings supply free during a siege. */
export function freeGarrisonCount(region: RegionState): number {
  let total = 0;
  for (const id of region.buildings) total += getBuildingType(id).effects.garrison ?? 0;
  return total;
}
