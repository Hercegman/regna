/**
 * The palette.
 *
 * These games had a fixed table of colours and every shade of a thing was a
 * short ladder inside it: five or six steps from dark to light, and a slope
 * picked a step rather than mixing a new colour. That is what gives the
 * picture its banding, and the banding is most of the look — a gradient
 * would read as a modern renderer pretending.
 *
 * So: one ladder per kind of ground, and nothing is ever blended except the
 * owner's wash, which is deliberately weak because the colour that says whose
 * a province is belongs on its border, not smeared over its fields.
 *
 * Beyond the ground there are the ladders height imposes on it — bare rock
 * and snow, which arrive above a certain line whatever the province is made
 * of — and the few colours the things scattered over it are painted in.
 */
import type { Terrain } from '../../core/types';

/** Dark to light. Index 2 is the flat, unlit ground. */
export type Ramp = readonly [string, string, string, string, string];

const RAMPS: Readonly<Record<Terrain, Ramp>> = {
  plains: ['#2f4a1c', '#3f6024', '#52782f', '#669039', '#7ca84a'],
  farmland: ['#3c4a16', '#54641d', '#6d8027', '#879a33', '#a0b346'],
  forest: ['#17300f', '#1f3f16', '#2a521d', '#366527', '#447c33'],
  hills: ['#3e4a1c', '#546024', '#6c7a2e', '#86913b', '#9fa84f'],
  mountains: ['#423e38', '#57514a', '#6f685e', '#8a8277', '#a49c90'],
  marsh: ['#283a2b', '#344c38', '#436047', '#547458', '#67886b'],
  steppe: ['#4b4a26', '#636030', '#7b783c', '#938f4a', '#aaa65c'],
  desert: ['#6d5b33', '#8c7543', '#a99056', '#c3a96c', '#d9c087'],
  coastal: ['#36461f', '#49602b', '#5d7837', '#739045', '#89a658'],
};

/** Deep water to shallow. */
export const WATER: Ramp = ['#0b1c30', '#102641', '#163154', '#1d3d67', '#25497c'];

/**
 * The shelf.
 *
 * A sea reads as a sea because of where it stops, so the water nearest the
 * land is a different colour from the water out in the middle of it. This is
 * the band that makes a coastline a coastline from across the room.
 */
export const SHALLOWS: Ramp = ['#1d3f63', '#255078', '#2e618c', '#3875a2', '#4a8cb6'];

/** Bare rock, which takes over from whatever the province grows above a line. */
export const ROCK: Ramp = ['#3b3733', '#4e4842', '#655e55', '#7e766c', '#978f84'];

/** And snow above that. */
export const SNOW: Ramp = ['#8c99a4', '#a3b0ba', '#bcc8d1', '#d4dee5', '#eaf1f6'];

/** The strand between the fields and the water. */
export const SAND: Ramp = ['#7c6b43', '#998655', '#b5a169', '#cebb80', '#e0d099'];

/**
 * Where the ground stops growing things and where it goes white.
 *
 * High enough that the Hungarian plain and the Po are untouched, low enough
 * that the Alps, the Pyrenees, the Carpathians and the Caucasus have a
 * treeline and a snowline the eye can follow.
 */
export const ROCK_LINE = 1300;
export const SNOW_LINE = 2100;

/** What a province of this ground is made of, before height has its say. */
export function rampFor(terrain: Terrain): Ramp {
  return RAMPS[terrain] ?? RAMPS.plains;
}

/**
 * The ladder a tile actually takes.
 *
 * Height overrules the province: a mountain province is rock at two thousand
 * metres whatever grows in its valleys, and so is the one next door. The
 * change is not a hard line but a short band, decided per tile by the same
 * noise that mottles the ground, so a treeline wanders the way one does.
 */
export function groundRamp(terrain: Terrain, metres: number, jitter: number): Ramp {
  const wander = (jitter - 0.5) * 300;
  if (metres > SNOW_LINE + wander) return SNOW;
  if (metres > ROCK_LINE + wander) return ROCK;
  return rampFor(terrain);
}

/**
 * Which step of a ladder a face takes.
 *
 * Three tones for the three faces a tile shows, nudged by which way the tile
 * leans so that a hillside catches the light along its slope.
 */
export function stepFor(face: 'top' | 'left' | 'right', lean: number): number {
  // The faces sit far apart on the ladder, because a cliff that is only a
  // shade darker than the field above it is not a cliff.
  const base = face === 'top' ? 3 : face === 'right' ? 1 : 0;
  const tilt = lean > 0.4 ? 1 : lean < -0.4 ? -1 : 0;
  return Math.max(0, Math.min(4, base + (face === 'top' ? tilt : 0)));
}

/**
 * The owner's wash.
 *
 * Weak on purpose, and weaker than it was. A province reads as its own
 * country first and as somebody's possession second: the colour that says
 * whose it is belongs in the band inside its frontier, which is drawn, not
 * smeared over every field it holds.
 */
export const OWNER_WASH = 0.1;

/** The things standing on the ground, in the few colours they are painted. */
export const DECOR = {
  /** Broadleaf, conifer, and the shadow both cast. */
  leaf: ['#2b5222', '#356128', '#24451c'],
  conifer: ['#1d3f1f', '#255026', '#182f18'],
  scrub: ['#5e6a33', '#74803f'],
  /** A furrow in a worked field, and the baulk between two of them. */
  furrow: ['#7d8a36', '#94a042', '#60702a'],
  rock: ['#6b6459', '#857d71', '#4d4740'],
  /** The great rivers, and the thread of light down the middle of one. */
  river: '#2a5f8a',
  riverLight: '#3d7ba8',
  /** Where the water breaks on the shore. */
  surf: '#7fb3cc',
} as const;

/** Mixes two hex colours. */
export function mix(a: string, b: string, amount: number): string {
  const left = parseInt(a.slice(1), 16);
  const right = parseInt(b.slice(1), 16);
  const blend = (shift: number): number => {
    const l = (left >> shift) & 255;
    const r = (right >> shift) & 255;
    return Math.round(l + (r - l) * amount) & 255;
  };
  return `#${((blend(16) << 16) | (blend(8) << 8) | blend(0)).toString(16).padStart(6, '0')}`;
}

/**
 * Snaps a colour to a coarse grid.
 *
 * The ladders are already a fixed set, but the owner's wash mixes new values
 * out of them. Snapping keeps the total number of colours on screen small,
 * which is the difference between pixel art and a screenshot of pixel art.
 */
export function snap(hex: string, levels = 12): string {
  const n = parseInt(hex.slice(1), 16);
  const step = 255 / (levels - 1);
  const fix = (shift: number): number =>
    Math.round(Math.round(((n >> shift) & 255) / step) * step) & 255;
  return `#${((fix(16) << 16) | (fix(8) << 8) | fix(0)).toString(16).padStart(6, '0')}`;
}

/**
 * A number between nought and one that is always the same for a tile.
 *
 * Every bit of variety on the ground — which way a field is ploughed, where
 * a wood thins out, how far up the hill the snow comes — is drawn from this
 * rather than from a generator, because the map is redrawn on every pan and
 * anything random would crawl.
 */
export function tileNoise(tx: number, ty: number, salt = 0): number {
  let h = (tx * 374761393 + ty * 668265263 + salt * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 65536) / 65536;
}
