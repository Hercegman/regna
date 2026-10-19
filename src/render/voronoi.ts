/**
 * Dividing the map into provinces.
 *
 * Every province has one settlement and the ground around it belongs to that
 * settlement, which is what a Voronoi diagram is. Each cell is built by
 * starting from the whole map and cutting it with the perpendicular bisector
 * against every other settlement: whatever survives is closer to this
 * settlement than to any other.
 *
 * That is O(n squared) in the number of provinces, which for a few hundred of
 * them is a few milliseconds once at load, so there is no call for a Delaunay
 * triangulation and its edge cases.
 *
 * The work is done in projected space, longitude against Mercator latitude,
 * because that is the space the map is drawn in. Cutting in raw degrees would
 * make northern provinces the wrong shape.
 */

export interface Site {
  readonly x: number;
  readonly y: number;
}

export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export type Cell = readonly (readonly [number, number])[];

/**
 * Clips a convex polygon by the half-plane on the near side of the bisector
 * between `site` and `other`: the set of points at least as close to `site`.
 */
function clipByBisector(poly: [number, number][], site: Site, other: Site): [number, number][] {
  // Points p with |p - site|^2 <= |p - other|^2, which rearranges to a line.
  const nx = other.x - site.x;
  const ny = other.y - site.y;
  const offset = (nx * (site.x + other.x) + ny * (site.y + other.y)) / 2;
  // Keep where nx*px + ny*py <= offset.
  const value = (p: readonly [number, number]): number => nx * p[0] + ny * p[1] - offset;

  const out: [number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]!;
    const prev = poly[(i + poly.length - 1) % poly.length]!;
    const dCur = value(cur);
    const dPrev = value(prev);
    const curIn = dCur <= 0;
    const prevIn = dPrev <= 0;
    if (curIn) {
      if (!prevIn) {
        const t = dPrev / (dPrev - dCur);
        out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
      }
      out.push(cur);
    } else if (prevIn) {
      const t = dPrev / (dPrev - dCur);
      out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
    }
  }
  return out;
}

/**
 * The cell of every site, in the same order as the sites.
 *
 * A site that coincides exactly with another would have an empty cell; the
 * caller is expected not to do that, and the map's own tests assert that no
 * two settlements share a position.
 */
export function voronoiCells(sites: readonly Site[], bounds: Bounds): Cell[] {
  const frame: [number, number][] = [
    [bounds.minX, bounds.minY],
    [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY],
    [bounds.minX, bounds.maxY],
  ];

  return sites.map((site) => {
    let poly: [number, number][] = frame.map((point) => [point[0], point[1]]);
    for (const other of sites) {
      if (other === site) continue;
      // A site far enough away cannot cut a cell this small; skip the work.
      poly = clipByBisector(poly, site, other);
      if (poly.length === 0) break;
    }
    return poly;
  });
}

/** Area of a polygon, positive whichever way it is wound. */
export function polygonArea(cell: Cell): number {
  let sum = 0;
  for (let i = 0; i < cell.length; i++) {
    const a = cell[i]!;
    const b = cell[(i + 1) % cell.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

/** Is the point inside the polygon? Ray casting, for tests and hit testing. */
export function pointInPolygon(cell: Cell, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = cell.length - 1; i < cell.length; j = i++) {
    const [xi, yi] = cell[i]!;
    const [xj, yj] = cell[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
