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
import { factionState, provincesOf, strengthOf } from './state';
import {
  availableBuildings,
  isAtWar,
  militaryStrength,
  moveArmy,
  recruitCost,
  recruitableUnits,
  startConstruction,
  startRecruitment,
  transferProvince,
  beginSiege,
  MAX_RECRUIT_QUEUE,
} from './actions';
import { factionFinances } from './economy';
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
  warDesire,
} from './diplomacy';
import { applyBattleResult, autoResolve, planBattle, assaultOdds } from './resolve';
import type { Rng } from '../rng';

export function takeAiTurn(state: CampaignState, id: FactionId, rng: Rng): void {
  manageEconomy(state, id, rng);
  manageDiplomacy(state, id, rng);
  manageArmies(state, id, rng);
}

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

/**
 * What the AI wants to spend on. It keeps a reserve proportional to its army,
 * builds in its best provinces first, and recruits when it is at war or weak.
 */
function manageEconomy(state: CampaignState, id: FactionId, rng: Rng): void {
  const faction = factionState(state, id);
  const finances = factionFinances(state, id);
  const provinces = provincesOf(state, id);
  if (provinces.length === 0) return;

  const atWar = countWars(state, id) > 0;
  // Keep enough in hand to pay upkeep for several turns.
  const reserve = Math.max(500, (finances.armyUpkeep + finances.garrisonUpkeep) * 3);

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
  // Build in the province where the best available option scores highest.
  let best: { province: RegionState; building: BuildingId; score: number } | undefined;
  for (const province of candidates) {
    for (const building of availableBuildings(state, province.id)) {
      const cost = getBuildingType(building).cost;
      if (faction.treasury - cost < reserve) continue;
      const score = buildingScore(state, province, building) + rng.float(0, 0.3);
      if (!best || score > best.score) best = { province, building, score };
    }
  }
  if (best) startConstruction(state, best.province.id, best.building);
}

function recruitWhereNeeded(
  state: CampaignState,
  id: FactionId,
  provinces: readonly RegionState[],
  reserve: number,
  rng: Rng,
): void {
  const faction = factionState(state, id);
  const targets = [...provinces]
    .filter((province) => !province.siege && province.recruitQueue.length < MAX_RECRUIT_QUEUE)
    .sort((a, b) => strengthOf(a.garrison) - strengthOf(b.garrison));

  for (const province of targets.slice(0, 3)) {
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
    const affordable = options.filter(
      (unit) => faction.treasury - recruitCost(id, unit) >= reserve,
    );
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
    startRecruitment(state, province.id, pick);
  }
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
    if (current.stance === 'trade' && relation(state, other, id).attitude > 50 && rng.chance(0.12)) {
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
  const armies = [...state.armies.values()].filter((army) => army.faction === id);
  for (const army of armies) {
    if (!state.armies.has(army.id)) continue;
    if (army.regiments.length === 0) continue;
    actWithArmy(state, army, rng);
  }
}

function actWithArmy(state: CampaignState, army: Army, rng: Rng): void {
  const own = strengthOf(army.regiments);
  if (own === 0) return;

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

  // 3. Otherwise garrison the most threatened province we can reach.
  const home = [...state.regions.values()]
    .filter((province) => province.owner === army.faction && isThreatened(state, province))
    .sort((a, b) => strengthOf(a.garrison) - strengthOf(b.garrison))[0];
  if (home && home.id !== army.location && landNeighbours(army.location).includes(home.id)) {
    attemptMove(state, army, home.id, rng);
  }
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
  if (ratio < 1.2 + penalty * 2) return 0;

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
