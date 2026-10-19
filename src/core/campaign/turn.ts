/**
 * The turn.
 *
 * Two turns make a year: a summer campaigning season and a winter in which
 * armies move badly, income falls and sieges start to bite. Everything that
 * happens between the player pressing end-turn and getting control back is in
 * this file, in a fixed order, so that a save taken at any point replays
 * identically.
 */
import type { FactionId } from '../types';
import { characterId, clamp, SETTLEMENT_ORDER, unitTypeId } from '../types';
import type { CampaignState, Character, RegionState } from './state';
import {
  CAMPAIGN_END_YEAR,
  characterName,
  commitRng,
  factionState,
  logEvent,
  fleetCapacity,
  provincesOf,
  rngFor,
  strengthOf,
} from './state';
import { factionFinances, growthRate, publicOrder, tierThreshold } from './economy';
import { commissionShip, fleetMovementBudget, isBlockaded } from './naval';
import { advanceCaravans } from './caravans';
import { ageAgents, refreshAgents } from './agents';
import { desertUnpaid, replenishMercenaries } from './mercenaries';
import { considerHolyWar, driftStanding, notePiety, progressHolyWar } from './faith';
import { getBuildingType } from '../data/buildings';
import { getUnitType } from '../data/units';
import { getRegion } from '../data/regions';
import { getFaction, tryGetFaction, INDEPENDENT_ID } from '../data/factions';
import { freeGarrisonCount, movementBudget, transferProvince } from './actions';
import { driftRelations } from './diplomacy';
import { dueThisYear, emerge, reapDeadFactions } from './emergence';
import { takeAiTurn } from './ai';
import type { Rng } from '../rng';

export interface TurnReport {
  readonly turn: number;
  readonly year: number;
  readonly season: string;
  readonly income: number;
  readonly treasury: number;
  readonly events: readonly string[];
}

/** Ends the player's turn, runs everything else, and returns to the player. */
export function endTurn(state: CampaignState): TurnReport {
  const rng = rngFor(state);
  const startLog = state.log.length;

  // 1. The AI acts while it is still the current turn.
  for (const [id, faction] of state.factions) {
    if (id === state.player || id === INDEPENDENT_ID || !faction.alive) continue;
    takeAiTurn(state, id, rng);
  }

  // 2. Resolve what the turn's events left standing.
  progressSieges(state, rng);

  // 3. Provinces: build, muster, grow, settle or revolt.
  for (const region of state.regions.values()) {
    progressConstruction(state, region);
    progressRecruitment(state, region);
    progressShipbuilding(state, region);
    progressPopulation(state, region);
    progressReligion(state, region);
    progressOrder(state, region, rng);
  }

  weatherFleets(state, rng);
  advanceCaravans(state, rng);
  ageAgents(state, rng);
  replenishMercenaries(state);
  progressHolyWar(state);
  considerHolyWar(state, rng);
  driftStanding(state);

  // 4. Money, after the provinces have been updated.
  settleFinances(state);

  // 5. Advance the clock.
  advanceClock(state);

  // 6. New factions, dead factions, and the slow drift of relations.
  for (const id of dueThisYear(state)) emerge(state, id, rng);
  reapDeadFactions(state);
  driftRelations(state, rng);
  ageCharacters(state, rng);

  // 7. Give every army and fleet its movement back.
  for (const army of state.armies.values()) {
    army.movement = movementBudget(state, army);
    army.embarked = false;
  }
  for (const fleet of state.fleets.values()) {
    fleet.movement = fleetMovementBudget(state, fleet);
  }
  refreshAgents(state);

  commitRng(state, rng);

  const finances = factionFinances(state, state.player);
  return {
    turn: state.turn,
    year: state.year,
    season: state.season,
    income: finances.net,
    treasury: factionState(state, state.player).treasury,
    events: state.log.slice(startLog).map((entry) => entry.text),
  };
}

// ---------------------------------------------------------------------------
// Province upkeep
// ---------------------------------------------------------------------------

function progressConstruction(state: CampaignState, region: RegionState): void {
  const work = region.construction;
  if (!work) return;
  if (region.siege) return; // nothing is built under siege
  work.turnsLeft -= 1;
  if (work.turnsLeft > 0) return;
  const type = getBuildingType(work.building);
  // A new level of a chain replaces the one below it.
  for (const id of [...region.buildings]) {
    const other = getBuildingType(id);
    if (other.chain === type.chain && other.level < type.level) region.buildings.delete(id);
  }
  region.buildings.add(work.building);
  region.construction = undefined;
  // The authority of a faith notices who builds for it.
  if (type.category === 'religion') notePiety(state, region.owner, 2 + type.level * 2);
  logEvent(
    state,
    region.owner,
    `${type.name} is completed at ${getRegion(region.id).settlement}.`,
  );
}

function progressRecruitment(state: CampaignState, region: RegionState): void {
  if (region.recruitQueue.length === 0) return;
  if (region.siege) return;
  const head = region.recruitQueue[0]!;
  head.turnsLeft -= 1;
  if (head.turnsLeft > 0) return;
  region.recruitQueue.shift();
  const type = getUnitType(head.unit);
  let experience = 0;
  for (const id of region.buildings) {
    experience = Math.max(experience, getBuildingType(id).effects.recruitExperience ?? 0);
  }
  region.garrison.push({ type: type.id, soldiers: type.soldiers, experience });
  logEvent(
    state,
    region.owner,
    `${type.name} muster at ${getRegion(region.id).settlement}.`,
  );
}

/**
 * Hulls on the slipway. A blockaded harbour cannot launch: the yard is within
 * bowshot of the enemy and the timber convoys do not arrive.
 */
function progressShipbuilding(state: CampaignState, region: RegionState): void {
  if (region.shipyardQueue.length === 0) return;
  if (region.siege || isBlockaded(state, region.id)) return;
  const head = region.shipyardQueue[0]!;
  head.turnsLeft -= 1;
  if (head.turnsLeft > 0) return;
  region.shipyardQueue.shift();
  commissionShip(state, region.id, head.unit);
}

/**
 * Attrition at sea. A fleet kept at sea through the winter loses hulls to
 * weather, which is why medieval fleets were laid up and why a blockade was so
 * hard to maintain.
 */
function weatherFleets(state: CampaignState, rng: Rng): void {
  if (state.season !== 'winter') return;
  for (const [id, fleet] of [...state.fleets]) {
    if (fleet.location.kind !== 'sea') continue;
    for (const ship of fleet.ships) {
      const seaworthy = getUnitType(ship.type).abilities.includes('seaworthy');
      const risk = seaworthy ? 0.03 : 0.09;
      if (!rng.chance(risk)) continue;
      ship.soldiers = Math.max(0, Math.round(ship.soldiers * rng.float(0.6, 0.9)));
    }
    const before = fleet.ships.length;
    fleet.ships = fleet.ships.filter((ship) => ship.soldiers > 0);
    if (fleet.ships.length < before) {
      logEvent(
        state,
        fleet.faction,
        `Winter gales scatter ${before - fleet.ships.length} ships of the ` +
          `${getFaction(fleet.faction).adjective} fleet.`,
      );
    }
    if (fleet.ships.length === 0) {
      state.fleets.delete(id);
    } else {
      const room = fleetCapacity(fleet);
      if (fleet.cargo.length > room) fleet.cargo = fleet.cargo.slice(0, Math.max(0, room));
    }
  }
}

function progressPopulation(state: CampaignState, region: RegionState): void {
  const rate = growthRate(state, region);
  region.population = Math.max(0.5, region.population * (1 + rate));

  const index = SETTLEMENT_ORDER.indexOf(region.tier);
  const threshold = tierThreshold(region.tier);
  if (region.population >= threshold && index < SETTLEMENT_ORDER.length - 1) {
    region.tier = SETTLEMENT_ORDER[index + 1]!;
    logEvent(
      state,
      region.owner,
      `${getRegion(region.id).settlement} grows into a ${region.tier.replace('_', ' ')}.`,
    );
  } else if (index > 0 && region.population < tierThreshold(SETTLEMENT_ORDER[index - 1]!) * 0.6) {
    // A province can also shrink, after a sack or a long siege.
    region.tier = SETTLEMENT_ORDER[index - 1]!;
  }
}

function progressReligion(state: CampaignState, region: RegionState): void {
  const faction = tryGetFaction(region.owner);
  if (!faction || region.religion === faction.religion) {
    region.conversion = 0;
    return;
  }
  let pressure = 0;
  for (const id of region.buildings) pressure += getBuildingType(id).effects.conversion ?? 0;
  pressure *= 1 + (faction.traits.conversion ?? 0);
  // People resist conversion more where they are numerous and discontented.
  pressure -= region.population / 40;
  pressure -= region.unrest / 60;
  region.conversion = clamp(region.conversion + pressure, 0, 100);
  if (region.conversion >= 100) {
    region.religion = faction.religion;
    region.conversion = 0;
    region.unrest = Math.min(100, region.unrest + 10);
    logEvent(
      state,
      region.owner,
      `${getRegion(region.id).settlement} comes over to the faith of its rulers.`,
    );
  }
}

function progressOrder(state: CampaignState, region: RegionState, rng: Rng): void {
  const order = publicOrder(state, region);
  // Unrest moves towards the level implied by the order score.
  const target = clamp(50 - order * 5, 0, 100);
  region.unrest += (target - region.unrest) * 0.3 + rng.float(-2, 2);
  region.unrest = clamp(region.unrest, 0, 100);

  if (region.unrest >= 95 && region.owner !== INDEPENDENT_ID) {
    revolt(state, region, rng);
  }
}

function revolt(state: CampaignState, region: RegionState, rng: Rng): void {
  const militia = getUnitType(unitTypeId('town_militia'));
  const levy = getUnitType(unitTypeId('peasant_levy'));
  const rebels = Math.max(2, Math.round(region.population / 3));
  const regiments = Array.from({ length: Math.min(8, rebels) }, () => {
    const type = rng.chance(0.4) ? militia : levy;
    return { type: type.id, soldiers: type.soldiers, experience: 0 };
  });
  const garrison = strengthOf(region.garrison);
  const rebelStrength = strengthOf(regiments);

  logEvent(
    state,
    region.owner,
    `${getRegion(region.id).settlement} rises in revolt.`,
  );

  if (rebelStrength > garrison * 1.3) {
    // The rising succeeds and the province goes independent.
    region.garrison = regiments;
    transferProvince(state, region.id, INDEPENDENT_ID);
    region.unrest = 40;
  } else {
    // It is put down, at a cost in men and population.
    const losses = Math.min(garrison * 0.3, rebelStrength);
    let remaining = losses;
    for (const regiment of region.garrison) {
      const taken = Math.min(regiment.soldiers, remaining);
      regiment.soldiers -= taken;
      remaining -= taken;
      if (remaining <= 0) break;
    }
    region.garrison = region.garrison.filter((regiment) => regiment.soldiers > 0);
    region.population = Math.max(1, region.population * 0.95);
    region.unrest = 55;
  }
}

// ---------------------------------------------------------------------------
// Sieges
// ---------------------------------------------------------------------------

function progressSieges(state: CampaignState, rng: Rng): void {
  for (const region of state.regions.values()) {
    const siege = region.siege;
    if (!siege) continue;
    // A siege only continues while a besieging army is actually present.
    const present = [...state.armies.values()].some(
      (army) => army.location === region.id && army.faction === siege.besieger,
    );
    if (!present) {
      region.siege = undefined;
      continue;
    }
    siege.turns += 1;

    // Starvation: the garrison weakens, and the population with it.
    const bite = 0.04 + siege.turns * 0.015;
    for (const regiment of region.garrison) {
      regiment.soldiers = Math.max(0, Math.round(regiment.soldiers * (1 - bite * 0.5)));
    }
    region.garrison = region.garrison.filter((regiment) => regiment.soldiers > 0);
    region.population = Math.max(1, region.population * (1 - bite * 0.3));
    region.unrest = clamp(region.unrest + 4, 0, 100);

    // Free garrison from the province's own buildings keeps turning out.
    const free = freeGarrisonCount(region);
    if (region.garrison.length < free && rng.chance(0.4)) {
      const militia = getUnitType(unitTypeId('town_militia'));
      region.garrison.push({ type: militia.id, soldiers: militia.soldiers, experience: 0 });
    }

    // Surrender: a starving garrison with no hope gives up.
    if (strengthOf(region.garrison) === 0) {
      transferProvince(state, region.id, siege.besieger);
      continue;
    }
    const besiegers = [...state.armies.values()]
      .filter((army) => army.location === region.id && army.faction === siege.besieger)
      .reduce((sum, army) => sum + strengthOf(army.regiments), 0);
    // A garrison yields when it is badly outnumbered and no relief has come.
    // The old test compared the garrison against the town's population, which
    // almost nothing satisfied, so sieges never ended in surrender at all.
    const hopeless = siege.turns > 3 && besiegers > strengthOf(region.garrison) * 2.5;
    if (hopeless && rng.chance(0.12 + siege.turns * 0.04)) {
      logEvent(
        state,
        region.owner,
        `${getRegion(region.id).settlement} surrenders after ${siege.turns} seasons of siege.`,
      );
      transferProvince(state, region.id, siege.besieger);
    }
  }
}

// ---------------------------------------------------------------------------
// Money and time
// ---------------------------------------------------------------------------

function settleFinances(state: CampaignState): void {
  for (const [id, faction] of state.factions) {
    if (!faction.alive || id === INDEPENDENT_ID) continue;
    const finances = factionFinances(state, id);
    faction.treasury += finances.net;
    if (faction.treasury >= 0) continue;
    // Bankruptcy disbands the most expensive regiments until the books balance.
    disbandForDebt(state, id);
  }
}

function disbandForDebt(state: CampaignState, id: FactionId): void {
  const faction = factionState(state, id);
  // The hired men go first, as they did: their contract is with the pay.
  if (faction.treasury < 0) {
    faction.treasury += desertUnpaid(state, id, -faction.treasury / 4);
  }
  if (faction.treasury >= 0) return;
  const candidates: { upkeep: number; disband: () => void }[] = [];
  for (const army of state.armies.values()) {
    if (army.faction !== id) continue;
    army.regiments.forEach((regiment, index) => {
      if (getUnitType(regiment.type).unitClass === 'general') return;
      candidates.push({
        upkeep: getUnitType(regiment.type).upkeep,
        disband: () => {
          army.regiments.splice(index, 1);
        },
      });
    });
  }
  for (const region of provincesOf(state, id)) {
    region.garrison.forEach((regiment, index) => {
      candidates.push({
        upkeep: getUnitType(regiment.type).upkeep,
        disband: () => {
          region.garrison.splice(index, 1);
        },
      });
    });
  }
  candidates.sort((a, b) => b.upkeep - a.upkeep);
  let disbanded = 0;
  while (faction.treasury < 0 && disbanded < candidates.length) {
    const victim = candidates[disbanded]!;
    victim.disband();
    faction.treasury += victim.upkeep * 4;
    disbanded += 1;
  }
  if (disbanded > 0) {
    logEvent(
      state,
      id,
      `${getFaction(id).name} cannot pay its soldiers: ${disbanded} regiments are disbanded.`,
    );
  }
  if (faction.treasury < 0) faction.treasury = 0;
  // Clean up anything emptied by the disbandment.
  for (const [armyId, army] of [...state.armies]) {
    if (army.faction === id && army.regiments.length === 0) state.armies.delete(armyId);
  }
}

function advanceClock(state: CampaignState): void {
  state.turn += 1;
  if (state.season === 'summer') {
    state.season = 'winter';
  } else {
    state.season = 'summer';
    state.year += 1;
  }
}

function ageCharacters(state: CampaignState, rng: Rng): void {
  if (state.season !== 'summer') return;
  for (const [id, faction] of state.factions) {
    if (!faction.alive || id === INDEPENDENT_ID) continue;
    for (const character of [...faction.characters]) {
      character.age += 1;
      // Death becomes likely past sixty, as it did.
      const risk = character.age < 45 ? 0.008 : 0.008 + (character.age - 45) * 0.011;
      if (!rng.chance(risk)) continue;
      faction.characters = faction.characters.filter((other) => other.id !== character.id);
      for (const region of state.regions.values()) {
        if (region.governor?.id === character.id) region.governor = undefined;
      }
      for (const army of state.armies.values()) {
        if (army.general?.id === character.id) army.general = undefined;
      }
      if (character.leader) {
        logEvent(state, id, `${character.name} of ${getFaction(id).name} dies.`);
        promoteHeir(state, id, rng);
      }
    }
    // A faction with no characters at all produces one: a state is not a person.
    if (faction.characters.length === 0) promoteHeir(state, id, rng);
  }
}

function promoteHeir(state: CampaignState, id: FactionId, rng: Rng): void {
  const faction = factionState(state, id);
  const heir = faction.characters.find((character) => !character.leader);
  if (heir) {
    heir.leader = true;
    logEvent(state, id, `${heir.name} succeeds to the throne of ${getFaction(id).name}.`);
    return;
  }
  state.nextCharacterSerial += 1;
  const fresh: Character = {
    id: characterId(`char-${state.nextCharacterSerial}`),
    faction: id,
    name: characterName(id, rng),
    command: rng.int(2, 7),
    governance: rng.int(2, 7),
    guile: rng.int(1, 7),
    age: rng.int(22, 40),
    leader: true,
  };
  faction.characters.push(fresh);
}

/** Has the campaign reached its end date? */
export function campaignOver(state: CampaignState): boolean {
  return state.year > CAMPAIGN_END_YEAR;
}

export type CampaignOutcome = 'supremacy' | 'ruin' | 'the clock';

/** How a realm stands at the end, and why the campaign ended at all. */
export interface Reckoning {
  readonly outcome: CampaignOutcome;
  readonly year: number;
  readonly faction: FactionId;
  readonly provinces: number;
  /** Provinces on the map, so the share can be shown as a fraction of it. */
  readonly totalProvinces: number;
  readonly share: number;
  readonly treasury: number;
  readonly soldiers: number;
  readonly hulls: number;
  /** Rank among the surviving powers, counting provinces. First is 1. */
  readonly rank: number;
  readonly powers: readonly { readonly faction: FactionId; readonly provinces: number }[];
}

/**
 * Judges a campaign.
 *
 * A realm wins by supremacy if it holds more than half the map, loses by ruin
 * if it holds nothing at all, and otherwise the campaign simply runs out of
 * years in 1530 and is judged on where it stood. Without this last case a
 * campaign had no end: the date existed in the rules and nothing ever consulted
 * it.
 */
export function reckon(state: CampaignState): Reckoning | undefined {
  const counts = new Map<FactionId, number>();
  for (const region of state.regions.values()) {
    if (region.owner === INDEPENDENT_ID) continue;
    counts.set(region.owner, (counts.get(region.owner) ?? 0) + 1);
  }
  const powers = [...counts.entries()]
    .map(([faction, provinces]) => ({ faction, provinces }))
    .sort((a, b) => b.provinces - a.provinces || (a.faction < b.faction ? -1 : 1));

  const player = state.player;
  const provinces = counts.get(player) ?? 0;
  const share = state.regions.size === 0 ? 0 : provinces / state.regions.size;
  const armies = [...state.armies.values()].filter((army) => army.faction === player);
  const landless = provinces === 0 && armies.length === 0;

  let outcome: CampaignOutcome | undefined;
  if (landless) outcome = 'ruin';
  else if (share > 0.5) outcome = 'supremacy';
  else if (campaignOver(state)) outcome = 'the clock';
  if (!outcome) return undefined;

  let soldiers = 0;
  for (const army of armies) soldiers += strengthOf(army.regiments);
  for (const region of state.regions.values()) {
    if (region.owner === player) soldiers += strengthOf(region.garrison);
  }
  let hulls = 0;
  for (const fleet of state.fleets.values()) {
    if (fleet.faction === player) hulls += fleet.ships.length;
  }

  return {
    outcome,
    year: state.year,
    faction: player,
    provinces,
    totalProvinces: state.regions.size,
    share,
    treasury: Math.round(state.factions.get(player)?.treasury ?? 0),
    soldiers: Math.round(soldiers),
    hulls,
    rank: powers.findIndex((entry) => entry.faction === player) + 1,
    powers,
  };
}

/** New characters come of age, so factions do not run out of commanders. */
export function addCharacter(state: CampaignState, id: FactionId, rng: Rng): void {
  const faction = factionState(state, id);
  if (faction.characters.length >= 8) return;
  state.nextCharacterSerial += 1;
  const character: Character = {
    id: characterId(`char-${state.nextCharacterSerial}`),
    faction: id,
    name: characterName(id, rng),
    command: rng.int(1, 7),
    governance: rng.int(1, 7),
    guile: rng.int(1, 7),
    age: rng.int(18, 26),
    leader: false,
  };
  faction.characters.push(character);
}
