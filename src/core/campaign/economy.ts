/**
 * Provincial economy and faction finances.
 *
 * The model is deliberately legible: four income streams and two cost streams,
 * each computed from data the player can see. A province that looks rich should
 * be rich for a reason the player can point at.
 */
import type { FactionId, RegionId } from '../types';
import { clamp, SETTLEMENT_ORDER } from '../types';
import type { CampaignState, Regiment, RegionState, Season } from './state';
import { MERCENARY_UPKEEP_MULTIPLIER, isMercenary } from './mercenaries';
import { censureUnrest, holyWarRelief } from './faith';
import { merchantIncome } from './agents';
import { isMinor, legitimacyUnrest } from './dynasty';
import { getAgentType } from '../data/agents';
import { factionState, hasPort, provincesOf, strengthOf, wallTier } from './state';
import { getBuildingType } from '../data/buildings';
import { getRegion } from '../data/regions';
import { landNeighbours, seaNeighbours } from '../data/adjacency';
import { getUnitType } from '../data/units';
import { tryGetFaction } from '../data/factions';
import { INDEPENDENT_ID } from '../data/factions';
import { seaLaneClosed } from './naval';

/** Tax yield per thousand inhabitants, by settlement rank. */
const TAX_PER_THOUSAND: Readonly<Record<string, number>> = {
  village: 6,
  town: 7,
  large_town: 9,
  city: 10,
  large_city: 12,
  huge_city: 13,
};

/** What a province's special resource is worth per trade route. */
const RESOURCE_VALUE: Readonly<Record<string, number>> = {
  none: 0,
  fish: 6,
  timber: 7,
  grain: 8,
  wool: 10,
  salt: 11,
  furs: 12,
  copper: 10,
  tin: 11,
  iron: 12,
  horses: 13,
  wine: 12,
  amber: 14,
  marble: 12,
  dyes: 15,
  silk: 20,
  spices: 20,
  ivory: 18,
  silver: 22,
  gold: 30,
};

export interface ProvinceIncome {
  readonly region: RegionId;
  readonly farming: number;
  readonly tax: number;
  readonly trade: number;
  readonly mining: number;
  readonly buildingUpkeep: number;
  readonly net: number;
}

/** Summer harvest brings in the money; winter does not. */
export function seasonFactor(season: Season): number {
  return season === 'summer' ? 1.0 : 0.6;
}

function buildingEffectSum(
  region: RegionState,
  pick: (effects: ReturnType<typeof getBuildingType>['effects']) => number | undefined,
): number {
  let total = 0;
  for (const id of region.buildings) {
    const value = pick(getBuildingType(id).effects);
    if (value) total += value;
  }
  return total;
}

/**
 * Trade routes: adjacent provinces that are actually open for trade, which
 * means owned by us, by a trade partner or by an ally, and not at war. Sea
 * routes count double, which is why the maritime republics are rich.
 */
export function tradeRoutes(state: CampaignState, region: RegionState): number {
  const owner = region.owner;
  let routes = 0;
  const openTo = (other: RegionId, weight: number): void => {
    const neighbour = state.regions.get(other);
    if (!neighbour) return;
    if (neighbour.owner === owner) {
      routes += weight * 0.5;
      return;
    }
    if (neighbour.owner === INDEPENDENT_ID) {
      routes += weight * 0.5;
      return;
    }
    const relation = factionState(state, owner).relations.get(neighbour.owner);
    const stance = relation?.stance ?? 'neutral';
    if (stance === 'war') return;
    routes += stance === 'trade' || stance === 'alliance' ? weight * 1.5 : weight;
  };
  for (const other of landNeighbours(region.id)) openTo(other, 1);
  if (hasPort(region)) {
    for (const other of seaNeighbours(region.id)) {
      // A hostile fleet standing on the water between two harbours closes the
      // trade along it. One squadron in the Channel is worth a campaign.
      if (seaLaneClosed(state, owner, region.id, other)) continue;
      openTo(other, 2);
    }
  }
  return routes;
}

export function provinceIncome(
  state: CampaignState,
  region: RegionState,
  season: Season = state.season,
): ProvinceIncome {
  const geography = getRegion(region.id);
  const faction = tryGetFaction(region.owner);
  const traits = faction?.traits ?? {};
  const harvest = seasonFactor(season);
  const governor = region.governor;

  const orderPenalty = 1 - clamp(region.unrest, 0, 100) / 150;

  const farmBonus = 1 + buildingEffectSum(region, (e) => e.farming);
  const farming =
    region.population * 4.5 * geography.fertility * farmBonus * harvest * orderPenalty;

  const taxRate = TAX_PER_THOUSAND[region.tier] ?? 8;
  const governorBonus = governor ? 1 + governor.governance * 0.02 : 1;
  const tax = region.population * taxRate * orderPenalty * governorBonus * harvest;

  const tradeBuildings = buildingEffectSum(region, (e) => e.trade);
  const resource = RESOURCE_VALUE[geography.resource] ?? 0;
  const trade = (tradeBuildings + resource * tradeRoutes(state, region)) * orderPenalty;

  const mining = buildingEffectSum(region, (e) => e.mining) * (geography.resource === 'gold' ? 1.6 : 1);

  const buildingUpkeep = (() => {
    let total = 0;
    for (const id of region.buildings) total += getBuildingType(id).upkeep;
    return total;
  })();

  const economyMultiplier = 1 + (traits.economy ?? 0);
  const tradeMultiplier = 1 + (traits.trade ?? 0);

  const gross =
    (farming + tax + mining) * economyMultiplier + trade * tradeMultiplier;

  return {
    region: region.id,
    farming: Math.round(farming * economyMultiplier),
    tax: Math.round(tax * economyMultiplier),
    trade: Math.round(trade * tradeMultiplier),
    mining: Math.round(mining * economyMultiplier),
    buildingUpkeep: Math.round(buildingUpkeep),
    net: Math.round(gross - buildingUpkeep),
  };
}

export interface FactionFinances {
  readonly faction: FactionId;
  readonly provinceNet: number;
  readonly armyUpkeep: number;
  readonly garrisonUpkeep: number;
  /** Court, chancery, couriers and the price of keeping distant lords loyal. */
  readonly administration: number;
  /** What a hoard loses to display, officials and debasement. */
  readonly hoarding: number;
  /** Spies, envoys, priests and factors, less what the factors send home. */
  readonly agents: number;
  readonly stipend: number;
  readonly net: number;
}

/**
 * What it costs to govern a realm of a given size, before any of its armies
 * are paid. The cost rises faster than the realm does: a king with thirty
 * provinces needs more than five times the officials, garrisons of clerks and
 * outright bribes that a king with six provinces needs. This is the brake that
 * stops a large AI empire accumulating a treasury it has no use for.
 */
export function administrationCost(provinces: number): number {
  if (provinces <= 0) return 0;
  return Math.round(18 * Math.pow(provinces, 1.25));
}

/** A treasury this size is a working reserve and nobody notices it. */
export const HOARD_THRESHOLD = 5000;

/**
 * What a hoard costs to keep.
 *
 * Medieval treasuries leaked. Money sitting in a vault was spent on display,
 * siphoned by the officials guarding it, lent to favourites who did not repay,
 * or quietly debased. Mechanically this is the brake that stops a small state
 * sitting on a rich trade road from accumulating a fortune it has no use for,
 * while leaving a prudent reserve untouched.
 */
export function hoardingCost(treasury: number): number {
  if (treasury <= HOARD_THRESHOLD) return 0;
  return Math.round((treasury - HOARD_THRESHOLD) * 0.03);
}

/** Upkeep of one regiment, after the faction's upkeep trait. */
export function regimentUpkeep(
  state: CampaignState,
  faction: FactionId,
  regiment: Regiment,
): number {
  const traits = tryGetFaction(faction)?.traits ?? {};
  const type = getUnitType(regiment.type);
  // A hired company costs far more than the same troops raised at home. That
  // is the price of having them tomorrow instead of in four turns, and the
  // reason an army of other people's soldiers is a dangerous habit.
  const premium = isMercenary(regiment) ? MERCENARY_UPKEEP_MULTIPLIER : 1;
  // A ruler who has taken the cross is kept partly by the faithful.
  const relief = 1 - holyWarRelief(state, faction);
  return type.upkeep * premium * relief * (1 + (traits.upkeep ?? 0));
}

export function factionFinances(
  state: CampaignState,
  id: FactionId,
  season: Season = state.season,
): FactionFinances {
  let provinceNet = 0;
  let garrisonUpkeep = 0;
  for (const region of provincesOf(state, id)) {
    provinceNet += provinceIncome(state, region, season).net;
    for (const regiment of region.garrison) {
      // A regiment at half strength costs half as much to keep.
      const type = getUnitType(regiment.type);
      const fraction = regiment.soldiers / type.soldiers;
      garrisonUpkeep += regimentUpkeep(state, id, regiment) * fraction;
    }
  }
  let armyUpkeep = 0;
  for (const army of state.armies.values()) {
    if (army.faction !== id) continue;
    for (const regiment of army.regiments) {
      const type = getUnitType(regiment.type);
      const fraction = regiment.soldiers / type.soldiers;
      armyUpkeep += regimentUpkeep(state, id, regiment) * fraction;
    }
  }
  const stipend = tryGetFaction(id)?.traits.stipend ?? 0;
  const administration = administrationCost(provincesOf(state, id).length);
  const hoarding = hoardingCost(state.factions.get(id)?.treasury ?? 0);
  // Agents are a net figure: a merchant on a foreign silver mine can pay for
  // the whole establishment, and often did.
  let agents = 0;
  for (const agent of state.agents.values()) {
    if (agent.faction !== id) continue;
    agents += getAgentType(agent.kind).upkeep - merchantIncome(state, agent);
  }
  // The reported components are rounded, and the total is computed from those
  // rounded figures rather than from the raw ones. A breakdown the player can
  // see must add up to the total the player is charged.
  const reported = {
    provinceNet: Math.round(provinceNet),
    armyUpkeep: Math.round(armyUpkeep),
    garrisonUpkeep: Math.round(garrisonUpkeep),
    administration,
    hoarding,
    agents: Math.round(agents),
    stipend,
  };
  return {
    faction: id,
    ...reported,
    net:
      reported.provinceNet -
      reported.armyUpkeep -
      reported.garrisonUpkeep -
      reported.administration -
      reported.hoarding -
      reported.agents +
      reported.stipend,
  };
}

/**
 * What the realm earns across a full year, averaged over both seasons.
 *
 * Budgeting on the summer figure is what sent the AI bankrupt every winter:
 * the harvest pays for an army that the following season cannot keep. A
 * treasurer plans for the year.
 */
export function annualNet(state: CampaignState, id: FactionId): number {
  const summer = factionFinances(state, id, 'summer').net;
  const winter = factionFinances(state, id, 'winter').net;
  return (summer + winter) / 2;
}

/**
 * Public order. Positive values are calm; the province revolts when unrest
 * reaches 100, and unrest moves towards the equilibrium implied by this score.
 */
export function publicOrder(state: CampaignState, region: RegionState): number {
  const faction = tryGetFaction(region.owner);
  let order = 4;
  order += buildingEffectSum(region, (e) => e.order);
  order += (faction?.traits.order ?? 0);
  if (region.governor) order += region.governor.governance;

  // A realm that does not believe in its own king is harder to hold
  // everywhere at once, which is what a disputed succession actually did.
  const realm = state.factions.get(region.owner);
  if (realm) {
    order -= legitimacyUnrest(realm) / 2;
    // A regency is a standing invitation, and everyone can see it.
    if (isMinor(state, region.owner)) order -= 2;
  }

  // A garrison keeps the peace, with diminishing returns.
  const garrison = strengthOf(region.garrison);
  order += Math.min(6, Math.sqrt(garrison) / 5);

  // Walls make a town defensible against its own population too.
  const walls = wallTier(region);
  order += ['none', 'palisade', 'wooden', 'stone', 'large_stone', 'epic'].indexOf(walls) * 0.5;

  // The wrong faith is the single largest source of trouble.
  if (faction && region.religion !== faction.religion) {
    order -= 10;
    const sameFamily =
      (faction.religion === 'catholic' && region.religion === 'orthodox') ||
      (faction.religion === 'orthodox' && region.religion === 'catholic') ||
      (faction.religion === 'sunni' && region.religion === 'shia') ||
      (faction.religion === 'shia' && region.religion === 'sunni');
    if (sameFamily) order += 4;
  }

  // Distance from the capital, measured in provinces, not kilometres.
  const capital = faction ? factionState(state, region.owner).capital : undefined;
  if (capital && capital !== region.id) {
    order -= Math.min(6, distanceInProvinces(capital, region.id) * 0.7);
  }

  // Recent conquest: a generation can pass before a province stops resenting
  // the lord who took it.
  const held = state.turn - region.ownedSince;
  if (held < 20) order -= (20 - held) * 0.6;

  // Big cities are harder to police than villages.
  order -= SETTLEMENT_ORDER.indexOf(region.tier) * 1.1;

  if (region.siege) order -= 5;
  // A ruler under censure keeps order in a country whose churches are shut.
  order -= censureUnrest(state, region.id);
  return order;
}

/** Breadth-first province distance, capped so the search stays cheap. */
export function distanceInProvinces(from: RegionId, to: RegionId, cap = 12): number {
  if (from === to) return 0;
  let frontier: RegionId[] = [from];
  const seen = new Set<RegionId>([from]);
  for (let depth = 1; depth <= cap; depth++) {
    const next: RegionId[] = [];
    for (const current of frontier) {
      for (const neighbour of landNeighbours(current)) {
        if (neighbour === to) return depth;
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        next.push(neighbour);
      }
      for (const neighbour of seaNeighbours(current)) {
        if (neighbour === to) return depth + 1;
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        next.push(neighbour);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return cap;
}

/**
 * How many thousands of people a province can feed and house.
 *
 * Medieval population was bounded by land, not by ambition: a province grew
 * until it hit the limit of what its fields, markets and water supply could
 * support, and then stopped. Without this ceiling a province compounds for
 * centuries and ends up with a tax base no medieval state ever had.
 */
export function carryingCapacity(region: RegionState): number {
  const geography = getRegion(region.id);
  const farming = 1 + buildingEffectSum(region, (e) => e.farming);
  const health = 1 + buildingEffectSum(region, (e) => e.growth) * 4;
  const rank = SETTLEMENT_ORDER.indexOf(region.tier);
  // A grown settlement supports more than its own fields do, because it can
  // buy grain: that is what a market town is for.
  const urban = 1 + rank * 0.5;
  const port = geography.port ? 1.2 : 1;
  return 6 * geography.fertility * farming * health * urban * port;
}

/**
 * Population growth for one turn, as a fraction of current population.
 *
 * Logistic: fast when there is room, zero at the ceiling, negative above it.
 */
export function growthRate(state: CampaignState, region: RegionState): number {
  const geography = getRegion(region.id);
  const faction = tryGetFaction(region.owner);
  if (region.siege) return -0.02;

  let vigour = 0.006 * geography.fertility;
  vigour += buildingEffectSum(region, (e) => e.growth);
  vigour += faction?.traits.growth ? faction.traits.growth * 0.01 : 0;
  vigour -= (clamp(region.unrest, 0, 100) / 100) * 0.012;
  // Even the healthiest province does not double in a decade.
  vigour = clamp(vigour, -0.02, 0.035);

  const capacity = Math.max(1, carryingCapacity(region));
  const headroom = 1 - region.population / capacity;
  let rate = vigour * headroom;
  // Above the ceiling the province starves back towards it regardless of how
  // well it is governed.
  if (headroom < 0) rate = Math.max(-0.03, headroom * 0.05);
  if (state.season === 'winter') rate *= 0.5;
  return rate;
}

/** Population at which the settlement is ready for the next rank. */
export function tierThreshold(tier: string): number {
  switch (tier) {
    case 'village': return 8;
    case 'town': return 14;
    case 'large_town': return 22;
    case 'city': return 32;
    case 'large_city': return 48;
    default: return Infinity;
  }
}
