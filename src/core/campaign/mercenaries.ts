/**
 * Hiring mercenaries.
 *
 * A mercenary is not recruited, it is found. Companies exist in the countries
 * that bred them, in limited numbers, and a state with money goes there and
 * buys what is standing about. Hiring therefore ignores the hiring state's own
 * roster entirely: the Pope can buy Swiss pikemen and the Swiss cannot raise
 * condottieri.
 *
 * What hiring does not ignore is the purse. A company joins immediately, with
 * no muster to wait for, and in exchange it costs a premium to take on, far
 * more than a levy to keep, and it is the first thing to walk away when the
 * money runs short.
 */
import type { ArmyId, FactionId, RegionId, UnitTypeId } from '../types';
import type { CampaignState, Regiment } from './state';
import { factionState, isAtWar, logEvent, regionState } from './state';
import type { MercenaryPool } from '../data/mercenaries';
import { MERCENARY_POOLS, getMercenaryPool, poolsAt } from '../data/mercenaries';
import type { Rng } from '../rng';
import { getUnitType } from '../data/units';
import { getRegion } from '../data/regions';
import { tryGetFaction, INDEPENDENT_ID } from '../data/factions';
import { MAX_ARMY_REGIMENTS, MAX_GARRISON_REGIMENTS } from './actions';

type Outcome = { ok: true } | { ok: false; reason: string };
const ok: Outcome = { ok: true };
const no = (reason: string): Outcome => ({ ok: false, reason });

/** What a hired company costs to keep, against what the same troops cost at home. */
export const MERCENARY_UPKEEP_MULTIPLIER = 1.8;

export interface PoolState {
  /** Companies standing about and available to anyone with the money. */
  available: number;
  /** Turns until the next company gathers. */
  countdown: number;
}

function poolState(state: CampaignState, id: string): PoolState {
  let entry = state.mercenaries.get(id);
  if (!entry) {
    const pool = getMercenaryPool(id);
    entry = { available: pool.capacity, countdown: pool.replenish };
    state.mercenaries.set(id, entry);
  }
  return entry;
}

export function isPoolActive(state: CampaignState, pool: MercenaryPool): boolean {
  if (pool.fromYear !== undefined && state.year < pool.fromYear) return false;
  if (pool.untilYear !== undefined && state.year > pool.untilYear) return false;
  const unit = getUnitType(pool.unit as UnitTypeId);
  if (unit.fromYear !== undefined && state.year < unit.fromYear) return false;
  if (unit.untilYear !== undefined && state.year > unit.untilYear) return false;
  return true;
}

/** What it costs to take a company on, before any faction discount. */
export function hireCost(pool: MercenaryPool): number {
  return Math.round(getUnitType(pool.unit as UnitTypeId).cost * pool.premium);
}

/** What a company costs to keep for a turn. */
export function mercenaryUpkeep(type: UnitTypeId): number {
  return Math.round(getUnitType(type).upkeep * MERCENARY_UPKEEP_MULTIPLIER);
}

export interface MercenaryOffer {
  readonly pool: MercenaryPool;
  readonly unit: UnitTypeId;
  readonly available: number;
  readonly cost: number;
  readonly upkeep: number;
}

/** The companies standing about in a province, whoever holds it. */
export function offersAt(state: CampaignState, region: RegionId): MercenaryOffer[] {
  const offers: MercenaryOffer[] = [];
  for (const pool of poolsAt(region)) {
    if (!isPoolActive(state, pool)) continue;
    const entry = poolState(state, pool.id);
    if (entry.available <= 0) continue;
    const unit = pool.unit as UnitTypeId;
    offers.push({
      pool,
      unit,
      available: entry.available,
      cost: hireCost(pool),
      upkeep: mercenaryUpkeep(unit),
    });
  }
  return offers;
}

/** Can this faction take on that company here? */
export function canHire(
  state: CampaignState,
  region: RegionId,
  poolId: string,
  faction: FactionId,
): Outcome {
  const pool = MERCENARY_POOLS.find((candidate) => candidate.id === poolId);
  if (!pool) return no('No such company.');
  if (faction === INDEPENDENT_ID) return no('Nobody there answers for a contract.');
  if (!pool.regions.includes(region)) return no('That company is not to be found here.');
  if (!isPoolActive(state, pool)) return no('No such company exists in this year.');

  const province = regionState(state, region);
  if (province.siege) return no('The settlement is under siege.');
  // Mercenaries will not walk into a town held by the enemy of their employer,
  // but they are happy to be hired in a neutral one.
  if (province.owner !== faction && province.owner !== INDEPENDENT_ID) {
    const relation = state.factions.get(faction)?.relations.get(province.owner);
    if (relation?.stance === 'war') return no('That town is held by our enemy.');
  }

  if (poolState(state, pool.id).available <= 0) return no('There is no company free just now.');
  if (factionState(state, faction).treasury < hireCost(pool)) {
    return no('The treasury cannot pay the contract.');
  }
  if (roomFor(state, region, faction) <= 0) {
    return no('There is nowhere here to quarter another company.');
  }
  return ok;
}

/** Whether a company hired here would have anywhere to go. */
function roomFor(state: CampaignState, region: RegionId, faction: FactionId): number {
  const army = [...state.armies.values()].find(
    (candidate) => candidate.location === region && candidate.faction === faction,
  );
  if (army && army.regiments.length < MAX_ARMY_REGIMENTS) {
    return MAX_ARMY_REGIMENTS - army.regiments.length;
  }
  const province = state.regions.get(region);
  if (province && province.owner === faction && province.garrison.length < MAX_GARRISON_REGIMENTS) {
    return MAX_GARRISON_REGIMENTS - province.garrison.length;
  }
  return 0;
}

/**
 * Takes a company into service. It joins an army of ours standing here if
 * there is one, because that is the point of hiring on campaign, and otherwise
 * the garrison.
 */
export function hireMercenary(
  state: CampaignState,
  region: RegionId,
  poolId: string,
  faction: FactionId,
): Outcome {
  const allowed = canHire(state, region, poolId, faction);
  if (!allowed.ok) return allowed;

  const pool = getMercenaryPool(poolId);
  const type = getUnitType(pool.unit as UnitTypeId);
  factionState(state, faction).treasury -= hireCost(pool);
  poolState(state, pool.id).available -= 1;

  const company: Regiment = {
    type: type.id,
    soldiers: type.soldiers,
    // A company that lives by fighting knows its trade.
    experience: 2,
    mercenary: true,
  };

  const army = [...state.armies.values()].find(
    (candidate) =>
      candidate.location === region &&
      candidate.faction === faction &&
      candidate.regiments.length < MAX_ARMY_REGIMENTS,
  );
  if (army) army.regiments.push(company);
  else regionState(state, region).garrison.push(company);

  logEvent(
    state,
    faction,
    `${type.name} take service at ${getRegion(region).settlement}.`,
  );
  return ok;
}

/** Companies gather again over time, up to what the country can furnish. */
export function replenishMercenaries(state: CampaignState): void {
  for (const pool of MERCENARY_POOLS) {
    const entry = poolState(state, pool.id);
    if (!isPoolActive(state, pool)) {
      // A pool out of its years empties: those men are not there to be hired.
      entry.available = 0;
      entry.countdown = pool.replenish;
      continue;
    }
    if (entry.available >= pool.capacity) {
      entry.countdown = pool.replenish;
      continue;
    }
    entry.countdown -= 1;
    if (entry.countdown <= 0) {
      entry.available = Math.min(pool.capacity, entry.available + 1);
      entry.countdown = pool.replenish;
    }
  }
}

/** Is this regiment a hired company? */
export function isMercenary(regiment: Regiment): boolean {
  return regiment.mercenary === true || getUnitType(regiment.type).mercenary === true;
}

/** Hired companies a faction is paying for. */
export function mercenaryCompanies(state: CampaignState, faction: FactionId): number {
  let total = 0;
  for (const army of state.armies.values()) {
    if (army.faction !== faction) continue;
    total += army.regiments.filter(isMercenary).length;
  }
  for (const province of state.regions.values()) {
    if (province.owner !== faction) continue;
    total += province.garrison.filter(isMercenary).length;
  }
  return total;
}

/**
 * Companies leave when the pay does.
 *
 * Called when a realm cannot meet its bills: the hired men go first, which is
 * both what happened and a reason to think twice before building an army out
 * of other people's soldiers.
 */
export function desertUnpaid(state: CampaignState, faction: FactionId, needed: number): number {
  let recovered = 0;
  const leave = (regiments: Regiment[], index: number): void => {
    const [gone] = regiments.splice(index, 1);
    if (gone) recovered += mercenaryUpkeep(gone.type);
  };

  for (const army of state.armies.values()) {
    if (army.faction !== faction) continue;
    for (let i = army.regiments.length - 1; i >= 0; i--) {
      if (recovered >= needed) break;
      if (!isMercenary(army.regiments[i]!)) continue;
      leave(army.regiments, i);
    }
  }
  for (const province of state.regions.values()) {
    if (province.owner !== faction) continue;
    for (let i = province.garrison.length - 1; i >= 0; i--) {
      if (recovered >= needed) break;
      if (!isMercenary(province.garrison[i]!)) continue;
      leave(province.garrison, i);
    }
  }
  if (recovered > 0) {
    logEvent(
      state,
      faction,
      `${tryGetFaction(faction)?.adjective ?? 'The'} mercenaries leave for want of pay.`,
    );
    // A command whose last company has walked away is no longer an army.
    for (const [id, army] of [...state.armies]) {
      if (army.faction === faction && army.regiments.length === 0) state.armies.delete(id);
    }
  }
  return recovered;
}

// ---------------------------------------------------------------------------
// What a company does when the money stops
// ---------------------------------------------------------------------------

/**
 * How long the pay has to be late before a company acts, by how drastic the
 * act is.
 *
 * One missed season and it is listening to other people's offers, which is
 * all a condottiere ever needed. Taking the town it was hired to garrison is
 * a different matter, and wants a year of being owed.
 */
export const ARREARS_BEFORE_POACHING = 1;
export const ARREARS_BEFORE_MUTINY = 2;

/** What it costs to buy a company out of somebody else's service. */
export function poachCost(regiment: Regiment): number {
  // More than hiring one off the street, because he is already somewhere and
  // has to be persuaded to break a contract to come.
  return Math.round(getUnitType(regiment.type).cost * 1.6);
}

export interface Poach {
  readonly employer: FactionId;
  readonly army: ArmyId;
  readonly index: number;
  readonly regiment: Regiment;
  readonly cost: number;
  /** Where the company is standing, which is where it would change sides. */
  readonly where: RegionId;
}

/**
 * Companies that could be bought out from under their employer.
 *
 * Only from a realm in arrears. A company whose pay has arrived has a
 * contract and keeps it; one whose pay has not is listening to offers, and
 * everybody in Italy knew it. The buyer must be at war with the employer —
 * this is an act of war carried out with money, not a labour market.
 */
export function poachable(state: CampaignState, buyer: FactionId): Poach[] {
  const offers: Poach[] = [];
  for (const army of state.armies.values()) {
    if (army.faction === buyer) continue;
    const employer = state.factions.get(army.faction);
    if (!employer?.alive) continue;
    if (employer.arrears < ARREARS_BEFORE_POACHING) continue;
    if (!isAtWar(state, buyer, army.faction)) continue;
    army.regiments.forEach((regiment, index) => {
      if (!isMercenary(regiment)) return;
      offers.push({
        employer: army.faction,
        army: army.id,
        index,
        regiment,
        cost: poachCost(regiment),
        where: army.location,
      });
    });
  }
  return offers;
}

export function canPoach(state: CampaignState, buyer: FactionId, offer: Poach): Outcome {
  const army = state.armies.get(offer.army);
  if (!army) return no('That company is no longer there.');
  const regiment = army.regiments[offer.index];
  if (!regiment || !isMercenary(regiment)) return no('That company is no longer there.');
  const employer = state.factions.get(army.faction);
  if (!employer || employer.arrears < ARREARS_BEFORE_POACHING) {
    return no('They are being paid, and a paid company keeps its contract.');
  }
  if (!isAtWar(state, buyer, army.faction)) return no('We are not at war with their employer.');
  if (factionState(state, buyer).treasury < offer.cost) return no('Not enough money.');
  return ok;
}

/**
 * Buys a company out of an enemy's army.
 *
 * It does not change sides on the field — it walks away from the man who is
 * not paying it and turns up in the nearest force of the man who is. If the
 * buyer has nothing standing nearby, the company marches to his capital, and
 * if he has nowhere at all to put it, the money buys nothing but the enemy's
 * loss, which was often the point.
 */
export function poachCompany(state: CampaignState, buyer: FactionId, offer: Poach): Outcome {
  const allowed = canPoach(state, buyer, offer);
  if (!allowed.ok) return allowed;
  const army = state.armies.get(offer.army)!;
  const [company] = army.regiments.splice(offer.index, 1);
  if (!company) return no('That company is no longer there.');
  factionState(state, buyer).treasury -= offer.cost;

  // An army with nobody left in it is not an army.
  if (army.regiments.length === 0) state.armies.delete(army.id);

  const taken = placeCompany(state, buyer, company, offer.where);
  logEvent(
    state,
    buyer,
    taken
      ? `${getUnitType(company.type).name} changes sides at ${getRegion(offer.where).settlement}.`
      : `${getUnitType(company.type).name} is bought out of ${tryGetFaction(offer.employer)?.name ?? 'enemy'} service and disperses.`,
  );
  logEvent(
    state,
    offer.employer,
    `${getUnitType(company.type).name} takes another man's money and leaves ${getRegion(offer.where).settlement}.`,
  );
  return ok;
}

/** Finds somewhere for a bought company to stand; false if there is nowhere. */
function placeCompany(
  state: CampaignState,
  buyer: FactionId,
  company: Regiment,
  near: RegionId,
): boolean {
  const ours = [...state.armies.values()].filter(
    (army) => army.faction === buyer && army.regiments.length < MAX_ARMY_REGIMENTS,
  );
  ours.sort((a, b) => distanceApart(a.location, near) - distanceApart(b.location, near));
  const nearest = ours[0];
  if (nearest) {
    nearest.regiments.push(company);
    return true;
  }
  const seat = state.factions.get(buyer)?.capital;
  const home = seat ? state.regions.get(seat) : undefined;
  if (home && home.owner === buyer && home.garrison.length < MAX_GARRISON_REGIMENTS) {
    home.garrison.push(company);
    return true;
  }
  return false;
}

function distanceApart(a: RegionId, b: RegionId): number {
  const from = getRegion(a);
  const to = getRegion(b);
  const scale = Math.cos(((from.lat + to.lat) / 2) * (Math.PI / 180));
  return Math.hypot((from.lon - to.lon) * scale, from.lat - to.lat);
}

/**
 * A company that has not been paid takes the town it was garrisoning.
 *
 * This is the thing the hiring model was missing. A company left unpaid in
 * somebody's city did not simply walk home: more than once it kept the city.
 * The province goes to nobody — the company holds it for itself — and every
 * soldier in it who was not a mercenary is gone.
 */
export function mutiny(state: CampaignState, rng: Rng): void {
  for (const [id, faction] of state.factions) {
    if (!faction.alive || id === INDEPENDENT_ID) continue;
    if (faction.arrears < ARREARS_BEFORE_MUTINY) continue;

    for (const province of state.regions.values()) {
      if (province.owner !== id) continue;
      const hired = province.garrison.filter(isMercenary);
      // They can only take the place if they are at least half of what is
      // holding it. One company among six militia is in no position to keep
      // anything, whatever it is owed.
      if (hired.length === 0) continue;
      if (hired.length * 2 < province.garrison.length) continue;

      const chance = 0.1 + (faction.arrears - ARREARS_BEFORE_MUTINY) * 0.06;
      if (!rng.chance(Math.min(0.45, chance))) continue;

      province.garrison = hired;
      province.siege = undefined;
      province.construction = undefined;
      province.recruitQueue = [];
      province.governor = undefined;
      province.unrest = Math.min(100, province.unrest + 30);
      province.owner = INDEPENDENT_ID;
      province.ownedSince = state.turn;
      logEvent(
        state,
        id,
        `The unpaid companies in ${getRegion(province.id).settlement} take the town for themselves.`,
      );
      // One town a season is enough of a disaster.
      break;
    }
  }
}
