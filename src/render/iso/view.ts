/**
 * The isometric view.
 *
 * Drawn the way Transport Tycoon and Locomotion drew theirs: diamond tiles
 * seen from a fixed corner, each one raised by the height of the ground under
 * it. Nothing rotates and nothing tilts, so the whole picture is a flat
 * drawing with a strict back-to-front order, which is why it can be made of
 * pixels rather than polygons.
 *
 * With one difference, and it matters. Those games lay their tile grid along
 * the world's own axes, which turns the world forty-five degrees on screen:
 * north ends up in a corner. Their worlds are invented, so nobody minds.
 * Ours is Europe, and a Europe tilted into a diamond is a Europe nobody can
 * read. So the grid runs diagonally through longitude and latitude instead:
 * the tiles come out as diamonds exactly as they should, and the map stays
 * the way up it has always been.
 *
 * The world keeps the coordinates it already had — longitude across, Mercator
 * latitude up — so every province shape, sea lane and trade road in the game
 * is drawn through this without being reprojected.
 */
import type { Point } from '../../core/types';
import type { Camera, Viewport } from '../projection';
import { inverseMercator, mercatorY } from '../projection';

/**
 * How much the ground is flattened towards the viewer.
 *
 * A half is the classic two-to-one: a tile twice as wide as it is tall. It
 * is also what squashes the map vertically, which is the price of the look.
 */
export const SQUASH = 0.5;

/**
 * How far a tile is raised for each step of height.
 *
 * Quantising height into steps is what makes a hillside a flight of terraces
 * rather than a smooth ramp, and that is most of the look. A hundred metres
 * is fine enough that the Alps have shape and coarse enough that the
 * Hungarian plain is flat.
 */
export const METRES_PER_STEP = 100;

/**
 * How much taller than life the ground is.
 *
 * A degree is about 111 km and the tallest thing in the theatre is under five
 * of them, so at true scale a continent is a sheet of paper. Every map of
 * this kind exaggerates; this one does it by twenty-five.
 */
export const EXAGGERATION = 25;

const METRES_PER_UNIT = 111_000;

/**
 * How much of the world a tile covers, in projected units.
 *
 * Tiles are kept to roughly eight pixels across whatever the zoom, so the
 * number drawn stays about the same and the detail doubles as you close in.
 * Quantised to powers of two so that zooming does not make the grid crawl.
 */
export function unitsPerTile(zoom: number): number {
  const wanted = 6 / Math.max(1, zoom);
  return Math.pow(2, Math.round(Math.log2(wanted)));
}

/** Pixels a tile rises for one step of height. Always whole pixels. */
export function pixelsPerStep(zoom: number): number {
  const units = (METRES_PER_STEP * EXAGGERATION) / METRES_PER_UNIT;
  return Math.max(1, Math.round(units * zoom * SQUASH));
}

export interface IsoTransform {
  /** Pixels per projected unit across. */
  readonly zoom: number;
  /** Where longitude zero and the equator would fall. */
  readonly originX: number;
  readonly originY: number;
  readonly unitsPerTile: number;
  /** Half a tile across, and half a tile down. */
  readonly halfWidth: number;
  readonly halfHeight: number;
  readonly stepPixels: number;
}

/**
 * The one transform everything is drawn through.
 *
 * `scale` is for the pixel-art canvas: the picture is drawn small and blown
 * up with hard edges, so this works in the small picture's pixels.
 */
export function isoTransform(camera: Camera, viewport: Viewport, scale = 1): IsoTransform {
  const zoom = camera.zoom / scale;
  const width = viewport.width / scale;
  const height = viewport.height / scale;
  const units = unitsPerTile(zoom);
  return {
    zoom,
    originX: width / 2 - camera.centreLon * zoom,
    originY: height / 2 + mercatorY(camera.centreLat) * zoom * SQUASH,
    unitsPerTile: units,
    halfWidth: units * zoom,
    halfHeight: units * zoom * SQUASH,
    stepPixels: pixelsPerStep(zoom),
  };
}

/** Where a point of the world floor lands, before any height lifts it. */
export function floorAt(transform: IsoTransform, lon: number, merc: number): Point {
  return {
    x: transform.originX + lon * transform.zoom,
    y: transform.originY - merc * transform.zoom * SQUASH,
  };
}

/** The same, for a longitude and latitude. */
export function floorAtLatLon(transform: IsoTransform, lon: number, lat: number): Point {
  return floorAt(transform, lon, mercatorY(lat));
}

/** How far up a height in metres lifts whatever stands on it. */
export function liftFor(transform: IsoTransform, metres: number): number {
  if (metres <= 0) return 0;
  return Math.round(metres / METRES_PER_STEP) * transform.stepPixels;
}

/**
 * Back from the picture to the world floor.
 *
 * Only the floor: a point on screen sits on every tile at every height, so
 * whatever is asking has to decide which it meant. Picking and the sea both
 * want sea level, which is this.
 */
export function floorFrom(
  transform: IsoTransform,
  x: number,
  y: number,
): { lon: number; merc: number } {
  return {
    lon: (x - transform.originX) / transform.zoom,
    merc: (transform.originY - y) / (transform.zoom * SQUASH),
  };
}

/** The same, as a longitude and latitude. */
export function latLonFrom(
  transform: IsoTransform,
  x: number,
  y: number,
): { lon: number; lat: number } {
  const floor = floorFrom(transform, x, y);
  return { lon: floor.lon, lat: inverseMercator(floor.merc) };
}

/**
 * The corner of a tile, in world units.
 *
 * The grid runs diagonally: one step of tx goes north-east, one step of ty
 * goes north-west. That is what keeps the tiles diamond and the map upright.
 */
export function cornerOf(
  transform: IsoTransform,
  tx: number,
  ty: number,
): { lon: number; merc: number } {
  const d = transform.unitsPerTile;
  return { lon: (tx - ty) * d, merc: (tx + ty) * d };
}

/** The tile a world point falls on. */
export function tileOf(
  transform: IsoTransform,
  lon: number,
  merc: number,
): { tx: number; ty: number } {
  const d = transform.unitsPerTile;
  return {
    tx: Math.floor((merc / d + lon / d) / 2),
    ty: Math.floor((merc / d - lon / d) / 2),
  };
}
