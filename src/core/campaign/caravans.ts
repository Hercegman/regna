/**
 * Caravans: the trade routes made concrete.
 *
 * A route is a path on the map; a caravan is a thing that walks it. Sending
 * one costs money now and pays more later, if it arrives. On the way it pays a
 * toll to every lord whose land it crosses, which is how a province with
 * nothing of its own can grow rich on a road, and it can be seized outright by
 * any army at war with its owner.
 *
 * This is the whole of the trade mechanic the player interacts with. The
 * passive, local trade of a province with its neighbours lives in `economy.ts`
 * and is unaffected.
 */
import type { FactionId, RegionId } from '../types';
import { clamp } from '../types';
import type { CampaignState, Caravan } from './state';
import {
  factionState,
  isAtWar,
  logEvent,
  newCaravanId,
  regionState,
} from './state';
import type { TradeRoute, TradeRouteId } from '../data/trade';
import {
  getTradeRoute,
  positionOn,
  routesInYear,
  routesThrough,
  tryTradeRoute,
} from '../data/trade';
import { borderBetween } from '../data/adjacency';
import { getRegion } from '../data/regions';
import { factionName, tryGetFaction, INDEPENDENT_ID } from '../data/factions';
import { seaLaneClosed } from './naval';
import type { Rng } from '../rng';

type Outcome = { ok: true } | { ok: false; reason: string };
const ok: Outcome = { ok: true };
const no = (reason: string): Outcome => ({ ok: false, reason });

/** A state can have this many caravans on one road at a time. */
export const MAX_CARAVANS_PER_ROUTE = 2;
/** Fraction of a cargo's value taken as toll by each foreign lord it crosses. */
export const TOLL_RATE = 0.05;
/** What it costs to load a caravan, as a fraction of what it will fetch. */
export const OUTLAY_RATE = 0.38;

export function caravanOutlay(route: TradeRoute): number {
  return Math.round(route.value * OUTLAY_RATE);
}

/**
 * Can this province send a caravan along that road?
 *
 * It must be ours, be on the road, have a market to load at, not be besieged,
 * and we must not already have more caravans on that road than we can watch.
 */
export function canDispatch(
  state: CampaignState,
  region: RegionId,
  routeId: TradeRouteId,
): Outcome {
  const route = tryTradeRoute(routeId);
  if (!route) return no('No such trade road.');
  if (state.year < (route.fromYear ?? -Infinity)) return no('That road is not yet in use.');
  if (state.year > (route.untilYear ?? Infinity)) return no('That road has fallen out of use.');

  const province = regionState(state, region);
  if (province.owner === INDEPENDENT_ID) return no('Nobody there answers for a caravan.');
  if (province.siege) return no('The settlement is under siege.');
  if (positionOn(route, region) < 0) return no('That road does not pass through here.');

  // A caravan is loaded at a market, not in a field.
  const hasMarket = [...province.buildings].some((id) => (id as string).startsWith('market') ||
    (id as string) === 'merchants_guild' || (id as string) === 'great_exchange');
  if (!hasMarket) return no('There is no market here to load a caravan at.');

  const mine = [...state.caravans.values()].filter(
    (caravan) => caravan.faction === province.owner && caravan.route === routeId,
  );
  if (mine.length >= MAX_CARAVANS_PER_ROUTE) {
    return no('We already have as many caravans on that road as we can look after.');
  }

  const faction = factionState(state, province.owner);
  if (faction.treasury < caravanOutlay(route)) return no('The treasury cannot pay for the goods.');
  return ok;
}

/** Sends a caravan from this province along the road, towards its far end. */
export function dispatchCaravan(
  state: CampaignState,
  region: RegionId,
  routeId: TradeRouteId,
): Outcome {
  const allowed = canDispatch(state, region, routeId);
  if (!allowed.ok) return allowed;

  const route = getTradeRoute(routeId);
  const province = regionState(state, region);
  const start = positionOn(route, region);
  // It makes for whichever end of the road is further away: that is where the
  // goods are worth the most.
  const toEnd = route.path.length - 1 - start;
  const direction: 1 | -1 = toEnd >= start ? 1 : -1;
  const destination = direction === 1 ? route.path.length - 1 : 0;

  factionState(state, province.owner).treasury -= caravanOutlay(route);
  const caravan: Caravan = {
    id: newCaravanId(state),
    faction: province.owner,
    route: routeId,
    position: start,
    direction,
    destination,
    value: route.value,
    stalled: 0,
  };
  state.caravans.set(caravan.id, caravan);
  return ok;
}

/**
 * Can a caravan of this faction move from one province to the next?
 *
 * The road is shut by a siege, by war with whoever holds the far side, and at
 * sea by an enemy squadron standing on the crossing.
 */
export function stepOpen(
  state: CampaignState,
  faction: FactionId,
  from: RegionId,
  to: RegionId,
): boolean {
  const border = borderBetween(from, to);
  if (!border) return false;
  const target = state.regions.get(to);
  if (!target) return false;
  if (target.siege) return false;
  if (target.owner !== faction && isAtWar(state, faction, target.owner)) return false;
  // A province in open revolt is no safer than an enemy one.
  if (target.unrest > 85) return false;
  if (border.kind === 'sea' && seaLaneClosed(state, faction, from, to)) return false;
  return true;
}

/** How far a caravan travels in one turn. Winter roads are bad roads. */
export function caravanPace(state: CampaignState): number {
  return state.season === 'winter' ? 1 : 2;
}

/** Everything that happens to the caravans in one turn. */
export function advanceCaravans(state: CampaignState, rng: Rng): void {
  for (const [id, caravan] of [...state.caravans]) {
    const route = tryTradeRoute(caravan.route);
    if (!route) {
      state.caravans.delete(id);
      continue;
    }

    // 1. Anyone at war with us who is standing where we are takes the lot.
    if (seizeIfCaught(state, caravan)) {
      state.caravans.delete(id);
      continue;
    }

    // 2. March.
    let moved = false;
    for (let step = 0; step < caravanPace(state); step++) {
      const next = caravan.position + caravan.direction;
      if (next < 0 || next >= route.path.length) break;
      const from = route.path[caravan.position]!;
      const to = route.path[next]!;
      if (!stepOpen(state, caravan.faction, from, to)) break;
      caravan.position = next;
      moved = true;
      payToll(state, caravan, to);
      if (seizeIfCaught(state, caravan)) {
        state.caravans.delete(id);
        break;
      }
      if (caravan.position === caravan.destination) break;
    }
    if (!state.caravans.has(id)) continue;

    // 3. Arrival.
    if (caravan.position === caravan.destination) {
      deliver(state, caravan, route);
      state.caravans.delete(id);
      continue;
    }

    // 4. Blocked. A merchant waits a while, then turns for home, and if home
    // is shut too he is ruined.
    if (moved) {
      caravan.stalled = 0;
      continue;
    }
    caravan.stalled += 1;
    if (caravan.stalled === 3) {
      caravan.direction = caravan.direction === 1 ? -1 : 1;
      caravan.destination = caravan.direction === 1 ? route.path.length - 1 : 0;
      logEvent(
        state,
        caravan.faction,
        `A caravan on ${route.name} turns back at ${getRegion(route.path[caravan.position]!).settlement}.`,
      );
    } else if (caravan.stalled >= 7) {
      logEvent(
        state,
        caravan.faction,
        `A caravan on ${route.name} is lost at ${getRegion(route.path[caravan.position]!).settlement}.`,
      );
      state.caravans.delete(id);
    }
    // Being stuck in bad company is dangerous in itself.
    if (rng.chance(0.05)) caravan.value = Math.round(caravan.value * 0.95);
  }
}

/** Pays the lord of a province his toll, and takes it off the cargo. */
function payToll(state: CampaignState, caravan: Caravan, region: RegionId): void {
  const province = state.regions.get(region);
  if (!province) return;
  if (province.owner === caravan.faction) return;
  const toll = Math.round(caravan.value * TOLL_RATE);
  if (toll <= 0) return;
  caravan.value = Math.max(0, caravan.value - toll);
  if (province.owner === INDEPENDENT_ID) return; // taken by local lords, not a state
  factionState(state, province.owner).treasury += toll;
}

/** Pays the owner on arrival. */
function deliver(state: CampaignState, caravan: Caravan, route: TradeRoute): void {
  const faction = state.factions.get(caravan.faction);
  if (!faction) return;
  const traits = tryGetFaction(caravan.faction)?.traits ?? {};
  const profit = Math.round(caravan.value * (1 + (traits.trade ?? 0) * 0.5));
  faction.treasury += profit;
  logEvent(
    state,
    caravan.faction,
    `A caravan reaches ${getRegion(route.path[caravan.destination]!).settlement} ` +
      `by ${route.name}, worth ${profit} florins.`,
  );
}

/** An army at war with the caravan's owner, standing where it stands. */
export function captorOf(state: CampaignState, caravan: Caravan): FactionId | undefined {
  const route = tryTradeRoute(caravan.route);
  if (!route) return undefined;
  const here = route.path[caravan.position];
  if (!here) return undefined;
  for (const army of state.armies.values()) {
    if (army.location !== here) continue;
    if (!isAtWar(state, caravan.faction, army.faction)) continue;
    if (army.regiments.length === 0) continue;
    return army.faction;
  }
  // A province that has changed hands to an enemy keeps the goods too.
  const province = state.regions.get(here);
  if (province && province.owner !== caravan.faction && isAtWar(state, caravan.faction, province.owner)) {
    return province.owner === INDEPENDENT_ID ? undefined : province.owner;
  }
  return undefined;
}

function seizeIfCaught(state: CampaignState, caravan: Caravan): boolean {
  const captor = captorOf(state, caravan);
  if (!captor) return false;
  const route = getTradeRoute(caravan.route);
  factionState(state, captor).treasury += caravan.value;
  logEvent(
    state,
    captor,
    `${factionName(captor)} seizes a ${factionName(caravan.faction)} caravan on ` +
      `${route.name}, worth ${Math.round(caravan.value)} florins.`,
  );
  return true;
}

// ---------------------------------------------------------------------------
// Information for the interface and the AI
// ---------------------------------------------------------------------------

export interface RouteStanding {
  readonly route: TradeRoute;
  /** Provinces of the road we hold. */
  readonly held: number;
  /** How much of the road is passable to us, 0 to 1. */
  readonly open: number;
}

/** How a faction stands on each road that is in use this year. */
export function routeStandings(state: CampaignState, faction: FactionId): RouteStanding[] {
  const standings: RouteStanding[] = [];
  for (const route of routesInYear(state.year)) {
    let held = 0;
    let passable = 0;
    for (let i = 0; i < route.path.length; i++) {
      const region = route.path[i]!;
      if (state.regions.get(region)?.owner === faction) held += 1;
      if (i === 0) continue;
      if (stepOpen(state, faction, route.path[i - 1]!, region)) passable += 1;
    }
    standings.push({
      route,
      held,
      open: route.path.length < 2 ? 1 : passable / (route.path.length - 1),
    });
  }
  return standings;
}

/** Roads passing through a province that are in use this year. */
export function activeRoutesThrough(state: CampaignState, region: RegionId): TradeRoute[] {
  return routesThrough(region)
    .map((id) => getTradeRoute(id))
    .filter(
      (route) =>
        state.year >= (route.fromYear ?? -Infinity) &&
        state.year <= (route.untilYear ?? Infinity),
    );
}

/** Caravans standing in a province, whoever they belong to. */
export function caravansIn(state: CampaignState, region: RegionId): Caravan[] {
  const result: Caravan[] = [];
  for (const caravan of state.caravans.values()) {
    const route = tryTradeRoute(caravan.route);
    if (route?.path[caravan.position] === region) result.push(caravan);
  }
  return result;
}

/** Where a caravan is now. */
export function caravanLocation(caravan: Caravan): RegionId | undefined {
  return tryTradeRoute(caravan.route)?.path[caravan.position];
}

/** What a caravan is expected to be worth if it gets through, for the AI. */
export function expectedReturn(
  state: CampaignState,
  faction: FactionId,
  route: TradeRoute,
  from: RegionId,
): number {
  const start = positionOn(route, from);
  if (start < 0) return 0;
  const toEnd = route.path.length - 1 - start;
  const direction = toEnd >= start ? 1 : -1;
  const destination = direction === 1 ? route.path.length - 1 : 0;

  let value = route.value;
  let openSteps = 0;
  const steps = Math.abs(destination - start);
  for (let i = start; i !== destination; i += direction) {
    const next = i + direction;
    const region = route.path[next]!;
    if (!stepOpen(state, faction, route.path[i]!, region)) break;
    openSteps += 1;
    if (state.regions.get(region)?.owner !== faction) value *= 1 - TOLL_RATE;
  }
  // A road that is only half open is worth about half a caravan's risk.
  const reach = steps === 0 ? 0 : openSteps / steps;
  return Math.round(value * clamp(reach, 0, 1) * reach);
}
