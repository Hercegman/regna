/**
 * Map projection and the camera.
 *
 * Provinces are stored at their real longitude and latitude, so drawing the map
 * means projecting the globe onto the screen. A Mercator projection keeps
 * compass bearings and the familiar shape of Europe; at this scale its
 * distortion towards Trondheim is a feature rather than a problem, because it
 * gives the crowded north more room.
 */
import type { Point } from '../core/types';
import { clamp } from '../core/types';

export interface Camera {
  /** Longitude and latitude at the centre of the view. */
  centreLon: number;
  centreLat: number;
  /** Pixels per projected unit. */
  zoom: number;
  readonly minZoom: number;
  readonly maxZoom: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** Mercator y for a latitude, in the same units as longitude. */
export function mercatorY(lat: number): number {
  const clamped = clamp(lat, -84, 84);
  const radians = (clamped * Math.PI) / 180;
  return (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

/** Inverse of mercatorY. */
export function inverseMercator(y: number): number {
  const radians = (y * Math.PI) / 180;
  return ((2 * Math.atan(Math.exp(radians)) - Math.PI / 2) * 180) / Math.PI;
}

export function createCamera(): Camera {
  return {
    // Centred on the Adriatic, which puts the whole theatre on screen.
    centreLon: 16,
    centreLat: 43,
    zoom: 22,
    minZoom: 5,
    maxZoom: 90,
  };
}

export function project(
  camera: Camera,
  viewport: Viewport,
  lon: number,
  lat: number,
): Point {
  const x = (lon - camera.centreLon) * camera.zoom + viewport.width / 2;
  const y = (mercatorY(camera.centreLat) - mercatorY(lat)) * camera.zoom + viewport.height / 2;
  return { x, y };
}

export function unproject(
  camera: Camera,
  viewport: Viewport,
  x: number,
  y: number,
): { lon: number; lat: number } {
  const lon = (x - viewport.width / 2) / camera.zoom + camera.centreLon;
  const mercator = mercatorY(camera.centreLat) - (y - viewport.height / 2) / camera.zoom;
  return { lon, lat: inverseMercator(mercator) };
}

/** Pans by a screen-space delta. */
export function panCamera(camera: Camera, dx: number, dy: number): void {
  camera.centreLon -= dx / camera.zoom;
  const mercator = mercatorY(camera.centreLat) + dy / camera.zoom;
  camera.centreLat = clamp(inverseMercator(mercator), -60, 72);
  camera.centreLon = clamp(camera.centreLon, -40, 80);
}

/** Zooms about a screen point, so the ground under the cursor stays put. */
export function zoomCamera(
  camera: Camera,
  viewport: Viewport,
  factor: number,
  anchorX: number,
  anchorY: number,
): void {
  const before = unproject(camera, viewport, anchorX, anchorY);
  camera.zoom = clamp(camera.zoom * factor, camera.minZoom, camera.maxZoom);
  const after = unproject(camera, viewport, anchorX, anchorY);
  camera.centreLon += before.lon - after.lon;
  camera.centreLat = clamp(
    inverseMercator(mercatorY(camera.centreLat) + (mercatorY(before.lat) - mercatorY(after.lat))),
    -60,
    72,
  );
}
