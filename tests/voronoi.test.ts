import { describe, it, expect } from 'vitest';
import { voronoiCells, polygonArea, pointInPolygon, type Site } from '../src/render/voronoi';

const BOUNDS = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

describe('dividing a map into cells', () => {
  it('gives a single site the whole map', () => {
    const cells = voronoiCells([{ x: 50, y: 50 }], BOUNDS);
    expect(cells.length).toBe(1);
    expect(polygonArea(cells[0]!)).toBeCloseTo(10_000, 6);
  });

  it('splits two sites down the middle', () => {
    const cells = voronoiCells([{ x: 25, y: 50 }, { x: 75, y: 50 }], BOUNDS);
    expect(polygonArea(cells[0]!)).toBeCloseTo(5000, 6);
    expect(polygonArea(cells[1]!)).toBeCloseTo(5000, 6);
    // Every vertex of the left cell is on the left of the bisector.
    for (const [x] of cells[0]!) expect(x).toBeLessThanOrEqual(50.000001);
  });

  it('gives every site a cell that contains it', () => {
    const sites: Site[] = Array.from({ length: 40 }, (_, i) => ({
      x: ((i * 37) % 97) + 1,
      y: ((i * 61) % 89) + 5,
    }));
    const cells = voronoiCells(sites, BOUNDS);
    sites.forEach((site, index) => {
      const cell = cells[index]!;
      expect(cell.length, `site ${index} has no cell`).toBeGreaterThanOrEqual(3);
      expect(pointInPolygon(cell, site.x, site.y), `site ${index} is outside its own cell`).toBe(true);
    });
  });

  it('tiles the whole map without gaps or overlap', () => {
    const sites: Site[] = Array.from({ length: 30 }, (_, i) => ({
      x: ((i * 29) % 95) + 2,
      y: ((i * 53) % 91) + 3,
    }));
    const cells = voronoiCells(sites, BOUNDS);
    const total = cells.reduce((sum, cell) => sum + polygonArea(cell), 0);
    expect(total).toBeCloseTo(10_000, 3);
  });

  it('puts every point in the cell of its nearest site', () => {
    const sites: Site[] = [
      { x: 20, y: 20 }, { x: 80, y: 25 }, { x: 50, y: 70 }, { x: 15, y: 85 },
    ];
    const cells = voronoiCells(sites, BOUNDS);
    for (let x = 5; x < 100; x += 7) {
      for (let y = 5; y < 100; y += 7) {
        let nearest = 0;
        let best = Infinity;
        sites.forEach((site, index) => {
          const d = (site.x - x) ** 2 + (site.y - y) ** 2;
          if (d < best) { best = d; nearest = index; }
        });
        expect(
          pointInPolygon(cells[nearest]!, x, y),
          `(${x}, ${y}) should belong to site ${nearest}`,
        ).toBe(true);
      }
    }
  });

  it('keeps every cell inside the map', () => {
    const sites: Site[] = Array.from({ length: 25 }, (_, i) => ({
      x: ((i * 41) % 99) + 0.5,
      y: ((i * 17) % 97) + 1.5,
    }));
    for (const cell of voronoiCells(sites, BOUNDS)) {
      for (const [x, y] of cell) {
        expect(x).toBeGreaterThanOrEqual(BOUNDS.minX - 1e-6);
        expect(x).toBeLessThanOrEqual(BOUNDS.maxX + 1e-6);
        expect(y).toBeGreaterThanOrEqual(BOUNDS.minY - 1e-6);
        expect(y).toBeLessThanOrEqual(BOUNDS.maxY + 1e-6);
      }
    }
  });

  it('is quick enough to do once at load for a map this size', () => {
    const sites: Site[] = Array.from({ length: 222 }, (_, i) => ({
      x: ((i * 7919) % 1000) / 10,
      y: ((i * 6151) % 1000) / 10,
    }));
    const started = performance.now();
    const cells = voronoiCells(sites, BOUNDS);
    const elapsed = performance.now() - started;
    expect(cells.length).toBe(222);
    expect(elapsed, `took ${elapsed.toFixed(0)}ms`).toBeLessThan(500);
  });
});
