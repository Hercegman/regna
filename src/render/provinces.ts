/**
 * The shape of every province.
 *
 * The map stores a settlement and its coordinates; the ground around it is
 * worked out here, once, by dividing the whole theatre between the
 * settlements. A province is then a polygon the owner's colour can be painted
 * into, which is the difference between a map and a diagram.
 *
 * Shapes are computed in projected space, longitude against Mercator latitude,
 * and cached: the settlements never move, so this happens once for the life of
 * the page.
 */
import type { RegionId, Terrain } from '../core/types';
import { REGIONS, getRegion } from '../core/data/regions';
import { LAND_RINGS, GEO_BOUNDS, type Ring } from '../core/data/geography';
import { mercatorY } from './projection';
import { jitter } from './mapArt';
import { pointInPolygon, voronoiCells, type Cell, type Site } from './voronoi';

export interface ProvinceShape {
  readonly id: RegionId;
  /** The cell, as [longitude, mercator-latitude] pairs. */
  readonly cell: Cell;
  /** The settlement, in the same space. */
  readonly site: readonly [number, number];
  /**
   * For each edge of the cell, the province on the other side of it, or
   * undefined where the edge is the edge of the map. Edge `i` runs from
   * `cell[i]` to `cell[i + 1]`. This is what lets a national border be drawn
   * more heavily than a line between two provinces of the same realm.
   */
  readonly edgeNeighbours: readonly (RegionId | undefined)[];
}

const BOUNDS = {
  minX: GEO_BOUNDS.west,
  maxX: GEO_BOUNDS.east,
  minY: mercatorY(GEO_BOUNDS.south),
  maxY: mercatorY(GEO_BOUNDS.north),
};

let cached: readonly ProvinceShape[] | undefined;

/** Every province's shape, computed on first use and kept. */
export function provinceShapes(): readonly ProvinceShape[] {
  if (cached) return cached;
  const sites: Site[] = REGIONS.map((region) => ({
    x: region.lon,
    y: mercatorY(region.lat),
  }));
  const cells = voronoiCells(sites, BOUNDS);
  cached = REGIONS.map((region, index) => {
    const cell = cells[index] ?? [];
    return {
      id: region.id,
      cell,
      site: [sites[index]!.x, sites[index]!.y] as const,
      edgeNeighbours: edgeNeighbours(cell, index, sites),
    };
  });
  return cached;
}

/**
 * Whose cell lies across each edge.
 *
 * The midpoint of an edge of this cell is equidistant from this settlement and
 * from the one across it, so the nearest other settlement to that midpoint is
 * the neighbour. Comparing against every settlement is a few hundred thousand
 * distance checks for the whole map, once.
 */
function edgeNeighbours(
  cell: Cell,
  ownIndex: number,
  sites: readonly Site[],
): (RegionId | undefined)[] {
  const result: (RegionId | undefined)[] = [];
  for (let i = 0; i < cell.length; i++) {
    const a = cell[i]!;
    const b = cell[(i + 1) % cell.length]!;
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    let best = -1;
    let bestDistance = Infinity;
    for (let j = 0; j < sites.length; j++) {
      if (j === ownIndex) continue;
      const site = sites[j]!;
      const d = (site.x - mx) ** 2 + (site.y - my) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = j;
      }
    }
    const own = sites[ownIndex]!;
    const ownDistance = (own.x - mx) ** 2 + (own.y - my) ** 2;
    // An edge on the frame of the map is nearer its own settlement than any
    // other, by a margin: there is nobody across it.
    const shared = best >= 0 && Math.abs(bestDistance - ownDistance) < ownDistance * 0.02 + 1e-9;
    result.push(shared ? REGIONS[best]!.id : undefined);
  }
  return result;
}

/** The coastline in the same projected space, computed once. */
let cachedLand: readonly Ring[] | undefined;

export function landInMercator(): readonly Ring[] {
  if (cachedLand) return cachedLand;
  cachedLand = LAND_RINGS.map(
    (ring) => ring.map(([lon, lat]) => [lon, mercatorY(lat)] as const) as Ring,
  );
  return cachedLand;
}

/** Converts any lon/lat ring into projected space. */
export function toMercator(ring: Ring): Ring {
  return ring.map(([lon, lat]) => [lon, mercatorY(lat)] as const) as Ring;
}

/** The rough span of a province, for deciding how much to draw inside it. */
export function cellExtent(shape: ProvinceShape): number {
  if (shape.cell.length === 0) return 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of shape.cell) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return Math.min(maxX - minX, maxY - minY);
}

/**
 * Where to put the marks that say what a province is made of.
 *
 * A mountainous province should read as a range, not as a single caret in the
 * middle of a polygon, so the marks are scattered over the whole of it. The
 * scatter is a jittered grid filtered to the inside of the cell: regular
 * enough to cover evenly, irregular enough not to look like a lattice. It is
 * computed in projected space and cached, so it is stable from frame to frame
 * and a province's hills stay where they were when the camera moves.
 */
export interface ScatterPoint {
  readonly x: number;
  readonly y: number;
  /** A number in [0, 1) belonging to this point, for varying its size. */
  readonly seed: number;
}

/** Marks per unit area, by terrain: a forest is thick, a desert is empty. */
const DENSITY: Record<Terrain, number> = {
  forest: 1,
  mountains: 0.8,
  hills: 0.75,
  farmland: 0.55,
  marsh: 0.5,
  plains: 0.4,
  steppe: 0.35,
  coastal: 0.3,
  desert: 0.3,
};

const scatters = new Map<RegionId, readonly ScatterPoint[]>();

export function terrainScatter(shape: ProvinceShape): readonly ScatterPoint[] {
  const cached = scatters.get(shape.id);
  if (cached) return cached;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of shape.cell) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const terrain = getRegion(shape.id).terrain;
  // A step in degrees. Denser terrain gets a finer grid; the clamp keeps a
  // huge steppe province from costing thousands of marks.
  const step = Math.max(0.33, 0.62 / DENSITY[terrain]);
  const points: ScatterPoint[] = [];
  let n = 0;
  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      n += 1;
      const dx = (jitter(n, 11) - 0.5) * step * 0.85;
      const dy = (jitter(n, 23) - 0.5) * step * 0.85;
      const px = x + dx;
      const py = y + dy;
      if (!pointInPolygon(shape.cell, px, py)) continue;
      points.push({ x: px, y: py, seed: jitter(n, 37) });
      if (points.length >= 220) break;
    }
    if (points.length >= 220) break;
  }
  // A province too small for the grid still deserves one mark.
  if (points.length === 0) points.push({ x: shape.site[0], y: shape.site[1], seed: 0.5 });

  scatters.set(shape.id, points);
  return points;
}
