import { describe, it, expect } from 'vitest';
import { provinceShapes } from '../src/render/provinces';
import { pointInPolygon, polygonArea } from '../src/render/voronoi';
import { REGIONS, getRegion } from '../src/core/data/regions';
import { mercatorY } from '../src/render/projection';
import { borderBetween } from '../src/core/data/adjacency';

describe('province shapes', () => {
  it('gives every province a shape that contains its own settlement', () => {
    const shapes = provinceShapes();
    expect(shapes.length).toBe(REGIONS.length);
    for (const shape of shapes) {
      const region = getRegion(shape.id);
      expect(shape.cell.length, `${region.settlement} has no shape`).toBeGreaterThanOrEqual(3);
      expect(
        pointInPolygon(shape.cell, region.lon, mercatorY(region.lat)),
        `${region.settlement} sits outside its own province`,
      ).toBe(true);
      expect(polygonArea(shape.cell)).toBeGreaterThan(0);
    }
  });

  it('divides the whole theatre between them, leaving no ground unclaimed', () => {
    const shapes = provinceShapes();
    const total = shapes.reduce((sum, shape) => sum + polygonArea(shape.cell), 0);
    // The frame runs from the western Atlantic to the Caspian and from the
    // Sahel to the Arctic, in longitude against Mercator latitude.
    const frame = (58 - -18) * (mercatorY(73) - mercatorY(2));
    expect(total).toBeCloseTo(frame, 1);
  });

  it('names a neighbour across an edge, and agrees with itself about it', () => {
    const shapes = provinceShapes();
    const byId = new Map(shapes.map((shape) => [shape.id, shape]));
    let shared = 0;
    for (const shape of shapes) {
      expect(shape.edgeNeighbours.length).toBe(shape.cell.length);
      for (const neighbour of shape.edgeNeighbours) {
        if (!neighbour) continue;
        shared += 1;
        expect(neighbour).not.toBe(shape.id);
        // If this province calls that one a neighbour, the feeling is mutual.
        const other = byId.get(neighbour)!;
        expect(other.edgeNeighbours).toContain(shape.id);
      }
    }
    expect(shared).toBeGreaterThan(REGIONS.length);
  });

  it('mostly agrees with the hand-drawn land borders', () => {
    // The shapes are derived from coordinates and the borders were authored by
    // hand, so they are two independent accounts of the same geography. They
    // should largely coincide.
    const shapes = provinceShapes();
    let touching = 0;
    let alsoABorder = 0;
    for (const shape of shapes) {
      for (const neighbour of new Set(shape.edgeNeighbours)) {
        if (!neighbour) continue;
        touching += 1;
        const border = borderBetween(shape.id, neighbour);
        if (border?.kind === 'land') alsoABorder += 1;
      }
    }
    expect(alsoABorder / touching).toBeGreaterThan(0.45);
  });

});

