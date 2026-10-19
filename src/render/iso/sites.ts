/**
 * Which province a point of the world belongs to.
 *
 * The map asks this once per tile, thousands of times a frame, so it cannot
 * be a walk through two hundred polygons. It does not need to be: a province
 * *is* the ground nearer to its own settlement than to any other, so the
 * answer is the nearest settlement and nothing more.
 *
 * Nearest is found through a coarse grid of buckets. Each bucket holds the
 * settlements in it; a query looks in its own bucket and the ring around it,
 * widening only if it has found nothing, which for a map this evenly settled
 * means two or three distance tests instead of two hundred.
 */
import type { RegionId } from '../../core/types';
import { provinceShapes } from '../provinces';

/** Projected units to a bucket. About four degrees, so a handful of sites. */
const BUCKET = 4;

interface Site {
  readonly id: RegionId;
  readonly lon: number;
  readonly merc: number;
}

interface Index {
  readonly buckets: Map<string, Site[]>;
  readonly all: readonly Site[];
  readonly minX: number;
  readonly minY: number;
}

let index: Index | undefined;

function key(column: number, row: number): string {
  return `${column},${row}`;
}

function build(): Index {
  const all: Site[] = provinceShapes().map((shape) => ({
    id: shape.id,
    lon: shape.site[0],
    merc: shape.site[1],
  }));
  let minX = Infinity;
  let minY = Infinity;
  for (const site of all) {
    minX = Math.min(minX, site.lon);
    minY = Math.min(minY, site.merc);
  }
  const buckets = new Map<string, Site[]>();
  for (const site of all) {
    const column = Math.floor((site.lon - minX) / BUCKET);
    const row = Math.floor((site.merc - minY) / BUCKET);
    const bucket = buckets.get(key(column, row));
    if (bucket) bucket.push(site);
    else buckets.set(key(column, row), [site]);
  }
  return { buckets, all, minX, minY };
}

/** The province whose settlement is nearest a projected point. */
export function provinceNear(lon: number, merc: number): RegionId | undefined {
  if (!index) index = build();
  const { buckets, minX, minY } = index;
  const column = Math.floor((lon - minX) / BUCKET);
  const row = Math.floor((merc - minY) / BUCKET);

  let best: RegionId | undefined;
  let bestDistance = Infinity;
  for (let ring = 1; ring <= 12; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        // Only the new ring each time round; the inside has been done.
        if (ring > 1 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        const bucket = buckets.get(key(column + dx, row + dy));
        if (!bucket) continue;
        for (const site of bucket) {
          const distance = (site.lon - lon) ** 2 + (site.merc - merc) ** 2;
          if (distance < bestDistance) {
            bestDistance = distance;
            best = site.id;
          }
        }
      }
    }
    // A site found in this ring can still be beaten by one in the next, but
    // only if the next ring could hold anything nearer than what we have.
    if (best !== undefined && bestDistance <= (ring * BUCKET) ** 2) break;
  }
  return best;
}

/** Thrown away when the province shapes are rebuilt, which is never in play. */
export function forgetSites(): void {
  index = undefined;
}
