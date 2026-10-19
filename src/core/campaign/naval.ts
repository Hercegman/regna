/**
 * Naval orders.
 *
 * Fleets live on the sea-zone graph rather than on the province map. A fleet
 * at anchor is in a harbour and safe; a fleet at sea is in a zone, where it can
 * blockade that water, be intercepted in it, and carry an army across it.
 *
 * As with everything else, the player and the AI go through these same
 * functions, so there is no naval behaviour available to one and not the other.
 */
import type { FactionId, FleetId, RegionId, UnitTypeId } from '../types';
import type { ArmyId } from '../types';
import type { CampaignState, Fleet, FleetLocation, Regiment } from './state';
import {
  factionState,
  fleetCapacity,
  fleetsInZone,
  hasPort,
  isAtWar,
  logEvent,
  newFleetId,
  regionState,
  strengthOf,
} from './state';
import type { SeaZoneId } from '../data/seas';
import { getSeaZone, seaNeighbourZones, zoneServesPort, zonesOffPort } from '../data/seas';
import { getRegion } from '../data/regions';
import { getUnitType } from '../data/units';
import { getFaction, tryGetFaction, INDEPENDENT_ID } from '../data/factions';
import { navalRosterFor } from '../data/roster';


/** Same shape as a land order's result; re-exported from `actions`. */
type Outcome = { ok: true } | { ok: false; reason: string };
const ok: Outcome = { ok: true };
const no = (reason: string): Outcome => ({ ok: false, reason });

/** A fleet is a squadron, not an armada. */
export const MAX_FLEET_SHIPS = 12;
export const MAX_SHIPYARD_QUEUE = 2;

// ---------------------------------------------------------------------------
// Building ships
// ---------------------------------------------------------------------------

/** Ships this harbour could lay down now. */
export function buildableShips(state: CampaignState, id: RegionId): readonly UnitTypeId[] {
  const region = regionState(state, id);
  if (!getRegion(id).port) return [];
  if (region.siege) return [];
  const faction = tryGetFaction(region.owner);
  if (!faction) return [];
  // What the harbour opens onto decides what can be built there: a river
  // galley is useless on the open sea, and a carrack cannot be floated down
  // the Tigris.
  const waters = zonesOffPort(id);
  const onRiver = waters.some((zone) => getSeaZone(zone).river);
  const onSea = waters.some((zone) => !getSeaZone(zone).river);

  return navalRosterFor(faction, state.year)
    .filter((ship) => !ship.requires || region.buildings.has(ship.requires))
    .filter((ship) => {
      const needs = ship.waters ?? 'any';
      if (needs === 'river') return onRiver;
      if (needs === 'sea') return onSea;
      return onRiver || onSea;
    })
    .map((ship) => ship.id);
}

export function shipCost(faction: FactionId, ship: UnitTypeId): number {
  const traits = tryGetFaction(faction)?.traits ?? {};
  // A maritime state builds hulls more cheaply: it has the yards and the timber
  // contracts already. The trade trait stands in for that.
  const discount = Math.min(0.25, (traits.trade ?? 0) * 0.4);
  return Math.round(getUnitType(ship).cost * (1 - discount));
}

export function shipBuildTurns(ship: UnitTypeId): number {
  return Math.max(1, Math.ceil(getUnitType(ship).tier / 2) + 1);
}

export function startShipbuilding(
  state: CampaignState,
  id: RegionId,
  ship: UnitTypeId,
): Outcome {
  const region = regionState(state, id);
  if (region.shipyardQueue.length >= MAX_SHIPYARD_QUEUE) return no('The slipways are full.');
  if (!buildableShips(state, id).includes(ship)) return no('That ship cannot be built here.');
  const faction = factionState(state, region.owner);
  const cost = shipCost(region.owner, ship);
  if (faction.treasury < cost) return no('The treasury cannot pay for it.');
  faction.treasury -= cost;
  region.shipyardQueue.push({ unit: ship, turnsLeft: shipBuildTurns(ship) });
  return ok;
}

/** Puts a finished hull into a fleet at its home port, raising one if needed. */
export function commissionShip(
  state: CampaignState,
  id: RegionId,
  ship: UnitTypeId,
): void {
  const region = regionState(state, id);
  const type = getUnitType(ship);
  const regiment: Regiment = { type: type.id, soldiers: type.soldiers, experience: 0 };
  const existing = [...state.fleets.values()].find(
    (fleet) =>
      fleet.faction === region.owner &&
      fleet.location.kind === 'port' &&
      fleet.location.region === id &&
      fleet.ships.length < MAX_FLEET_SHIPS,
  );
  if (existing) {
    existing.ships.push(regiment);
  } else {
    const fleet: Fleet = {
      id: newFleetId(state),
      faction: region.owner,
      location: { kind: 'port', region: id },
      ships: [regiment],
      cargo: [],
      admiral: undefined,
      movement: 0,
    };
    state.fleets.set(fleet.id, fleet);
  }
  logEvent(state, region.owner, `${type.name} is launched at ${getRegion(id).settlement}.`);
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

export const BASE_SEA_MOVEMENT = 3;

/**
 * How far a fleet can sail this turn, in zones. Winter is the great limiter:
 * medieval fleets were laid up from autumn to spring, and only the seaworthy
 * hulls kept any of their range.
 */
export function fleetMovementBudget(state: CampaignState, fleet: Fleet): number {
  const traits = tryGetFaction(fleet.faction)?.traits ?? {};
  let budget = BASE_SEA_MOVEMENT * (1 + (traits.movement ?? 0));
  if (state.season === 'winter') {
    const seaworthy = fleet.ships.filter((ship) =>
      getUnitType(ship.type).abilities.includes('seaworthy'),
    ).length;
    const share = fleet.ships.length === 0 ? 0 : seaworthy / fleet.ships.length;
    budget *= 0.45 + share * 0.35;
  }
  // A fleet weighed down with an army is slower than a squadron.
  if (fleet.cargo.length > 0) budget *= 0.85;
  return budget;
}

/** Cost of entering a water. Rivers are slow going; open sea is not. */
export function sailCost(zone: SeaZoneId): number {
  return getSeaZone(zone).river ? 1.5 : 1;
}

/** Where a fleet could go with the movement it has left. */
export function reachableWaters(state: CampaignState, fleet: Fleet): {
  readonly zones: readonly SeaZoneId[];
  readonly ports: readonly RegionId[];
} {
  const zones: SeaZoneId[] = [];
  const ports: RegionId[] = [];

  if (fleet.location.kind === 'port') {
    // Putting to sea costs half a zone: the harbour mouth is not a voyage.
    for (const zone of zonesOffPort(fleet.location.region)) {
      if (0.5 <= fleet.movement) zones.push(zone);
    }
    return { zones, ports };
  }

  const here = fleet.location.zone;
  for (const next of seaNeighbourZones(here)) {
    if (sailCost(next) <= fleet.movement) zones.push(next);
  }
  // Any friendly or neutral harbour on this water can be put into.
  for (const port of getSeaZone(here).ports) {
    const province = state.regions.get(port);
    if (!province || !hasPort(province)) continue;
    if (province.owner !== fleet.faction && isAtWar(state, fleet.faction, province.owner)) continue;
    if (0.5 <= fleet.movement) ports.push(port);
  }
  return { zones, ports };
}

export type FleetMoveResult =
  | { kind: 'moved' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'battle'; enemy: FactionId; fleets: readonly FleetId[] };

/** Sails a fleet to an adjacent water, or into a harbour on its present water. */
export function moveFleet(
  state: CampaignState,
  id: FleetId,
  target: FleetLocation,
): FleetMoveResult {
  const fleet = state.fleets.get(id);
  if (!fleet) return { kind: 'blocked', reason: 'No such fleet.' };
  if (fleet.ships.length === 0) return { kind: 'blocked', reason: 'The fleet has no hulls.' };

  const options = reachableWaters(state, fleet);
  if (target.kind === 'port') {
    if (!options.ports.includes(target.region)) {
      return { kind: 'blocked', reason: 'That harbour is out of reach.' };
    }
    fleet.movement -= 0.5;
    fleet.location = target;
    return { kind: 'moved' };
  }

  if (!options.zones.includes(target.zone)) {
    return { kind: 'blocked', reason: 'That water is out of reach.' };
  }

  // Hostile fleets at sea must be fought before the water can be entered.
  const enemies = fleetsInZone(state, target.zone).filter((other) =>
    isAtWar(state, fleet.faction, other.faction),
  );
  const cost = fleet.location.kind === 'port' ? 0.5 : sailCost(target.zone);
  fleet.movement -= cost;
  if (enemies.length > 0) {
    return {
      kind: 'battle',
      enemy: enemies[0]!.faction,
      fleets: enemies.map((other) => other.id),
    };
  }
  fleet.location = target;
  return { kind: 'moved' };
}

// ---------------------------------------------------------------------------
// Carrying an army
// ---------------------------------------------------------------------------

/** Takes regiments aboard from an army standing in the fleet's harbour. */
export function embark(
  state: CampaignState,
  fleetId: FleetId,
  armyId: ArmyId,
  indices: readonly number[],
): Outcome {
  const fleet = state.fleets.get(fleetId);
  const army = state.armies.get(armyId);
  if (!fleet || !army) return no('No such fleet or army.');
  if (fleet.faction !== army.faction) return no('They serve different lords.');
  if (fleet.location.kind !== 'port') return no('The fleet must be in harbour to load.');
  if (army.location !== fleet.location.region) return no('The army is not at that harbour.');

  const picked = [...new Set(indices)].sort((a, b) => b - a);
  if (picked.length === 0) return no('No regiments selected.');
  if (fleet.cargo.length + picked.length > fleetCapacity(fleet)) {
    return no('There is not enough room in the hulls.');
  }
  const moved: Regiment[] = [];
  for (const index of picked) {
    const regiment = army.regiments[index];
    if (!regiment) return no('No such regiment.');
    moved.push(regiment);
    army.regiments.splice(index, 1);
  }
  fleet.cargo.push(...moved.reverse());
  if (army.regiments.length === 0) state.armies.delete(army.id);
  return ok;
}

/**
 * Puts the cargo ashore. A landing in a hostile province is an invasion: the
 * regiments arrive as an army with no movement left, which is what makes an
 * opposed landing dangerous.
 */
export function disembark(state: CampaignState, fleetId: FleetId, at: RegionId): Outcome {
  const fleet = state.fleets.get(fleetId);
  if (!fleet) return no('No such fleet.');
  if (fleet.cargo.length === 0) return no('The fleet is carrying nothing.');

  const province = state.regions.get(at);
  if (!province) return no('No such province.');
  if (!getRegion(at).port) return no('There is nowhere to land there.');

  const reachable =
    fleet.location.kind === 'port'
      ? fleet.location.region === at
      : zoneServesPort(fleet.location.zone, at);
  if (!reachable) return no('That shore is not on this water.');

  if (province.owner !== fleet.faction && !isAtWar(state, fleet.faction, province.owner)) {
    return no('Not at war with the owner of that shore.');
  }

  const landed = fleet.cargo;
  fleet.cargo = [];
  const existing = [...state.armies.values()].find(
    (army) =>
      army.location === at &&
      army.faction === fleet.faction &&
      army.regiments.length + landed.length <= 20,
  );
  if (existing) {
    existing.regiments.push(...landed);
    existing.movement = 0;
    return ok;
  }
  const army = {
    id: (() => {
      // Reuse the army id allocator through the state, as every other army does.
      state.nextArmySerial += 1;
      return `army-${state.nextArmySerial}` as ArmyId;
    })(),
    faction: fleet.faction,
    location: at,
    regiments: landed,
    general: undefined,
    movement: 0,
    embarked: false,
  };
  state.armies.set(army.id, army);
  logEvent(
    state,
    fleet.faction,
    `${getFaction(fleet.faction).adjective} troops land at ${getRegion(at).settlement}.`,
  );
  return ok;
}

/**
 * The first leg of the shortest sea route to a water that satisfies the test.
 *
 * Fleets need this for the same reason armies do: a squadron that only ever
 * considers the water it can see from its own harbour never reaches the war.
 * The search is breadth-first over the zone graph and bounded, because the
 * whole graph is only a few dozen nodes wide.
 */
export function routeOverSea(
  fleet: Fleet,
  isGoal: (zone: SeaZoneId) => boolean,
  maxDepth = 6,
): SeaZoneId | undefined {
  const start =
    fleet.location.kind === 'sea'
      ? [fleet.location.zone]
      : [...zonesOffPort(fleet.location.region)];
  if (start.length === 0) return undefined;

  // A fleet already in a goal water has arrived.
  if (fleet.location.kind === 'sea' && isGoal(fleet.location.zone)) return undefined;

  const seen = new Set<SeaZoneId>(fleet.location.kind === 'sea' ? [fleet.location.zone] : []);
  let frontier: { zone: SeaZoneId; first: SeaZoneId }[] = [];
  for (const zone of start) {
    if (seen.has(zone)) continue;
    seen.add(zone);
    frontier.push({ zone, first: zone });
  }

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    for (const entry of frontier) {
      if (isGoal(entry.zone)) return entry.first;
    }
    const next: { zone: SeaZoneId; first: SeaZoneId }[] = [];
    for (const entry of frontier) {
      for (const neighbour of seaNeighbourZones(entry.zone)) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        next.push({ zone: neighbour, first: entry.first });
      }
    }
    frontier = next;
  }
  return undefined;
}

/** Waters this fleet could reach in one move, as a set for quick testing. */
export function nextLegTowards(
  state: CampaignState,
  fleet: Fleet,
  isGoal: (zone: SeaZoneId) => boolean,
): SeaZoneId | undefined {
  const leg = routeOverSea(fleet, isGoal);
  if (!leg) return undefined;
  return reachableWaters(state, fleet).zones.includes(leg) ? leg : undefined;
}

// ---------------------------------------------------------------------------
// Blockade
// ---------------------------------------------------------------------------

/**
 * Factions whose fleets are at sea in this water. A faction with ships here
 * contests it; a faction alone here controls it.
 */
export function factionsAtSeaIn(state: CampaignState, zone: SeaZoneId): Set<FactionId> {
  const present = new Set<FactionId>();
  for (const fleet of fleetsInZone(state, zone)) {
    if (fleet.ships.length > 0) present.add(fleet.faction);
  }
  return present;
}

/**
 * Is this harbour under blockade, and by whom?
 *
 * A harbour is blockaded when an enemy has ships at sea on every water it
 * opens onto and the owner has none there to contest them. A port with two
 * seas in front of it is correspondingly hard to close, which is exactly why
 * Constantinople was worth what it was.
 */
export function blockaderOf(state: CampaignState, id: RegionId): FactionId | undefined {
  const province = state.regions.get(id);
  if (!province || !getRegion(id).port) return undefined;
  if (province.owner === INDEPENDENT_ID) return undefined;
  const waters = zonesOffPort(id);
  if (waters.length === 0) return undefined;

  let blockader: FactionId | undefined;
  for (const zone of waters) {
    const present = factionsAtSeaIn(state, zone);
    if (present.has(province.owner)) return undefined; // the owner contests it
    const hostile = [...present].filter((faction) =>
      isAtWar(state, province.owner, faction),
    );
    if (hostile.length === 0) return undefined; // this water is open
    blockader = blockader ?? hostile[0];
  }
  return blockader;
}

export function isBlockaded(state: CampaignState, id: RegionId): boolean {
  return blockaderOf(state, id) !== undefined;
}

/**
 * Is the sea road between two harbours closed to this faction?
 *
 * It is closed when every water that joins them has an enemy fleet at sea on
 * it and we have none there. A fleet in the Channel stops an army crossing the
 * Channel, which is the point of keeping one there.
 */
export function seaLaneClosed(
  state: CampaignState,
  faction: FactionId,
  from: RegionId,
  to: RegionId,
): boolean {
  const shared = zonesOffPort(from).filter((zone) => zonesOffPort(to).includes(zone));
  // Two harbours with no water in common are joined by a short hop along the
  // coast that no fleet can stand across.
  if (shared.length === 0) return false;
  for (const zone of shared) {
    const present = factionsAtSeaIn(state, zone);
    if (present.has(faction)) return false;
    const hostile = [...present].some((other) => isAtWar(state, faction, other));
    if (!hostile) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------

export function mergeFleets(state: CampaignState, into: FleetId, from: FleetId): Outcome {
  const target = state.fleets.get(into);
  const source = state.fleets.get(from);
  if (!target || !source) return no('No such fleet.');
  if (target.faction !== source.faction) return no('Those fleets serve different lords.');
  if (!sameWater(target.location, source.location)) return no('They are not in the same water.');
  if (target.ships.length + source.ships.length > MAX_FLEET_SHIPS) {
    return no('A squadron that size cannot be handled as one command.');
  }
  target.ships.push(...source.ships);
  const room = fleetCapacity(target) - target.cargo.length;
  target.cargo.push(...source.cargo.slice(0, Math.max(0, room)));
  target.movement = Math.min(target.movement, source.movement);
  if (!target.admiral && source.admiral) target.admiral = source.admiral;
  state.fleets.delete(from);
  return ok;
}

export function sameWater(a: FleetLocation, b: FleetLocation): boolean {
  if (a.kind === 'port' && b.kind === 'port') return a.region === b.region;
  if (a.kind === 'sea' && b.kind === 'sea') return a.zone === b.zone;
  return false;
}

/** Scraps a hull, recovering a little of what it cost. */
export function scrapShip(state: CampaignState, id: FleetId, index: number): Outcome {
  const fleet = state.fleets.get(id);
  if (!fleet) return no('No such fleet.');
  const ship = fleet.ships[index];
  if (!ship) return no('No such ship.');
  if (fleet.location.kind !== 'port') return no('A ship can only be broken up in harbour.');
  factionState(state, fleet.faction).treasury += Math.floor(getUnitType(ship.type).cost / 5);
  fleet.ships.splice(index, 1);
  if (fleet.ships.length === 0) {
    fleet.cargo = [];
    state.fleets.delete(id);
  } else {
    const room = fleetCapacity(fleet);
    if (fleet.cargo.length > room) fleet.cargo = fleet.cargo.slice(0, Math.max(0, room));
  }
  return ok;
}

/** Total hulls a faction has afloat. */
export function navalStrength(state: CampaignState, id: FactionId): number {
  let total = 0;
  for (const fleet of state.fleets.values()) {
    if (fleet.faction === id) total += strengthOf(fleet.ships);
  }
  return total;
}
