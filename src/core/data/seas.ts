/**
 * Sea zones: the water the fleets operate in.
 *
 * Provinces are the land layer and sea zones are the water layer. A port
 * province opens onto one or more zones, and a fleet moves from zone to zone
 * rather than from port to port. That is what gives naval power something to
 * do beyond ferrying: a fleet sitting in the Aegean closes the Aegean, whether
 * or not it ever touches a harbour.
 *
 * Great rivers are zones too. The Nile, the Danube, the Dnieper, the Volga and
 * the Rhine carried more medieval traffic than most coastlines, and a war
 * galley on them is as real as one at sea.
 */
import type { RegionId } from '../types';
import { regionId } from '../types';

declare const seaBrand: unique symbol;
export type SeaZoneId = string & { readonly [seaBrand]: 'SeaZoneId' };
export const seaZoneId = (value: string): SeaZoneId => value as SeaZoneId;

export interface SeaZone {
  readonly id: SeaZoneId;
  readonly name: string;
  /** Centre of the zone, for drawing and for distance. */
  readonly lon: number;
  readonly lat: number;
  /** Port provinces that open onto this water. */
  readonly ports: readonly RegionId[];
  /** True for a river system rather than open sea: cramped, and no storms. */
  readonly river: boolean;
}

type Spec = Omit<SeaZone, 'id' | 'ports' | 'river'> & {
  id: string;
  ports: readonly string[];
  river?: boolean;
};

const z = (spec: Spec): SeaZone => ({
  id: seaZoneId(spec.id),
  name: spec.name,
  lon: spec.lon,
  lat: spec.lat,
  ports: spec.ports.map(regionId),
  river: spec.river ?? false,
});

export const SEA_ZONES: readonly SeaZone[] = [
  // ---------------- The northern ocean ----------------
  z({
    id: 'norwegian_sea', name: 'Norwegian Sea', lon: 2, lat: 65,
    ports: ['trondheim', 'bergen', 'inverness'],
  }),
  z({
    id: 'north_sea', name: 'North Sea', lon: 3.5, lat: 56,
    ports: ['bergen', 'oslo', 'inverness', 'edinburgh', 'york', 'norwich', 'london',
            'bruges', 'utrecht', 'bremen', 'hamburg', 'aarhus'],
  }),
  z({
    id: 'english_channel', name: 'English Channel', lon: 0, lat: 50,
    ports: ['london', 'rouen', 'bruges'],
  }),
  z({
    id: 'irish_sea', name: 'Irish Sea', lon: -5, lat: 53.6,
    ports: ['chester', 'caernarfon', 'cardiff', 'dublin', 'armagh', 'stirling'],
  }),
  z({
    id: 'celtic_sea', name: 'Celtic Sea', lon: -7.5, lat: 50.5,
    ports: ['bristol', 'cork', 'cardiff', 'nantes', 'galway'],
  }),
  z({
    id: 'bay_of_biscay', name: 'Bay of Biscay', lon: -4, lat: 45,
    ports: ['nantes', 'bordeaux', 'santiago'],
  }),
  z({
    id: 'iberian_atlantic', name: 'Iberian Atlantic', lon: -10.5, lat: 39,
    ports: ['santiago', 'porto', 'lisbon', 'seville', 'tangier', 'ceuta'],
  }),
  z({
    id: 'rhine', name: 'The Rhine', lon: 6.6, lat: 51.6, river: true,
    ports: ['cologne', 'utrecht'],
  }),

  // ---------------- The Baltic ----------------
  z({
    id: 'skagerrak', name: 'Skagerrak', lon: 9.5, lat: 57.8,
    ports: ['aarhus', 'oslo', 'roskilde', 'lund'],
  }),
  z({
    id: 'baltic_sea', name: 'Baltic Sea', lon: 18, lat: 56,
    ports: ['lund', 'kalmar', 'visby', 'gdansk', 'stettin', 'oldenburg', 'roskilde',
            'prussia', 'semigallia', 'reval'],
  }),
  z({
    id: 'gulf_of_bothnia', name: 'Gulf of Bothnia', lon: 19.5, lat: 61,
    ports: ['sigtuna', 'turku'],
  }),
  z({
    id: 'gulf_of_finland', name: 'Gulf of Finland', lon: 26, lat: 59.8,
    ports: ['turku', 'reval', 'novgorod'],
  }),

  // ---------------- The western Mediterranean ----------------
  z({
    id: 'alboran_sea', name: 'Alboran Sea', lon: -3.5, lat: 36,
    ports: ['malaga', 'ceuta', 'tangier', 'algiers'],
  }),
  z({
    id: 'balearic_sea', name: 'Balearic Sea', lon: 1.5, lat: 39.5,
    ports: ['barcelona', 'valencia', 'palma'],
  }),
  z({
    id: 'gulf_of_lion', name: 'Gulf of Lion', lon: 4.5, lat: 42.6,
    ports: ['marseille', 'barcelona'],
  }),
  z({
    id: 'ligurian_sea', name: 'Ligurian Sea', lon: 8.8, lat: 43.4,
    ports: ['genoa', 'pisa', 'ajaccio', 'marseille'],
  }),
  z({
    id: 'sardinian_sea', name: 'Sardinian Sea', lon: 7.5, lat: 39,
    ports: ['cagliari', 'palma', 'ajaccio', 'algiers', 'bejaia'],
  }),
  z({
    id: 'tyrrhenian_sea', name: 'Tyrrhenian Sea', lon: 12.2, lat: 40.2,
    ports: ['rome', 'naples', 'salerno', 'palermo', 'messina', 'cagliari', 'pisa'],
  }),
  z({
    id: 'strait_of_sicily', name: 'Strait of Sicily', lon: 12, lat: 36.5,
    ports: ['palermo', 'mdina', 'syracuse', 'tunis', 'mahdia', 'tripoli_libya', 'cagliari'],
  }),
  z({
    id: 'gulf_of_sidra', name: 'Gulf of Sidra', lon: 18.5, lat: 32,
    ports: ['tripoli_libya', 'mdina', 'alexandria'],
  }),

  // ---------------- The eastern Mediterranean ----------------
  z({
    id: 'adriatic_sea', name: 'Adriatic Sea', lon: 15.5, lat: 43,
    ports: ['venice', 'ravenna', 'zadar', 'split', 'dubrovnik', 'kotor', 'bari',
            'taranto', 'durres'],
  }),
  z({
    id: 'ionian_sea', name: 'Ionian Sea', lon: 19, lat: 37.5,
    ports: ['taranto', 'messina', 'syracuse', 'durres', 'corinth', 'candia', 'mdina', 'athens'],
  }),
  z({
    id: 'aegean_sea', name: 'Aegean Sea', lon: 25, lat: 38.5,
    ports: ['thessaloniki', 'athens', 'corinth', 'smyrna', 'rhodes', 'candia', 'constantinople'],
  }),
  z({
    id: 'sea_of_marmara', name: 'Sea of Marmara', lon: 28.3, lat: 40.7,
    ports: ['constantinople', 'nicaea'],
  }),
  z({
    id: 'levantine_sea', name: 'Levantine Sea', lon: 32, lat: 34,
    ports: ['rhodes', 'nicosia', 'attaleia', 'tarsus', 'antioch', 'tripoli_syria', 'tyre',
            'acre', 'ascalon', 'damietta', 'alexandria', 'candia'],
  }),

  // ---------------- The Black Sea and its rivers ----------------
  z({
    id: 'black_sea', name: 'Black Sea', lon: 34, lat: 43,
    ports: ['varna', 'constantinople', 'cherson', 'soldaia', 'sinope', 'trebizond', 'azov'],
  }),
  z({
    id: 'sea_of_azov', name: 'Sea of Azov', lon: 37.5, lat: 46,
    ports: ['azov', 'soldaia'],
  }),
  z({
    id: 'danube', name: 'The Danube', lon: 24, lat: 44.3, river: true,
    ports: ['belgrade', 'vidin', 'varna'],
  }),
  z({
    id: 'dnieper', name: 'The Dnieper', lon: 32, lat: 48, river: true,
    ports: ['kiev', 'cherson'],
  }),

  // ---------------- The east ----------------
  z({
    id: 'caspian_sea', name: 'Caspian Sea', lon: 50, lat: 41.5,
    ports: ['derbent', 'saksin'],
  }),
  z({
    id: 'volga', name: 'The Volga', lon: 47.5, lat: 50, river: true,
    ports: ['saksin', 'bolghar'],
  }),
  z({
    id: 'mesopotamia', name: 'The Tigris and Euphrates', lon: 45, lat: 33, river: true,
    ports: ['baghdad', 'mosul', 'basra'],
  }),

  // ---------------- Africa ----------------
  z({
    id: 'nile', name: 'The Nile', lon: 31.5, lat: 26, river: true,
    ports: ['cairo', 'damietta', 'aswan', 'dongola', 'soba', 'alexandria'],
  }),
  z({
    id: 'red_sea', name: 'Red Sea', lon: 41, lat: 15,
    ports: ['zeila'],
  }),
  z({
    id: 'niger', name: 'The Niger', lon: -1.5, lat: 16.5, river: true,
    ports: ['timbuktu', 'gao'],
  }),
];

/** Which zones a fleet can sail between. Written once and symmetrised. */
const ZONE_LINKS: readonly (readonly [string, string])[] = [
  ['norwegian_sea', 'north_sea'],
  ['norwegian_sea', 'irish_sea'],
  ['north_sea', 'english_channel'],
  ['north_sea', 'skagerrak'],
  ['north_sea', 'rhine'],
  ['english_channel', 'celtic_sea'],
  ['celtic_sea', 'irish_sea'],
  ['celtic_sea', 'bay_of_biscay'],
  ['bay_of_biscay', 'iberian_atlantic'],
  ['iberian_atlantic', 'alboran_sea'],
  ['skagerrak', 'baltic_sea'],
  ['baltic_sea', 'gulf_of_bothnia'],
  ['baltic_sea', 'gulf_of_finland'],
  ['gulf_of_bothnia', 'gulf_of_finland'],
  ['alboran_sea', 'balearic_sea'],
  ['alboran_sea', 'sardinian_sea'],
  ['balearic_sea', 'gulf_of_lion'],
  ['balearic_sea', 'sardinian_sea'],
  ['gulf_of_lion', 'ligurian_sea'],
  ['ligurian_sea', 'tyrrhenian_sea'],
  ['ligurian_sea', 'sardinian_sea'],
  ['sardinian_sea', 'strait_of_sicily'],
  ['tyrrhenian_sea', 'strait_of_sicily'],
  ['tyrrhenian_sea', 'ionian_sea'],
  ['strait_of_sicily', 'gulf_of_sidra'],
  ['strait_of_sicily', 'ionian_sea'],
  ['gulf_of_sidra', 'levantine_sea'],
  ['ionian_sea', 'adriatic_sea'],
  ['ionian_sea', 'aegean_sea'],
  ['ionian_sea', 'levantine_sea'],
  ['aegean_sea', 'sea_of_marmara'],
  ['aegean_sea', 'levantine_sea'],
  ['sea_of_marmara', 'black_sea'],
  ['black_sea', 'sea_of_azov'],
  ['black_sea', 'danube'],
  ['black_sea', 'dnieper'],
  ['levantine_sea', 'nile'],
  ['caspian_sea', 'volga'],
];

const BY_ID = new Map<SeaZoneId, SeaZone>(SEA_ZONES.map((zone) => [zone.id, zone]));

function buildZoneAdjacency(): ReadonlyMap<SeaZoneId, readonly SeaZoneId[]> {
  const map = new Map<SeaZoneId, SeaZoneId[]>();
  const seen = new Set<string>();
  for (const [a, b] of ZONE_LINKS) {
    if (a === b) throw new Error(`Sea zone ${a} linked to itself`);
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) throw new Error(`Duplicate sea link ${key}`);
    seen.add(key);
    const left = seaZoneId(a);
    const right = seaZoneId(b);
    if (!BY_ID.has(left)) throw new Error(`Unknown sea zone ${a}`);
    if (!BY_ID.has(right)) throw new Error(`Unknown sea zone ${b}`);
    map.set(left, [...(map.get(left) ?? []), right]);
    map.set(right, [...(map.get(right) ?? []), left]);
  }
  return map;
}

export const SEA_ADJACENCY = buildZoneAdjacency();

export function getSeaZone(id: SeaZoneId): SeaZone {
  const zone = BY_ID.get(id);
  if (!zone) throw new Error(`Unknown sea zone: ${id}`);
  return zone;
}

export function trySeaZone(id: SeaZoneId): SeaZone | undefined {
  return BY_ID.get(id);
}

export function seaNeighbourZones(id: SeaZoneId): readonly SeaZoneId[] {
  return SEA_ADJACENCY.get(id) ?? [];
}

/** Index from a port province to the waters it opens onto. */
const PORT_TO_ZONES = ((): ReadonlyMap<RegionId, readonly SeaZoneId[]> => {
  const map = new Map<RegionId, SeaZoneId[]>();
  for (const zone of SEA_ZONES) {
    for (const port of zone.ports) {
      map.set(port, [...(map.get(port) ?? []), zone.id]);
    }
  }
  return map;
})();

export function zonesOffPort(port: RegionId): readonly SeaZoneId[] {
  return PORT_TO_ZONES.get(port) ?? [];
}

/** Can a fleet in this zone put into that harbour? */
export function zoneServesPort(zone: SeaZoneId, port: RegionId): boolean {
  return zonesOffPort(port).includes(zone);
}

export const SEA_ZONE_IDS: readonly SeaZoneId[] = SEA_ZONES.map((zone) => zone.id);
