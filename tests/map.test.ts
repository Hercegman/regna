import { describe, it, expect } from 'vitest';
import { REGIONS, getRegion, REGION_IDS } from '../src/core/data/regions';
import { BORDERS, ADJACENCY, neighbours, landNeighbours, seaNeighbours, borderBetween } from '../src/core/data/adjacency';
import { FACTIONS, INDEPENDENT_ID } from '../src/core/data/factions';
import type { RegionId } from '../src/core/types';

const ALL_IDS = new Set<RegionId>(REGION_IDS);

describe('region data', () => {
  it('is a large map', () => {
    expect(REGIONS.length).toBeGreaterThanOrEqual(150);
  });

  it('has unique ids', () => {
    expect(new Set(REGIONS.map((r) => r.id)).size).toBe(REGIONS.length);
  });

  it('places every settlement at plausible real-world coordinates', () => {
    for (const region of REGIONS) {
      // The theatre runs from the Atlantic to the Caspian and from Trondheim
      // to the Sahel.
      expect(region.lon, region.settlement).toBeGreaterThan(-15);
      expect(region.lon, region.settlement).toBeLessThan(55);
      expect(region.lat, region.settlement).toBeGreaterThan(5);
      expect(region.lat, region.settlement).toBeLessThan(70);
    }
  });

  it('gives no two settlements the same position', () => {
    const seen = new Set<string>();
    for (const region of REGIONS) {
      const key = `${region.lon.toFixed(2)},${region.lat.toFixed(2)}`;
      expect(seen.has(key), `${region.settlement} duplicates a position`).toBe(false);
      seen.add(key);
    }
  });

  it('keeps population and fertility in range', () => {
    for (const region of REGIONS) {
      expect(region.population, region.settlement).toBeGreaterThan(0);
      expect(region.population, region.settlement).toBeLessThanOrEqual(45);
      expect(region.fertility, region.settlement).toBeGreaterThanOrEqual(0.3);
      expect(region.fertility, region.settlement).toBeLessThanOrEqual(1.5);
    }
  });

  it('assigns every region to a known faction or to the independents', () => {
    const known = new Set<string>([...FACTIONS.map((f) => f.id), INDEPENDENT_ID]);
    for (const region of REGIONS) {
      expect(known.has(region.owner), `${region.settlement} -> ${region.owner}`).toBe(true);
    }
  });

  it('never gives a 1080 province to a faction that does not exist yet', () => {
    const byId = new Map(FACTIONS.map((f) => [f.id as string, f]));
    for (const region of REGIONS) {
      if (region.owner === INDEPENDENT_ID) continue;
      const faction = byId.get(region.owner)!;
      expect(faction.appearsIn, `${region.settlement} owned by ${faction.name}`).toBe(1080);
    }
  });

  it('gives every faction present in 1080 at least one province', () => {
    const owned = new Set(REGIONS.map((r) => r.owner as string));
    for (const faction of FACTIONS) {
      if (faction.appearsIn !== 1080) continue;
      expect(owned.has(faction.id), `${faction.name} owns nothing`).toBe(true);
    }
  });

  it('marks one historical seat at most for each faction that holds one', () => {
    const seats = new Map<string, string[]>();
    for (const region of REGIONS) {
      if (!region.capital) continue;
      const list = seats.get(region.owner as string) ?? [];
      list.push(region.settlement);
      seats.set(region.owner as string, list);
    }
    for (const [owner, held] of seats) {
      expect(held.length, `${owner} has two capitals: ${held.join(', ')}`).toBe(1);
      expect(owner).not.toBe(INDEPENDENT_ID);
    }
    // The great powers of 1080 all have one.
    for (const id of ['byzantium', 'france', 'england', 'hungary', 'croatia', 'fatimids']) {
      expect(seats.has(id), `${id} has no seat`).toBe(true);
    }
  });

  it('resolves regions by id and rejects unknown ones', () => {
    expect(getRegion(REGIONS[0]!.id).settlement).toBe(REGIONS[0]!.settlement);
    // @ts-expect-error deliberately unknown id
    expect(() => getRegion('narnia')).toThrow();
  });
});

describe('adjacency', () => {
  it('references only real regions', () => {
    for (const border of BORDERS) {
      expect(ALL_IDS.has(border.a), `border from ${border.a}`).toBe(true);
      expect(ALL_IDS.has(border.b), `border to ${border.b}`).toBe(true);
    }
  });

  it('is symmetric', () => {
    for (const id of REGION_IDS) {
      for (const border of neighbours(id)) {
        const back = borderBetween(border.b, id);
        expect(back, `${border.b} -> ${id}`).toBeDefined();
        expect(back!.kind).toBe(border.kind);
      }
    }
  });

  it('has no duplicate or self borders', () => {
    const keys = BORDERS.map((b) => (b.a < b.b ? `${b.a}|${b.b}` : `${b.b}|${b.a}`));
    expect(new Set(keys).size).toBe(BORDERS.length);
    for (const border of BORDERS) expect(border.a).not.toBe(border.b);
  });

  it('connects every region to something', () => {
    const orphans = REGION_IDS.filter((id) => neighbours(id).length === 0);
    expect(orphans, `orphaned regions: ${orphans.join(', ')}`).toEqual([]);
  });

  it('leaves the whole map reachable when ships are available', () => {
    const start = REGION_IDS[0]!;
    const seen = new Set<RegionId>([start]);
    const queue: RegionId[] = [start];
    while (queue.length) {
      const current = queue.pop()!;
      for (const border of neighbours(current)) {
        if (!seen.has(border.b)) {
          seen.add(border.b);
          queue.push(border.b);
        }
      }
    }
    const unreachable = REGION_IDS.filter((id) => !seen.has(id));
    expect(unreachable, `unreachable: ${unreachable.join(', ')}`).toEqual([]);
  });

  it('only allows a sea crossing between two harbours', () => {
    for (const border of BORDERS) {
      if (border.kind !== 'sea') continue;
      expect(getRegion(border.a).port, `${getRegion(border.a).settlement} needs a port`).toBe(true);
      expect(getRegion(border.b).port, `${getRegion(border.b).settlement} needs a port`).toBe(true);
    }
  });

  it('splits the land graph into exactly the expected landmasses', () => {
    // Every island group must be its own land component, and everything else
    // must be one continuous Old World landmass. A new island needs a line here.
    const unvisited = new Set<RegionId>(REGION_IDS);
    const components: RegionId[][] = [];
    while (unvisited.size) {
      const start: RegionId = unvisited.values().next().value!;
      const component: RegionId[] = [];
      const queue = [start];
      unvisited.delete(start);
      while (queue.length) {
        const current = queue.pop()!;
        component.push(current);
        for (const next of landNeighbours(current)) {
          if (unvisited.has(next)) {
            unvisited.delete(next);
            queue.push(next);
          }
        }
      }
      components.push(component);
    }
    const sizes = components.map((c) => c.length).sort((a, b) => b - a);
    // one mainland, then the islands
    expect(sizes[0]).toBeGreaterThan(REGIONS.length * 0.7);
    const islandGroups = components
      .filter((c) => c.length !== sizes[0])
      .map((c) => [...c].sort().join('+'))
      .sort();
    expect(islandGroups).toEqual([
      'armagh+cork+dublin+galway',                        // Ireland
      // The Scandinavian peninsula is reached only by ship: Scania connects to
      // Denmark across the Sound and to Finland only across the Baltic, which
      // is why every medieval campaign in the North was a naval operation.
      'bergen+kalmar+lund+oslo+sigtuna+skara+trondheim',
      'ajaccio',                                          // Corsica
      'bristol+caernarfon+cardiff+chester+edinburgh+inverness+london+norwich+stirling+york', // Britain
      'cagliari',                                         // Sardinia
      'candia',                                           // Crete
      'mdina',                                            // Malta
      'messina+palermo+syracuse',                         // Sicily
      'nicosia',                                          // Cyprus
      'palma',                                            // Balearics
      'rhodes',                                           // Rhodes
      'roskilde',                                         // Zealand
      'visby',                                            // Gotland
    ].sort());
  });

  it('gives a sensible average number of neighbours', () => {
    const total = REGION_IDS.reduce((sum, id) => sum + neighbours(id).length, 0);
    const average = total / REGIONS.length;
    expect(average).toBeGreaterThan(2.5);
    expect(average).toBeLessThan(7);
  });

  it('separates land and sea neighbours', () => {
    for (const id of REGION_IDS) {
      const land = new Set(landNeighbours(id));
      for (const sea of seaNeighbours(id)) expect(land.has(sea)).toBe(false);
      expect(land.size + seaNeighbours(id).length).toBe(ADJACENCY.get(id)!.length);
    }
  });
});
