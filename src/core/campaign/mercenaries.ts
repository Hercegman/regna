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
import type { FactionId, RegionId, UnitTypeId } from '../types';
import type { CampaignState, Regiment } from './state';
import { factionState, logEvent, regionState } from './state';
import type { MercenaryPool } from '../data/mercenaries';
import { MERCENARY_POOLS, getMercenaryPool, poolsAt } from '../data/mercenaries';
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
  }
  return recovered;
}
