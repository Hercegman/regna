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
import type { RegionId } from '../core/types';
import { REGIONS } from '../core/data/regions';
import { GEO_BOUNDS } from '../core/data/geography';
import { mercatorY } from './projection';
import { voronoiCells, type Cell, type Site } from './voronoi';

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
