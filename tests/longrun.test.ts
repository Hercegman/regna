import { describe, it, expect } from 'vitest';
import { newCampaign } from '../src/core/campaign';
import { endTurn, strengthOf } from '../src/core/campaign';
import { INDEPENDENT_ID, FACTIONS, getFaction } from '../src/core/data/factions';
import { REGIONS } from '../src/core/data/regions';
import { getUnitType } from '../src/core/data/units';
import type { CampaignState } from '../src/core/campaign';

/** Everything that must remain true after any number of turns. */
function checkInvariants(state: CampaignState, label: string): void {
  expect(state.regions.size, `${label}: provinces vanished`).toBe(REGIONS.length);

  for (const region of state.regions.values()) {
    expect(Number.isFinite(region.population), `${label}: ${region.id} population`).toBe(true);
    expect(region.population, `${label}: ${region.id} population`).toBeGreaterThan(0);
    expect(region.unrest, `${label}: ${region.id} unrest`).toBeGreaterThanOrEqual(0);
    expect(region.unrest, `${label}: ${region.id} unrest`).toBeLessThanOrEqual(100);
    expect(state.factions.has(region.owner), `${label}: ${region.id} owner unknown`).toBe(true);
    for (const regiment of region.garrison) {
      expect(regiment.soldiers, `${label}: ${region.id} garrison`).toBeGreaterThan(0);
      expect(Number.isFinite(regiment.soldiers)).toBe(true);
      expect(() => getUnitType(regiment.type)).not.toThrow();
    }
    if (region.construction) {
      expect(region.construction.turnsLeft).toBeGreaterThan(0);
    }
  }

  for (const [id, faction] of state.factions) {
    expect(Number.isFinite(faction.treasury), `${label}: ${id} treasury`).toBe(true);
    expect(faction.treasury, `${label}: ${id} treasury`).toBeGreaterThanOrEqual(0);
    if (id === INDEPENDENT_ID) continue;
    // A living faction must hold something: a province or an army.
    if (faction.alive) {
      const provinces = [...state.regions.values()].filter((r) => r.owner === id).length;
      const armies = [...state.armies.values()].filter((a) => a.faction === id).length;
      expect(provinces + armies, `${label}: ${id} alive with nothing`).toBeGreaterThan(0);
    }
  }

  for (const army of state.armies.values()) {
    expect(state.regions.has(army.location), `${label}: army in no province`).toBe(true);
    expect(army.regiments.length, `${label}: empty army kept`).toBeGreaterThan(0);
    for (const regiment of army.regiments) {
      expect(regiment.soldiers).toBeGreaterThan(0);
    }
  }
}

describe('a long campaign', () => {
  it('runs three hundred turns without breaking its own rules', () => {
    const state = newCampaign({ seed: 'longrun' });
    checkInvariants(state, 'turn 0');
    for (let turn = 1; turn <= 300; turn++) {
      endTurn(state);
      if (turn % 25 === 0) checkInvariants(state, `turn ${turn}`);
    }
    checkInvariants(state, 'final');
    expect(state.year).toBe(1080 + 150);
  }, 180_000);

  it('produces a changed map rather than a frozen one', () => {
    const state = newCampaign({ seed: 'history' });
    const before = new Map([...state.regions].map(([id, region]) => [id, region.owner]));
    for (let turn = 0; turn < 120; turn++) endTurn(state);
    let changed = 0;
    for (const [id, owner] of before) {
      if (state.regions.get(id)!.owner !== owner) changed += 1;
    }
    // Sixty years of medieval politics should move more than a handful of
    // provinces.
    expect(changed).toBeGreaterThan(10);
  }, 120_000);

  it('brings later factions into play in their own year', () => {
    const state = newCampaign({ seed: 'emergence' });
    // 1299 is the Ottoman year; run to just past it.
    while (state.year <= 1300) endTurn(state);
    const arrivals = FACTIONS.filter((faction) => {
      const live = state.factions.get(faction.id)!;
      return faction.appearsIn > 1080 && faction.appearsIn <= 1300 && live.joinedOn >= 0;
    });
    // Most of the factions due by 1300 should have appeared. A few can be
    // pre-empted: a seat already swallowed by a neighbour cannot rise.
    const due = FACTIONS.filter((f) => f.appearsIn > 1080 && f.appearsIn <= 1300);
    expect(arrivals.length).toBeGreaterThan(due.length * 0.5);
    for (const faction of arrivals) {
      expect(faction.appearsIn, `${faction.name} appeared early`).toBeLessThanOrEqual(1300);
    }
  }, 180_000);

  it('keeps total soldiery within sane bounds', () => {
    const state = newCampaign({ seed: 'armies' });
    for (let turn = 0; turn < 80; turn++) endTurn(state);
    let soldiers = 0;
    for (const region of state.regions.values()) soldiers += strengthOf(region.garrison);
    for (const army of state.armies.values()) soldiers += strengthOf(army.regiments);
    // Not an empty world, and not a billion men under arms either.
    expect(soldiers).toBeGreaterThan(20_000);
    expect(soldiers).toBeLessThan(5_000_000);
  }, 90_000);

  it('is reproducible across a long run', () => {
    const digest = (seed: string): string => {
      const state = newCampaign({ seed });
      for (let turn = 0; turn < 60; turn++) endTurn(state);
      return [...state.regions.values()]
        .map((region) => `${region.id}:${region.owner}:${Math.round(region.population)}`)
        .join('|');
    };
    expect(digest('same')).toBe(digest('same'));
    expect(digest('same')).not.toBe(digest('different'));
  }, 120_000);
});

describe('a campaign chronicle', () => {
  it('can be summarised, as a readable check on the simulation', () => {
    const state = newCampaign({ seed: 'chronicle' });
    for (let turn = 0; turn < 200; turn++) endTurn(state);

    const holdings = new Map<string, number>();
    for (const region of state.regions.values()) {
      const key = region.owner as string;
      holdings.set(key, (holdings.get(key) ?? 0) + 1);
    }
    const ranked = [...holdings.entries()]
      .filter(([id]) => id !== (INDEPENDENT_ID as string))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);

    const lines = ranked.map(([id, count]) => {
      const name = (() => {
        try {
          return getFaction(id as never).name;
        } catch {
          return id;
        }
      })();
      return `${count.toString().padStart(3)}  ${name}`;
    });
    const dead = [...state.factions.values()].filter((f) => f.destroyedOn !== undefined).length;
    const born = [...state.factions.values()].filter((f) => f.joinedOn > 0).length;

    console.log(
      `\nYear ${state.year}, turn ${state.turn}\n` +
        `Factions risen since 1080: ${born}   destroyed: ${dead}\n` +
        `Largest realms:\n${lines.join('\n')}\n`,
    );

    expect(ranked.length).toBeGreaterThan(3);
  }, 150_000);
});
