import { describe, it, expect } from 'vitest';
import {
  createCamera,
  inverseMercator,
  mercatorY,
  panCamera,
  project,
  projectMercator,
  unproject,
  viewTransform,
  zoomCamera,
} from '../src/render/projection';

const viewport = { width: 1200, height: 800 };

describe('projection', () => {
  it('round-trips a latitude through the Mercator transform', () => {
    for (const lat of [-40, -10, 0, 15, 43.5, 60, 70]) {
      expect(inverseMercator(mercatorY(lat))).toBeCloseTo(lat, 6);
    }
  });

  it('puts the camera centre at the centre of the screen', () => {
    const camera = createCamera();
    const point = project(camera, viewport, camera.centreLon, camera.centreLat);
    expect(point.x).toBeCloseTo(viewport.width / 2, 6);
    expect(point.y).toBeCloseTo(viewport.height / 2, 6);
  });

  it('round-trips a screen point', () => {
    const camera = createCamera();
    const { lon, lat } = unproject(camera, viewport, 400, 250);
    const back = project(camera, viewport, lon, lat);
    expect(back.x).toBeCloseTo(400, 4);
    expect(back.y).toBeCloseTo(250, 4);
  });

  it('places north above south and east right of west', () => {
    const camera = createCamera();
    const north = project(camera, viewport, 16, 50);
    const south = project(camera, viewport, 16, 36);
    const east = project(camera, viewport, 30, 43);
    const west = project(camera, viewport, 0, 43);
    expect(north.y).toBeLessThan(south.y);
    expect(east.x).toBeGreaterThan(west.x);
  });

  it('pans in the direction of the drag', () => {
    const camera = createCamera();
    const before = camera.centreLon;
    panCamera(camera, 100, 0);
    expect(camera.centreLon).toBeLessThan(before);
  });

  it('keeps the point under the cursor fixed while zooming', () => {
    const camera = createCamera();
    const anchorX = 320;
    const anchorY = 210;
    const before = unproject(camera, viewport, anchorX, anchorY);
    zoomCamera(camera, viewport, 1.8, anchorX, anchorY);
    const after = unproject(camera, viewport, anchorX, anchorY);
    expect(after.lon).toBeCloseTo(before.lon, 3);
    expect(after.lat).toBeCloseTo(before.lat, 3);
  });

  it('clamps zoom to its limits', () => {
    const camera = createCamera();
    for (let i = 0; i < 50; i++) zoomCamera(camera, viewport, 2, 600, 400);
    expect(camera.zoom).toBeLessThanOrEqual(camera.maxZoom);
    for (let i = 0; i < 100; i++) zoomCamera(camera, viewport, 0.5, 600, 400);
    expect(camera.zoom).toBeGreaterThanOrEqual(camera.minZoom);
  });
});

describe('bulk transform', () => {
  it('agrees with projecting one point at a time', () => {
    const camera = createCamera();
    const { scale, offsetX, offsetY } = viewTransform(camera, viewport);
    for (const [lon, lat] of [[0, 0], [16, 43], [-9, 38.7], [31, 55]] as const) {
      const direct = project(camera, viewport, lon, lat);
      const bulkX = lon * scale + offsetX;
      const bulkY = offsetY - mercatorY(lat) * scale;
      expect(bulkX).toBeCloseTo(direct.x, 6);
      expect(bulkY).toBeCloseTo(direct.y, 6);
    }
  });

  it('projects from Mercator space to the same place', () => {
    const camera = createCamera();
    for (const [lon, lat] of [[12.5, 41.9], [-0.1, 51.5], [35, 31.8]] as const) {
      const direct = project(camera, viewport, lon, lat);
      const viaMercator = projectMercator(camera, viewport, lon, mercatorY(lat));
      expect(viaMercator.x).toBeCloseTo(direct.x, 9);
      expect(viaMercator.y).toBeCloseTo(direct.y, 9);
    }
  });
});
