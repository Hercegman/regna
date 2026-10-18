import { describe, it, expect } from 'vitest';
import { newCampaign } from '../src/core/campaign';
import {
  administrationCost,
  annualNet,
  carryingCapacity,
  endTurn,
  factionFinances,
  growthRate,
  provincesOf,
  regionState,
  strengthOf,
} from '../src/core/campaign';
import { INDEPENDENT_ID } from '../src/core/data/factions';
import { regionId } from '../src/core/types';

describe('population', () => {
  it('has a ceiling that depends on land, buildings and settlement size', () => {
    const state = newCampaign({ seed: 'capacity' });
    const fertile = regionState(state, regionId('paris'));
    const barren = regionState(state, regionId('taghaza'));
    expect(carryingCapacity(fertile)).toBeGreaterThan(carryingCapacity(barren));
    // Nothing on this map can support a modern metropolis.
    for (const region of state.regions.values()) {
      expect(carryingCapacity(region)).toBeLessThan(120);
      expect(carryingCapacity(region)).toBeGreaterThan(1);
    }
  });

  it('grows towards the ceiling and stops there', () => {
    const state = newCampaign({ seed: 'growth' });
    const region = regionState(state, regionId('paris'));
    const capacity = carryingCapacity(region);
    expect(growthRate(state, region)).toBeGreaterThan(0);
    region.population = capacity;
    expect(growthRate(state, region)).toBeCloseTo(0, 3);
    region.population = capacity * 1.5;
    expect(growthRate(state, region)).toBeLessThan(0);
  });

  it('starves a besieged province whatever its size', () => {
    const state = newCampaign({ seed: 'siege-growth' });
    const region = regionState(state, regionId('paris'));
    region.siege = { besieger: INDEPENDENT_ID, turns: 1 };
    expect(growthRate(state, region)).toBeLessThan(0);
  });

  it('stays inside its ceiling across two centuries', () => {
    const state = newCampaign({ seed: 'population-longrun' });
    for (let turn = 0; turn < 240; turn++) endTurn(state);
    for (const region of state.regions.values()) {
      // A province may sit a little over its ceiling while it starves back.
      expect(
        region.population,
        `${region.id} has ${Math.round(region.population)}k against a ceiling of ${Math.round(carryingCapacity(region))}k`,
      ).toBeLessThan(carryingCapacity(region) * 1.25 + 2);
    }
  }, 180_000);
});

describe('the treasury', () => {
  it('charges more to administer a larger realm, and more per province', () => {
    expect(administrationCost(0)).toBe(0);
    expect(administrationCost(10)).toBeGreaterThan(administrationCost(5));
    // Superlinear: doubling the realm more than doubles the cost of running it.
    expect(administrationCost(20)).toBeGreaterThan(administrationCost(10) * 2);
    expect(administrationCost(20) / 20).toBeGreaterThan(administrationCost(5) / 5);
  });

  it('keeps every faction inside a medieval order of magnitude', () => {
    const state = newCampaign({ seed: 'treasury-longrun' });
    for (let turn = 0; turn < 200; turn++) endTurn(state);
    for (const [id, faction] of state.factions) {
      if (id === INDEPENDENT_ID) continue;
      // No medieval crown ever sat on a million florins in cash.
      expect(faction.treasury, `${id} holds ${Math.round(faction.treasury)}`).toBeLessThan(400_000);
      expect(faction.treasury).toBeGreaterThanOrEqual(0);
    }
  }, 150_000);

  it('leaves the great powers solvent but not idle rich', () => {
    const state = newCampaign({ seed: 'solvency' });
    for (let turn = 0; turn < 150; turn++) endTurn(state);
    const powers = [...state.factions.values()]
      .filter((faction) => faction.alive && faction.id !== INDEPENDENT_ID)
      .map((faction) => ({ faction, provinces: provincesOf(state, faction.id).length }))
      .filter((entry) => entry.provinces >= 8);
    expect(powers.length, 'no faction grew into a great power').toBeGreaterThan(0);
    for (const { faction } of powers) {
      const finances = factionFinances(state, faction.id);
      expect(finances.administration).toBeGreaterThan(0);
      // A great power pays for what it holds.
      expect(finances.armyUpkeep + finances.garrisonUpkeep + finances.administration)
        .toBeGreaterThan(finances.provinceNet * 0.25);
    }
  }, 120_000);
});

describe('solvency', () => {
  it('pays off troops it cannot afford instead of being bankrupted', () => {
    const state = newCampaign({ seed: 'retrench' });
    let bankruptcies = 0;
    let seen = 0;
    for (let turn = 0; turn < 160; turn++) {
      endTurn(state);
      for (const entry of state.log.slice(seen)) {
        if (entry.text.includes('cannot pay its soldiers')) bankruptcies += 1;
      }
      seen = state.log.length;
    }
    // Running out of money should be a reverse of fortune, not the ordinary
    // state of affairs. Factions reduce their establishment before it happens.
    expect(bankruptcies).toBeLessThan(60);
  }, 150_000);

  it('budgets on the year rather than the harvest season', () => {
    const state = newCampaign({ seed: 'annual' });
    for (let turn = 0; turn < 40; turn++) endTurn(state);
    for (const [id, faction] of state.factions) {
      if (!faction.alive || id === INDEPENDENT_ID) continue;
      const summer = factionFinances(state, id, 'summer').net;
      const winter = factionFinances(state, id, 'winter').net;
      // Winter is leaner than summer everywhere there is a harvest to bring in.
      if (provincesOf(state, id).length > 0) expect(winter).toBeLessThanOrEqual(summer);
      expect(annualNet(state, id)).toBeCloseTo((summer + winter) / 2, 6);
    }
  }, 60_000);
});

describe('warfare', () => {
  it('produces wars, sieges and conquests rather than a frozen map', () => {
    const state = newCampaign({ seed: 'warfare' });
    const start = new Map([...state.regions].map(([id, region]) => [id, region.owner]));
    let wars = 0;
    let sieges = 0;
    let surrenders = 0;
    let seen = 0;
    for (let turn = 0; turn < 160; turn++) {
      endTurn(state);
      for (const entry of state.log.slice(seen)) {
        if (entry.text.includes('declares war')) wars += 1;
        else if (entry.text.includes('lay siege')) sieges += 1;
        else if (entry.text.includes('surrenders')) surrenders += 1;
      }
      seen = state.log.length;
    }
    let changed = 0;
    for (const [id, owner] of start) if (state.regions.get(id)!.owner !== owner) changed += 1;

    expect(wars, 'nobody went to war').toBeGreaterThan(5);
    expect(sieges, 'nobody besieged anything').toBeGreaterThan(10);
    expect(surrenders, 'no siege ever ended in a surrender').toBeGreaterThan(0);
    expect(changed, 'the map never changed hands').toBeGreaterThan(20);
  }, 150_000);

  it('keeps armies and garrisons within their command limits', () => {
    const state = newCampaign({ seed: 'limits' });
    for (let turn = 0; turn < 160; turn++) endTurn(state);
    for (const army of state.armies.values()) {
      expect(army.regiments.length, `army ${army.id}`).toBeLessThanOrEqual(20);
    }
    for (const region of state.regions.values()) {
      // Revolts and conquest can momentarily exceed the billeting limit.
      expect(region.garrison.length, `garrison of ${region.id}`).toBeLessThanOrEqual(16);
      expect(strengthOf(region.garrison)).toBeGreaterThanOrEqual(0);
    }
  }, 150_000);
});
