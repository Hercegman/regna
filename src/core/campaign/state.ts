/**
 * Campaign state and its construction.
 *
 * The state is a plain mutable object graph with no behaviour on it: every rule
 * lives in a function that takes the state. That keeps the simulation easy to
 * snapshot, diff and serialise, and it keeps the rules testable in isolation.
 */
import type {
  AgentId,
  ArmyId,
  CaravanId,
  FleetId,
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
import { armyId, fleetId, caravanId, characterId } from '../types';
import type { AgentKind } from '../data/agents';
import { SETTLEMENT_ORDER } from '../types';
import type { RngState } from '../rng';
import { Rng } from '../rng';
import { FACTIONS, INDEPENDENT_ID, getFaction, tryGetFaction } from '../data/factions';
import type { Region } from '../data/regions';
import type { SeaZoneId } from '../data/seas';
import type { TradeRouteId } from '../data/trade';
import { getSeaZone, zonesOffPort } from '../data/seas';
import { REGIONS, getRegion } from '../data/regions';
import { getBuildingType } from '../data/buildings';
import { generalUnitFor, navalRosterFor } from '../data/roster';
import { getUnitType } from '../data/units';
import { MERCENARY_POOLS } from '../data/mercenaries';

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
  /**
   * A company serving for pay. The same troops can be raised at home by the
   * country that breeds them and hired abroad by anyone else, so this belongs
   * to the regiment rather than to the unit type. A hired company costs more
   * to keep and is the first to leave when the money runs short.
   */
  mercenary?: boolean;
}

export interface Character {
  readonly id: CharacterId;
  readonly faction: FactionId;
  name: string;
  readonly sex: 'm' | 'f';
  /**
   * The father, when he was born into a line this realm remembers. This is
   * what makes a succession an argument about descent rather than a lottery.
   */
  father: CharacterId | undefined;
  /** Whoever he or she is married to, in this court or another. */
  spouse: CharacterId | undefined;
  /**
   * The realm this person was born in, when it is not the one they now serve.
   * Only a bride who has moved to her husband's court has one, and it is the
   * whole of the bond a marriage creates between two houses.
   */
  bornIn: FactionId | undefined;
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

/**
 * Where a fleet is. A fleet is either at anchor in one of its own or a
 * friendly harbour, or at sea in a zone. Only a fleet at sea can blockade or
 * be intercepted; only a fleet at anchor can take on cargo or be repaired.
 */
export type FleetLocation =
  | { readonly kind: 'port'; readonly region: RegionId }
  | { readonly kind: 'sea'; readonly zone: SeaZoneId };

export interface Fleet {
  readonly id: FleetId;
  readonly faction: FactionId;
  location: FleetLocation;
  /** The hulls. A fleet with none of these is gone. */
  ships: Regiment[];
  /** Land regiments being carried. Bounded by the fleet's total capacity. */
  cargo: Regiment[];
  admiral: Character | undefined;
  /** Movement points left this turn, counted in sea zones. */
  movement: number;
}

/**
 * A caravan on the road.
 *
 * It belongs to the faction that paid to send it, carries a cargo worth more
 * than the outlay, pays a toll to every lord whose land it crosses, and is
 * fair game for any army at war with its owner. Trade in this period was a
 * calculated risk, not a passive income.
 */
export interface Caravan {
  readonly id: CaravanId;
  readonly faction: FactionId;
  readonly route: TradeRouteId;
  /** Index into the route's path. */
  position: number;
  /** +1 towards the far end of the route, -1 back towards the near one. */
  direction: 1 | -1;
  /** The index it is making for. */
  destination: number;
  /** Cargo value left after the tolls paid so far. */
  value: number;
  /** Turns it has stood still because the road ahead is shut. */
  stalled: number;
}

/**
 * A man in somebody else's country.
 *
 * He has one number that matters — his skill — and it rises only by succeeding
 * at something, so a veteran agent is a real asset and losing one hurts.
 */
export interface Agent {
  readonly id: AgentId;
  readonly faction: FactionId;
  readonly kind: AgentKind;
  name: string;
  /** 1 to 10. Tried against the guard on whatever province he is standing in. */
  skill: number;
  location: RegionId;
  /** Provinces he can still cross this turn; a mission spends the rest. */
  movement: number;
  age: number;
  /** Missions attempted, for the panel and for nothing else. */
  missions: number;
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
  /** Ships being built at the harbour, which join a fleet when finished. */
  shipyardQueue: Recruitment[];
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
  /**
   * How secure the ruler's title is, 0 to 100. A clean succession from father
   * to eldest son leaves it untouched; a brother, a cousin or an outright
   * stranger does not, and a realm that does not believe in its own king is
   * harder to hold.
   */
  legitimacy: number;
  /**
   * The given names of every ruler this realm has had, in order, so that the
   * third Stjepan is actually the third.
   */
  rulers: string[];
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
  fleets: Map<FleetId, Fleet>;
  caravans: Map<CaravanId, Caravan>;
  /**
   * Spies, envoys, priests and merchants. Kept on the state rather than on the
   * faction because where a man is standing matters to everyone, not only to
   * whoever pays him.
   */
  agents: Map<AgentId, Agent>;
  /**
   * How many companies are standing about in each mercenary pool. Keyed by
   * pool id, and part of the state because hiring one denies it to everybody
   * else until the country furnishes another.
   */
  mercenaries: Map<string, { available: number; countdown: number }>;
  /**
   * Standing with the authority of one's own faith, who is under censure, and
   * the holy war now being preached. Kept on the state because a crusade is a
   * fact about the world, not about any one ruler.
   */
  faith: {
    standing: Map<FactionId, number>;
    censured: Map<FactionId, number>;
    holyWar:
      | {
          faith: 'christian' | 'muslim';
          caller: FactionId;
          target: RegionId;
          calledOn: number;
          expires: number;
          participants: FactionId[];
        }
      | undefined;
    lastWarEnded: number;
  };
  nextArmySerial: number;
  nextFleetSerial: number;
  nextCaravanSerial: number;
  nextAgentSerial: number;
  nextCharacterSerial: number;
  player: FactionId;
  log: LogEntry[];
}

/**
 * Every pool starts with its full complement standing about.
 *
 * Defined here rather than imported from `mercenaries.ts` so that the state
 * module stays free of the rule modules that import it.
 */
function initialMercenaryPools(): Map<string, { available: number; countdown: number }> {
  const map = new Map<string, { available: number; countdown: number }>();
  for (const pool of MERCENARY_POOLS) {
    map.set(pool.id, { available: pool.capacity, countdown: pool.replenish });
  }
  return map;
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

/**
 * Women's names, by the same cultures.
 *
 * A dynasty needs both halves of itself. These are the names that actually
 * recur in the charters and chronicles of each region in this period, which
 * is also why several of them repeat across cultures: Europe's ruling houses
 * married each other constantly, and the names travelled with the brides.
 */
const WOMENS_NAMES: Readonly<Record<string, readonly string[]>> = {
  latin_west: ['Adela', 'Matilda', 'Constance', 'Eleanor', 'Agnes', 'Blanche', 'Sibylla', 'Jeanne'],
  nordic: ['Ingrid', 'Astrid', 'Gyda', 'Sigrid', 'Helena', 'Margareta', 'Thora', 'Ragnhild'],
  slavic_west: ['Jelena', 'Dobrava', 'Anastazija', 'Katarina', 'Judita', 'Zorica', 'Marica', 'Vladislava'],
  slavic_east: ['Yevpraksia', 'Predslava', 'Anna', 'Maria', 'Verkhuslava', 'Olena', 'Sbyslava', 'Rogneda'],
  balkan: ['Jelena', 'Simonida', 'Teodora', 'Ana', 'Milica', 'Danica', 'Jefimija', 'Katarina'],
  hellenic: ['Anna', 'Eirene', 'Theodora', 'Zoe', 'Maria', 'Eudokia', 'Helena', 'Euphrosyne'],
  levantine: ['Zubaida', 'Khadija', 'Safiya', 'Rabia', 'Fatima', 'Amina', 'Nur', 'Shajar'],
  maghrebi: ['Zaynab', 'Aisha', 'Fatima', 'Habiba', 'Maryam', 'Sawda', 'Tuda', 'Yasmin'],
  steppe: ['Borte', 'Terken', 'Altun', 'Sorghaghtani', 'Oghul', 'Chabi', 'Ilbilge', 'Gurbesu'],
  sahelian: ['Kassa', 'Sogolon', 'Nana', 'Aminata', 'Hawa', 'Fatoumata', 'Dalla', 'Kaya'],
  celtic: ['Gormlaith', 'Derbforgaill', 'Mor', 'Gwenllian', 'Bebinn', 'Sadb', 'Angharad', 'Lassar'],
};

/** A given name of the faction's culture, for a man or a woman. */
export function givenName(faction: FactionId, sex: 'm' | 'f', rng: Rng): string {
  const culture = tryGetFaction(faction)?.culture ?? 'latin_west';
  if (sex === 'f') {
    return rng.pick(WOMENS_NAMES[culture] ?? WOMENS_NAMES.latin_west!);
  }
  const pool =
    FACTION_NAME_POOLS[faction as string] ?? NAME_POOLS[culture] ?? NAME_POOLS.latin_west!;
  return rng.pick(pool);
}

/**
 * A given name drawn from the faction's own culture. Successors and newly
 * emerged rulers go through this too, so that a dynasty is never reduced to
 * being called after its own adjective.
 */
export function characterName(faction: FactionId, rng: Rng): string {
  return `${givenName(faction, 'm', rng)} I`;
}

const NUMERALS = [
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX',
];

/** "Stjepan III" back to "Stjepan". */
export function givenNameOf(character: Character | string): string {
  const name = typeof character === 'string' ? character : character.name;
  const parts = name.split(' ');
  const last = parts[parts.length - 1];
  return last && NUMERALS.includes(last) ? parts.slice(0, -1).join(' ') : name;
}

/**
 * Names a new ruler, with the regnal number his realm's own history gives him.
 *
 * The number used to be rolled, which produced a Henri IV succeeded by a
 * Henri II. Counting the line instead means the third Stjepan is the third
 * Stjepan, and a long-lived dynasty reads as one at a glance.
 */
export function nameRuler(faction: FactionState, given: string): string {
  const before = faction.rulers.filter((name) => name === given).length;
  const numeral = NUMERALS[Math.min(before, NUMERALS.length - 1)] ?? 'I';
  faction.rulers.push(given);
  return `${given} ${numeral}`;
}

/**
 * What to call an agent.
 *
 * Not a ruler, so no regnal number. A commoner in this period had one given
 * name and, when more was needed, the place he came from — which is exactly
 * what an agent's employer would have written in the accounts.
 */
export function agentName(
  faction: FactionId,
  home: RegionId,
  rng: Rng,
  taken: Iterable<string> = [],
): string {
  const culture = tryGetFaction(faction)?.culture ?? 'latin_west';
  const pool =
    FACTION_NAME_POOLS[faction as string] ?? NAME_POOLS[culture] ?? NAME_POOLS.latin_west!;
  const already = new Set(taken);
  const place = getRegion(home).settlement;
  // Two men of one name in one service is confusing in a way the real
  // accounts also had to solve. Try the pool at random, then walk it in order,
  // and only then fall back to telling them apart by number — which is what
  // the clerks ended up doing too.
  for (let attempt = 0; attempt < 8; attempt++) {
    const name = `${rng.pick(pool)} of ${place}`;
    if (!already.has(name)) return name;
  }
  for (const given of pool) {
    const name = `${given} of ${place}`;
    if (!already.has(name)) return name;
  }
  const base = `${rng.pick(pool)} of ${place}`;
  const suffixes = ['the Younger', 'the Elder', 'the Third', 'the Fourth', 'the Fifth'];
  for (const suffix of suffixes) {
    const name = `${base} ${suffix}`;
    if (!already.has(name)) return name;
  }
  for (let n = 6; ; n++) {
    const name = `${base} (${n})`;
    if (!already.has(name)) return name;
  }
}

/**
 * Dynastic names for the factions where a culture-wide pool is too coarse.
 *
 * The west-Slavic pool serves Poland, Bohemia, Croatia and Hungary at once,
 * which produced Croatian kings called Mieszko. Where a realm has a
 * recognisable line of its own, it gets one.
 */
const FACTION_NAME_POOLS: Readonly<Record<string, readonly string[]>> = {
  croatia: ['Kresimir', 'Zvonimir', 'Stjepan', 'Tomislav', 'Dmitar', 'Petar', 'Branimir', 'Mislav'],
  hungary: ['Bela', 'Laszlo', 'Geza', 'Kalman', 'Andras', 'Imre', 'Istvan', 'Lajos'],
  poland: ['Boleslaw', 'Mieszko', 'Wladyslaw', 'Kazimierz', 'Leszek', 'Przemysl', 'Henryk'],
  bohemia: ['Vratislav', 'Sobeslav', 'Vladislav', 'Premysl', 'Ottokar', 'Jaromir', 'Vaclav'],
  serbia: ['Stefan', 'Vukan', 'Uros', 'Dragutin', 'Milutin', 'Dusan', 'Lazar'],
  bosnia: ['Kulin', 'Stjepan', 'Tvrtko', 'Ninoslav', 'Dabisa', 'Ostoja'],
  bulgaria: ['Asen', 'Kaloyan', 'Petar', 'Boril', 'Konstantin', 'Ivan', 'Mihail'],
  ragusa: ['Marin', 'Nikola', 'Junije', 'Vlaho', 'Damjan', 'Lovro'],
  england: ['William', 'Henry', 'Richard', 'Edward', 'Stephen', 'John', 'Harold'],
  france: ['Philippe', 'Louis', 'Charles', 'Robert', 'Henri', 'Jean'],
  scotland: ['Malcolm', 'Alexander', 'David', 'Donnchad', 'Uilleam', 'Robert'],
  ireland: ['Domnall', 'Muirchertach', 'Diarmait', 'Toirdelbach', 'Ruaidri', 'Brian'],
  wales: ['Gruffydd', 'Owain', 'Llywelyn', 'Dafydd', 'Rhys', 'Madog'],
  milan: ['Azzone', 'Luchino', 'Galeazzo', 'Matteo', 'Bernabo'],
  papal_states: ['Gregorius', 'Urbanus', 'Innocentius', 'Alexander', 'Clemens', 'Honorius'],
  lithuania: ['Mindaugas', 'Gediminas', 'Algirdas', 'Kestutis', 'Vytautas'],
  teutonic_order: ['Hermann', 'Konrad', 'Siegfried', 'Winrich', 'Ulrich'],
  wallachia: ['Basarab', 'Mircea', 'Vlad', 'Radu', 'Dan'],
  albania: ['Gjergj', 'Lek', 'Gjon', 'Pal', 'Arianit'],
  denmark: ['Knut', 'Valdemar', 'Erik', 'Svend', 'Niels', 'Harald'],
  norway: ['Harald', 'Olav', 'Magnus', 'Sigurd', 'Haakon', 'Eystein'],
  sweden: ['Birger', 'Erik', 'Knut', 'Sverker', 'Magnus', 'Valdemar'],
  byzantium: ['Alexios', 'Ioannes', 'Manuel', 'Andronikos', 'Isaakios', 'Konstantinos'],
  kievan_rus: ['Vsevolod', 'Mstislav', 'Yaropolk', 'Izyaslav', 'Rostislav', 'Sviatopolk'],
  muscovy: ['Ivan', 'Dmitri', 'Vasili', 'Yuri', 'Simeon', 'Daniil'],
  novgorod: ['Mstislav', 'Yaroslav', 'Vsevolod', 'Aleksandr', 'Gavril'],
  venice: ['Vitale', 'Domenico', 'Pietro', 'Ordelafo', 'Enrico', 'Sebastiano'],
  genoa: ['Guglielmo', 'Simone', 'Oberto', 'Nicolo', 'Lanfranco'],
  castile: ['Alfonso', 'Sancho', 'Fernando', 'Enrique', 'Pedro'],
  aragon: ['Ramiro', 'Pedro', 'Jaime', 'Alfonso', 'Martin'],
  portugal: ['Afonso', 'Sancho', 'Dinis', 'Duarte', 'Joao'],
  hre: ['Heinrich', 'Konrad', 'Friedrich', 'Otto', 'Rudolf', 'Albrecht'],
  seljuks: ['Malik', 'Alp', 'Tutush', 'Berkyaruq', 'Sanjar', 'Mahmud'],
  ottomans: ['Osman', 'Orhan', 'Murad', 'Bayezid', 'Mehmed', 'Selim'],
  fatimids: ['Mustansir', 'Mustali', 'Amir', 'Hafiz', 'Zafir'],
  almoravids: ['Yusuf', 'Ali', 'Tashfin', 'Ibrahim', 'Ishaq'],
  mali: ['Sundiata', 'Mansa Uli', 'Sakura', 'Musa', 'Maghan', 'Suleyman'],
  georgia: ['David', 'Giorgi', 'Bagrat', 'Demetre', 'Tamar'],
  armenia: ['Levon', 'Toros', 'Ruben', 'Hetum', 'Konstantin'],
};

function nextCharacter(state: CampaignState, faction: FactionId, rng: Rng, leader: boolean): Character {
  // A ruler in 1080 is a man; the women of the house appear as daughters and
  // as brides, which is where they mattered to a realm's politics.
  const sex: 'm' | 'f' = leader ? 'm' : rng.chance(0.45) ? 'f' : 'm';
  return newCharacter(state, faction, {
    sex,
    leader,
    name: leader ? characterName(faction, rng) : givenName(faction, sex, rng),
    command: rng.int(leader ? 3 : 1, leader ? 8 : 6),
    governance: rng.int(1, leader ? 8 : 6),
    guile: rng.int(1, leader ? 8 : 6),
    age: rng.int(leader ? 28 : 20, leader ? 50 : 38),
  });
}

/** Everything a character needs, with the bookkeeping filled in. */
export function newCharacter(
  state: CampaignState,
  faction: FactionId,
  fields: {
    sex: 'm' | 'f';
    name: string;
    command: number;
    governance: number;
    guile: number;
    age: number;
    leader?: boolean;
    father?: CharacterId | undefined;
  },
): Character {
  state.nextCharacterSerial += 1;
  return {
    id: characterId(`char-${state.nextCharacterSerial}`),
    faction,
    name: fields.name,
    sex: fields.sex,
    father: fields.father,
    spouse: undefined,
    bornIn: undefined,
    command: fields.command,
    governance: fields.governance,
    guile: fields.guile,
    age: fields.age,
    leader: fields.leader ?? false,
  };
}

/** Allocates a fresh army id. */
export function newArmyId(state: CampaignState): ArmyId {
  state.nextArmySerial += 1;
  return armyId(`army-${state.nextArmySerial}`);
}

/** Allocates a fresh fleet id. */
export function newFleetId(state: CampaignState): FleetId {
  state.nextFleetSerial += 1;
  return fleetId(`fleet-${state.nextFleetSerial}`);
}

/** Allocates a fresh caravan id. */
export function newCaravanId(state: CampaignState): CaravanId {
  state.nextCaravanSerial += 1;
  return caravanId(`caravan-${state.nextCaravanSerial}`);
}

function startingBuildings(tier: SettlementTier, port: boolean): BuildingId[] {
  // Every settlement starts with what its size implies it must already have:
  // somewhere to muster, somewhere to trade, somewhere to pray, and walls
  // proportional to its importance. A place the map calls a harbour already
  // has a quay: without one no hull could be laid down anywhere in 1080.
  const index = SETTLEMENT_ORDER.indexOf(tier);
  const ids: string[] = ['muster_field', 'chapel', 'market', 'palisade', 'land_clearance'];
  if (port) ids.push('harbour');
  if (port && index >= 3) ids.push('shipyard');
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
    fleets: new Map(),
    caravans: new Map(),
    agents: new Map(),
    mercenaries: initialMercenaryPools(),
    faith: { standing: new Map(), censured: new Map(), holyWar: undefined, lastWarEnded: -99 },
    nextArmySerial: 0,
    nextFleetSerial: 0,
    nextCaravanSerial: 0,
    nextAgentSerial: 0,
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
      buildings: new Set(startingBuildings(region.tier, region.port)),
      construction: undefined,
      recruitQueue: [],
      shipyardQueue: [],
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
    // The historical seat where the map records one, otherwise the largest
    // province the faction holds.
    const seat =
      REGIONS.find((region) => region.owner === faction.id && region.capital)?.id ??
      [...provinces]
        .map((id) => REGIONS.find((region) => region.id === id)!)
        .sort(
          (a, b) =>
            SETTLEMENT_ORDER.indexOf(b.tier) - SETTLEMENT_ORDER.indexOf(a.tier) ||
            b.population - a.population,
        )[0]?.id;
    state.factions.set(faction.id, {
      id: faction.id,
      treasury: present ? startingTreasury(provinces.length) : 0,
      alive: present,
      relations: new Map(),
      capital: seat,
      characters: [],
      legitimacy: 100,
      rulers: [],
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
    legitimacy: 100,
    rulers: [],
    joinedOn: 0,
    destroyedOn: undefined,
  });

  // --- leaders, governors and the initial field army of each living faction
  for (const [id, faction] of state.factions) {
    if (!faction.alive || id === INDEPENDENT_ID) continue;
    const leader = nextCharacter(state, id, rng, true);
    leader.name = nameRuler(faction, givenNameOf(leader));
    faction.characters.push(leader);

    const capital = faction.capital;
    if (capital) {
      // The ruler rides with his own army, which is where a ruler was in 1080.
      // He cannot also be sitting in the capital governing it: the capital
      // waits for an officer, and the court posts one as soon as it has a man
      // to spare.
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

  // --- a squadron for every power with a coast
  for (const [id, faction] of state.factions) {
    if (!faction.alive || id === INDEPENDENT_ID) continue;
    const definition = tryGetFaction(id);
    if (!definition) continue;
    const harbours = REGIONS.filter((region) => region.owner === id && region.port);
    if (harbours.length === 0) continue;
    // A fleet is based where the state can pay for and protect it: the capital
    // if it has a harbour, otherwise its largest port. Taking whichever port
    // came first in the table put the Byzantine navy at Cherson in the Crimea
    // rather than at Constantinople.
    harbours.sort((a, b) => {
      const capitalFirst = Number(b.id === faction.capital) - Number(a.id === faction.capital);
      return capitalFirst !== 0 ? capitalFirst : b.population - a.population;
    });

    const home = harbours[0]!;
    const waters = zonesOffPort(home.id);
    const onRiver = waters.some((zone) => getSeaZone(zone).river);
    const onSea = waters.some((zone) => !getSeaZone(zone).river);
    const hulls = navalRosterFor(definition, CAMPAIGN_START_YEAR)
      // Only what a harbour alone can produce: nobody starts with an arsenal.
      .filter((ship) => !ship.requires || ship.requires === ('harbour' as BuildingId))
      // And only hulls suited to the water the harbour actually opens onto.
      .filter((ship) => {
        const needs = ship.waters ?? 'any';
        if (needs === 'river') return onRiver;
        if (needs === 'sea') return onSea;
        return true;
      });
    if (hulls.length === 0) continue;

    const maritime = definition.rosterTags.includes('maritime');
    const count = maritime ? 3 : 1;
    const ships: Regiment[] = [];
    for (let i = 0; i < count; i++) {
      const type = rng.pick(hulls);
      ships.push({ type: type.id, soldiers: type.soldiers, experience: maritime ? 1 : 0 });
    }
    const fleet: Fleet = {
      id: newFleetId(state),
      faction: id,
      location: { kind: 'port', region: home.id },
      ships,
      cargo: [],
      admiral: undefined,
      movement: 0,
    };
    state.fleets.set(fleet.id, fleet);
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

export function fleetsOf(state: CampaignState, id: FactionId): Fleet[] {
  const result: Fleet[] = [];
  for (const fleet of state.fleets.values()) if (fleet.faction === id) result.push(fleet);
  return result;
}

export function caravansOf(state: CampaignState, id: FactionId): Caravan[] {
  const result: Caravan[] = [];
  for (const caravan of state.caravans.values()) {
    if (caravan.faction === id) result.push(caravan);
  }
  return result;
}

/** Land regiments the fleet's hulls can carry between them. */
export function fleetCapacity(fleet: Fleet): number {
  let total = 0;
  for (const ship of fleet.ships) {
    const type = getUnitType(ship.type);
    // A half-wrecked hull carries proportionally less.
    const share = ship.soldiers / Math.max(1, type.soldiers);
    total += (type.capacity ?? 0) * share;
  }
  return Math.floor(total);
}

/** The zone a fleet is in, counting a fleet at anchor as being in its harbour's water. */
export function fleetZones(fleet: Fleet): readonly SeaZoneId[] {
  return fleet.location.kind === 'sea' ? [fleet.location.zone] : zonesOffPort(fleet.location.region);
}

/** Every fleet of the given faction that is at sea in the given zone. */
export function fleetsInZone(
  state: CampaignState,
  zone: SeaZoneId,
  faction?: FactionId,
): Fleet[] {
  const result: Fleet[] = [];
  for (const fleet of state.fleets.values()) {
    if (fleet.location.kind !== 'sea' || fleet.location.zone !== zone) continue;
    if (faction !== undefined && fleet.faction !== faction) continue;
    result.push(fleet);
  }
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

/**
 * Are these two factions at war?
 *
 * The independents are at war with everyone by default: unclaimed towns defend
 * themselves and nobody negotiates with them.
 */
export function isAtWar(state: CampaignState, a: FactionId, b: FactionId): boolean {
  if (a === b) return false;
  if (a === INDEPENDENT_ID || b === INDEPENDENT_ID) return true;
  const faction = state.factions.get(a);
  return faction?.relations.get(b)?.stance === 'war';
}

/**
 * Does the province have a working harbour?
 *
 * Geography decides whether there is anywhere to put a ship; buildings decide
 * how good it is. A natural anchorage trades before a quay is built, just less.
 */
export function hasPort(region: RegionState): boolean {
  const geography = REGIONS.find((candidate) => candidate.id === region.id);
  if (!geography?.port) return false;
  return true;
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
