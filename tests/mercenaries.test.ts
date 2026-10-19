import { describe, it, expect } from 'vitest';
import { newCampaign } from '../src/core/campaign';
import {
  canHire,
  desertUnpaid,
  endTurn,
  factionState,
  hireCost,
  hireMercenary,
  isMercenary,
  isPoolActive,
  mercenaryCompanies,
  mercenaryUpkeep,
  MERCENARY_UPKEEP_MULTIPLIER,
  offersAt,
  regimentUpkeep,
  regionState,
  replenishMercenaries,
  setStance,
  recruitableUnits,
  type CampaignState,
} from '../src/core/campaign';
import { MERCENARY_POOLS, MERCENARY_UNITS, poolsAt, getMercenaryPool } from '../src/core/data/mercenaries';
import { tryGetRegion } from '../src/core/data/regions';
import { getUnitType, tryGetUnitType } from '../src/core/data/units';
import { INDEPENDENT_ID } from '../src/core/data/factions';
import { factionId, regionId, unitTypeId } from '../src/core/types';

const MILAN = factionId('milan');
const VENICE = factionId('venice');
const BYZANTIUM = factionId('byzantium');

describe('the companies', () => {
  it('offers a decent spread of them', () => {
    expect(MERCENARY_POOLS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(MERCENARY_POOLS.map((pool) => pool.id)).size).toBe(MERCENARY_POOLS.length);
    expect(new Set(MERCENARY_POOLS.map((pool) => pool.name)).size).toBe(MERCENARY_POOLS.length);
  });

  it('names only real units and real provinces', () => {
    for (const pool of MERCENARY_POOLS) {
      expect(tryGetUnitType(unitTypeId(pool.unit)), `${pool.id} hires ${pool.unit}`).toBeDefined();
      expect(pool.regions.length, `${pool.id} is nowhere`).toBeGreaterThan(0);
      for (const region of pool.regions) {
        expect(tryGetRegion(region), `${pool.id} is offered at ${region}`).toBeDefined();
      }
      expect(pool.description.length).toBeGreaterThan(60);
      expect(pool.capacity).toBeGreaterThan(0);
      expect(pool.premium).toBeGreaterThanOrEqual(1);
    }
  });

  it('puts each company where that country actually bred it', () => {
    // Swiss pikemen in the Alps, gallowglass in the Hebrides and Ireland,
    // turcopoles in Outremer, and none of them in each other's countries.
    expect(poolsAt(regionId('schwyz')).map((p) => p.id)).toContain('swiss');
    expect(poolsAt(regionId('armagh')).map((p) => p.id)).toContain('gallowglass');
    expect(poolsAt(regionId('acre')).map((p) => p.id)).toContain('turcopole');
    expect(poolsAt(regionId('schwyz')).map((p) => p.id)).not.toContain('turcopole');
    // Hired crossbowmen are to be had in any large town, including Prague,
    // but a mountain fastness like Knin has no company standing about at all.
    expect(poolsAt(regionId('prague')).map((p) => p.id)).toEqual(['crossbow_companies']);
    expect(poolsAt(regionId('knin')).length).toBe(0);
  });

  it('keeps hire-only companies out of ordinary recruitment', () => {
    const state = newCampaign({ seed: 'no-recruit' });
    for (const province of state.regions.values()) {
      if (province.owner !== MILAN) continue;
      for (const id of recruitableUnits(state, province.id)) {
        expect(getUnitType(id).mercenary, `${id} was offered at a drill square`).toBeFalsy();
      }
    }
    for (const unit of MERCENARY_UNITS) expect(unit.mercenary).toBe(true);
  });

  it('respects the years a company existed', () => {
    const state = newCampaign({ seed: 'years' });
    const swiss = getMercenaryPool('swiss');
    expect(isPoolActive({ ...state, year: 1100 }, swiss)).toBe(false);
    expect(isPoolActive({ ...state, year: 1400 }, swiss)).toBe(true);
    const cuman = getMercenaryPool('cuman');
    expect(isPoolActive({ ...state, year: 1100 }, cuman)).toBe(true);
    expect(isPoolActive({ ...state, year: 1400 }, cuman)).toBe(false);
  });
});

describe('taking a company into service', () => {
  function rich(seed: string): CampaignState {
    const state = newCampaign({ seed });
    factionState(state, MILAN).treasury = 40000;
    factionState(state, VENICE).treasury = 40000;
    return state;
  }

  it('offers what is standing about and nothing else', () => {
    const state = rich('offers');
    const milan = offersAt(state, regionId('milan')).map((offer) => offer.pool.id);
    // In 1080 the Swiss and the condottieri do not yet exist.
    expect(milan).not.toContain('swiss');
    expect(milan).not.toContain('condotta');
    expect(offersAt(state, regionId('knin'))).toEqual([]);
    expect(offersAt(state, regionId('constantinople')).map((o) => o.pool.id))
      .toContain('varangian');
  });

  it('charges the contract, takes the company out of the pool and arms it', () => {
    const state = rich('hire');
    const before = factionState(state, BYZANTIUM).treasury = 40000;
    const pool = getMercenaryPool('varangian');
    const available = state.mercenaries.get('varangian')!.available;
    expect(canHire(state, regionId('constantinople'), 'varangian', BYZANTIUM).ok).toBe(true);
    expect(hireMercenary(state, regionId('constantinople'), 'varangian', BYZANTIUM).ok).toBe(true);
    expect(factionState(state, BYZANTIUM).treasury).toBe(before - hireCost(pool));
    expect(state.mercenaries.get('varangian')!.available).toBe(available - 1);
    expect(mercenaryCompanies(state, BYZANTIUM)).toBe(1);
  });

  it('marks the regiment as hired rather than raised', () => {
    const state = rich('marked');
    factionState(state, BYZANTIUM).treasury = 40000;
    hireMercenary(state, regionId('constantinople'), 'varangian', BYZANTIUM);
    const all = [
      ...regionState(state, regionId('constantinople')).garrison,
      ...[...state.armies.values()]
        .filter((army) => army.location === regionId('constantinople'))
        .flatMap((army) => army.regiments),
    ];
    const hired = all.filter(isMercenary);
    expect(hired.length).toBe(1);
    expect(hired[0]!.mercenary).toBe(true);
    expect(hired[0]!.experience).toBeGreaterThan(0);
  });

  it('refuses a company that is not to be found here', () => {
    const state = rich('wrong-place');
    expect(canHire(state, regionId('prague'), 'varangian', MILAN).ok).toBe(false);
    expect(canHire(state, regionId('milan'), 'gallowglass', MILAN).ok).toBe(false);
  });

  it('refuses when the treasury cannot pay the contract', () => {
    const state = rich('broke');
    factionState(state, BYZANTIUM).treasury = 1;
    expect(canHire(state, regionId('constantinople'), 'varangian', BYZANTIUM).ok).toBe(false);
  });

  it('refuses a town held by our enemy', () => {
    const state = rich('enemy-town');
    setStance(state, VENICE, BYZANTIUM, 'war');
    expect(canHire(state, regionId('constantinople'), 'varangian', VENICE).ok).toBe(false);
  });

  it('empties the pool, and then refills it over time', () => {
    const state = rich('empty');
    factionState(state, BYZANTIUM).treasury = 200000;
    const capacity = getMercenaryPool('varangian').capacity;
    for (let i = 0; i < capacity; i++) {
      expect(hireMercenary(state, regionId('constantinople'), 'varangian', BYZANTIUM).ok).toBe(true);
    }
    expect(canHire(state, regionId('constantinople'), 'varangian', BYZANTIUM).ok).toBe(false);
    const replenish = getMercenaryPool('varangian').replenish;
    for (let turn = 0; turn < replenish; turn++) replenishMercenaries(state);
    expect(state.mercenaries.get('varangian')!.available).toBe(1);
  });

  it('denies a hired company to everyone else', () => {
    const state = rich('contested');
    factionState(state, BYZANTIUM).treasury = 200000;
    const capacity = getMercenaryPool('varangian').capacity;
    for (let i = 0; i < capacity; i++) {
      hireMercenary(state, regionId('constantinople'), 'varangian', BYZANTIUM);
    }
    // Venice arrives with money and finds the Varangians already engaged.
    expect(offersAt(state, regionId('constantinople')).map((o) => o.pool.id))
      .not.toContain('varangian');
  });
});

describe('what a company costs', () => {
  it('costs more to keep than the same troops raised at home', () => {
    const type = unitTypeId('swiss_pikemen');
    expect(mercenaryUpkeep(type)).toBeGreaterThan(getUnitType(type).upkeep);
    expect(mercenaryUpkeep(type)).toBe(
      Math.round(getUnitType(type).upkeep * MERCENARY_UPKEEP_MULTIPLIER),
    );
  });

  it('is charged the premium in the accounts of the realm', () => {
    const state = newCampaign({ seed: 'upkeep' });
    const type = unitTypeId('town_militia');
    const raised = { type, soldiers: 120, experience: 0 };
    const hired = { type, soldiers: 120, experience: 0, mercenary: true };
    expect(regimentUpkeep(MILAN, hired)).toBeGreaterThan(regimentUpkeep(MILAN, raised));
    void state;
  });

  it('leaves for want of pay before anything of our own does', () => {
    const state = newCampaign({ seed: 'desert' });
    factionState(state, BYZANTIUM).treasury = 40000;
    hireMercenary(state, regionId('constantinople'), 'varangian', BYZANTIUM);
    expect(mercenaryCompanies(state, BYZANTIUM)).toBe(1);
    const native = [...state.regions.values()]
      .filter((region) => region.owner === BYZANTIUM)
      .reduce((sum, region) => sum + region.garrison.filter((r) => !isMercenary(r)).length, 0);

    const recovered = desertUnpaid(state, BYZANTIUM, 10_000);
    expect(recovered).toBeGreaterThan(0);
    expect(mercenaryCompanies(state, BYZANTIUM)).toBe(0);
    const stillNative = [...state.regions.values()]
      .filter((region) => region.owner === BYZANTIUM)
      .reduce((sum, region) => sum + region.garrison.filter((r) => !isMercenary(r)).length, 0);
    expect(stillNative, 'our own troops were sent away too').toBe(native);
  });
});

describe('a century of hiring', () => {
  it('sees companies taken into service and paid for', () => {
    const state = newCampaign({ seed: 'merc-century' });
    let peak = 0;
    for (let turn = 0; turn < 200; turn++) {
      endTurn(state);
      let total = 0;
      for (const [id, faction] of state.factions) {
        if (id === INDEPENDENT_ID || !faction.alive) continue;
        total += mercenaryCompanies(state, id);
      }
      peak = Math.max(peak, total);
      // A pool can never hold more than the country can furnish.
      for (const pool of MERCENARY_POOLS) {
        const entry = state.mercenaries.get(pool.id)!;
        expect(entry.available, pool.id).toBeGreaterThanOrEqual(0);
        expect(entry.available, pool.id).toBeLessThanOrEqual(pool.capacity);
      }
    }
    expect(peak, 'nobody ever hired a company').toBeGreaterThan(5);
  }, 180_000);

  it('keeps a hired company out of a pool that is out of its years', () => {
    const state = newCampaign({ seed: 'merc-years' });
    while (state.year < 1320) endTurn(state);
    // The Cumans are gone by now and the Swiss have arrived.
    expect(state.mercenaries.get('cuman')!.available).toBe(0);
    expect(offersAt(state, regionId('schwyz')).map((o) => o.pool.id)).toContain('swiss');
  }, 180_000);
});
