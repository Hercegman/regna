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
 */
import type { Terrain } from '../../core/types';

/** Dark to light. Index 2 is the flat, unlit ground. */
export type Ramp = readonly [string, string, string, string, string];

const RAMPS: Readonly<Record<Terrain, Ramp>> = {
  plains: ['#2f4a1c', '#3d5f23', '#4e7a2e', '#5f8c38', '#74a048'],
  farmland: ['#3a4a18', '#4e621f', '#647c28', '#7b9434', '#93ab45'],
  forest: ['#1c3418', '#25431e', '#2f5626', '#3a6a2f', '#49803c'],
  hills: ['#3f4a1e', '#556026', '#6d7a2f', '#86913c', '#9da84f'],
  mountains: ['#45413c', '#5c564f', '#767066', '#908a80', '#aaa49a'],
  marsh: ['#2c3a2e', '#3a4c3c', '#4b604d', '#5d745f', '#718872'],
  steppe: ['#4a4a22', '#60602c', '#787838', '#8f8f46', '#a6a657'],
  desert: ['#6b5a34', '#897444', '#a68e56', '#bfa66a', '#d4bc82'],
  coastal: ['#3a4a24', '#4c602e', '#60783a', '#749047', '#8aa659'],
};

/** Deep water to shallow. */
export const WATER: Ramp = ['#0c1b2c', '#11253c', '#17304d', '#1d3c5e', '#254a71'];

/** What a province of this ground is made of. */
export function rampFor(terrain: Terrain): Ramp {
  return RAMPS[terrain] ?? RAMPS.plains;
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
 * Weak on purpose. A province reads as its own country first and as somebody
 * 's possession second, which is both how these maps looked and how the
 * frontier bands end up doing the real work.
 */
export const OWNER_WASH = 0.16;

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
