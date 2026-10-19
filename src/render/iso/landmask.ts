/**
 * Where the land is.
 *
 * Deciding it from the elevation — anything above sea level is land — gives a
 * coast that shimmers: a tile covering seven kilometres of shoreline averages
 * to a metre either side of zero, so whole stretches of Dalmatia flicker in
 * and out of the sea depending on the zoom.
 *
 * The game already knows exactly where the coast is: `LAND_RINGS` is the real
 * thing, clipped from Natural Earth. The trouble is that asking "is this
 * point inside any of two hundred rings" thousands of times a frame is not
 * cheap. So the rings are painted once into an off-screen bitmap and the
 * question becomes a lookup, which is both exact and free.
 */
import { LAKE_RINGS, LAND_RINGS, GEO_BOUNDS } from '../../core/data/geography';
import { mercatorY } from '../projection';

/** About four kilometres to a cell, which is finer than any tile gets. */
const SIZE = 2048;

interface Mask {
  readonly bits: Uint8Array;
  readonly minLon: number;
  readonly minMerc: number;
  readonly lonPerCell: number;
  readonly mercPerCell: number;
}

let mask: Mask | undefined;

function build(): Mask {
  const minLon = GEO_BOUNDS.west;
  const maxLon = GEO_BOUNDS.east;
  const minMerc = mercatorY(GEO_BOUNDS.south);
  const maxMerc = mercatorY(GEO_BOUNDS.north);
  const lonPerCell = (maxLon - minLon) / SIZE;
  const mercPerCell = (maxMerc - minMerc) / SIZE;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SIZE, SIZE);

  const paint = (rings: readonly (readonly (readonly [number, number])[])[]): void => {
    ctx.beginPath();
    for (const ring of rings) {
      ring.forEach(([lon, lat], index) => {
        const x = (lon - minLon) / lonPerCell;
        // The bitmap runs north at the top, as a picture does.
        const y = (maxMerc - mercatorY(lat)) / mercPerCell;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
    ctx.fill();
  };

  ctx.fillStyle = '#fff';
  paint(LAND_RINGS);
  // Inland water is not land, and a lake you can see is worth having.
  ctx.fillStyle = '#000';
  paint(LAKE_RINGS);

  const image = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const bits = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < bits.length; i++) bits[i] = image[i * 4]! > 127 ? 1 : 0;
  return { bits, minLon, minMerc, lonPerCell, mercPerCell };
}

/** True where the ground is dry, from the real coastline. */
export function isLand(lon: number, merc: number): boolean {
  if (!mask) mask = build();
  const column = Math.floor((lon - mask.minLon) / mask.lonPerCell);
  const row = SIZE - 1 - Math.floor((merc - mask.minMerc) / mask.mercPerCell);
  if (column < 0 || row < 0 || column >= SIZE || row >= SIZE) return false;
  return mask.bits[row * SIZE + column] === 1;
}
