/**
 * The isometric view.
 *
 * The projection is the one thing everything else on the map is drawn
 * through, so the properties worth pinning down are the ones a picture will
 * not tell you: that a point survives the trip to the screen and back, that
 * tiles and the world agree about where each other are, and that the ground
 * is read at a coarseness matched to how big a tile is — which is what stops
 * a mountain range turning into a field of spikes.
 */
import { describe, it, expect } from 'vitest';
import {
  EXAGGERATION,
  METRES_PER_STEP,
  SQUASH,
  cornerOf,
  floorAt,
  floorFrom,
  isoTransform,
  latLonFrom,
  liftFor,
  pixelsPerStep,
  tileOf,
  unitsPerTile,
} from '../src/render/iso/view';
import { groundFrom, flatGround } from '../src/render/iso/elevation';
import { WATER, mix, rampFor, snap, stepFor } from '../src/render/iso/palette';
import { createCamera, mercatorY } from '../src/render/projection';
import { ELEVATION } from '../src/core/data/elevation';

const viewport = { width: 1200, height: 800 };

function transformAt(lon: number, lat: number, zoom: number, scale = 1) {
  const camera = createCamera();
  camera.centreLon = lon;
  camera.centreLat = lat;
  camera.zoom = zoom;
  return isoTransform(camera, viewport, scale);
}

describe('the projection', () => {
  it('puts the camera at the middle of the picture', () => {
    const transform = transformAt(15, 45, 40);
    const at = floorAt(transform, 15, mercatorY(45));
    expect(at.x).toBeCloseTo(viewport.width / 2, 6);
    expect(at.y).toBeCloseTo(viewport.height / 2, 6);
  });

  it('survives the trip to the screen and back', () => {
    const transform = transformAt(12, 48, 55);
    for (const [lon, lat] of [[12, 48], [-4, 61], [31, 22], [45, 55]] as const) {
      const at = floorAt(transform, lon, mercatorY(lat));
      const back = floorFrom(transform, at.x, at.y);
      expect(back.lon).toBeCloseTo(lon, 6);
      expect(back.merc).toBeCloseTo(mercatorY(lat), 6);
      expect(latLonFrom(transform, at.x, at.y).lat).toBeCloseTo(lat, 4);
    }
  });

  it('keeps the map the way up it has always been', () => {
    const transform = transformAt(15, 45, 40);
    const here = floorAt(transform, 15, mercatorY(45));
    const east = floorAt(transform, 16, mercatorY(45));
    const north = floorAt(transform, 15, mercatorY(46));
    // East is to the right and nowhere else; north is up and nowhere else.
    // A grid laid along the world's own axes would turn both forty-five
    // degrees and put north in a corner.
    expect(east.x).toBeGreaterThan(here.x);
    expect(east.y).toBeCloseTo(here.y, 6);
    expect(north.y).toBeLessThan(here.y);
    expect(north.x).toBeCloseTo(here.x, 6);
  });

  it('flattens the ground towards the viewer by exactly the squash', () => {
    const transform = transformAt(15, 45, 40);
    const here = floorAt(transform, 15, mercatorY(45));
    const east = floorAt(transform, 16, mercatorY(45));
    const north = floorAt(transform, 15, mercatorY(45) + 1);
    expect(Math.abs(north.y - here.y) / Math.abs(east.x - here.x)).toBeCloseTo(SQUASH, 6);
  });
});

describe('the tile grid', () => {
  it('agrees with the world about where each tile is', () => {
    const transform = transformAt(15, 45, 40);
    for (const [tx, ty] of [[0, 0], [12, -30], [-7, 5], [100, 100]] as const) {
      const corner = cornerOf(transform, tx, ty);
      const back = tileOf(transform, corner.lon, corner.merc);
      expect(back.tx).toBe(tx);
      expect(back.ty).toBe(ty);
    }
  });

  it('runs diagonally, which is what keeps the tiles diamond', () => {
    const transform = transformAt(15, 45, 40);
    const here = cornerOf(transform, 0, 0);
    const alongX = cornerOf(transform, 1, 0);
    const alongY = cornerOf(transform, 0, 1);
    // One step of either axis moves both longitude and latitude.
    expect(alongX.lon).toBeGreaterThan(here.lon);
    expect(alongX.merc).toBeGreaterThan(here.merc);
    expect(alongY.lon).toBeLessThan(here.lon);
    expect(alongY.merc).toBeGreaterThan(here.merc);
  });

  it('keeps a tile about the same size on screen at any zoom', () => {
    for (const zoom of [8, 20, 55, 140, 400]) {
      const transform = transformAt(15, 45, zoom);
      // Half a tile across, in pixels: the sweep is sized on this, so it is
      // what keeps the number of tiles drawn roughly constant.
      expect(transform.halfWidth).toBeGreaterThan(2);
      expect(transform.halfWidth).toBeLessThan(20);
    }
  });

  it('quantises the tile size so that zooming does not make the grid crawl', () => {
    for (const zoom of [11, 12, 13, 14]) {
      const units = unitsPerTile(zoom);
      expect(Math.log2(units) % 1).toBeCloseTo(0, 9);
    }
  });
});

describe('height', () => {
  it('is quantised into steps, which is what makes a hillside terraced', () => {
    const transform = transformAt(15, 45, 60);
    const step = transform.stepPixels;
    expect(step).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(step)).toBe(true);
    // Two heights inside the same step lift by the same amount.
    expect(liftFor(transform, 10)).toBe(liftFor(transform, 40));
    expect(liftFor(transform, METRES_PER_STEP * 3)).toBe(step * 3);
  });

  it('never lifts the sea', () => {
    const transform = transformAt(15, 45, 60);
    expect(liftFor(transform, 0)).toBe(0);
    expect(liftFor(transform, -4000)).toBe(0);
  });

  it('rises with the zoom, so a mountain stays a mountain', () => {
    expect(pixelsPerStep(200)).toBeGreaterThan(pixelsPerStep(20));
    expect(EXAGGERATION).toBeGreaterThan(1);
  });
});

describe('reading the ground', () => {
  function ramp(): Int16Array {
    // A slope rising east, so interpolation has something to interpolate.
    const posts = new Int16Array(ELEVATION.width * ELEVATION.height);
    for (let row = 0; row < ELEVATION.height; row++) {
      for (let column = 0; column < ELEVATION.width; column++) {
        posts[row * ELEVATION.width + column] = column * 2;
      }
    }
    return posts;
  }

  it('interpolates between posts rather than stepping between them', () => {
    const ground = groundFrom(ramp());
    const west = ground.metresAt(ELEVATION.west + ELEVATION.step * 4, ELEVATION.north - 1);
    const between = ground.metresAt(ELEVATION.west + ELEVATION.step * 4.5, ELEVATION.north - 1);
    const east = ground.metresAt(ELEVATION.west + ELEVATION.step * 5, ELEVATION.north - 1);
    expect(between).toBeGreaterThan(west);
    expect(between).toBeLessThan(east);
  });

  it('reads nothing outside the theatre', () => {
    const ground = groundFrom(ramp());
    expect(ground.metresAt(ELEVATION.west - 5, 40)).toBe(0);
    expect(ground.metresAt(20, ELEVATION.north + 5)).toBe(0);
  });

  it('answers from a coarser copy as the tiles get wider', () => {
    const ground = groundFrom(ramp());
    // A tile the width of one post reads the finest copy; a tile sixteen
    // times that reads four levels down.
    expect(ground.levelFor(ELEVATION.step)).toBe(0);
    expect(ground.levelFor(ELEVATION.step * 2)).toBe(1);
    expect(ground.levelFor(ELEVATION.step * 16)).toBe(4);
  });

  it('averages rather than samples, so a coarse tile is not a lottery', () => {
    // One tall post among flat ground. Read finely it is a mountain; read
    // coarsely it should be a bump, not a spike, and not nothing either.
    const posts = new Int16Array(ELEVATION.width * ELEVATION.height);
    const row = 40;
    const column = 60;
    posts[row * ELEVATION.width + column] = 4000;
    const ground = groundFrom(posts);
    const lon = ELEVATION.west + column * ELEVATION.step;
    const lat = ELEVATION.north - row * ELEVATION.step;
    const fine = ground.metresAtLevel(lon, lat, 0);
    const coarse = ground.metresAtLevel(lon, lat, 3);
    expect(fine).toBeCloseTo(4000, 0);
    expect(coarse).toBeGreaterThan(0);
    expect(coarse).toBeLessThan(fine / 4);
  });

  it('gives a flat world when there is nothing to read', () => {
    const ground = flatGround();
    expect(ground.metresAt(15, 45)).toBe(0);
  });
});

describe('the palette', () => {
  it('gives every ground a ladder of five', () => {
    for (const terrain of ['plains', 'forest', 'mountains', 'desert', 'marsh'] as const) {
      const ladder = rampFor(terrain);
      expect(ladder.length).toBe(5);
      for (const colour of ladder) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(WATER.length).toBe(5);
  });

  it('puts the three faces of a tile far apart on the ladder', () => {
    const top = stepFor('top', 0);
    const right = stepFor('right', 0);
    const left = stepFor('left', 0);
    expect(top).toBeGreaterThan(right);
    expect(right).toBeGreaterThan(left);
  });

  it('lights a tile by which way it leans', () => {
    expect(stepFor('top', 1)).toBeGreaterThan(stepFor('top', 0));
    expect(stepFor('top', -1)).toBeLessThan(stepFor('top', 0));
    // A face that is not the top does not change: a cliff is a cliff.
    expect(stepFor('left', 1)).toBe(stepFor('left', -1));
  });

  it('never leaves the ladder', () => {
    for (const lean of [-9, -1, 0, 1, 9]) {
      for (const face of ['top', 'left', 'right'] as const) {
        const step = stepFor(face, lean);
        expect(step).toBeGreaterThanOrEqual(0);
        expect(step).toBeLessThanOrEqual(4);
      }
    }
  });

  it('mixes and snaps without leaving the range', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0.5)).toMatch(/^#[0-9a-f]{6}$/);
    for (const colour of ['#123456', '#ffffff', '#000000', '#7f8081']) {
      expect(snap(colour)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('snaps to a short list, which is what keeps it pixel art', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 256; i++) {
      seen.add(snap(`#${i.toString(16).padStart(2, '0')}0000`));
    }
    // Two hundred and fifty-six greens become a dozen.
    expect(seen.size).toBeLessThanOrEqual(12);
  });
});
