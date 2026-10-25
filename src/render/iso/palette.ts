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

/**
 * Ground is the backdrop, and it was painted like the subject.
 *
 * The ladders used to run at the saturation the colour names suggest: a
 * field was grass green and a steppe was straw yellow, both of them as
 * strong a paint as the men standing on them. That is the one thing that
 * cannot be, because the men are the subject and the field is what they are
 * standing on — a bright green ground and a blue surcoat are two colours
 * arguing, and at twenty pixels the ground wins.
 *
 * So every ladder here is pulled a quarter of the way towards its own grey
 * and taken down a little, and the ladder itself is stretched to make up for
 * it: muting a colour flattens the difference between a lit face and a
 * shaded one, and that difference is what makes a hillside a hillside.
 * Ground that is quieter and has more shape in it, which is what a field
 * under an open sky actually looks like from a distance.
 */
const RAMPS: Readonly<Record<Terrain, Ramp>> = {
  plains: ['#2f4123', '#3d522b', '#516a3a', '#678348', '#799657'],
  farmland: ['#39421f', '#4c5629', '#667337', '#818e48', '#95a259'],
  forest: ['#192a14', '#20351a', '#2d4824', '#3b5b31', '#476d3c'],
  hills: ['#3a4324', '#4c542d', '#656e3b', '#7f864d', '#93995d'],
  mountains: ['#3c3a36', '#4d4945', '#66615a', '#827d75', '#979189'],
  marsh: ['#28342a', '#324235', '#435646', '#566b58', '#657b68'],
  steppe: ['#44442c', '#575536', '#706e46', '#898658', '#9b9867'],
  desert: ['#61553a', '#796a49', '#97865f', '#b2a078', '#c4b38d'],
  coastal: ['#343f25', '#445330', '#596c40', '#718452', '#829662'],
};

/** Deep water to shallow. */
export const WATER: Ramp = ['#0b1c30', '#102641', '#163154', '#1d3d67', '#25497c'];

/**
 * The sea a fight is fought on, which is not the sea on a map of Europe.
 *
 * The map's water is dark because it is the thing a continent is drawn
 * against and has to stay behind the land. A sea fight has no land in it:
 * you are on the water, in daylight, and water in daylight is not nearly
 * that dark. The same five steps, lifted and given back the colour the map
 * cannot afford.
 */
export const OPEN_WATER: Ramp = ['#173850', '#1d4766', '#25577d', '#2f6994', '#3d7cab'];

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

/**
 * The same ladder with snow lying on it.
 *
 * Step for step rather than one flat white, because the banding is what
 * makes this a picture of ground rather than a sheet of paint, and a field
 * under snow still has a lit face and a shaded one. Blended against the snow
 * ladder's matching step, so a shadow on snow is blue and a lit slope is
 * nearly white, which is what snow actually does.
 */
export function snowy(ramp: Ramp, amount: number): Ramp {
  if (amount <= 0.01) return ramp;
  return [
    mix(ramp[0], SNOW[0], amount),
    mix(ramp[1], SNOW[1], amount),
    mix(ramp[2], SNOW[2], amount),
    mix(ramp[3], SNOW[3], amount),
    mix(ramp[4], SNOW[4], amount),
  ] as const;
}

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
  leaf: ['#2e4828', '#38552f', '#263c21'],
  conifer: ['#203722', '#29462a', '#1a291a'],
  scrub: ['#58603b', '#6c7449'],
  /** A furrow in a worked field, and the baulk between two of them. */
  furrow: ['#747d45', '#899152', '#5a6536'],
  rock: ['#625d56', '#7a756c', '#46423e'],
  /** The great rivers, and the thread of light down the middle of one. */
  river: '#325572',
  riverLight: '#456f8d',
  /** Where the water breaks on the shore. */
  surf: '#80a3b4',
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

/**
 * What kind of place this part of the ground is.
 *
 * `tileNoise` is the wrong grain for this and always was. It gives every
 * tile its own number with no relation to its neighbour's, which is right
 * for the speckle in the grass and wrong for everything larger: a field
 * dressed from it has trees scattered one to a tile from edge to edge, at
 * the same thinness everywhere, because nothing knows that the tile next to
 * it is part of the same wood.
 *
 * This asks the question at a coarser grain and smooths between the
 * answers, so what comes back changes slowly across the ground: high here
 * and for the next ten tiles, low over there. Dressing drawn against it
 * comes out in stands and clearings — a copse at one end of the field, bare
 * going at the other, rough ground along the line between — which is what
 * country looks like, and what gives the eye something to judge distance by.
 *
 * `size` is how many tiles a patch runs for. Fed the same `salt` it always
 * answers the same, so nothing crawls when the camera moves.
 */
export function patchOf(tx: number, ty: number, size: number, salt = 0): number {
  const fx = tx / size;
  const fy = ty / size;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  // Smoothstep rather than a straight blend, so a patch has a soft middle
  // and a definite edge instead of looking like a stretched chequerboard.
  const ease = (t: number): number => t * t * (3 - 2 * t);
  const ax = ease(fx - x0);
  const ay = ease(fy - y0);
  const topLeft = tileNoise(x0, y0, salt);
  const topRight = tileNoise(x0 + 1, y0, salt);
  const lowLeft = tileNoise(x0, y0 + 1, salt);
  const lowRight = tileNoise(x0 + 1, y0 + 1, salt);
  const top = topLeft + (topRight - topLeft) * ax;
  const low = lowLeft + (lowRight - lowLeft) * ax;
  return top + (low - top) * ay;
}

/**
 * Which worked field a tile belongs to, and how that field was ploughed.
 *
 * Ploughland was not a continuous texture, it was somebody's strip next to
 * somebody else's, and the thing you see from a hill is the boundaries: one
 * block running one way, the next running the other. Fixing the direction
 * to the tile gave the opposite — every tile its own direction, which at
 * any distance averages out to a single grey hatch.
 *
 * So a field is a block of tiles, and this says which block a tile is in.
 * `edge` is true where the block ends, which is where the baulk goes.
 */
export const FIELD_TILES = 4;

export function fieldOf(tx: number, ty: number): {
  along: number;
  tone: number;
  edgeX: boolean;
  edgeY: boolean;
} {
  const fx = Math.floor(tx / FIELD_TILES);
  const fy = Math.floor(ty / FIELD_TILES);
  return {
    along: tileNoise(fx, fy, 77) > 0.5 ? 1 : -1,
    tone: tileNoise(fx, fy, 91),
    edgeX: ((tx % FIELD_TILES) + FIELD_TILES) % FIELD_TILES === 0,
    edgeY: ((ty % FIELD_TILES) + FIELD_TILES) % FIELD_TILES === 0,
  };
}

/**
 * The swell, at a point of the sea and a moment of the clock.
 *
 * Water was the one thing on this map that never moved and never varied: a
 * flat tile of one blue with, now and then, a single pale pixel for a
 * ripple. A sea fought on that is a sheet of paper with ships standing on
 * it, and even at rest the eye knows that water is the surface that is
 * always doing something.
 *
 * Three trains of waves at different angles, lengths and speeds, summed.
 * One would be corrugated iron, and two would beat against each other in a
 * pattern you can see; three never quite repeat, which is what an open sea
 * looks like. Everything is a function of where and when, so nothing is
 * stored, the far side of the field is in the same sea as the near one, and
 * a battle paused shows the same water it showed a moment before.
 *
 * Comes back between minus one and one: the trough and the crest.
 */
export function swellAt(x: number, y: number, seconds: number): number {
  const long = Math.sin((x * 0.034 + y * 0.051) - seconds * 0.62);
  const cross = Math.sin((x * -0.058 + y * 0.027) - seconds * 0.41);
  const chop = Math.sin((x * 0.092 + y * 0.071) - seconds * 1.05);
  return long * 0.48 + cross * 0.34 + chop * 0.18;
}

/** Above this, a wave is breaking and shows white along its back. */
export const CREST = 0.68;
