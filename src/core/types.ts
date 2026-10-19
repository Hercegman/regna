/**
 * Shared domain types for the whole simulation.
 *
 * Ids are branded strings so that a RegionId can never be passed where a
 * FactionId is expected, while still being plain strings at runtime (cheap to
 * serialise into a save file and readable in a debugger).
 */

declare const brand: unique symbol;
type Branded<T, B extends string> = T & { readonly [brand]: B };

export type FactionId = Branded<string, 'FactionId'>;
export type RegionId = Branded<string, 'RegionId'>;
export type UnitTypeId = Branded<string, 'UnitTypeId'>;
export type BuildingId = Branded<string, 'BuildingId'>;
export type ArmyId = Branded<string, 'ArmyId'>;
export type FleetId = Branded<string, 'FleetId'>;
export type CharacterId = Branded<string, 'CharacterId'>;

export const factionId = (value: string): FactionId => value as FactionId;
export const regionId = (value: string): RegionId => value as RegionId;
export const unitTypeId = (value: string): UnitTypeId => value as UnitTypeId;
export const buildingId = (value: string): BuildingId => value as BuildingId;
export const armyId = (value: string): ArmyId => value as ArmyId;
export const fleetId = (value: string): FleetId => value as FleetId;
export const characterId = (value: string): CharacterId => value as CharacterId;

// ---------------------------------------------------------------------------
// Cultural and religious model
// ---------------------------------------------------------------------------

/**
 * A culture group drives architecture, unit availability and AI temperament.
 * Kept coarse on purpose: fine-grained national flavour lives on the faction.
 */
export type Culture =
  | 'latin_west'      // France, England, HRE, Italian states, Iberian Christians
  | 'nordic'          // Denmark, Norway, Sweden, Iceland
  | 'slavic_west'     // Poland, Bohemia, Croatia, Hungary (Latin-rite Slavs + Magyars)
  | 'slavic_east'     // Rus principalities, Novgorod, Muscovy
  | 'balkan'          // Serbia, Bulgaria, Bosnia, Wallachia, Albania
  | 'hellenic'        // Byzantium and its successor states, Georgia, Armenia
  | 'levantine'       // Arab and Turkic Near East
  | 'maghrebi'        // North-west Africa and al-Andalus
  | 'steppe'          // Cuman, Mongol, Tatar hordes
  | 'sahelian'        // Mali, Kanem, Nubia, Ethiopia
  | 'celtic';         // Ireland, Scotland, Wales

export type Religion =
  | 'catholic'
  | 'orthodox'
  | 'sunni'
  | 'shia'
  | 'miaphysite'      // Armenian, Coptic, Ethiopian churches
  | 'pagan'           // Baltic, Finnic, Slavic and Turco-Mongol traditional faiths
  | 'tengri'
  | 'animist';

/** Confessional families decide who may crusade on whom and how clerics behave. */
export const RELIGION_FAMILY: Record<Religion, 'christian' | 'muslim' | 'other'> = {
  catholic: 'christian',
  orthodox: 'christian',
  miaphysite: 'christian',
  sunni: 'muslim',
  shia: 'muslim',
  pagan: 'other',
  tengri: 'other',
  animist: 'other',
};

// ---------------------------------------------------------------------------
// Terrain and geography
// ---------------------------------------------------------------------------

export type Terrain =
  | 'plains'
  | 'farmland'
  | 'hills'
  | 'mountains'
  | 'forest'
  | 'marsh'
  | 'steppe'
  | 'desert'
  | 'coastal';

/** What a region yields beyond its farmland, used by the trade model. */
export type Resource =
  | 'none'
  | 'iron'
  | 'silver'
  | 'gold'
  | 'copper'
  | 'tin'
  | 'furs'
  | 'timber'
  | 'wool'
  | 'silk'
  | 'spices'
  | 'wine'
  | 'grain'
  | 'salt'
  | 'horses'
  | 'fish'
  | 'amber'
  | 'marble'
  | 'ivory'
  | 'dyes';

/** Settlement rank; gates building chains, garrison size and tax income. */
export type SettlementTier =
  | 'village'
  | 'town'
  | 'large_town'
  | 'city'
  | 'large_city'
  | 'huge_city';

export const SETTLEMENT_ORDER: readonly SettlementTier[] = [
  'village',
  'town',
  'large_town',
  'city',
  'large_city',
  'huge_city',
];

/** Defensive works, independent of the settlement tier that unlocks them. */
export type WallTier = 'none' | 'palisade' | 'wooden' | 'stone' | 'large_stone' | 'epic';

export const WALL_ORDER: readonly WallTier[] = [
  'none',
  'palisade',
  'wooden',
  'stone',
  'large_stone',
  'epic',
];

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export type UnitClass =
  | 'light_infantry'
  | 'heavy_infantry'
  | 'spearmen'
  | 'pikemen'
  | 'archers'
  | 'crossbowmen'
  | 'javelinmen'
  | 'gunpowder_infantry'
  | 'light_cavalry'
  | 'heavy_cavalry'
  | 'horse_archers'
  | 'camel_cavalry'
  | 'siege_engine'
  | 'general'
  | 'warship'
  | 'transport';

/** Broad behaviour buckets used by battle AI and by the recruitment planner. */
export const UNIT_ROLE: Record<UnitClass, 'melee' | 'missile' | 'cavalry' | 'siege'> = {
  light_infantry: 'melee',
  heavy_infantry: 'melee',
  spearmen: 'melee',
  pikemen: 'melee',
  archers: 'missile',
  crossbowmen: 'missile',
  javelinmen: 'missile',
  gunpowder_infantry: 'missile',
  light_cavalry: 'cavalry',
  heavy_cavalry: 'cavalry',
  horse_archers: 'cavalry',
  camel_cavalry: 'cavalry',
  siege_engine: 'siege',
  general: 'cavalry',
  // A sea fight is decided by closing and boarding, so a warship behaves like
  // heavy foot that happens to float. Ships that carry archers or engines
  // still shoot, because that is driven by their range rather than their role.
  warship: 'melee',
  transport: 'melee',
};

export type UnitAbility =
  | 'shield_wall'      // bonus defence while holding a tight line
  | 'schiltron'        // pike circle, strong against cavalry from any side
  | 'charge_bonus'     // extra impact damage on a successful charge
  | 'armour_piercing'  // ignores part of the target's armour
  | 'anti_cavalry'     // bonus against mounted targets
  | 'skirmish'         // retreats automatically from approaching melee
  | 'stakes'           // may plant defensive stakes before battle
  | 'hardy'            // slower fatigue accumulation
  | 'highly_trained'   // better discipline recovery
  | 'berserk'          // cannot be routed while in melee, no withdraw
  | 'feigned_retreat'  // horse archer tactic: fire while withdrawing
  | 'siege_crew'       // operates engines
  | 'ladder_carrier'   // can scale walls without engines
  | 'mountaineer'      // no penalty in mountains
  | 'desert_hardy'     // no heat fatigue penalty
  | 'forest_fighter'   // no penalty in forest
  // At sea
  | 'ram'              // can hole an enemy hull on impact
  | 'greek_fire'       // short-ranged incendiary, decisive against wooden hulls
  | 'tall_sided'       // a high hull is hard to board from a low one
  | 'seaworthy'        // can keep station in open water and in winter
  | 'oared';           // not becalmed, and can manoeuvre in a flat sea

export interface UnitType {
  readonly id: UnitTypeId;
  readonly name: string;
  readonly unitClass: UnitClass;
  /** 1 = levy, 5 = elite household troops. Drives AI value and upkeep. */
  readonly tier: 1 | 2 | 3 | 4 | 5;
  readonly soldiers: number;
  /** Melee attack rating. */
  readonly attack: number;
  /** Added to attack on the turn a charge connects. */
  readonly charge: number;
  /** Skill-based defence (parrying, training). */
  readonly defence: number;
  /** Damage reduction from worn armour. */
  readonly armour: number;
  /** Extra protection, directional: only against frontal and left attacks. */
  readonly shield: number;
  /** 1-20; how much punishment the unit takes before routing. */
  readonly morale: number;
  /** 1-20; resistance to panic spreading and speed of rallying. */
  readonly discipline: number;
  /** Metres per second on the battle map. */
  readonly speed: number;
  /** Missile range in metres; 0 for melee-only units. */
  readonly range: number;
  /** Missile damage per hit. */
  readonly missileAttack: number;
  readonly ammunition: number;
  readonly mounted: boolean;
  readonly abilities: readonly UnitAbility[];
  /** Recruitment cost in florins. */
  readonly cost: number;
  /** Per-turn upkeep in florins. */
  readonly upkeep: number;
  /** Building required to recruit; undefined means any settlement. */
  readonly requires?: BuildingId;
  /** Minimum settlement tier required to recruit. */
  readonly minSettlement?: SettlementTier;
  /**
   * Recruitment pools this unit belongs to. A faction can recruit it when any
   * pool matches the faction's culture or one of its roster tags. This keeps
   * the roster table small while still giving 70+ factions distinct armies.
   */
  readonly pools: readonly string[];
  /** Faction-unique units: only these factions may recruit it, pools ignored. */
  readonly factions?: readonly FactionId[];
  /** Earliest year the unit can be recruited. */
  readonly fromYear?: number;
  /** Year after which the unit is obsolete and can no longer be recruited. */
  readonly untilYear?: number;
  /** Land regiments a ship of this type can carry. Zero for everything else. */
  readonly capacity?: number;
  /**
   * The water a hull is built for. A river galley is useless on the open sea
   * and a carrack cannot be floated down the Tigris.
   */
  readonly waters?: 'river' | 'sea' | 'any';
  /** Historical note shown in the unit card. */
  readonly description: string;
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export type BuildingCategory =
  | 'settlement'
  | 'defence'
  | 'military'
  | 'economy'
  | 'religion'
  | 'infrastructure'
  | 'culture';

export interface BuildingType {
  readonly id: BuildingId;
  readonly name: string;
  readonly category: BuildingCategory;
  /** Position in its chain, 0-based. */
  readonly level: number;
  /** The chain this building belongs to, e.g. "barracks". */
  readonly chain: string;
  readonly cost: number;
  readonly turnsToBuild: number;
  readonly upkeep: number;
  readonly minSettlement: SettlementTier;
  /** Previous level in the chain, if any. */
  readonly requires?: BuildingId;
  readonly effects: BuildingEffects;
  readonly description: string;
}

export interface BuildingEffects {
  /** Flat bonus to trade income. */
  readonly trade?: number;
  /** Multiplier on farm income, as a fraction: 0.25 = +25%. */
  readonly farming?: number;
  /** Public order points. */
  readonly order?: number;
  /** Population growth bonus, as a fraction per turn. */
  readonly growth?: number;
  /** Raises the wall tier. */
  readonly walls?: WallTier;
  /** Free garrison units spawned on siege. */
  readonly garrison?: number;
  /** Experience granted to units recruited here. */
  readonly recruitExperience?: number;
  /** Religious conversion pressure, points per turn. */
  readonly conversion?: number;
  /** Flat income from mining. */
  readonly mining?: number;
  /** Enables sea trade and naval recruitment. */
  readonly port?: boolean;
  /** Bonus to army movement range leaving this region. */
  readonly roads?: number;
}

// ---------------------------------------------------------------------------
// Diplomacy
// ---------------------------------------------------------------------------

export type DiplomaticStance = 'war' | 'neutral' | 'ceasefire' | 'trade' | 'alliance' | 'vassal';

export interface Relation {
  readonly stance: DiplomaticStance;
  /** -100 (hatred) to +100 (devotion). */
  readonly attitude: number;
  /** Turn the current stance started, for cooldowns. */
  readonly since: number;
}

// ---------------------------------------------------------------------------
// Utility geometry
// ---------------------------------------------------------------------------

export interface Point {
  readonly x: number;
  readonly y: number;
}

export function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
