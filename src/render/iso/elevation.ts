/**
 * The shape of the ground, as the map needs it.
 *
 * `src/core/data/elevation.ts` says how large the grid is and where it lives;
 * this fetches it and answers the only two questions anything asks of it: how
 * high is the ground at this longitude and latitude, and give me the whole
 * grid so I can build a mesh out of it.
 *
 * The grid is read on the processor rather than sampled in a shader because
 * the map stands settlements, armies and ships on the ground: they need a
 * height in metres at an exact point, not a displaced vertex.
 */
import { ELEVATION } from '../../core/data/elevation';

export interface Ground {
  readonly width: number;
  readonly height: number;
  /** Metres, row-major from the north edge southwards. */
  readonly posts: Int16Array;
  /** Metres at a longitude and latitude, interpolated between posts. */
  metresAt(lon: number, lat: number): number;
  /**
   * The same, from a coarser copy of the grid.
   *
   * Drawing a tile half a degree across from posts a fifteenth of a degree
   * apart means taking one reading in every seven and throwing the rest
   * away, which turns a mountain range into a field of spikes: whether a
   * tile is a peak or a valley comes down to where its corner happened to
   * land. Each level of this is the one above it averaged in half, so a
   * coarse tile is the average of the ground it covers rather than one
   * arbitrary point of it.
   */
  metresAtLevel(lon: number, lat: number, level: number): number;
  /** The level whose posts are about as far apart as a tile is wide. */
  levelFor(unitsAcross: number): number;
}

let loading: Promise<Ground> | undefined;

/**
 * Loads the grid once and hands the same one to everybody afterwards.
 *
 * The campaign screen draws synchronously, so whatever calls this has to be
 * able to draw without it for the first few frames.
 */
export function loadGround(base = ''): Promise<Ground> {
  if (!loading) loading = fetchGround(base);
  return loading;
}

async function fetchGround(base: string): Promise<Ground> {
  const response = await fetch(`${base}${ELEVATION.url}`);
  if (!response.ok) throw new Error(`No elevation data: ${response.status}`);
  const bytes = await response.arrayBuffer();
  const expected = ELEVATION.width * ELEVATION.height * 2;
  if (bytes.byteLength !== expected) {
    throw new Error(`Elevation is ${bytes.byteLength} bytes, expected ${expected}`);
  }
  return groundFrom(new Int16Array(bytes));
}

/** Each level is the one above it averaged in half, down to a coarse map. */
function pyramid(posts: Int16Array): { posts: Int16Array; width: number; height: number }[] {
  const levels: { posts: Int16Array; width: number; height: number }[] = [
    { posts, width: ELEVATION.width, height: ELEVATION.height },
  ];
  while (true) {
    const above = levels[levels.length - 1]!;
    if (above.width < 16 || above.height < 16) break;
    const width = above.width >> 1;
    const height = above.height >> 1;
    const next = new Int16Array(width * height);
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const a = above.posts[row * 2 * above.width + column * 2]!;
        const b = above.posts[row * 2 * above.width + column * 2 + 1]!;
        const c = above.posts[(row * 2 + 1) * above.width + column * 2]!;
        const d = above.posts[(row * 2 + 1) * above.width + column * 2 + 1]!;
        next[row * width + column] = Math.round((a + b + c + d) / 4);
      }
    }
    levels.push({ posts: next, width, height });
  }
  return levels;
}

/** Wraps a grid of posts in the questions the map asks of it. */
export function groundFrom(posts: Int16Array): Ground {
  const { width, height, step, west, north } = ELEVATION;
  const levels = pyramid(posts);

  const sample = (level: number, lon: number, lat: number): number => {
    const grid = levels[Math.max(0, Math.min(levels.length - 1, level))]!;
    const scale = ELEVATION.width / grid.width;
    const x = (lon - west) / (step * scale);
    const y = (north - lat) / (step * scale);
    if (x < 0 || y < 0 || x > grid.width - 1 || y > grid.height - 1) return 0;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(grid.width - 1, x0 + 1);
    const y1 = Math.min(grid.height - 1, y0 + 1);
    const fx = x - x0;
    const fy = y - y0;
    const topLeft = grid.posts[y0 * grid.width + x0]!;
    const topRight = grid.posts[y0 * grid.width + x1]!;
    const bottomLeft = grid.posts[y1 * grid.width + x0]!;
    const bottomRight = grid.posts[y1 * grid.width + x1]!;
    const top = topLeft + (topRight - topLeft) * fx;
    const bottom = bottomLeft + (bottomRight - bottomLeft) * fx;
    return top + (bottom - top) * fy;
  };

  return {
    width,
    height,
    posts,
    metresAtLevel: (lon, lat, level) => sample(level, lon, lat),
    levelFor(unitsAcross: number): number {
      // One level down for every doubling of the distance between posts.
      return Math.max(0, Math.round(Math.log2(unitsAcross / step)));
    },
    metresAt(lon: number, lat: number): number {
      // Where the point falls between posts, in grid coordinates.
      const x = (lon - west) / step;
      const y = (north - lat) / step;
      if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return 0;

      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      const fx = x - x0;
      const fy = y - y0;

      // Bilinear, so that a hillside is a slope rather than a staircase.
      const topLeft = posts[y0 * width + x0]!;
      const topRight = posts[y0 * width + x1]!;
      const bottomLeft = posts[y1 * width + x0]!;
      const bottomRight = posts[y1 * width + x1]!;
      const top = topLeft + (topRight - topLeft) * fx;
      const bottom = bottomLeft + (bottomRight - bottomLeft) * fx;
      return top + (bottom - top) * fy;
    },
  };
}

/** A flat world, for drawing something before the grid has arrived. */
export function flatGround(): Ground {
  return groundFrom(new Int16Array(ELEVATION.width * ELEVATION.height));
}
