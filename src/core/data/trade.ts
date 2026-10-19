/**
 * The long-distance trade routes.
 *
 * Local trade is already modelled: a province earns from the neighbours it can
 * reach. This is the other kind, the one that made medieval cities rich and
 * medieval wars worth fighting. Each route is an ordered path of real
 * provinces, so a caravan can walk it, a lord can tax it where it crosses his
 * land, and an enemy can cut it.
 *
 * Every path is contiguous: each pair of consecutive provinces shares a border,
 * by land or by sea. A test asserts it, because a route with a gap in it would
 * silently strand every caravan dispatched along it.
 */
import type { RegionId, Resource } from '../types';
import { regionId } from '../types';

declare const routeBrand: unique symbol;
export type TradeRouteId = string & { readonly [routeBrand]: 'TradeRouteId' };
export const tradeRouteId = (value: string): TradeRouteId => value as TradeRouteId;

export interface TradeRoute {
  readonly id: TradeRouteId;
  readonly name: string;
  /** The provinces it passes through, in order. */
  readonly path: readonly RegionId[];
  /** What travels along it. */
  readonly commodity: Resource;
  /**
   * What a full caravan is worth on arrival, before tolls. The great routes
   * are worth several times what a regional one is, which is why states
   * fought over the ends of them.
   */
  readonly value: number;
  readonly fromYear?: number;
  readonly untilYear?: number;
  readonly description: string;
}

type Spec = Omit<TradeRoute, 'id' | 'path'> & { id: string; path: readonly string[] };

const t = (spec: Spec): TradeRoute => ({
  ...spec,
  id: tradeRouteId(spec.id),
  path: spec.path.map(regionId),
});

export const TRADE_ROUTES: readonly TradeRoute[] = [
  t({
    id: 'silk_road', name: 'The Silk Road', commodity: 'silk', value: 675,
    path: ['baghdad', 'mosul', 'edessa', 'melitene', 'sebasteia', 'ankyra', 'nicaea', 'constantinople'],
    description:
      'The western end of the road from China: silk, porcelain and paper carried overland ' +
      'from Baghdad across Anatolia to the Bosporus. Whoever holds the middle of it does not ' +
      'need to produce anything at all.',
  }),
  t({
    id: 'trebizond_road', name: 'The Trebizond Road', commodity: 'silk', value: 525,
    path: ['derbent', 'tbilisi', 'erzurum', 'trebizond'],
    description:
      'The northern branch of the eastern trade, over the Caucasus to a Black Sea quay. It ' +
      'is what makes a small Pontic city worth an empire of its own.',
  }),
  t({
    id: 'varangian', name: 'From the Varangians to the Greeks', commodity: 'furs', value: 465,
    path: ['novgorod', 'smolensk', 'chernigov', 'kiev', 'podolia', 'donets', 'soldaia', 'cherson', 'constantinople'],
    description:
      'Furs, wax, honey and slaves carried down the rivers and across the steppe to ' +
      'Constantinople, and silver carried back. The road that made the Rus a state.',
  }),
  t({
    id: 'amber_road', name: 'The Amber Road', commodity: 'amber', value: 390,
    path: ['gdansk', 'plock', 'krakow', 'olomouc', 'vienna', 'salzburg', 'brixen', 'verona', 'venice'],
    description:
      'Baltic amber carried south to the Adriatic, by a road older than any state along it. ' +
      'Salt and silver travel the other way.',
  }),
  t({
    id: 'hanseatic', name: 'The Hanseatic Circuit', commodity: 'furs', value: 510, fromYear: 1160,
    path: ['bruges', 'utrecht', 'bremen', 'hamburg', 'oldenburg', 'roskilde', 'lund', 'kalmar', 'visby', 'reval', 'novgorod'],
    description:
      'Flemish cloth east, Russian furs and wax west, Baltic grain and timber everywhere. ' +
      'The Hanse is a league of towns with no sovereign, and it blockades kings.',
  }),
  t({
    id: 'champagne', name: 'The Champagne Fairs', commodity: 'wool', value: 540,
    fromYear: 1140, untilYear: 1400,
    path: ['bruges', 'reims', 'dijon', 'besancon', 'lyon', 'turin', 'milan', 'verona', 'venice'],
    description:
      'Six fairs a year where Flemish cloth meets Italian silk and the money of all Europe ' +
      'is changed. The counts of Champagne guarantee the peace of the road and take a cut.',
  }),
  t({
    id: 'saharan_gold', name: 'The Western Saharan Road', commodity: 'gold', value: 750,
    path: ['koumbi', 'walata', 'taghaza', 'sijilmasa', 'fez', 'tangier', 'malaga', 'seville'],
    description:
      'Gold dust north and rock salt south, across two months of desert by camel. More gold ' +
      'reached Europe this way than by any other, and it is why Marrakesh is worth having.',
  }),
  t({
    id: 'fezzan', name: 'The Fezzan Road', commodity: 'ivory', value: 465,
    path: ['njimi', 'tripoli_libya', 'mahdia', 'tunis'],
    description:
      'The central Saharan crossing from Lake Chad to the Tripolitanian coast: ivory, ' +
      'ostrich feathers and slaves out, horses and mail shirts in.',
  }),
  t({
    id: 'niger_bend', name: 'The Niger Bend', commodity: 'gold', value: 420,
    path: ['niani', 'timbuktu', 'gao', 'njimi'],
    description:
      'River traffic along the great bend of the Niger, tying the goldfields of Manden to ' +
      'the desert ports where the caravans form up.',
  }),
  t({
    id: 'nile', name: 'The Nile Road', commodity: 'ivory', value: 480,
    path: ['soba', 'dongola', 'aswan', 'cairo', 'alexandria'],
    description:
      'Boats downstream and camels along the bank: ivory, gold and slaves from Nubia to ' +
      'Cairo, and Egyptian grain and cloth back up.',
  }),
  t({
    id: 'spice_route', name: 'The Spice Road', commodity: 'spices', value: 825,
    path: ['basra', 'baghdad', 'damascus', 'tyre', 'acre', 'nicosia', 'rhodes', 'candia',
           'corinth', 'taranto', 'bari', 'dubrovnik', 'split', 'venice'],
    description:
      'Pepper, cinnamon and nutmeg from the Indian Ocean by way of the Gulf, overland to the ' +
      'Syrian coast, and then into Italian hulls. The most valuable cargo in the world by ' +
      'weight, and the reason Venice has a foreign policy.',
  }),
  t({
    id: 'francigena', name: 'The Via Francigena', commodity: 'silver', value: 420,
    path: ['london', 'rouen', 'paris', 'dijon', 'besancon', 'lyon', 'turin', 'milan', 'genoa',
           'pisa', 'siena', 'rome'],
    description:
      'The pilgrim road to Rome. What travels is people, and what they leave behind is coin: ' +
      'hospices, bridges and whole towns exist because the road passes through them.',
  }),
  t({
    id: 'rhine', name: 'The Rhine Road', commodity: 'wine', value: 495,
    path: ['utrecht', 'cologne', 'mainz', 'strasbourg', 'zurich', 'brixen', 'milan'],
    description:
      'Wine and cloth up the river and over the Alpine passes. Every lord on the bank has a ' +
      'tower and a chain, and the tolls between Mainz and the sea are a scandal of the age.',
  }),
  t({
    id: 'danube', name: 'The Danube Road', commodity: 'grain', value: 390,
    path: ['vienna', 'pozsony', 'esztergom', 'szeged', 'belgrade', 'vidin', 'tarnovo', 'varna'],
    description:
      'Hungarian cattle and grain downstream to the Black Sea, Byzantine silk and spice ' +
      'upstream. The river is the only good road in the Carpathian basin.',
  }),
  t({
    id: 'egnatia', name: 'The Via Egnatia', commodity: 'silk', value: 435,
    path: ['durres', 'ohrid', 'thessaloniki', 'adrianople', 'constantinople'],
    description:
      'The Roman road across the Balkans, still paved and still the fastest way from the ' +
      'Adriatic to the capital. Armies use it as often as merchants do.',
  }),
  t({
    id: 'wool_road', name: 'The Iberian Wool Road', commodity: 'wool', value: 375,
    path: ['burgos', 'leon', 'porto', 'lisbon', 'seville'],
    description:
      'Merino fleeces from the Castilian meseta to the Atlantic ports, where Flemish and ' +
      'Genoese buyers are waiting with silver.',
  }),
  t({
    id: 'levant', name: 'The Venetian Levant', commodity: 'spices', value: 645,
    path: ['venice', 'split', 'dubrovnik', 'kotor', 'durres', 'ioannina', 'corinth', 'candia',
           'rhodes', 'nicosia', 'acre'],
    description:
      'The Adriatic and Aegean leg of the eastern trade, port by port down a coast of ' +
      'colonies and treaty privileges. Venice does not want the Levant; it wants the route.',
  }),
  t({
    id: 'fur_road', name: 'The Volga Fur Road', commodity: 'furs', value: 352,
    path: ['bolghar', 'suzdal', 'novgorod'],
    description:
      'Sable, marten and squirrel out of the northern forests to the Volga market, and ' +
      'Islamic silver dirhams back. The forest has nothing else to sell and needs nothing else.',
  }),
  t({
    id: 'english_wool', name: 'The English Wool Trade', commodity: 'wool', value: 465,
    path: ['york', 'london', 'bruges'],
    description:
      'Raw English wool across the Channel to the Flemish looms. The customs on it pay for ' +
      'English armies, which is why a quarrel over Flanders is never only about Flanders.',
  }),
];

const BY_ID = new Map<TradeRouteId, TradeRoute>(TRADE_ROUTES.map((route) => [route.id, route]));

export function getTradeRoute(id: TradeRouteId): TradeRoute {
  const route = BY_ID.get(id);
  if (!route) throw new Error(`Unknown trade route: ${id}`);
  return route;
}

export function tryTradeRoute(id: TradeRouteId): TradeRoute | undefined {
  return BY_ID.get(id);
}

/** Routes in use in the given year. */
export function routesInYear(year: number): readonly TradeRoute[] {
  return TRADE_ROUTES.filter(
    (route) =>
      (route.fromYear === undefined || year >= route.fromYear) &&
      (route.untilYear === undefined || year <= route.untilYear),
  );
}

/** Index from a province to the routes that pass through it. */
const BY_REGION = ((): ReadonlyMap<RegionId, readonly TradeRouteId[]> => {
  const map = new Map<RegionId, TradeRouteId[]>();
  for (const route of TRADE_ROUTES) {
    for (const region of route.path) {
      map.set(region, [...(map.get(region) ?? []), route.id]);
    }
  }
  return map;
})();

export function routesThrough(region: RegionId): readonly TradeRouteId[] {
  return BY_REGION.get(region) ?? [];
}

/** Where a province sits along a route, or -1 if it is not on it. */
export function positionOn(route: TradeRoute, region: RegionId): number {
  return route.path.indexOf(region);
}

export const TRADE_ROUTE_IDS: readonly TradeRouteId[] = TRADE_ROUTES.map((route) => route.id);
