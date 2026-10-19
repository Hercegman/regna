import { describe, it, expect } from 'vitest';
import {
  SEA_ZONES,
  SEA_ZONE_IDS,
  getSeaZone,
  seaNeighbourZones,
  zonesOffPort,
  zoneServesPort,
} from '../src/core/data/seas';
import { REGIONS, getRegion } from '../src/core/data/regions';
import type { SeaZoneId } from '../src/core/data/seas';

describe('sea zones', () => {
  it('covers the whole theatre', () => {
    expect(SEA_ZONES.length).toBeGreaterThanOrEqual(25);
  });

  it('has unique ids and names', () => {
    expect(new Set(SEA_ZONES.map((zone) => zone.id)).size).toBe(SEA_ZONES.length);
    expect(new Set(SEA_ZONES.map((zone) => zone.name)).size).toBe(SEA_ZONES.length);
  });

  it('places every zone at plausible coordinates', () => {
    for (const zone of SEA_ZONES) {
      expect(zone.lon, zone.name).toBeGreaterThan(-15);
      expect(zone.lon, zone.name).toBeLessThan(55);
      expect(zone.lat, zone.name).toBeGreaterThan(5);
      expect(zone.lat, zone.name).toBeLessThan(70);
    }
  });

  it('only lists provinces that are really harbours', () => {
    for (const zone of SEA_ZONES) {
      expect(zone.ports.length, `${zone.name} has no harbours`).toBeGreaterThan(0);
      for (const port of zone.ports) {
        const region = getRegion(port);
        expect(region.port, `${region.settlement} is in ${zone.name} but has no harbour`).toBe(true);
      }
      expect(new Set(zone.ports).size, `${zone.name} lists a harbour twice`).toBe(zone.ports.length);
    }
  });

  it('gives every harbour on the map some water to sail into', () => {
    const uncovered = REGIONS.filter(
      (region) => region.port && zonesOffPort(region.id).length === 0,
    ).map((region) => region.settlement);
    expect(uncovered, `harbours with no sea zone: ${uncovered.join(', ')}`).toEqual([]);
  });

  it('agrees with itself about which zone serves which harbour', () => {
    for (const zone of SEA_ZONES) {
      for (const port of zone.ports) {
        expect(zoneServesPort(zone.id, port)).toBe(true);
      }
    }
    expect(zoneServesPort('baltic_sea' as SeaZoneId, REGIONS[0]!.id)).toBe(false);
  });

  it('links zones symmetrically and without self links', () => {
    for (const id of SEA_ZONE_IDS) {
      for (const neighbour of seaNeighbourZones(id)) {
        expect(neighbour).not.toBe(id);
        expect(seaNeighbourZones(neighbour), `${neighbour} -> ${id}`).toContain(id);
      }
    }
  });

  it('keeps the Mediterranean, the Atlantic and the Baltic one navigable whole', () => {
    // A fleet built in Venice must be able to reach the North Sea without
    // being carried overland.
    const reach = (start: SeaZoneId): Set<SeaZoneId> => {
      const seen = new Set<SeaZoneId>([start]);
      const queue = [start];
      while (queue.length) {
        const current = queue.pop()!;
        for (const next of seaNeighbourZones(current)) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      return seen;
    };
    const fromAdriatic = reach('adriatic_sea' as SeaZoneId);
    for (const id of ['north_sea', 'baltic_sea', 'black_sea', 'iberian_atlantic', 'nile']) {
      expect(fromAdriatic.has(id as SeaZoneId), `Venice cannot reach ${id}`).toBe(true);
    }
  });

  it('leaves only the waters that really are cut off isolated', () => {
    // Everything that is not connected to the Mediterranean is a closed basin
    // or an inland river system, and each one is listed here on purpose.
    const main = (() => {
      const seen = new Set<SeaZoneId>(['adriatic_sea' as SeaZoneId]);
      const queue: SeaZoneId[] = ['adriatic_sea' as SeaZoneId];
      while (queue.length) {
        const current = queue.pop()!;
        for (const next of seaNeighbourZones(current)) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      return seen;
    })();
    const isolated = SEA_ZONE_IDS.filter((id) => !main.has(id)).sort();
    expect(isolated).toEqual(
      [
        'caspian_sea', // closed basin, reached only from the Volga
        'volga',
        'mesopotamia', // the Gulf is beyond the edge of the map
        'red_sea', // no canal until the nineteenth century
        'niger', // the inland delta reaches no ocean a galley can use
      ].sort(),
    );
  });

  it('resolves zones by id and rejects unknown ones', () => {
    for (const zone of SEA_ZONES) expect(getSeaZone(zone.id).name).toBe(zone.name);
    expect(() => getSeaZone('atlantis' as SeaZoneId)).toThrow();
  });

  it('marks river systems as rivers', () => {
    const rivers = SEA_ZONES.filter((zone) => zone.river).map((zone) => zone.id);
    expect(rivers).toContain('nile');
    expect(rivers).toContain('danube');
    expect(rivers).not.toContain('aegean_sea');
  });
});
