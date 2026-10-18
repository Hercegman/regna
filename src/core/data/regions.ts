/**
 * The campaign map.
 *
 * Each region is a province with one settlement. Coordinates are the real
 * longitude and latitude of that settlement, so the map is a projection of
 * actual geography rather than a drawn approximation, and adding a province
 * means adding one row here plus its edges in `adjacency.ts`.
 *
 * `owner` is the situation in 1080. Where the historical holder is a polity too
 * small to be worth a faction of its own (the lesser taifas, the Welsh marcher
 * lords, the Sardinian judicates, the pagan Baltic tribes) the province starts
 * independent, which is a playable neutral rather than a placeholder.
 */
import type { RegionId, Resource, SettlementTier, Terrain, FactionId } from '../types';
import { regionId, factionId } from '../types';

export interface Region {
  readonly id: RegionId;
  /** The province, e.g. "Normandy". */
  readonly province: string;
  /** Its settlement, e.g. "Rouen". */
  readonly settlement: string;
  readonly lon: number;
  readonly lat: number;
  readonly terrain: Terrain;
  readonly resource: Resource;
  readonly tier: SettlementTier;
  /** Has a harbour: enables sea trade, naval movement and amphibious landing. */
  readonly port: boolean;
  /** Owner in 1080. */
  readonly owner: FactionId;
  /** Baseline population in thousands, before campaign growth. */
  readonly population: number;
  /** Farm output multiplier, 0.4 desert to 1.5 best farmland. */
  readonly fertility: number;
}

type Spec = Omit<Region, 'id' | 'owner'> & { id: string; owner: string };

const r = (spec: Spec): Region => ({
  ...spec,
  id: regionId(spec.id),
  owner: factionId(spec.owner),
});

export const REGIONS: readonly Region[] = [
  // ======================= British Isles =======================
  r({ id: 'london', province: 'Middlesex', settlement: 'London', lon: -0.1, lat: 51.51, terrain: 'farmland', resource: 'wool', tier: 'large_town', port: true, owner: 'england', population: 18, fertility: 1.3 }),
  r({ id: 'york', province: 'Yorkshire', settlement: 'York', lon: -1.08, lat: 53.96, terrain: 'farmland', resource: 'wool', tier: 'town', port: true, owner: 'england', population: 9, fertility: 1.1 }),
  r({ id: 'bristol', province: 'Wessex', settlement: 'Bristol', lon: -2.59, lat: 51.45, terrain: 'hills', resource: 'tin', tier: 'town', port: true, owner: 'england', population: 8, fertility: 1.0 }),
  r({ id: 'norwich', province: 'East Anglia', settlement: 'Norwich', lon: 1.3, lat: 52.63, terrain: 'farmland', resource: 'grain', tier: 'town', port: true, owner: 'england', population: 9, fertility: 1.3 }),
  r({ id: 'chester', province: 'Cheshire', settlement: 'Chester', lon: -2.89, lat: 53.19, terrain: 'hills', resource: 'iron', tier: 'town', port: true, owner: 'england', population: 6, fertility: 0.9 }),
  r({ id: 'caernarfon', province: 'Gwynedd', settlement: 'Caernarfon', lon: -4.27, lat: 53.14, terrain: 'mountains', resource: 'copper', tier: 'village', port: true, owner: 'wales', population: 3, fertility: 0.6 }),
  r({ id: 'cardiff', province: 'Glamorgan', settlement: 'Cardiff', lon: -3.18, lat: 51.48, terrain: 'hills', resource: 'iron', tier: 'village', port: true, owner: 'independent', population: 4, fertility: 0.9 }),
  r({ id: 'edinburgh', province: 'Lothian', settlement: 'Edinburgh', lon: -3.19, lat: 55.95, terrain: 'hills', resource: 'wool', tier: 'town', port: true, owner: 'scotland', population: 7, fertility: 0.9 }),
  r({ id: 'stirling', province: 'Strathclyde', settlement: 'Stirling', lon: -3.94, lat: 56.12, terrain: 'marsh', resource: 'grain', tier: 'village', port: true, owner: 'scotland', population: 4, fertility: 0.9 }),
  r({ id: 'inverness', province: 'Moray', settlement: 'Inverness', lon: -4.22, lat: 57.48, terrain: 'mountains', resource: 'furs', tier: 'village', port: true, owner: 'scotland', population: 3, fertility: 0.5 }),
  r({ id: 'dublin', province: 'Leinster', settlement: 'Dublin', lon: -6.26, lat: 53.35, terrain: 'farmland', resource: 'grain', tier: 'town', port: true, owner: 'ireland', population: 6, fertility: 1.1 }),
  r({ id: 'cork', province: 'Munster', settlement: 'Cork', lon: -8.47, lat: 51.9, terrain: 'hills', resource: 'fish', tier: 'village', port: true, owner: 'ireland', population: 4, fertility: 0.9 }),
  r({ id: 'galway', province: 'Connacht', settlement: 'Galway', lon: -9.05, lat: 53.27, terrain: 'marsh', resource: 'wool', tier: 'village', port: true, owner: 'ireland', population: 3, fertility: 0.7 }),
  r({ id: 'armagh', province: 'Ulster', settlement: 'Armagh', lon: -6.65, lat: 54.35, terrain: 'hills', resource: 'timber', tier: 'village', port: true, owner: 'ireland', population: 4, fertility: 0.8 }),

  // ======================= Scandinavia =======================
  r({ id: 'roskilde', province: 'Zealand', settlement: 'Roskilde', lon: 12.08, lat: 55.64, terrain: 'farmland', resource: 'grain', tier: 'town', port: true, owner: 'denmark', population: 7, fertility: 1.2 }),
  r({ id: 'aarhus', province: 'Jutland', settlement: 'Aarhus', lon: 10.2, lat: 56.16, terrain: 'farmland', resource: 'grain', tier: 'village', port: true, owner: 'denmark', population: 5, fertility: 1.1 }),
  r({ id: 'lund', province: 'Scania', settlement: 'Lund', lon: 13.19, lat: 55.7, terrain: 'farmland', resource: 'grain', tier: 'town', port: true, owner: 'denmark', population: 6, fertility: 1.2 }),
  r({ id: 'oslo', province: 'Viken', settlement: 'Oslo', lon: 10.75, lat: 59.91, terrain: 'forest', resource: 'timber', tier: 'village', port: true, owner: 'norway', population: 4, fertility: 0.7 }),
  r({ id: 'bergen', province: 'Hordaland', settlement: 'Bergen', lon: 5.32, lat: 60.39, terrain: 'mountains', resource: 'fish', tier: 'town', port: true, owner: 'norway', population: 5, fertility: 0.5 }),
  r({ id: 'trondheim', province: 'Trondelag', settlement: 'Trondheim', lon: 10.39, lat: 63.43, terrain: 'mountains', resource: 'furs', tier: 'town', port: true, owner: 'norway', population: 4, fertility: 0.5 }),
  r({ id: 'sigtuna', province: 'Svealand', settlement: 'Sigtuna', lon: 17.72, lat: 59.62, terrain: 'forest', resource: 'iron', tier: 'town', port: true, owner: 'sweden', population: 5, fertility: 0.8 }),
  r({ id: 'skara', province: 'Vastergotland', settlement: 'Skara', lon: 13.44, lat: 58.39, terrain: 'farmland', resource: 'grain', tier: 'village', port: false, owner: 'sweden', population: 4, fertility: 1.0 }),
  r({ id: 'kalmar', province: 'Smaland', settlement: 'Kalmar', lon: 16.36, lat: 56.66, terrain: 'forest', resource: 'timber', tier: 'village', port: true, owner: 'sweden', population: 3, fertility: 0.8 }),
  r({ id: 'visby', province: 'Gotland', settlement: 'Visby', lon: 18.3, lat: 57.64, terrain: 'coastal', resource: 'amber', tier: 'village', port: true, owner: 'independent', population: 4, fertility: 0.8 }),
  r({ id: 'turku', province: 'Finland', settlement: 'Turku', lon: 22.27, lat: 60.45, terrain: 'forest', resource: 'furs', tier: 'village', port: true, owner: 'independent', population: 3, fertility: 0.6 }),

  // ======================= Low Countries and the Empire =======================
  r({ id: 'bruges', province: 'Flanders', settlement: 'Bruges', lon: 3.22, lat: 51.21, terrain: 'farmland', resource: 'wool', tier: 'town', port: true, owner: 'france', population: 10, fertility: 1.3 }),
  r({ id: 'utrecht', province: 'Frisia', settlement: 'Utrecht', lon: 5.12, lat: 52.09, terrain: 'marsh', resource: 'grain', tier: 'town', port: true, owner: 'hre', population: 7, fertility: 1.1 }),
  r({ id: 'cologne', province: 'Lower Lorraine', settlement: 'Cologne', lon: 6.96, lat: 50.94, terrain: 'farmland', resource: 'wine', tier: 'large_town', port: true, owner: 'hre', population: 14, fertility: 1.2 }),
  r({ id: 'mainz', province: 'Franconia', settlement: 'Mainz', lon: 8.25, lat: 49.99, terrain: 'farmland', resource: 'wine', tier: 'town', port: false, owner: 'hre', population: 9, fertility: 1.2 }),
  r({ id: 'trier', province: 'Upper Lorraine', settlement: 'Trier', lon: 6.64, lat: 49.76, terrain: 'hills', resource: 'wine', tier: 'village', port: false, owner: 'hre', population: 5, fertility: 1.0 }),
  r({ id: 'strasbourg', province: 'Alsace', settlement: 'Strasbourg', lon: 7.75, lat: 48.57, terrain: 'farmland', resource: 'grain', tier: 'town', port: false, owner: 'hre', population: 8, fertility: 1.2 }),
  r({ id: 'nuremberg', province: 'Nordgau', settlement: 'Nuremberg', lon: 11.08, lat: 49.45, terrain: 'forest', resource: 'iron', tier: 'village', port: false, owner: 'hre', population: 5, fertility: 0.9 }),
  r({ id: 'regensburg', province: 'Bavaria', settlement: 'Regensburg', lon: 12.1, lat: 49.02, terrain: 'farmland', resource: 'salt', tier: 'town', port: false, owner: 'hre', population: 9, fertility: 1.1 }),
  r({ id: 'augsburg', province: 'Swabia', settlement: 'Augsburg', lon: 10.9, lat: 48.37, terrain: 'hills', resource: 'wool', tier: 'town', port: false, owner: 'hre', population: 7, fertility: 1.0 }),
  r({ id: 'salzburg', province: 'Carinthia', settlement: 'Salzburg', lon: 13.04, lat: 47.8, terrain: 'mountains', resource: 'salt', tier: 'village', port: false, owner: 'hre', population: 4, fertility: 0.7 }),
  r({ id: 'brixen', province: 'Tyrol', settlement: 'Brixen', lon: 11.66, lat: 46.72, terrain: 'mountains', resource: 'silver', tier: 'village', port: false, owner: 'hre', population: 3, fertility: 0.6 }),
  r({ id: 'zurich', province: 'Zurichgau', settlement: 'Zurich', lon: 8.54, lat: 47.37, terrain: 'hills', resource: 'wool', tier: 'village', port: false, owner: 'hre', population: 4, fertility: 0.9 }),
  r({ id: 'schwyz', province: 'Inner Switzerland', settlement: 'Schwyz', lon: 8.65, lat: 47.02, terrain: 'mountains', resource: 'none', tier: 'village', port: false, owner: 'hre', population: 2, fertility: 0.6 }),
  r({ id: 'vienna', province: 'Austria', settlement: 'Vienna', lon: 16.37, lat: 48.21, terrain: 'farmland', resource: 'wine', tier: 'town', port: false, owner: 'hre', population: 6, fertility: 1.2 }),
  r({ id: 'hamburg', province: 'Nordalbingia', settlement: 'Hamburg', lon: 9.99, lat: 53.55, terrain: 'marsh', resource: 'fish', tier: 'village', port: true, owner: 'hre', population: 5, fertility: 0.9 }),
  r({ id: 'bremen', province: 'Saxony', settlement: 'Bremen', lon: 8.8, lat: 53.08, terrain: 'marsh', resource: 'grain', tier: 'town', port: true, owner: 'hre', population: 6, fertility: 1.0 }),
  r({ id: 'magdeburg', province: 'Eastphalia', settlement: 'Magdeburg', lon: 11.63, lat: 52.13, terrain: 'farmland', resource: 'grain', tier: 'town', port: false, owner: 'hre', population: 7, fertility: 1.1 }),
  r({ id: 'meissen', province: 'Meissen', settlement: 'Meissen', lon: 13.47, lat: 51.16, terrain: 'hills', resource: 'silver', tier: 'village', port: false, owner: 'hre', population: 4, fertility: 0.9 }),
  r({ id: 'erfurt', province: 'Thuringia', settlement: 'Erfurt', lon: 11.03, lat: 50.98, terrain: 'farmland', resource: 'dyes', tier: 'town', port: false, owner: 'hre', population: 6, fertility: 1.1 }),
  r({ id: 'oldenburg', province: 'Wagria', settlement: 'Oldenburg', lon: 10.89, lat: 54.29, terrain: 'coastal', resource: 'fish', tier: 'village', port: true, owner: 'independent', population: 3, fertility: 0.9 }),
  r({ id: 'brandenburg', province: 'Brandenburg', settlement: 'Brandenburg', lon: 12.55, lat: 52.41, terrain: 'marsh', resource: 'timber', tier: 'village', port: false, owner: 'independent', population: 3, fertility: 0.8 }),
  r({ id: 'stettin', province: 'Pomerania', settlement: 'Stettin', lon: 14.55, lat: 53.43, terrain: 'marsh', resource: 'fish', tier: 'village', port: true, owner: 'independent', population: 4, fertility: 0.9 }),

  // ======================= France =======================
  r({ id: 'paris', province: 'Ile-de-France', settlement: 'Paris', lon: 2.35, lat: 48.86, terrain: 'farmland', resource: 'grain', tier: 'large_town', port: false, owner: 'france', population: 15, fertility: 1.4 }),
  r({ id: 'orleans', province: 'Orleanais', settlement: 'Orleans', lon: 1.9, lat: 47.9, terrain: 'farmland', resource: 'grain', tier: 'town', port: false, owner: 'france', population: 8, fertility: 1.3 }),
  r({ id: 'reims', province: 'Champagne', settlement: 'Reims', lon: 4.03, lat: 49.26, terrain: 'farmland', resource: 'wine', tier: 'town', port: false, owner: 'france', population: 8, fertility: 1.2 }),
  r({ id: 'rouen', province: 'Normandy', settlement: 'Rouen', lon: 1.1, lat: 49.44, terrain: 'farmland', resource: 'grain', tier: 'town', port: true, owner: 'england', population: 10, fertility: 1.3 }),
  r({ id: 'rennes', province: 'Brittany', settlement: 'Rennes', lon: -1.68, lat: 48.11, terrain: 'forest', resource: 'timber', tier: 'village', port: false, owner: 'independent', population: 5, fertility: 1.0 }),
  r({ id: 'nantes', province: 'Nantais', settlement: 'Nantes', lon: -1.55, lat: 47.22, terrain: 'coastal', resource: 'salt', tier: 'village', port: true, owner: 'independent', population: 5, fertility: 1.0 }),
  r({ id: 'angers', province: 'Anjou', settlement: 'Angers', lon: -0.55, lat: 47.47, terrain: 'farmland', resource: 'wine', tier: 'town', port: false, owner: 'france', population: 6, fertility: 1.2 }),
  r({ id: 'poitiers', province: 'Poitou', settlement: 'Poitiers', lon: 0.34, lat: 46.58, terrain: 'farmland', resource: 'wine', tier: 'town', port: false, owner: 'france', population: 7, fertility: 1.2 }),
  r({ id: 'bordeaux', province: 'Aquitaine', settlement: 'Bordeaux', lon: -0.58, lat: 44.84, terrain: 'farmland', resource: 'wine', tier: 'town', port: true, owner: 'france', population: 9, fertility: 1.2 }),
  r({ id: 'toulouse', province: 'Languedoc', settlement: 'Toulouse', lon: 1.44, lat: 43.6, terrain: 'farmland', resource: 'grain', tier: 'town', port: false, owner: 'france', population: 8, fertility: 1.2 }),
  r({ id: 'clermont', province: 'Auvergne', settlement: 'Clermont', lon: 3.08, lat: 45.78, terrain: 'mountains', resource: 'iron', tier: 'village', port: false, owner: 'france', population: 4, fertility: 0.8 }),
  r({ id: 'dijon', province: 'Burgundy', settlement: 'Dijon', lon: 5.04, lat: 47.32, terrain: 'farmland', resource: 'wine', tier: 'town', port: false, owner: 'france', population: 7, fertility: 1.2 }),
  r({ id: 'besancon', province: 'Franche-Comte', settlement: 'Besancon', lon: 6.02, lat: 47.24, terrain: 'hills', resource: 'salt', tier: 'village', port: false, owner: 'hre', population: 4, fertility: 1.0 }),
  r({ id: 'lyon', province: 'Lyonnais', settlement: 'Lyon', lon: 4.84, lat: 45.76, terrain: 'hills', resource: 'wine', tier: 'town', port: false, owner: 'hre', population: 8, fertility: 1.1 }),
  r({ id: 'marseille', province: 'Provence', settlement: 'Marseille', lon: 5.37, lat: 43.3, terrain: 'coastal', resource: 'fish', tier: 'town', port: true, owner: 'hre', population: 8, fertility: 0.9 }),

  // ======================= Iberia =======================
  r({ id: 'leon', province: 'Leon', settlement: 'Leon', lon: -5.57, lat: 42.6, terrain: 'hills', resource: 'wool', tier: 'town', port: false, owner: 'castile', population: 7, fertility: 0.9 }),
  r({ id: 'burgos', province: 'Castile', settlement: 'Burgos', lon: -3.7, lat: 42.34, terrain: 'hills', resource: 'wool', tier: 'town', port: false, owner: 'castile', population: 7, fertility: 0.9 }),
  r({ id: 'santiago', province: 'Galicia', settlement: 'Santiago', lon: -8.54, lat: 42.88, terrain: 'hills', resource: 'fish', tier: 'town', port: true, owner: 'castile', population: 6, fertility: 0.9 }),
  r({ id: 'porto', province: 'Portucale', settlement: 'Porto', lon: -8.61, lat: 41.15, terrain: 'coastal', resource: 'wine', tier: 'village', port: true, owner: 'castile', population: 5, fertility: 1.0 }),
  r({ id: 'lisbon', province: 'Estremadura', settlement: 'Lisbon', lon: -9.14, lat: 38.72, terrain: 'coastal', resource: 'fish', tier: 'town', port: true, owner: 'independent', population: 8, fertility: 1.0 }),
  r({ id: 'badajoz', province: 'Badajoz', settlement: 'Badajoz', lon: -6.97, lat: 38.88, terrain: 'plains', resource: 'grain', tier: 'town', port: false, owner: 'independent', population: 6, fertility: 1.0 }),
  r({ id: 'toledo', province: 'Toledo', settlement: 'Toledo', lon: -4.03, lat: 39.86, terrain: 'hills', resource: 'iron', tier: 'large_town', port: false, owner: 'independent', population: 12, fertility: 0.9 }),
  r({ id: 'seville', province: 'Seville', settlement: 'Seville', lon: -5.98, lat: 37.39, terrain: 'farmland', resource: 'grain', tier: 'large_town', port: true, owner: 'taifa_seville', population: 14, fertility: 1.3 }),
  r({ id: 'cordoba', province: 'Cordoba', settlement: 'Cordoba', lon: -4.78, lat: 37.89, terrain: 'farmland', resource: 'wine', tier: 'large_town', port: false, owner: 'taifa_seville', population: 15, fertility: 1.2 }),
  r({ id: 'granada', province: 'Granada', settlement: 'Granada', lon: -3.6, lat: 37.18, terrain: 'mountains', resource: 'silk', tier: 'town', port: false, owner: 'independent', population: 9, fertility: 0.9 }),
  r({ id: 'malaga', province: 'Malaga', settlement: 'Malaga', lon: -4.42, lat: 36.72, terrain: 'coastal', resource: 'wine', tier: 'town', port: true, owner: 'independent', population: 7, fertility: 1.0 }),
  r({ id: 'valencia', province: 'Valencia', settlement: 'Valencia', lon: -0.38, lat: 39.47, terrain: 'coastal', resource: 'silk', tier: 'town', port: true, owner: 'independent', population: 9, fertility: 1.2 }),
  r({ id: 'zaragoza', province: 'Zaragoza', settlement: 'Zaragoza', lon: -0.89, lat: 41.65, terrain: 'farmland', resource: 'grain', tier: 'town', port: false, owner: 'taifa_zaragoza', population: 9, fertility: 1.1 }),
  r({ id: 'jaca', province: 'Aragon', settlement: 'Jaca', lon: -0.55, lat: 42.57, terrain: 'mountains', resource: 'wool', tier: 'village', port: false, owner: 'aragon', population: 3, fertility: 0.7 }),
  r({ id: 'pamplona', province: 'Navarre', settlement: 'Pamplona', lon: -1.64, lat: 42.82, terrain: 'mountains', resource: 'wool', tier: 'town', port: false, owner: 'navarre', population: 5, fertility: 0.8 }),
  r({ id: 'barcelona', province: 'Catalonia', settlement: 'Barcelona', lon: 2.17, lat: 41.39, terrain: 'coastal', resource: 'wool', tier: 'town', port: true, owner: 'independent', population: 9, fertility: 1.1 }),
  r({ id: 'palma', province: 'Balearics', settlement: 'Palma', lon: 2.65, lat: 39.57, terrain: 'coastal', resource: 'salt', tier: 'village', port: true, owner: 'independent', population: 4, fertility: 0.9 }),

  // ======================= Italy =======================
  r({ id: 'milan', province: 'Lombardy', settlement: 'Milan', lon: 9.19, lat: 45.46, terrain: 'farmland', resource: 'iron', tier: 'large_town', port: false, owner: 'milan', population: 14, fertility: 1.4 }),
  r({ id: 'turin', province: 'Savoy', settlement: 'Turin', lon: 7.69, lat: 45.07, terrain: 'hills', resource: 'grain', tier: 'village', port: false, owner: 'hre', population: 5, fertility: 1.1 }),
  r({ id: 'genoa', province: 'Liguria', settlement: 'Genoa', lon: 8.93, lat: 44.41, terrain: 'coastal', resource: 'marble', tier: 'town', port: true, owner: 'genoa', population: 9, fertility: 0.8 }),
  r({ id: 'venice', province: 'Veneto', settlement: 'Venice', lon: 12.33, lat: 45.44, terrain: 'marsh', resource: 'salt', tier: 'large_town', port: true, owner: 'venice', population: 15, fertility: 0.7 }),
  r({ id: 'verona', province: 'Verona', settlement: 'Verona', lon: 10.99, lat: 45.44, terrain: 'farmland', resource: 'wine', tier: 'town', port: false, owner: 'hre', population: 8, fertility: 1.3 }),
  r({ id: 'bologna', province: 'Romagna', settlement: 'Bologna', lon: 11.34, lat: 44.49, terrain: 'farmland', resource: 'grain', tier: 'town', port: false, owner: 'papal_states', population: 9, fertility: 1.3 }),
  r({ id: 'ravenna', province: 'Ravenna', settlement: 'Ravenna', lon: 12.2, lat: 44.42, terrain: 'marsh', resource: 'salt', tier: 'town', port: true, owner: 'papal_states', population: 7, fertility: 1.0 }),
  r({ id: 'florence', province: 'Tuscany', settlement: 'Florence', lon: 11.26, lat: 43.77, terrain: 'hills', resource: 'wool', tier: 'town', port: false, owner: 'independent', population: 9, fertility: 1.1 }),
  r({ id: 'pisa', province: 'Pisa', settlement: 'Pisa', lon: 10.4, lat: 43.72, terrain: 'coastal', resource: 'marble', tier: 'town', port: true, owner: 'pisa', population: 8, fertility: 1.0 }),
  r({ id: 'siena', province: 'Siena', settlement: 'Siena', lon: 11.33, lat: 43.32, terrain: 'hills', resource: 'wool', tier: 'village', port: false, owner: 'independent', population: 5, fertility: 1.0 }),
  r({ id: 'rome', province: 'Latium', settlement: 'Rome', lon: 12.5, lat: 41.9, terrain: 'farmland', resource: 'marble', tier: 'large_town', port: true, owner: 'papal_states', population: 13, fertility: 1.0 }),
  r({ id: 'naples', province: 'Campania', settlement: 'Naples', lon: 14.27, lat: 40.85, terrain: 'farmland', resource: 'wine', tier: 'large_town', port: true, owner: 'sicily', population: 13, fertility: 1.3 }),
  r({ id: 'salerno', province: 'Salerno', settlement: 'Salerno', lon: 14.77, lat: 40.68, terrain: 'coastal', resource: 'grain', tier: 'town', port: true, owner: 'sicily', population: 7, fertility: 1.1 }),
  r({ id: 'bari', province: 'Apulia', settlement: 'Bari', lon: 16.87, lat: 41.12, terrain: 'coastal', resource: 'grain', tier: 'town', port: true, owner: 'sicily', population: 8, fertility: 1.1 }),
  r({ id: 'taranto', province: 'Calabria', settlement: 'Taranto', lon: 17.24, lat: 40.47, terrain: 'coastal', resource: 'fish', tier: 'village', port: true, owner: 'sicily', population: 5, fertility: 1.0 }),
  r({ id: 'palermo', province: 'Sicily', settlement: 'Palermo', lon: 13.36, lat: 38.12, terrain: 'coastal', resource: 'grain', tier: 'large_town', port: true, owner: 'sicily', population: 12, fertility: 1.2 }),
  r({ id: 'messina', province: 'Messina', settlement: 'Messina', lon: 15.55, lat: 38.19, terrain: 'coastal', resource: 'fish', tier: 'town', port: true, owner: 'sicily', population: 6, fertility: 1.0 }),
  r({ id: 'syracuse', province: 'Syracuse', settlement: 'Syracuse', lon: 15.28, lat: 37.08, terrain: 'coastal', resource: 'grain', tier: 'town', port: true, owner: 'independent', population: 6, fertility: 1.1 }),
  r({ id: 'cagliari', province: 'Sardinia', settlement: 'Cagliari', lon: 9.12, lat: 39.22, terrain: 'coastal', resource: 'silver', tier: 'village', port: true, owner: 'independent', population: 4, fertility: 0.9 }),
  r({ id: 'ajaccio', province: 'Corsica', settlement: 'Ajaccio', lon: 8.74, lat: 41.93, terrain: 'mountains', resource: 'timber', tier: 'village', port: true, owner: 'pisa', population: 3, fertility: 0.7 }),
  r({ id: 'mdina', province: 'Malta', settlement: 'Mdina', lon: 14.4, lat: 35.89, terrain: 'coastal', resource: 'fish', tier: 'village', port: true, owner: 'independent', population: 2, fertility: 0.7 }),

  // ======================= Poland, Bohemia, the Baltic =======================
  r({ id: 'krakow', province: 'Lesser Poland', settlement: 'Krakow', lon: 19.94, lat: 50.06, terrain: 'farmland', resource: 'salt', tier: 'town', port: false, owner: 'poland', population: 7, fertility: 1.1 }),
  r({ id: 'gniezno', province: 'Greater Poland', settlement: 'Gniezno', lon: 17.59, lat: 52.54, terrain: 'farmland', resource: 'grain', tier: 'town', port: false, owner: 'poland', population: 6, fertility: 1.1 }),
  r({ id: 'wroclaw', province: 'Silesia', settlement: 'Wroclaw', lon: 17.03, lat: 51.11, terrain: 'farmland', resource: 'grain', tier: 'town', port: false, owner: 'poland', population: 6, fertility: 1.1 }),
  r({ id: 'plock', province: 'Masovia', settlement: 'Plock', lon: 19.71, lat: 52.55, terrain: 'forest', resource: 'timber', tier: 'village', port: false, owner: 'poland', population: 4, fertility: 0.9 }),
  r({ id: 'gdansk', province: 'Pomerelia', settlement: 'Gdansk', lon: 18.65, lat: 54.35, terrain: 'coastal', resource: 'amber', tier: 'village', port: true, owner: 'independent', population: 4, fertility: 0.9 }),
  r({ id: 'prague', province: 'Bohemia', settlement: 'Prague', lon: 14.44, lat: 50.08, terrain: 'hills', resource: 'silver', tier: 'large_town', port: false, owner: 'bohemia', population: 11, fertility: 1.1 }),
  r({ id: 'olomouc', province: 'Moravia', settlement: 'Olomouc', lon: 17.25, lat: 49.59, terrain: 'hills', resource: 'iron', tier: 'village', port: false, owner: 'bohemia', population: 5, fertility: 1.0 }),
  r({ id: 'prussia', province: 'Prussia', settlement: 'Balga', lon: 19.4, lat: 54.56, terrain: 'forest', resource: 'amber', tier: 'village', port: true, owner: 'independent', population: 3, fertility: 0.8 }),
  r({ id: 'semigallia', province: 'Semigallia', settlement: 'Mezotne', lon: 24.11, lat: 56.47, terrain: 'forest', resource: 'furs', tier: 'village', port: true, owner: 'independent', population: 3, fertility: 0.8 }),
  r({ id: 'vilnius', province: 'Aukstaitija', settlement: 'Vilnius', lon: 25.28, lat: 54.69, terrain: 'forest', resource: 'amber', tier: 'village', port: false, owner: 'independent', population: 3, fertility: 0.8 }),
  r({ id: 'reval', province: 'Estonia', settlement: 'Reval', lon: 24.75, lat: 59.44, terrain: 'coastal', resource: 'fish', tier: 'village', port: true, owner: 'independent', population: 3, fertility: 0.7 }),

  // ======================= Rus =======================
  r({ id: 'novgorod', province: 'Novgorod', settlement: 'Novgorod', lon: 31.27, lat: 58.52, terrain: 'forest', resource: 'furs', tier: 'large_town', port: true, owner: 'kievan_rus', population: 11, fertility: 0.8 }),
  r({ id: 'pskov', province: 'Pskov', settlement: 'Pskov', lon: 28.33, lat: 57.82, terrain: 'forest', resource: 'timber', tier: 'village', port: false, owner: 'kievan_rus', population: 4, fertility: 0.8 }),
  r({ id: 'polotsk', province: 'Polotsk', settlement: 'Polotsk', lon: 28.8, lat: 55.49, terrain: 'forest', resource: 'furs', tier: 'village', port: false, owner: 'kievan_rus', population: 4, fertility: 0.8 }),
  r({ id: 'smolensk', province: 'Smolensk', settlement: 'Smolensk', lon: 32.05, lat: 54.78, terrain: 'forest', resource: 'furs', tier: 'town', port: false, owner: 'kievan_rus', population: 6, fertility: 0.9 }),
  r({ id: 'kiev', province: 'Kiev', settlement: 'Kiev', lon: 30.52, lat: 50.45, terrain: 'farmland', resource: 'grain', tier: 'large_town', port: true, owner: 'kievan_rus', population: 13, fertility: 1.3 }),
  r({ id: 'chernigov', province: 'Chernigov', settlement: 'Chernigov', lon: 31.29, lat: 51.49, terrain: 'forest', resource: 'timber', tier: 'town', port: false, owner: 'kievan_rus', population: 6, fertility: 1.1 }),
  r({ id: 'galich', province: 'Galicia', settlement: 'Halych', lon: 24.72, lat: 49.12, terrain: 'hills', resource: 'salt', tier: 'village', port: false, owner: 'kievan_rus', population: 5, fertility: 1.0 }),
  r({ id: 'suzdal', province: 'Suzdalia', settlement: 'Suzdal', lon: 40.44, lat: 56.42, terrain: 'forest', resource: 'furs', tier: 'village', port: false, owner: 'kievan_rus', population: 4, fertility: 0.8 }),
  r({ id: 'ryazan', province: 'Ryazan', settlement: 'Ryazan', lon: 39.74, lat: 54.63, terrain: 'forest', resource: 'timber', tier: 'village', port: false, owner: 'kievan_rus', population: 4, fertility: 0.9 }),
  r({ id: 'moscow', province: 'Moskva', settlement: 'Moscow', lon: 37.62, lat: 55.75, terrain: 'forest', resource: 'timber', tier: 'village', port: false, owner: 'independent', population: 2, fertility: 0.8 }),

  // ======================= The steppe =======================
  r({ id: 'podolia', province: 'Podolia', settlement: 'Bakota', lon: 27.2, lat: 48.6, terrain: 'steppe', resource: 'horses', tier: 'village', port: false, owner: 'cumans', population: 2, fertility: 1.0 }),
  r({ id: 'donets', province: 'Donets Steppe', settlement: 'Sharukan', lon: 37.0, lat: 48.8, terrain: 'steppe', resource: 'horses', tier: 'village', port: false, owner: 'cumans', population: 2, fertility: 0.8 }),
  r({ id: 'azov', province: 'Tana', settlement: 'Azak', lon: 39.42, lat: 47.11, terrain: 'steppe', resource: 'fish', tier: 'village', port: true, owner: 'cumans', population: 3, fertility: 0.8 }),
  r({ id: 'soldaia', province: 'Crimea', settlement: 'Soldaia', lon: 34.97, lat: 44.85, terrain: 'coastal', resource: 'wine', tier: 'village', port: true, owner: 'cumans', population: 3, fertility: 0.9 }),
  r({ id: 'cherson', province: 'Cherson', settlement: 'Cherson', lon: 33.52, lat: 44.61, terrain: 'coastal', resource: 'fish', tier: 'village', port: true, owner: 'byzantium', population: 4, fertility: 0.8 }),
  r({ id: 'saksin', province: 'Lower Volga', settlement: 'Saksin', lon: 47.5, lat: 46.5, terrain: 'steppe', resource: 'salt', tier: 'village', port: true, owner: 'volga_bulgaria', population: 3, fertility: 0.6 }),
  r({ id: 'bolghar', province: 'Volga Bulgaria', settlement: 'Bolghar', lon: 49.03, lat: 54.98, terrain: 'forest', resource: 'furs', tier: 'town', port: true, owner: 'volga_bulgaria', population: 6, fertility: 0.9 }),

  // ======================= Hungary and the Carpathians =======================
  r({ id: 'esztergom', province: 'Hungary', settlement: 'Esztergom', lon: 18.74, lat: 47.79, terrain: 'farmland', resource: 'grain', tier: 'large_town', port: false, owner: 'hungary', population: 9, fertility: 1.3 }),
  r({ id: 'szekesfehervar', province: 'Transdanubia', settlement: 'Szekesfehervar', lon: 18.41, lat: 47.19, terrain: 'plains', resource: 'horses', tier: 'town', port: false, owner: 'hungary', population: 6, fertility: 1.2 }),
  r({ id: 'pozsony', province: 'Nyitra', settlement: 'Pozsony', lon: 17.11, lat: 48.15, terrain: 'farmland', resource: 'wine', tier: 'village', port: false, owner: 'hungary', population: 5, fertility: 1.2 }),
  r({ id: 'pecs', province: 'Baranya', settlement: 'Pecs', lon: 18.23, lat: 46.07, terrain: 'hills', resource: 'wine', tier: 'village', port: false, owner: 'hungary', population: 5, fertility: 1.2 }),
  r({ id: 'szeged', province: 'Alfold', settlement: 'Szeged', lon: 20.15, lat: 46.25, terrain: 'plains', resource: 'grain', tier: 'village', port: false, owner: 'hungary', population: 4, fertility: 1.2 }),
  r({ id: 'bihar', province: 'Bihar', settlement: 'Bihar', lon: 21.9, lat: 47.1, terrain: 'plains', resource: 'grain', tier: 'village', port: false, owner: 'hungary', population: 4, fertility: 1.1 }),
  r({ id: 'cluj', province: 'Transylvania', settlement: 'Kolozsvar', lon: 23.6, lat: 46.77, terrain: 'mountains', resource: 'gold', tier: 'village', port: false, owner: 'hungary', population: 4, fertility: 0.9 }),

  // ======================= Croatia, Bosnia, the Adriatic =======================
  r({ id: 'knin', province: 'Croatia', settlement: 'Knin', lon: 16.2, lat: 44.04, terrain: 'mountains', resource: 'wool', tier: 'town', port: false, owner: 'croatia', population: 5, fertility: 0.8 }),
  r({ id: 'zagreb', province: 'Slavonia', settlement: 'Zagreb', lon: 15.98, lat: 45.81, terrain: 'hills', resource: 'timber', tier: 'village', port: false, owner: 'croatia', population: 4, fertility: 1.1 }),
  r({ id: 'split', province: 'Dalmatia', settlement: 'Split', lon: 16.44, lat: 43.51, terrain: 'coastal', resource: 'marble', tier: 'town', port: true, owner: 'croatia', population: 6, fertility: 0.8 }),
  r({ id: 'zadar', province: 'Northern Dalmatia', settlement: 'Zadar', lon: 15.23, lat: 44.12, terrain: 'coastal', resource: 'fish', tier: 'town', port: true, owner: 'croatia', population: 6, fertility: 0.8 }),
  r({ id: 'dubrovnik', province: 'Ragusa', settlement: 'Dubrovnik', lon: 18.09, lat: 42.65, terrain: 'coastal', resource: 'salt', tier: 'town', port: true, owner: 'ragusa', population: 5, fertility: 0.7 }),
  r({ id: 'vrhbosna', province: 'Bosnia', settlement: 'Vrhbosna', lon: 18.41, lat: 43.86, terrain: 'mountains', resource: 'silver', tier: 'village', port: false, owner: 'independent', population: 3, fertility: 0.8 }),
  r({ id: 'hum', province: 'Hum', settlement: 'Blagaj', lon: 17.9, lat: 43.26, terrain: 'mountains', resource: 'wool', tier: 'village', port: false, owner: 'independent', population: 3, fertility: 0.7 }),
  r({ id: 'kotor', province: 'Duklja', settlement: 'Kotor', lon: 18.77, lat: 42.42, terrain: 'mountains', resource: 'fish', tier: 'village', port: true, owner: 'serbia', population: 3, fertility: 0.7 }),

  // ======================= Serbia, Bulgaria, the southern Balkans =======================
  r({ id: 'ras', province: 'Raska', settlement: 'Ras', lon: 20.52, lat: 43.14, terrain: 'mountains', resource: 'silver', tier: 'village', port: false, owner: 'serbia', population: 4, fertility: 0.8 }),
  r({ id: 'belgrade', province: 'Belgrade', settlement: 'Belgrade', lon: 20.45, lat: 44.79, terrain: 'plains', resource: 'grain', tier: 'town', port: true, owner: 'byzantium', population: 6, fertility: 1.2 }),
  r({ id: 'nis', province: 'Nis', settlement: 'Nis', lon: 21.9, lat: 43.32, terrain: 'hills', resource: 'iron', tier: 'town', port: false, owner: 'byzantium', population: 5, fertility: 1.0 }),
  r({ id: 'skopje', province: 'Macedonia', settlement: 'Skopje', lon: 21.43, lat: 41.99, terrain: 'hills', resource: 'iron', tier: 'town', port: false, owner: 'byzantium', population: 6, fertility: 1.0 }),
  r({ id: 'ohrid', province: 'Ohrid', settlement: 'Ohrid', lon: 20.8, lat: 41.11, terrain: 'mountains', resource: 'fish', tier: 'town', port: false, owner: 'byzantium', population: 5, fertility: 0.9 }),
  r({ id: 'sredets', province: 'Sredets', settlement: 'Sredets', lon: 23.32, lat: 42.7, terrain: 'plains', resource: 'iron', tier: 'town', port: false, owner: 'byzantium', population: 6, fertility: 1.1 }),
  r({ id: 'tarnovo', province: 'Moesia', settlement: 'Tarnovo', lon: 25.63, lat: 43.08, terrain: 'hills', resource: 'grain', tier: 'village', port: false, owner: 'byzantium', population: 4, fertility: 1.1 }),
  r({ id: 'vidin', province: 'Vidin', settlement: 'Vidin', lon: 22.88, lat: 43.99, terrain: 'plains', resource: 'grain', tier: 'village', port: true, owner: 'byzantium', population: 4, fertility: 1.1 }),
  r({ id: 'varna', province: 'Varna', settlement: 'Varna', lon: 27.91, lat: 43.2, terrain: 'coastal', resource: 'grain', tier: 'town', port: true, owner: 'byzantium', population: 5, fertility: 1.1 }),
  r({ id: 'durres', province: 'Dyrrachium', settlement: 'Durres', lon: 19.45, lat: 41.32, terrain: 'coastal', resource: 'fish', tier: 'town', port: true, owner: 'byzantium', population: 6, fertility: 0.9 }),
  r({ id: 'kruje', province: 'Albania', settlement: 'Kruje', lon: 19.79, lat: 41.51, terrain: 'mountains', resource: 'wool', tier: 'village', port: false, owner: 'byzantium', population: 3, fertility: 0.7 }),
  r({ id: 'targoviste', province: 'Wallachia', settlement: 'Targoviste', lon: 25.46, lat: 44.93, terrain: 'plains', resource: 'grain', tier: 'village', port: false, owner: 'cumans', population: 3, fertility: 1.1 }),
  r({ id: 'suceava', province: 'Moldavia', settlement: 'Suceava', lon: 26.26, lat: 47.65, terrain: 'forest', resource: 'timber', tier: 'village', port: false, owner: 'cumans', population: 3, fertility: 1.0 }),

  // ======================= Greece =======================
  r({ id: 'thessaloniki', province: 'Thessalonica', settlement: 'Thessaloniki', lon: 22.94, lat: 40.64, terrain: 'coastal', resource: 'grain', tier: 'large_town', port: true, owner: 'byzantium', population: 11, fertility: 1.2 }),
  r({ id: 'larissa', province: 'Thessaly', settlement: 'Larissa', lon: 22.42, lat: 39.64, terrain: 'farmland', resource: 'horses', tier: 'town', port: false, owner: 'byzantium', population: 5, fertility: 1.2 }),
  r({ id: 'ioannina', province: 'Epirus', settlement: 'Ioannina', lon: 20.85, lat: 39.67, terrain: 'mountains', resource: 'wool', tier: 'village', port: false, owner: 'byzantium', population: 4, fertility: 0.8 }),
  r({ id: 'athens', province: 'Attica', settlement: 'Athens', lon: 23.73, lat: 37.98, terrain: 'hills', resource: 'marble', tier: 'town', port: true, owner: 'byzantium', population: 6, fertility: 0.8 }),
  r({ id: 'corinth', province: 'Morea', settlement: 'Corinth', lon: 22.93, lat: 37.94, terrain: 'hills', resource: 'wine', tier: 'town', port: true, owner: 'byzantium', population: 6, fertility: 0.9 }),
  r({ id: 'candia', province: 'Crete', settlement: 'Candia', lon: 25.14, lat: 35.34, terrain: 'coastal', resource: 'wine', tier: 'town', port: true, owner: 'byzantium', population: 6, fertility: 0.9 }),
  r({ id: 'nicosia', province: 'Cyprus', settlement: 'Nicosia', lon: 33.36, lat: 35.17, terrain: 'hills', resource: 'copper', tier: 'town', port: true, owner: 'byzantium', population: 6, fertility: 1.0 }),
  r({ id: 'rhodes', province: 'Rhodes', settlement: 'Rhodes', lon: 28.22, lat: 36.43, terrain: 'coastal', resource: 'wine', tier: 'village', port: true, owner: 'byzantium', population: 4, fertility: 0.9 }),

  // ======================= Anatolia and Constantinople =======================
  r({ id: 'constantinople', province: 'Thrace', settlement: 'Constantinople', lon: 28.98, lat: 41.01, terrain: 'coastal', resource: 'silk', tier: 'huge_city', port: true, owner: 'byzantium', population: 40, fertility: 1.1 }),
  r({ id: 'adrianople', province: 'Adrianople', settlement: 'Adrianople', lon: 26.56, lat: 41.68, terrain: 'farmland', resource: 'grain', tier: 'town', port: false, owner: 'byzantium', population: 7, fertility: 1.2 }),
  r({ id: 'nicaea', province: 'Bithynia', settlement: 'Nicaea', lon: 29.72, lat: 40.43, terrain: 'farmland', resource: 'wine', tier: 'town', port: true, owner: 'rum', population: 7, fertility: 1.2 }),
  r({ id: 'smyrna', province: 'Ionia', settlement: 'Smyrna', lon: 27.14, lat: 38.42, terrain: 'coastal', resource: 'dyes', tier: 'town', port: true, owner: 'byzantium', population: 7, fertility: 1.1 }),
  r({ id: 'attaleia', province: 'Pamphylia', settlement: 'Attaleia', lon: 30.69, lat: 36.9, terrain: 'coastal', resource: 'timber', tier: 'town', port: true, owner: 'byzantium', population: 5, fertility: 1.0 }),
  r({ id: 'konya', province: 'Lycaonia', settlement: 'Konya', lon: 32.49, lat: 37.87, terrain: 'plains', resource: 'wool', tier: 'town', port: false, owner: 'rum', population: 7, fertility: 0.8 }),
  r({ id: 'ankyra', province: 'Galatia', settlement: 'Ankyra', lon: 32.86, lat: 39.93, terrain: 'plains', resource: 'horses', tier: 'town', port: false, owner: 'rum', population: 5, fertility: 0.8 }),
  r({ id: 'kayseri', province: 'Cappadocia', settlement: 'Kayseri', lon: 35.49, lat: 38.73, terrain: 'mountains', resource: 'silver', tier: 'town', port: false, owner: 'rum', population: 6, fertility: 0.8 }),
  r({ id: 'sebasteia', province: 'Armenia Minor', settlement: 'Sebasteia', lon: 37.02, lat: 39.75, terrain: 'mountains', resource: 'iron', tier: 'village', port: false, owner: 'rum', population: 4, fertility: 0.8 }),
  r({ id: 'sinope', province: 'Paphlagonia', settlement: 'Sinope', lon: 35.15, lat: 42.03, terrain: 'coastal', resource: 'timber', tier: 'village', port: true, owner: 'byzantium', population: 4, fertility: 0.9 }),
  r({ id: 'trebizond', province: 'Chaldia', settlement: 'Trebizond', lon: 39.72, lat: 41.0, terrain: 'coastal', resource: 'silk', tier: 'town', port: true, owner: 'byzantium', population: 7, fertility: 0.9 }),
  r({ id: 'tarsus', province: 'Cilicia', settlement: 'Tarsus', lon: 34.9, lat: 36.92, terrain: 'farmland', resource: 'dyes', tier: 'town', port: true, owner: 'armenia', population: 6, fertility: 1.2 }),
  r({ id: 'sis', province: 'Taurus', settlement: 'Sis', lon: 36.23, lat: 37.79, terrain: 'mountains', resource: 'iron', tier: 'village', port: false, owner: 'armenia', population: 3, fertility: 0.7 }),
  r({ id: 'melitene', province: 'Melitene', settlement: 'Melitene', lon: 38.31, lat: 38.35, terrain: 'hills', resource: 'grain', tier: 'village', port: false, owner: 'seljuks', population: 4, fertility: 1.0 }),
  r({ id: 'erzurum', province: 'Theodosiopolis', settlement: 'Erzurum', lon: 41.28, lat: 39.91, terrain: 'mountains', resource: 'horses', tier: 'village', port: false, owner: 'seljuks', population: 4, fertility: 0.7 }),

  // ======================= Caucasus =======================
  r({ id: 'kutaisi', province: 'Imereti', settlement: 'Kutaisi', lon: 42.7, lat: 42.25, terrain: 'hills', resource: 'timber', tier: 'town', port: false, owner: 'georgia', population: 5, fertility: 1.0 }),
  r({ id: 'tbilisi', province: 'Kartli', settlement: 'Tbilisi', lon: 44.79, lat: 41.72, terrain: 'hills', resource: 'wine', tier: 'town', port: false, owner: 'seljuks', population: 6, fertility: 1.0 }),
  r({ id: 'ani', province: 'Shirak', settlement: 'Ani', lon: 43.57, lat: 40.51, terrain: 'mountains', resource: 'marble', tier: 'village', port: false, owner: 'seljuks', population: 4, fertility: 0.7 }),
  r({ id: 'derbent', province: 'Derbent', settlement: 'Derbent', lon: 48.29, lat: 42.06, terrain: 'coastal', resource: 'salt', tier: 'village', port: true, owner: 'seljuks', population: 3, fertility: 0.8 }),

  // ======================= Levant and Mesopotamia =======================
  r({ id: 'antioch', province: 'Antioch', settlement: 'Antioch', lon: 36.16, lat: 36.2, terrain: 'hills', resource: 'silk', tier: 'large_town', port: true, owner: 'byzantium', population: 11, fertility: 1.2 }),
  r({ id: 'aleppo', province: 'Aleppo', settlement: 'Aleppo', lon: 37.13, lat: 36.2, terrain: 'plains', resource: 'grain', tier: 'town', port: false, owner: 'seljuks', population: 9, fertility: 1.0 }),
  r({ id: 'edessa', province: 'Edessa', settlement: 'Edessa', lon: 38.8, lat: 37.16, terrain: 'plains', resource: 'grain', tier: 'town', port: false, owner: 'seljuks', population: 6, fertility: 1.0 }),
  r({ id: 'mosul', province: 'Jazira', settlement: 'Mosul', lon: 43.13, lat: 36.34, terrain: 'plains', resource: 'grain', tier: 'town', port: true, owner: 'seljuks', population: 8, fertility: 1.1 }),
  r({ id: 'homs', province: 'Homs', settlement: 'Homs', lon: 36.71, lat: 34.73, terrain: 'plains', resource: 'grain', tier: 'village', port: false, owner: 'seljuks', population: 5, fertility: 1.0 }),
  r({ id: 'damascus', province: 'Damascus', settlement: 'Damascus', lon: 36.29, lat: 33.51, terrain: 'desert', resource: 'silk', tier: 'large_town', port: false, owner: 'seljuks', population: 13, fertility: 0.9 }),
  r({ id: 'tripoli_syria', province: 'Tripoli', settlement: 'Tripoli', lon: 35.84, lat: 34.44, terrain: 'coastal', resource: 'silk', tier: 'town', port: true, owner: 'fatimids', population: 7, fertility: 1.0 }),
  r({ id: 'tyre', province: 'Tyre', settlement: 'Tyre', lon: 35.2, lat: 33.27, terrain: 'coastal', resource: 'dyes', tier: 'town', port: true, owner: 'fatimids', population: 6, fertility: 1.0 }),
  r({ id: 'acre', province: 'Galilee', settlement: 'Acre', lon: 35.08, lat: 32.93, terrain: 'coastal', resource: 'fish', tier: 'town', port: true, owner: 'fatimids', population: 6, fertility: 1.0 }),
  r({ id: 'jerusalem', province: 'Judea', settlement: 'Jerusalem', lon: 35.22, lat: 31.78, terrain: 'hills', resource: 'wine', tier: 'town', port: false, owner: 'fatimids', population: 7, fertility: 0.8 }),
  r({ id: 'ascalon', province: 'Ascalon', settlement: 'Ascalon', lon: 34.55, lat: 31.67, terrain: 'coastal', resource: 'grain', tier: 'village', port: true, owner: 'fatimids', population: 4, fertility: 1.0 }),
  r({ id: 'baghdad', province: 'Iraq', settlement: 'Baghdad', lon: 44.36, lat: 33.31, terrain: 'desert', resource: 'silk', tier: 'huge_city', port: true, owner: 'abbasids', population: 35, fertility: 1.1 }),
  r({ id: 'basra', province: 'Basra', settlement: 'Basra', lon: 47.81, lat: 30.51, terrain: 'marsh', resource: 'spices', tier: 'town', port: true, owner: 'abbasids', population: 8, fertility: 1.0 }),

  // ======================= Egypt, Nubia, the Horn =======================
  r({ id: 'cairo', province: 'Egypt', settlement: 'Cairo', lon: 31.24, lat: 30.04, terrain: 'desert', resource: 'grain', tier: 'huge_city', port: true, owner: 'fatimids', population: 38, fertility: 1.4 }),
  r({ id: 'alexandria', province: 'Alexandria', settlement: 'Alexandria', lon: 29.92, lat: 31.2, terrain: 'coastal', resource: 'grain', tier: 'large_town', port: true, owner: 'fatimids', population: 14, fertility: 1.2 }),
  r({ id: 'damietta', province: 'Damietta', settlement: 'Damietta', lon: 31.81, lat: 31.42, terrain: 'marsh', resource: 'fish', tier: 'town', port: true, owner: 'fatimids', population: 7, fertility: 1.2 }),
  r({ id: 'aswan', province: 'Upper Egypt', settlement: 'Aswan', lon: 32.9, lat: 24.09, terrain: 'desert', resource: 'gold', tier: 'village', port: true, owner: 'fatimids', population: 4, fertility: 0.7 }),
  r({ id: 'dongola', province: 'Makuria', settlement: 'Dongola', lon: 30.48, lat: 19.18, terrain: 'desert', resource: 'gold', tier: 'town', port: true, owner: 'makuria', population: 5, fertility: 0.7 }),
  r({ id: 'soba', province: 'Alodia', settlement: 'Soba', lon: 32.6, lat: 15.5, terrain: 'desert', resource: 'ivory', tier: 'village', port: true, owner: 'makuria', population: 4, fertility: 0.8 }),
  r({ id: 'adefa', province: 'Lasta', settlement: 'Adefa', lon: 39.04, lat: 12.03, terrain: 'mountains', resource: 'ivory', tier: 'village', port: false, owner: 'independent', population: 4, fertility: 0.8 }),
  r({ id: 'zeila', province: 'Zeila', settlement: 'Zeila', lon: 43.47, lat: 11.36, terrain: 'desert', resource: 'ivory', tier: 'village', port: true, owner: 'independent', population: 3, fertility: 0.6 }),

  // ======================= Maghreb =======================
  r({ id: 'tripoli_libya', province: 'Tripolitania', settlement: 'Tripoli', lon: 13.19, lat: 32.89, terrain: 'coastal', resource: 'grain', tier: 'town', port: true, owner: 'zirids', population: 6, fertility: 0.9 }),
  r({ id: 'mahdia', province: 'Ifriqiya', settlement: 'Mahdia', lon: 11.06, lat: 35.5, terrain: 'coastal', resource: 'wine', tier: 'town', port: true, owner: 'zirids', population: 7, fertility: 1.0 }),
  r({ id: 'tunis', province: 'Tunis', settlement: 'Tunis', lon: 10.17, lat: 36.81, terrain: 'coastal', resource: 'grain', tier: 'town', port: true, owner: 'zirids', population: 8, fertility: 1.1 }),
  r({ id: 'bejaia', province: 'Hammadid Realm', settlement: 'Bejaia', lon: 5.08, lat: 36.75, terrain: 'coastal', resource: 'timber', tier: 'village', port: true, owner: 'independent', population: 5, fertility: 0.9 }),
  r({ id: 'algiers', province: 'Algiers', settlement: 'Algiers', lon: 3.06, lat: 36.75, terrain: 'coastal', resource: 'fish', tier: 'village', port: true, owner: 'independent', population: 4, fertility: 0.9 }),
  r({ id: 'tlemcen', province: 'Tlemcen', settlement: 'Tlemcen', lon: -1.32, lat: 34.88, terrain: 'hills', resource: 'wool', tier: 'village', port: false, owner: 'independent', population: 4, fertility: 0.8 }),
  r({ id: 'fez', province: 'Fez', settlement: 'Fez', lon: -5.0, lat: 34.03, terrain: 'hills', resource: 'dyes', tier: 'town', port: false, owner: 'almoravids', population: 9, fertility: 1.0 }),
  r({ id: 'tangier', province: 'Tangier', settlement: 'Tangier', lon: -5.8, lat: 35.76, terrain: 'coastal', resource: 'fish', tier: 'village', port: true, owner: 'almoravids', population: 4, fertility: 0.9 }),
  r({ id: 'ceuta', province: 'Ceuta', settlement: 'Ceuta', lon: -5.31, lat: 35.89, terrain: 'coastal', resource: 'fish', tier: 'village', port: true, owner: 'independent', population: 4, fertility: 0.8 }),
  r({ id: 'marrakesh', province: 'Marrakesh', settlement: 'Marrakesh', lon: -7.99, lat: 31.63, terrain: 'desert', resource: 'gold', tier: 'large_town', port: false, owner: 'almoravids', population: 10, fertility: 0.8 }),
  r({ id: 'sijilmasa', province: 'Tafilalt', settlement: 'Sijilmasa', lon: -4.28, lat: 31.28, terrain: 'desert', resource: 'gold', tier: 'village', port: false, owner: 'almoravids', population: 4, fertility: 0.5 }),

  // ======================= Sahel =======================
  r({ id: 'taghaza', province: 'Taghaza', settlement: 'Taghaza', lon: -5.0, lat: 23.6, terrain: 'desert', resource: 'salt', tier: 'village', port: false, owner: 'independent', population: 1, fertility: 0.3 }),
  r({ id: 'walata', province: 'Walata', settlement: 'Walata', lon: -7.03, lat: 17.3, terrain: 'desert', resource: 'salt', tier: 'village', port: false, owner: 'ghana', population: 3, fertility: 0.4 }),
  r({ id: 'koumbi', province: 'Wagadou', settlement: 'Koumbi Saleh', lon: -7.97, lat: 15.77, terrain: 'desert', resource: 'gold', tier: 'town', port: false, owner: 'ghana', population: 6, fertility: 0.5 }),
  r({ id: 'niani', province: 'Manden', settlement: 'Niani', lon: -8.42, lat: 11.38, terrain: 'plains', resource: 'gold', tier: 'village', port: false, owner: 'independent', population: 4, fertility: 0.9 }),
  r({ id: 'timbuktu', province: 'Timbuktu', settlement: 'Timbuktu', lon: -3.0, lat: 16.77, terrain: 'desert', resource: 'salt', tier: 'village', port: true, owner: 'independent', population: 3, fertility: 0.5 }),
  r({ id: 'gao', province: 'Gao', settlement: 'Gao', lon: 0.04, lat: 16.27, terrain: 'desert', resource: 'gold', tier: 'village', port: true, owner: 'independent', population: 4, fertility: 0.6 }),
  r({ id: 'njimi', province: 'Kanem', settlement: 'Njimi', lon: 15.5, lat: 13.5, terrain: 'desert', resource: 'ivory', tier: 'town', port: false, owner: 'kanem', population: 5, fertility: 0.6 }),
];

const BY_ID = new Map<RegionId, Region>(REGIONS.map((region) => [region.id, region]));

export function getRegion(id: RegionId): Region {
  const region = BY_ID.get(id);
  if (!region) throw new Error(`Unknown region: ${id}`);
  return region;
}

export function tryGetRegion(id: RegionId): Region | undefined {
  return BY_ID.get(id);
}

export const REGION_IDS: readonly RegionId[] = REGIONS.map((region) => region.id);
