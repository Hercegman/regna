/**
 * Campaign state and its construction.
 *
 * The state is a plain mutable object graph with no behaviour on it: every rule
 * lives in a function that takes the state. That keeps the simulation easy to
 * snapshot, diff and serialise, and it keeps the rules testable in isolation.
 */
import type {
  ArmyId,
  BuildingId,
  CharacterId,
  FactionId,
  Relation,
  RegionId,
  Religion,
  SettlementTier,
  UnitTypeId,
  WallTier,
} from '../types';
import { armyId, characterId } from '../types';
import { SETTLEMENT_ORDER } from '../types';
import type { RngState } from '../rng';
import { Rng } from '../rng';
import { FACTIONS, INDEPENDENT_ID, getFaction, tryGetFaction } from '../data/factions';
import type { Region } from '../data/regions';
import { REGIONS } from '../data/regions';
import { getBuildingType } from '../data/buildings';
import { generalUnitFor } from '../data/roster';
import { getUnitType } from '../data/units';

export const CAMPAIGN_START_YEAR = 1080;
export const CAMPAIGN_END_YEAR = 1530;
export const TURNS_PER_YEAR = 2;

export type Season = 'summer' | 'winter';

/** One regiment: a unit type plus its current strength and experience. */
export interface Regiment {
  readonly type: UnitTypeId;
  /** Surviving soldiers; a regiment is removed at zero. */
  soldiers: number;
  /** 0-9; raises attack and defence and steadies morale. */
  experience: number;
}

export interface Character {
  readonly id: CharacterId;
  readonly faction: FactionId;
  name: string;
  /** Battlefield command, 0-10. */
  command: number;
  /** Administration, 0-10: order and income in the province he governs. */
  governance: number;
  /** Negotiation, 0-10. */
  guile: number;
  /** Age in years; characters die of old age. */
  age: number;
  /** True for the faction leader. */
  leader: boolean;
}

export interface Army {
  readonly id: ArmyId;
  readonly faction: FactionId;
  /** The province the army stands in. Armies are always inside a province. */
  location: RegionId;
  regiments: Regiment[];
  /** The commander, if one is present. */
  general: Character | undefined;
  /** Movement points left this turn. */
  movement: number;
  /** True while the army is aboard ship and can cross sea borders. */
  embarked: boolean;
}

export interface Construction {
  readonly building: BuildingId;
  turnsLeft: number;
}

export interface Recruitment {
  readonly unit: UnitTypeId;
  turnsLeft: number;
}

export interface Siege {
  readonly besieger: FactionId;
  /** Turns the siege has lasted; starvation grows with it. */
  turns: number;
}

export interface RegionState {
  readonly id: RegionId;
  owner: FactionId;
  /** Thousands of people. */
  population: number;
  tier: SettlementTier;
  buildings: Set<BuildingId>;
  construction: Construction | undefined;
  recruitQueue: Recruitment[];
  /** Regiments stationed in the settlement. */
  garrison: Regiment[];
  /** 0 (content) to 100 (open revolt). */
  unrest: number;
  /** The faith of the population, which may differ from the owner's. */
  religion: Religion;
  /** Progress towards conversion, 0-100, resets on flip. */
  conversion: number;
  siege: Siege | undefined;
  /** Turn the current owner took the province, for occupation unrest. */
  ownedSince: number;
  /** Governor assigned to the province, if any. */
  governor: Character | undefined;
}

export interface FactionState {
  readonly id: FactionId;
  treasury: number;
  alive: boolean;
  /** Relations with other factions, keyed by their id. */
  relations: Map<FactionId, Relation>;
  /** The province that acts as the capital for distance-to-capital effects. */
  capital: RegionId | undefined;
  characters: Character[];
  /** Turn the faction entered play. */
  joinedOn: number;
  /** Set when the faction has lost every province. */
  destroyedOn: number | undefined;
}

export interface LogEntry {
  readonly turn: number;
  readonly year: number;
  /** Faction the entry concerns, for filtering the player's own news. */
  readonly faction: FactionId | undefined;
  readonly text: string;
}

export interface CampaignState {
  readonly seed: string;
  rngState: RngState;
  turn: number;
  year: number;
  season: Season;
  factions: Map<FactionId, FactionState>;
  regions: Map<RegionId, RegionState>;
  armies: Map<ArmyId, Army>;
  nextArmySerial: number;
  nextCharacterSerial: number;
  player: FactionId;
  log: LogEntry[];
}

/** The faith a faction imposes, used for conversion pressure. */
export function factionReligion(id: FactionId): Religion {
  const faction = tryGetFaction(id);
  return faction ? faction.religion : 'catholic';
}

/**
 * The religion of a province's population in 1080. Ownership is a reasonable
 * proxy except where it plainly is not: the Levant, Anatolia and Iberia were
 * religiously mixed, and conquest had not yet changed the countryside.
 */
const STARTING_RELIGION_OVERRIDES: Readonly<Record<string, Religion>> = {
  // Still overwhelmingly Christian populations under new Muslim rule
  nicaea: 'orthodox',
  konya: 'orthodox',
  ankyra: 'orthodox',
  kayseri: 'orthodox',
  sebasteia: 'orthodox',
  melitene: 'miaphysite',
  erzurum: 'miaphysite',
  ani: 'miaphysite',
  tbilisi: 'orthodox',
  edessa: 'miaphysite',
  antioch: 'orthodox',
  // Muslim populations under Christian rule or about to come under it
  toledo: 'sunni',
  valencia: 'sunni',
  granada: 'sunni',
  malaga: 'sunni',
  lisbon: 'sunni',
  badajoz: 'sunni',
  syracuse: 'sunni',
  palermo: 'sunni',
  messina: 'sunni',
  // Pagan lands
  vilnius: 'pagan',
  prussia: 'pagan',
  semigallia: 'pagan',
  reval: 'pagan',
  turku: 'pagan',
  oldenburg: 'pagan',
  brandenburg: 'pagan',
  stettin: 'pagan',
  gdansk: 'pagan',
  // Christian Nubia and Ethiopia
  dongola: 'miaphysite',
  soba: 'miaphysite',
  adefa: 'miaphysite',
  // Sahel before Islam reached the countryside
  niani: 'animist',
  koumbi: 'animist',
  timbuktu: 'sunni',
  gao: 'sunni',
  njimi: 'sunni',
  zeila: 'sunni',
  // Orthodox populations in the Latin-ruled south of Italy
  bari: 'orthodox',
  taranto: 'orthodox',
};

function startingReligion(region: Region): Religion {
  const override = STARTING_RELIGION_OVERRIDES[region.id as string];
  if (override) return override;
  return factionReligion(region.owner);
}

/** Starting treasury, scaled so that small states are not instantly bankrupt. */
function startingTreasury(provinces: number): number {
  return 1500 + provinces * 450;
}

const NAME_POOLS: Readonly<Record<string, readonly string[]>> = {
  latin_west: ['Guillaume', 'Robert', 'Henri', 'Baldwin', 'Roger', 'Geoffroy', 'Alain', 'Hugues'],
  nordic: ['Sven', 'Harald', 'Knut', 'Magnus', 'Eirik', 'Sigurd', 'Olav', 'Birger'],
  slavic_west: ['Boleslav', 'Mieszko', 'Vladislav', 'Zvonimir', 'Kresimir', 'Bela', 'Gyula', 'Stjepan'],
  slavic_east: ['Vsevolod', 'Mstislav', 'Yaropolk', 'Rostislav', 'Oleg', 'Izyaslav', 'Gleb', 'Boris'],
  balkan: ['Stefan', 'Vukan', 'Dragutin', 'Asen', 'Petar', 'Kaloyan', 'Nikola', 'Radoslav'],
  hellenic: ['Alexios', 'Nikephoros', 'Ioannes', 'Konstantinos', 'Theodoros', 'Isaakios', 'Georgios', 'Manuel'],
  levantine: ['Suleiman', 'Malik', 'Tutush', 'Ridwan', 'Yaghi', 'Qilij', 'Nasir', 'Zengi'],
  maghrebi: ['Yusuf', 'Tashfin', 'Abu Bakr', 'Ali', 'Umar', 'Mutamid', 'Idris', 'Yahya'],
  steppe: ['Bonyak', 'Tugorkan', 'Sharukan', 'Kotyan', 'Konchak', 'Batu', 'Nogai', 'Berke'],
  sahelian: ['Tunka', 'Sundiata', 'Dunama', 'Sakura', 'Mansa', 'Abubakari', 'Salmama', 'Umme'],
  celtic: ['Domnall', 'Muirchertach', 'Gruffydd', 'Malcolm', 'Donnchad', 'Owain', 'Diarmait', 'Aed'],
};

function nextCharacter(state: CampaignState, faction: FactionId, rng: Rng, leader: boolean): Character {
  const culture = tryGetFaction(faction)?.culture ?? 'latin_west';
  const pool = NAME_POOLS[culture] ?? NAME_POOLS.latin_west!;
  state.nextCharacterSerial += 1;
  return {
    id: characterId(`char-${state.nextCharacterSerial}`),
    faction,
    name: rng.pick(pool),
    command: rng.int(leader ? 3 : 1, leader ? 8 : 6),
    governance: rng.int(1, leader ? 8 : 6),
    guile: rng.int(1, leader ? 8 : 6),
    age: rng.int(leader ? 28 : 20, leader ? 50 : 38),
    leader,
  };
}

/** Allocates a fresh army id. */
export function newArmyId(state: CampaignState): ArmyId {
  state.nextArmySerial += 1;
  return armyId(`army-${state.nextArmySerial}`);
}

function startingBuildings(tier: SettlementTier): BuildingId[] {
  // Every settlement starts with what its size implies it must already have:
  // somewhere to muster, somewhere to trade, somewhere to pray, and walls
  // proportional to its importance.
  const index = SETTLEMENT_ORDER.indexOf(tier);
  const ids: string[] = ['muster_field', 'chapel', 'market', 'palisade', 'land_clearance'];
  if (index >= 1) ids.push('wooden_wall', 'governors_house', 'dirt_roads');
  if (index >= 2) ids.push('stone_wall', 'church', 'barracks', 'crop_rotation');
  if (index >= 3) ids.push('large_stone_wall', 'governors_villa', 'merchants_guild');
  if (index >= 4) ids.push('cathedral', 'drill_square');
  if (index >= 5) ids.push('epic_wall', 'governors_palace');
  return ids.map((id) => getBuildingType(id as BuildingId).id);
}

/** Builds the initial garrison for a province, scaled to its size. */
function startingGarrison(region: Region, rng: Rng): Regiment[] {
  const faction = tryGetFaction(region.owner);
  const size = SETTLEMENT_ORDER.indexOf(region.tier) + 1;
  const regiments: Regiment[] = [];
  if (!faction) {
    // Independent provinces are defended by their own townsmen.
    const militia = getUnitType('town_militia' as UnitTypeId);
    for (let i = 0; i < Math.max(1, size - 1); i++) {
      regiments.push({ type: militia.id, soldiers: militia.soldiers, experience: 0 });
    }
    const levy = getUnitType('peasant_levy' as UnitTypeId);
    regiments.push({ type: levy.id, soldiers: levy.soldiers, experience: 0 });
    return regiments;
  }
  // Owned provinces get a mix drawn from the faction's own early roster.
  const militia = getUnitType('town_militia' as UnitTypeId);
  const levy = getUnitType('peasant_levy' as UnitTypeId);
  for (let i = 0; i < size; i++) {
    const type = rng.chance(0.6) ? militia : levy;
    regiments.push({ type: type.id, soldiers: type.soldiers, experience: rng.int(0, 1) });
  }
  return regiments;
}

export interface CampaignOptions {
  readonly seed?: string;
  readonly player?: FactionId;
}

/** Creates the 1080 campaign. */
export function createCampaign(options: CampaignOptions = {}): CampaignState {
  const seed = options.seed ?? 'regna-1080';
  const rng = new Rng(seed);

  const state: CampaignState = {
    seed,
    rngState: rng.save(),
    turn: 1,
    year: CAMPAIGN_START_YEAR,
    season: 'summer',
    factions: new Map(),
    regions: new Map(),
    armies: new Map(),
    nextArmySerial: 0,
    nextCharacterSerial: 0,
    player: options.player ?? (getFaction('croatia' as FactionId).id),
    log: [],
  };

  // --- provinces
  for (const region of REGIONS) {
    state.regions.set(region.id, {
      id: region.id,
      owner: region.owner,
      population: region.population,
      tier: region.tier,
      buildings: new Set(startingBuildings(region.tier)),
      construction: undefined,
      recruitQueue: [],
      garrison: startingGarrison(region, rng),
      unrest: 0,
      religion: startingReligion(region),
      conversion: 0,
      siege: undefined,
      ownedSince: 0,
      governor: undefined,
    });
  }

  // --- factions present in 1080
  const provincesByFaction = new Map<FactionId, RegionId[]>();
  for (const region of REGIONS) {
    const list = provincesByFaction.get(region.owner) ?? [];
    list.push(region.id);
    provincesByFaction.set(region.owner, list);
  }

  for (const faction of FACTIONS) {
    const provinces = provincesByFaction.get(faction.id) ?? [];
    const present = faction.appearsIn <= CAMPAIGN_START_YEAR && provinces.length > 0;
    state.factions.set(faction.id, {
      id: faction.id,
      treasury: present ? startingTreasury(provinces.length) : 0,
      alive: present,
      relations: new Map(),
      capital: provinces[0],
      characters: [],
      joinedOn: present ? 0 : -1,
      destroyedOn: undefined,
    });
  }
  // The independents are a faction for ownership purposes but never act.
  state.factions.set(INDEPENDENT_ID, {
    id: INDEPENDENT_ID,
    treasury: 0,
    alive: true,
    relations: new Map(),
    capital: undefined,
    characters: [],
    joinedOn: 0,
    destroyedOn: undefined,
  });

  // --- leaders, governors and the initial field army of each living faction
  for (const [id, faction] of state.factions) {
    if (!faction.alive || id === INDEPENDENT_ID) continue;
    const leader = nextCharacter(state, id, rng, true);
    faction.characters.push(leader);

    const capital = faction.capital;
    if (capital) {
      const capitalState = state.regions.get(capital)!;
      capitalState.governor = leader;
      const general = generalUnitFor(getFaction(id));
      const army: Army = {
        id: newArmyId(state),
        faction: id,
        location: capital,
        regiments: [
          { type: general.id, soldiers: general.soldiers, experience: 2 },
          ...startingGarrison({ ...REGIONS.find((r) => r.id === capital)! }, rng),
        ],
        general: leader,
        movement: 0,
        embarked: false,
      };
      state.armies.set(army.id, army);
    }
  }

  state.rngState = rng.save();
  logEvent(state, undefined, `The year is ${CAMPAIGN_START_YEAR}.`);
  return state;
}

export function logEvent(
  state: CampaignState,
  faction: FactionId | undefined,
  text: string,
): void {
  state.log.push({
    turn: state.turn,
    year: state.year,
    ...(faction !== undefined ? { faction } : { faction: undefined }),
    text,
  });
  // The log is a UI convenience, not a historical record: cap it so a long
  // campaign cannot grow the save file without bound.
  if (state.log.length > 2000) state.log.splice(0, state.log.length - 2000);
}

/** Convenience accessors that throw rather than return undefined. */
export function regionState(state: CampaignState, id: RegionId): RegionState {
  const region = state.regions.get(id);
  if (!region) throw new Error(`No region state for ${id}`);
  return region;
}

export function factionState(state: CampaignState, id: FactionId): FactionState {
  const faction = state.factions.get(id);
  if (!faction) throw new Error(`No faction state for ${id}`);
  return faction;
}

export function provincesOf(state: CampaignState, id: FactionId): RegionState[] {
  const result: RegionState[] = [];
  for (const region of state.regions.values()) if (region.owner === id) result.push(region);
  return result;
}

export function armiesOf(state: CampaignState, id: FactionId): Army[] {
  const result: Army[] = [];
  for (const army of state.armies.values()) if (army.faction === id) result.push(army);
  return result;
}

/** Highest wall tier granted by the province's buildings. */
export function wallTier(region: RegionState): WallTier {
  let best: WallTier = 'none';
  let bestIndex = 0;
  for (const id of region.buildings) {
    const walls = getBuildingType(id).effects.walls;
    if (!walls) continue;
    const index = ['none', 'palisade', 'wooden', 'stone', 'large_stone', 'epic'].indexOf(walls);
    if (index > bestIndex) {
      bestIndex = index;
      best = walls;
    }
  }
  return best;
}

/** Total soldiers in a list of regiments. */
export function strengthOf(regiments: readonly Regiment[]): number {
  return regiments.reduce((sum, regiment) => sum + regiment.soldiers, 0);
}

export function rngFor(state: CampaignState): Rng {
  return Rng.fromState(state.rngState);
}

export function commitRng(state: CampaignState, rng: Rng): void {
  state.rngState = rng.save();
}
