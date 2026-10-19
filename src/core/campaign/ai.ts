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
  availableBuildings,
  mergeArmies,
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
  canMakePeace,
  countWars,
  declareWar,
  enemiesOf,
  makePeace,
  proposeAlliance,
  proposeTrade,
  relation,
  shareBorder,
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
        // Quiet provinces give up their troops first; a threatened one only
        // when there is nothing else left to cut.
        priority: exposed ? 2 : 0,
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
        priority: 3,
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
  let best: { port: RegionId; score: number } | undefined;
  for (const zone of SEA_ZONE_IDS) {
    if (!routeExists(fleet, zone)) continue;
    for (const port of getSeaZone(zone).ports) {
      const province = state.regions.get(port);
      if (!province || province.owner === fleet.faction) continue;
      if (!isAtWar(state, fleet.faction, province.owner)) continue;
      const defenders = strengthOf(province.garrison);
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
    if (current.stance === 'trade' && relation(state, other, id).attitude > 62 && rng.chance(0.05)) {
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
