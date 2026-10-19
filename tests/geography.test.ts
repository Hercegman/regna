import { describe, it, expect } from 'vitest';
import { LAND_RINGS, LAKE_RINGS, RIVER_LINES, GEO_BOUNDS, type Ring } from '../src/core/data/geography';
import { REGIONS } from '../src/core/data/regions';

/** Standard ray casting. The rings are closed, so the duplicate end is harmless. */
function inRing(ring: Ring, lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const straddles = yi > lat !== yj > lat;
    if (straddles && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function onLand(lon: number, lat: number): boolean {
  return LAND_RINGS.some((ring) => inRing(ring, lon, lat));
}

describe('the coastline', () => {
  it('is present and not absurdly heavy', () => {
    expect(LAND_RINGS.length).toBeGreaterThan(50);
    const points = LAND_RINGS.reduce((sum, ring) => sum + ring.length, 0);
    expect(points).toBeGreaterThan(1500);
    expect(points).toBeLessThan(40_000);
  });

  it('keeps every ring closed and inside the bounds it was clipped to', () => {
    for (const set of [LAND_RINGS, LAKE_RINGS]) {
      for (const ring of set) {
        expect(ring.length).toBeGreaterThanOrEqual(4);
        expect(ring[0]).toEqual(ring[ring.length - 1]);
        for (const [lon, lat] of ring) {
          expect(lon).toBeGreaterThanOrEqual(GEO_BOUNDS.west - 0.01);
          expect(lon).toBeLessThanOrEqual(GEO_BOUNDS.east + 0.01);
          expect(lat).toBeGreaterThanOrEqual(GEO_BOUNDS.south - 0.01);
          expect(lat).toBeLessThanOrEqual(GEO_BOUNDS.north + 0.01);
        }
      }
    }
  });

  it('puts the land where the land is', () => {
    const places: readonly [string, number, number][] = [
      ['Rome', 12.5, 41.9],
      ['Paris', 2.35, 48.86],
      ['Moscow', 37.62, 55.75],
      ['Cairo', 31.24, 30.04],
      ['Baghdad', 44.36, 33.31],
      ['Toledo', -4.03, 39.86],
      ['Krakow', 19.94, 50.06],
    ];
    for (const [name, lon, lat] of places) {
      expect(onLand(lon, lat), `${name} should be on land`).toBe(true);
    }
  });

  it('puts the sea where the sea is', () => {
    const waters: readonly [string, number, number][] = [
      ['the middle of the Mediterranean', 17, 35],
      ['the Bay of Biscay', -5, 45],
      ['the North Sea', 3, 56],
      ['the Black Sea', 34, 43],
      ['the Aegean', 25, 37.5],
      ['the Atlantic west of Ireland', -14, 53],
    ];
    for (const [name, lon, lat] of waters) {
      expect(onLand(lon, lat), `${name} should be open water`).toBe(false);
    }
  });

  it('separates Britain and Ireland from the continent', () => {
    expect(onLand(-0.1, 51.5)).toBe(true); // London
    expect(onLand(-6.26, 53.35)).toBe(true); // Dublin
    expect(onLand(-5.5, 53.4)).toBe(false); // the Irish Sea between them
    expect(onLand(1.4, 50.6)).toBe(false); // the Channel
  });

  it('agrees with the provinces about where they are', () => {
    // Most settlements fall on land. The exceptions are all harbours whose
    // point sits a little seaward of a simplified coast: Venice in its lagoon,
    // Trondheim up a fjord, Zadar and Split on their islands and spits. The
    // renderer deals with them by drawing ground under every settlement, so
    // this is a proportion rather than a rule.
    const ashore = REGIONS.filter((region) => onLand(region.lon, region.lat));
    expect(ashore.length / REGIONS.length).toBeGreaterThan(0.9);
    const adrift = REGIONS.filter((region) => !onLand(region.lon, region.lat));
    for (const region of adrift) {
      expect(region.port, `${region.settlement} is inland but off the coastline`).toBe(true);
    }
  });

  it('carries inland water and the great rivers', () => {
    expect(LAKE_RINGS.length).toBeGreaterThan(10);
    expect(RIVER_LINES.length).toBeGreaterThan(20);
    for (const line of RIVER_LINES) expect(line.length).toBeGreaterThanOrEqual(3);
  });
});
