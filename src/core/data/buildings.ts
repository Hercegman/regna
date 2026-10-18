/**
 * Building chains.
 *
 * Each chain is an upgrade ladder: a settlement holds at most one level of a
 * chain, and building the next level replaces the previous one. A chain level
 * is gated by the settlement's tier, so growing a town is what unlocks the
 * better barracks rather than money alone.
 */
import type { BuildingType, SettlementTier } from '../types';
import { buildingId } from '../types';

type Spec = Omit<BuildingType, 'id' | 'requires'> & { id: string; requires?: string };

const b = (spec: Spec): BuildingType => {
  const { id, requires, ...rest } = spec;
  return {
    ...rest,
    id: buildingId(id),
    ...(requires ? { requires: buildingId(requires) } : {}),
  };
};

export const BUILDING_TYPES: readonly BuildingType[] = [
  // ---------------- Defences ----------------
  b({
    id: 'palisade', name: 'Palisade', category: 'defence', chain: 'walls', level: 0,
    cost: 400, turnsToBuild: 1, upkeep: 0, minSettlement: 'village',
    effects: { walls: 'palisade', order: 1, garrison: 1 },
    description: 'A ditch, a bank and a timber fence. It stops a raid and buys time against an army.',
  }),
  b({
    id: 'wooden_wall', name: 'Wooden Wall', category: 'defence', chain: 'walls', level: 1,
    cost: 900, turnsToBuild: 2, upkeep: 10, minSettlement: 'town', requires: 'palisade',
    effects: { walls: 'wooden', order: 1, garrison: 2 },
    description: 'A proper timber rampart with towers and a gatehouse, defensible by militia.',
  }),
  b({
    id: 'stone_wall', name: 'Stone Wall', category: 'defence', chain: 'walls', level: 2,
    cost: 2000, turnsToBuild: 3, upkeep: 25, minSettlement: 'large_town', requires: 'wooden_wall',
    effects: { walls: 'stone', order: 2, garrison: 3 },
    description: 'Mortared curtain walls that cannot be burned and must be mined or battered.',
  }),
  b({
    id: 'large_stone_wall', name: 'Large Stone Wall', category: 'defence', chain: 'walls', level: 3,
    cost: 4000, turnsToBuild: 4, upkeep: 45, minSettlement: 'city', requires: 'stone_wall',
    effects: { walls: 'large_stone', order: 3, garrison: 4 },
    description: 'High walls with flanking towers and a barbican, proof against all but the heaviest engines.',
  }),
  b({
    id: 'epic_wall', name: 'Epic Fortifications', category: 'defence', chain: 'walls', level: 4,
    cost: 8000, turnsToBuild: 6, upkeep: 80, minSettlement: 'large_city', requires: 'large_stone_wall',
    effects: { walls: 'epic', order: 4, garrison: 6 },
    description:
      'Concentric walls, wet ditches and layered towers, in the manner of the Theodosian ' +
      'defences. An assault here costs an army.',
  }),

  // ---------------- Settlement core ----------------
  b({
    id: 'governors_house', name: "Governor's House", category: 'settlement', chain: 'governance', level: 0,
    cost: 500, turnsToBuild: 2, upkeep: 15, minSettlement: 'village',
    effects: { order: 1, trade: 10, growth: 0.005 },
    description: 'A hall for the lord or his steward: rents collected, disputes judged, order kept.',
  }),
  b({
    id: 'governors_villa', name: "Governor's Villa", category: 'settlement', chain: 'governance', level: 1,
    cost: 1400, turnsToBuild: 3, upkeep: 35, minSettlement: 'town', requires: 'governors_house',
    effects: { order: 2, trade: 25, growth: 0.01 },
    description: 'A seat of provincial administration with clerks, a treasury and a gaol.',
  }),
  b({
    id: 'governors_palace', name: "Governor's Palace", category: 'settlement', chain: 'governance', level: 2,
    cost: 3200, turnsToBuild: 4, upkeep: 70, minSettlement: 'city', requires: 'governors_villa',
    effects: { order: 4, trade: 50, growth: 0.015 },
    description: 'A palace fit to hold a court, overawe the local nobility and house an army of officials.',
  }),

  // ---------------- Military ----------------
  b({
    id: 'muster_field', name: 'Muster Field', category: 'military', chain: 'barracks', level: 0,
    cost: 350, turnsToBuild: 1, upkeep: 10, minSettlement: 'village',
    effects: { garrison: 1 },
    description: 'Open ground where the levy assembles and is counted. Enough to raise peasants and spearmen.',
  }),
  b({
    id: 'barracks', name: 'Barracks', category: 'military', chain: 'barracks', level: 1,
    cost: 1000, turnsToBuild: 2, upkeep: 25, minSettlement: 'town', requires: 'muster_field',
    effects: { garrison: 2, recruitExperience: 1 },
    description: 'Quarters, an armoury and a sergeant: soldiers who train together instead of meeting on the march.',
  }),
  b({
    id: 'drill_square', name: 'Drill Square', category: 'military', chain: 'barracks', level: 2,
    cost: 2400, turnsToBuild: 3, upkeep: 50, minSettlement: 'large_town', requires: 'barracks',
    effects: { garrison: 3, recruitExperience: 2 },
    description: 'A paved square for formation drill, which is what separates a regiment from a crowd.',
  }),
  b({
    id: 'royal_armoury', name: 'Royal Armoury', category: 'military', chain: 'barracks', level: 3,
    cost: 5000, turnsToBuild: 4, upkeep: 90, minSettlement: 'city', requires: 'drill_square',
    effects: { garrison: 4, recruitExperience: 3 },
    description: 'Master armourers, a standing cadre and the capacity to equip household troops to the best standard.',
  }),
  b({
    id: 'archery_range', name: 'Archery Range', category: 'military', chain: 'archery', level: 0,
    cost: 700, turnsToBuild: 2, upkeep: 20, minSettlement: 'town',
    effects: { garrison: 1, recruitExperience: 1 },
    description: 'Butts and a long meadow. Compulsory practice is what produces archers worth fielding.',
  }),
  b({
    id: 'bowyer', name: "Bowyer's Workshop", category: 'military', chain: 'archery', level: 1,
    cost: 1800, turnsToBuild: 3, upkeep: 40, minSettlement: 'large_town', requires: 'archery_range',
    effects: { garrison: 2, recruitExperience: 2 },
    description: 'Seasoned yew, horn and sinew worked by men who do nothing else, and a steady supply of arrows.',
  }),
  b({
    id: 'stables', name: 'Stables', category: 'military', chain: 'stables', level: 0,
    cost: 800, turnsToBuild: 2, upkeep: 25, minSettlement: 'town',
    effects: { garrison: 1 },
    description: 'Stalls, pasture and a farrier, enough to keep a troop of horse in the field.',
  }),
  b({
    id: 'knights_stables', name: "Knights' Stables", category: 'military', chain: 'stables', level: 1,
    cost: 2200, turnsToBuild: 3, upkeep: 55, minSettlement: 'large_town', requires: 'stables',
    effects: { garrison: 2, recruitExperience: 1 },
    description: 'Destriers bred and trained for the charge, and the grooms and armourers a knight requires.',
  }),
  b({
    id: 'royal_stud', name: 'Royal Stud', category: 'military', chain: 'stables', level: 2,
    cost: 4600, turnsToBuild: 4, upkeep: 95, minSettlement: 'city', requires: 'knights_stables',
    effects: { garrison: 3, recruitExperience: 2 },
    description: 'A breeding programme for warhorses, the most expensive and most decisive livestock in Europe.',
  }),
  b({
    id: 'siege_works', name: 'Siege Works', category: 'military', chain: 'siege', level: 0,
    cost: 1200, turnsToBuild: 2, upkeep: 30, minSettlement: 'town',
    effects: { garrison: 1 },
    description: 'Carpenters, rope-walks and a yard for assembling engines that are too heavy to carry whole.',
  }),
  b({
    id: 'cannon_foundry', name: 'Cannon Foundry', category: 'military', chain: 'siege', level: 1,
    cost: 4000, turnsToBuild: 4, upkeep: 85, minSettlement: 'city', requires: 'siege_works',
    effects: { garrison: 1, recruitExperience: 1 },
    description: 'Bell-founders turned gunfounders, casting bronze barrels that bring down ancient walls.',
  }),

  // ---------------- Economy ----------------
  b({
    id: 'land_clearance', name: 'Land Clearance', category: 'economy', chain: 'farms', level: 0,
    cost: 450, turnsToBuild: 2, upkeep: 0, minSettlement: 'village',
    effects: { farming: 0.15, growth: 0.01 },
    description: 'Woodland felled and marsh drained. The slow, decisive work of the medieval economy.',
  }),
  b({
    id: 'crop_rotation', name: 'Crop Rotation', category: 'economy', chain: 'farms', level: 1,
    cost: 1100, turnsToBuild: 3, upkeep: 15, minSettlement: 'town', requires: 'land_clearance',
    effects: { farming: 0.3, growth: 0.015 },
    description: 'The three-field system with legumes: more grain, more fodder, and soil that recovers.',
  }),
  b({
    id: 'heavy_plough', name: 'Heavy Plough', category: 'economy', chain: 'farms', level: 2,
    cost: 2600, turnsToBuild: 3, upkeep: 35, minSettlement: 'large_town', requires: 'crop_rotation',
    effects: { farming: 0.5, growth: 0.02 },
    description: 'The mouldboard plough and the horse collar, which open heavy northern clay to cultivation.',
  }),
  b({
    id: 'market', name: 'Market', category: 'economy', chain: 'trade', level: 0,
    cost: 600, turnsToBuild: 2, upkeep: 10, minSettlement: 'village',
    effects: { trade: 30, growth: 0.005 },
    description: 'A weekly market under charter, where the countryside turns surplus into coin and tolls.',
  }),
  b({
    id: 'merchants_guild', name: "Merchants' Guild", category: 'economy', chain: 'trade', level: 1,
    cost: 1600, turnsToBuild: 3, upkeep: 30, minSettlement: 'town', requires: 'market',
    effects: { trade: 70, growth: 0.01, order: 1 },
    description: 'Chartered merchants with privileges, warehouses and the capital to finance a caravan.',
  }),
  b({
    id: 'great_exchange', name: 'Great Exchange', category: 'economy', chain: 'trade', level: 2,
    cost: 3800, turnsToBuild: 4, upkeep: 60, minSettlement: 'large_town', requires: 'merchants_guild',
    effects: { trade: 140, growth: 0.015, order: 1 },
    description: 'Bills of exchange, marine insurance and double-entry books: banking before banks.',
  }),
  b({
    id: 'mine', name: 'Mine', category: 'economy', chain: 'mining', level: 0,
    cost: 1200, turnsToBuild: 3, upkeep: 25, minSettlement: 'village',
    effects: { mining: 120 },
    description: 'Shafts and adits worked by specialists, often German miners under their own law.',
  }),
  b({
    id: 'deep_mine', name: 'Deep Mine', category: 'economy', chain: 'mining', level: 1,
    cost: 3000, turnsToBuild: 4, upkeep: 60, minSettlement: 'town', requires: 'mine',
    effects: { mining: 300 },
    description: 'Drainage wheels and winding gear reaching ore that hand-digging cannot.',
  }),
  b({
    id: 'harbour', name: 'Harbour', category: 'economy', chain: 'port', level: 0,
    cost: 900, turnsToBuild: 2, upkeep: 20, minSettlement: 'village',
    effects: { trade: 50, port: true },
    description: 'A quay, a crane and a customs shed. Sea freight costs a fraction of carting.',
  }),
  b({
    id: 'shipyard', name: 'Shipyard', category: 'economy', chain: 'port', level: 1,
    cost: 2200, turnsToBuild: 3, upkeep: 45, minSettlement: 'town', requires: 'harbour',
    effects: { trade: 110, port: true },
    description: 'Slipways and shipwrights building round ships for cargo and galleys for war.',
  }),
  b({
    id: 'arsenal', name: 'Arsenal', category: 'economy', chain: 'port', level: 2,
    cost: 5200, turnsToBuild: 5, upkeep: 90, minSettlement: 'large_town', requires: 'shipyard',
    effects: { trade: 200, port: true, order: 1 },
    description:
      'A state shipyard building hulls on a production line, as Venice does, able to replace ' +
      'a fleet faster than an enemy can sink one.',
  }),

  // ---------------- Infrastructure ----------------
  b({
    id: 'dirt_roads', name: 'Dirt Roads', category: 'infrastructure', chain: 'roads', level: 0,
    cost: 500, turnsToBuild: 2, upkeep: 10, minSettlement: 'village',
    effects: { trade: 20, roads: 0.15 },
    description: 'Cleared tracks and fords. Passable in summer, which is when campaigns happen.',
  }),
  b({
    id: 'paved_roads', name: 'Paved Roads', category: 'infrastructure', chain: 'roads', level: 1,
    cost: 1500, turnsToBuild: 3, upkeep: 30, minSettlement: 'town', requires: 'dirt_roads',
    effects: { trade: 55, roads: 0.3 },
    description: 'Metalled surfaces, culverts and stone bridges: supply and reinforcement all year.',
  }),
  b({
    id: 'aqueduct', name: 'Aqueduct', category: 'infrastructure', chain: 'health', level: 0,
    cost: 1300, turnsToBuild: 3, upkeep: 30, minSettlement: 'town',
    effects: { growth: 0.02, order: 1 },
    description: 'Clean water brought in by channel, which does more for a city\'s population than any physician.',
  }),
  b({
    id: 'sewers', name: 'Sewers', category: 'infrastructure', chain: 'health', level: 1,
    cost: 3000, turnsToBuild: 4, upkeep: 55, minSettlement: 'large_town', requires: 'aqueduct',
    effects: { growth: 0.03, order: 2 },
    description: 'Covered drains that carry filth out of the streets, and with it much of the plague mortality.',
  }),

  // ---------------- Religion and culture ----------------
  b({
    id: 'chapel', name: 'Chapel', category: 'religion', chain: 'temple', level: 0,
    cost: 450, turnsToBuild: 2, upkeep: 10, minSettlement: 'village',
    effects: { order: 1, conversion: 0.4 },
    description: 'A parish church with a resident priest: baptisms, tithes and the week\'s only assembly.',
  }),
  b({
    id: 'church', name: 'Church', category: 'religion', chain: 'temple', level: 1,
    cost: 1200, turnsToBuild: 3, upkeep: 25, minSettlement: 'town', requires: 'chapel',
    effects: { order: 2, conversion: 0.8 },
    description: 'A stone church with a chapter of clergy, the dominant institution in any town.',
  }),
  b({
    id: 'cathedral', name: 'Cathedral', category: 'religion', chain: 'temple', level: 2,
    cost: 3400, turnsToBuild: 5, upkeep: 60, minSettlement: 'large_town', requires: 'church',
    effects: { order: 3, conversion: 1.4, growth: 0.01 },
    description:
      'A bishop\'s seat and a building project measured in generations, drawing pilgrims, ' +
      'masons and money from an entire province.',
  }),
  b({
    id: 'scriptorium', name: 'Scriptorium', category: 'culture', chain: 'learning', level: 0,
    cost: 900, turnsToBuild: 3, upkeep: 20, minSettlement: 'town',
    effects: { order: 1, trade: 15 },
    description: 'Copyists at their desks. Every charter, account and law the state relies on starts here.',
  }),
  b({
    id: 'university', name: 'University', category: 'culture', chain: 'learning', level: 1,
    cost: 2800, turnsToBuild: 5, upkeep: 60, minSettlement: 'large_town', requires: 'scriptorium',
    effects: { order: 2, trade: 40, growth: 0.01 },
    description:
      'A chartered corporation of masters and students with its own courts. Law, medicine and ' +
      'theology, and a permanent source of trained administrators.',
  }),
];

const BY_ID = new Map(BUILDING_TYPES.map((building) => [building.id, building]));

export function getBuildingType(id: BuildingType['id']): BuildingType {
  const building = BY_ID.get(id);
  if (!building) throw new Error(`Unknown building: ${id}`);
  return building;
}

export function tryGetBuildingType(id: BuildingType['id']): BuildingType | undefined {
  return BY_ID.get(id);
}

/** All chains, in a stable display order. */
export const BUILDING_CHAINS: readonly string[] = [...new Set(BUILDING_TYPES.map((x) => x.chain))];

/** The levels of one chain, lowest first. */
export function chainLevels(chain: string): readonly BuildingType[] {
  return BUILDING_TYPES.filter((building) => building.chain === chain).sort(
    (a, c) => a.level - c.level,
  );
}

/** Minimum settlement tier that allows any level of the chain. */
export function chainEntryTier(chain: string): SettlementTier {
  return chainLevels(chain)[0]!.minSettlement;
}
