import { describe, it, expect } from 'vitest';
import { Rng, hashString } from '../src/core/rng';

describe('Rng', () => {
  it('is reproducible from the same seed', () => {
    const a = new Rng('campaign-1080');
    const b = new Rng('campaign-1080');
    const drawsA = Array.from({ length: 200 }, () => a.nextUint32());
    const drawsB = Array.from({ length: 200 }, () => b.nextUint32());
    expect(drawsA).toEqual(drawsB);
  });

  it('produces different streams for different seeds', () => {
    const a = new Rng('a');
    const b = new Rng('b');
    const drawsA = Array.from({ length: 50 }, () => a.nextUint32());
    const drawsB = Array.from({ length: 50 }, () => b.nextUint32());
    expect(drawsA).not.toEqual(drawsB);
  });

  it('keeps next() inside [0, 1)', () => {
    const rng = new Rng(12345);
    for (let i = 0; i < 20000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('keeps int() inside the inclusive range and hits both ends', () => {
    const rng = new Rng(7);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 20000; i++) {
      const value = rng.int(3, 9);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(9);
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    expect(min).toBe(3);
    expect(max).toBe(9);
  });

  it('int() is roughly uniform', () => {
    const rng = new Rng('uniform');
    const counts = new Array(6).fill(0) as number[];
    const draws = 60000;
    for (let i = 0; i < draws; i++) counts[rng.int(0, 5)]!++;
    for (const count of counts) {
      // expected 10000 per bucket; allow a generous 10% band
      expect(count).toBeGreaterThan(draws / 6 * 0.9);
      expect(count).toBeLessThan(draws / 6 * 1.1);
    }
  });

  it('int() rejects an empty range', () => {
    expect(() => new Rng(1).int(5, 4)).toThrow();
  });

  it('chance() honours the probability', () => {
    const rng = new Rng('chance');
    let hits = 0;
    for (let i = 0; i < 40000; i++) if (rng.chance(0.25)) hits++;
    expect(hits / 40000).toBeCloseTo(0.25, 1);
    expect(rng.chance(0)).toBe(false);
    expect(rng.chance(1)).toBe(true);
  });

  it('weighted() respects the weights', () => {
    const rng = new Rng('weighted');
    const items = [
      { id: 'rare', w: 1 },
      { id: 'common', w: 9 },
    ];
    const counts: Record<string, number> = { rare: 0, common: 0 };
    for (let i = 0; i < 20000; i++) counts[rng.weighted(items, (x) => x.w).id]!++;
    expect(counts.common! / 20000).toBeCloseTo(0.9, 1);
  });

  it('weighted() falls back to uniform when all weights are zero', () => {
    const rng = new Rng(3);
    const picked = rng.weighted(['a', 'b'], () => 0);
    expect(['a', 'b']).toContain(picked);
  });

  it('shuffle() keeps every element exactly once', () => {
    const rng = new Rng('shuffle');
    const source = Array.from({ length: 64 }, (_, i) => i);
    const shuffled = rng.shuffle([...source]);
    expect([...shuffled].sort((x, y) => x - y)).toEqual(source);
    expect(shuffled).not.toEqual(source);
  });

  it('save/restore resumes the identical stream', () => {
    const rng = new Rng('save');
    for (let i = 0; i < 17; i++) rng.nextUint32();
    const state = rng.save();
    const expected = Array.from({ length: 10 }, () => rng.nextUint32());
    const resumed = Rng.fromState(state);
    expect(Array.from({ length: 10 }, () => resumed.nextUint32())).toEqual(expected);
  });

  it('fork() is deterministic but independent of the parent stream', () => {
    const parentA = new Rng('fork');
    const childA = parentA.fork('battle');
    const parentB = new Rng('fork');
    const childB = parentB.fork('battle');
    expect(childA.nextUint32()).toBe(childB.nextUint32());

    const other = new Rng('fork').fork('economy');
    expect(new Rng('fork').fork('battle').nextUint32()).not.toBe(other.nextUint32());
  });

  it('normal() centres on the mean', () => {
    const rng = new Rng('normal');
    let sum = 0;
    const draws = 20000;
    for (let i = 0; i < draws; i++) sum += rng.normal(10, 2);
    expect(sum / draws).toBeCloseTo(10, 1);
  });

  it('hashString is stable and order sensitive', () => {
    expect(hashString('croatia')).toBe(hashString('croatia'));
    expect(hashString('croatia')).not.toBe(hashString('aitaorc'));
  });
});
