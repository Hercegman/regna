/**
 * Mercenary companies and where they are hired.
 *
 * A mercenary is not recruited, it is found. A company exists in a particular
 * country because that country bred it: pikemen in the Alpine valleys,
 * crossbowmen in Liguria, gallowglass in the Hebrides, horse archers on the
 * steppe. A state with money and no manpower goes there and buys what is
 * standing about, which is the whole point of the institution.
 *
 * Hiring therefore ignores the hiring state's own roster entirely. What it
 * does not ignore is the purse: a company costs several times what a levy
 * costs to keep, and it is the first thing to walk away when the money stops.
 */
import type { RegionId, UnitType } from '../types';
import { regionId } from '../types';
import { defineUnit } from './unitSpec';

const m = defineUnit;

/**
 * Companies that exist only for hire. Several troops already in the roster are
 * also offered by pools below; these are the ones nobody raises at home.
 */
export const MERCENARY_UNITS: readonly UnitType[] = [
  m({
    id: 'brabancons', name: 'Brabancon Routiers', unitClass: 'heavy_infantry', tier: 3,
    attack: 11, defence: 7, armour: 4, shield: 2, morale: 12, discipline: 9,
    abilities: ['hardy'], cost: 620, upkeep: 130, mercenary: true, pools: [],
    fromYear: 1150, untilYear: 1360,
    description:
      'Discharged soldiers out of Brabant and Flanders who stayed together when the war ' +
      'ended. Between contracts they live off the country, and three popes in a row ' +
      'anathematised them without the slightest effect.',
  }),
  m({
    id: 'turcopoles', name: 'Turcopoles', unitClass: 'horse_archers', tier: 3,
    attack: 7, charge: 6, defence: 6, armour: 3, shield: 2, morale: 11, discipline: 12,
    speed: 5.4, range: 150, missileAttack: 11, ammunition: 26,
    abilities: ['skirmish', 'feigned_retreat', 'desert_hardy'],
    cost: 660, upkeep: 140, mercenary: true, pools: [], fromYear: 1100,
    description:
      'Light horse of mixed Frankish and Syrian descent, raised in Outremer and shooting ' +
      'in the Turkish manner. Every crusader army that lasted learned to hire them.',
  }),
  m({
    id: 'landsknechts', name: 'Landsknechts', unitClass: 'pikemen', tier: 5,
    soldiers: 150, attack: 11, defence: 10, armour: 4, morale: 15, discipline: 15,
    speed: 1.4, abilities: ['anti_cavalry', 'schiltron', 'highly_trained'],
    cost: 1080, upkeep: 230, mercenary: true, pools: [], fromYear: 1480,
    description:
      'German pikemen raised in deliberate imitation of the Swiss, and hated by them for it. ' +
      'They fight for the Emperor, for France, for anyone, and occasionally against each other.',
  }),
  m({
    id: 'free_company', name: 'Free Company', unitClass: 'heavy_infantry', tier: 4,
    attack: 12, defence: 9, armour: 6, shield: 3, morale: 13, discipline: 12,
    cost: 820, upkeep: 180, mercenary: true, pools: [], fromYear: 1360, untilYear: 1460,
    description:
      'A company of veterans left unemployed by a truce, with its own captain, its own banner ' +
      'and no country. It will take a contract, and if none is offered it will take a city.',
  }),
  m({
    id: 'varangian_mercenaries', name: 'Varangian Mercenaries', unitClass: 'heavy_infantry', tier: 4,
    attack: 13, defence: 8, armour: 5, shield: 3, morale: 15, discipline: 12,
    abilities: ['armour_piercing'], cost: 780, upkeep: 165, mercenary: true, pools: [],
    untilYear: 1300,
    description:
      'Northmen who went south for gold and never entirely went home. They serve whoever pays ' +
      'in silver, and they are worth it right up to the moment the silver stops.',
  }),
  m({
    id: 'cuman_mercenaries', name: 'Cuman Horse Archers', unitClass: 'horse_archers', tier: 3,
    attack: 6, charge: 5, defence: 5, armour: 2, shield: 1, morale: 11, discipline: 9,
    speed: 5.8, range: 160, missileAttack: 12, ammunition: 30,
    abilities: ['skirmish', 'feigned_retreat', 'hardy'],
    cost: 640, upkeep: 135, mercenary: true, pools: [], untilYear: 1300,
    description:
      'A clan of the steppe, hired entire with its horses and its families. Byzantium, Hungary ' +
      'and Bulgaria all bought Cuman service, and all of them regretted the price at least once.',
  }),
  m({
    id: 'black_army_hussars', name: 'Black Army Hussars', unitClass: 'light_cavalry', tier: 4,
    attack: 11, charge: 12, defence: 8, armour: 4, shield: 3, morale: 14, discipline: 15,
    speed: 5.5, abilities: ['charge_bonus', 'highly_trained'],
    cost: 900, upkeep: 195, mercenary: true, pools: [], fromYear: 1458, untilYear: 1495,
    description:
      'Matthias Corvinus paid a standing army in cash rather than land, and for thirty years it ' +
      'was the best in Europe. When the money stopped it dispersed in a single season.',
  }),
  m({
    id: 'sudanese_guard', name: 'Sudanese Spearmen', unitClass: 'spearmen', tier: 3,
    attack: 8, defence: 8, armour: 3, shield: 4, morale: 13, discipline: 13,
    abilities: ['shield_wall', 'anti_cavalry', 'desert_hardy'],
    cost: 600, upkeep: 125, mercenary: true, pools: [],
    description:
      'Infantry from beyond the desert, sold or hired north in companies and kept as a household ' +
      'guard by every Egyptian and Maghrebi dynasty in turn.',
  }),
];

/** A place where a particular kind of company can be found. */
export interface MercenaryPool {
  readonly id: string;
  readonly name: string;
  /** The unit hired from this pool. */
  readonly unit: string;
  /** Provinces in which the company can be taken on. */
  readonly regions: readonly RegionId[];
  /** How many companies can be standing at once. */
  readonly capacity: number;
  /** Turns between one company becoming available and the next. */
  readonly replenish: number;
  /** What hiring costs, as a multiple of the unit's own price. */
  readonly premium: number;
  readonly fromYear?: number;
  readonly untilYear?: number;
  readonly description: string;
}

const p = (
  pool: Omit<MercenaryPool, 'regions'> & { regions: readonly string[] },
): MercenaryPool => ({ ...pool, regions: pool.regions.map(regionId) });

export const MERCENARY_POOLS: readonly MercenaryPool[] = [
  p({
    id: 'swiss', name: 'Swiss Pikemen', unit: 'swiss_pikemen', capacity: 3, replenish: 4,
    premium: 1.3, fromYear: 1300,
    regions: ['schwyz', 'zurich', 'besancon', 'brixen', 'augsburg', 'milan', 'dijon'],
    description:
      'The cantons sell their young men by contract, and the contract is kept to the letter. ' +
      'They will not fight for an employer who has broken terms with another canton.',
  }),
  p({
    id: 'genoese', name: 'Genoese Crossbowmen', unit: 'genoese_crossbowmen', capacity: 3,
    replenish: 3, premium: 1.25, fromYear: 1150,
    regions: ['genoa', 'pisa', 'marseille', 'barcelona', 'naples', 'ajaccio'],
    description:
      'The guild hires out whole companies with their own pavises and their own standards. ' +
      'France, Hungary and Byzantium all employed them, sometimes against each other.',
  }),
  p({
    id: 'brabancon', name: 'Brabancon Routiers', unit: 'brabancons', capacity: 3, replenish: 3,
    premium: 1.1, fromYear: 1150, untilYear: 1360,
    regions: ['bruges', 'utrecht', 'cologne', 'reims', 'rouen', 'paris'],
    description:
      'Companies of discharged soldiers who have nowhere to go. Cheap, willing, and a plague ' +
      'on the country that hires them as much as on the one they are hired against.',
  }),
  p({
    id: 'catalan', name: 'Almughavars', unit: 'almughavars', capacity: 2, replenish: 5,
    premium: 1.2, fromYear: 1180,
    regions: ['barcelona', 'valencia', 'jaca', 'palma', 'naples', 'athens', 'corinth'],
    description:
      'Frontier irregulars of the Pyrenees who took service in Sicily, then in Byzantium, then ' +
      'carved out a duchy of their own in Greece when the pay ran late.',
  }),
  p({
    id: 'gallowglass', name: 'Gallowglass', unit: 'galloglaich', capacity: 2, replenish: 5,
    premium: 1.15, fromYear: 1250,
    regions: ['armagh', 'galway', 'dublin', 'inverness', 'stirling'],
    description:
      'Hebridean axemen hired by the season and quartered on the countryside. An Irish king ' +
      'without gallowglass is not taken seriously by the other Irish kings.',
  }),
  p({
    id: 'turcopole', name: 'Turcopoles', unit: 'turcopoles', capacity: 3, replenish: 3,
    premium: 1.1, fromYear: 1100,
    regions: ['acre', 'jerusalem', 'antioch', 'tripoli_syria', 'nicosia', 'tarsus', 'ascalon'],
    description:
      'Local light horse, indispensable to any Frankish army that means to campaign in the ' +
      'Levant rather than merely to arrive there.',
  }),
  p({
    id: 'cuman', name: 'Cuman Clans', unit: 'cuman_mercenaries', capacity: 3, replenish: 3,
    premium: 1.0, untilYear: 1300,
    regions: ['podolia', 'donets', 'azov', 'targoviste', 'suceava', 'szeged', 'tarnovo', 'kiev'],
    description:
      'A whole clan takes service together, with its herds and its women, and leaves the same ' +
      'way. They are the cheapest horse archers in the world and the least reliable.',
  }),
  p({
    id: 'varangian', name: 'Varangian Companies', unit: 'varangian_mercenaries', capacity: 2,
    replenish: 5, premium: 1.2, untilYear: 1300,
    regions: ['novgorod', 'kiev', 'sigtuna', 'roskilde', 'oslo', 'constantinople'],
    description:
      'Northmen on the river road south, available at any stage of it to anyone with silver.',
  }),
  p({
    id: 'condotta', name: 'Condottieri', unit: 'condottieri', capacity: 3, replenish: 4,
    premium: 1.35, fromYear: 1300,
    regions: ['milan', 'florence', 'siena', 'venice', 'bologna', 'rome', 'naples', 'genoa'],
    description:
      'Captains who treat war as a trade and a contract as a contract. They will not ruin an ' +
      'employer who may hire them next year, which is both their virtue and their limit.',
  }),
  p({
    id: 'free_companies', name: 'Free Companies', unit: 'free_company', capacity: 3, replenish: 3,
    premium: 1.1, fromYear: 1360, untilYear: 1460,
    regions: ['bordeaux', 'toulouse', 'lyon', 'dijon', 'clermont', 'poitiers', 'marseille', 'milan'],
    description:
      'The wreckage of a generation of war in France, organised and looking for work. Hiring ' +
      'them is often cheaper than being plundered by them.',
  }),
  p({
    id: 'landsknecht', name: 'Landsknechts', unit: 'landsknechts', capacity: 3, replenish: 3,
    premium: 1.2, fromYear: 1480,
    regions: ['augsburg', 'nuremberg', 'strasbourg', 'vienna', 'regensburg', 'magdeburg'],
    description:
      'Raised by imperial licence and drilled in the Swiss manner, with better clothes and worse ' +
      'discipline. There is always a colonel in Augsburg looking for a contract.',
  }),
  p({
    id: 'black_army', name: 'Black Army', unit: 'black_army_hussars', capacity: 2, replenish: 6,
    premium: 1.3, fromYear: 1458, untilYear: 1495,
    regions: ['esztergom', 'bihar', 'cluj', 'szeged', 'pozsony'],
    description:
      'Veterans of Corvinus paid in cash, the first standing army in Europe since Rome. ' +
      'Expensive, superb, and lost the moment the treasury falters.',
  }),
  p({
    id: 'sudanese', name: 'Sudanese Companies', unit: 'sudanese_guard', capacity: 3, replenish: 4,
    premium: 1.1,
    regions: ['cairo', 'alexandria', 'aswan', 'dongola', 'tripoli_libya', 'tunis', 'marrakesh', 'fez'],
    description:
      'Infantry brought north across the desert and hired in companies by the Egyptian and ' +
      'Maghrebi courts, who trusted them precisely because they had no local loyalties.',
  }),
  p({
    id: 'stradiot', name: 'Stradioti', unit: 'stratioti', capacity: 3, replenish: 3,
    premium: 1.15, fromYear: 1400,
    regions: ['kruje', 'durres', 'kotor', 'dubrovnik', 'corinth', 'candia', 'venice', 'ioannina'],
    description:
      'Albanian and Greek light horse who took Venetian pay when the Ottomans took their land. ' +
      'Europe copies their equipment for the next two centuries.',
  }),
  p({
    id: 'jinete', name: 'Jinetes', unit: 'jinetes', capacity: 3, replenish: 3, premium: 1.1,
    regions: ['granada', 'malaga', 'cordoba', 'seville', 'toledo', 'valencia', 'ceuta', 'tangier'],
    description:
      'Light horse of the Spanish frontier, hired across it in both directions without anyone ' +
      'feeling the need to explain themselves.',
  }),
  p({
    id: 'crossbow_companies', name: 'Hired Crossbowmen', unit: 'hired_crossbowmen', capacity: 4,
    replenish: 2, premium: 1.0, fromYear: 1120,
    regions: ['london', 'paris', 'cologne', 'prague', 'krakow', 'esztergom', 'venice', 'constantinople',
              'burgos', 'rome', 'thessaloniki', 'bruges'],
    description:
      'Professional bolt-shooters available in any large town for the campaign season. The ' +
      'crossbow needs money rather than a lifetime of practice, and money is what cities have.',
  }),
];

const BY_ID = new Map(MERCENARY_POOLS.map((pool) => [pool.id, pool]));

export function getMercenaryPool(id: string): MercenaryPool {
  const pool = BY_ID.get(id);
  if (!pool) throw new Error(`Unknown mercenary pool: ${id}`);
  return pool;
}

export function tryMercenaryPool(id: string): MercenaryPool | undefined {
  return BY_ID.get(id);
}

/** Pools that can be hired from in a given province, ignoring availability. */
export function poolsAt(region: RegionId): readonly MercenaryPool[] {
  return MERCENARY_POOLS.filter((pool) => pool.regions.includes(region));
}

export const MERCENARY_POOL_IDS: readonly string[] = MERCENARY_POOLS.map((pool) => pool.id);
