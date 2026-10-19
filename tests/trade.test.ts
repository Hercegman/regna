import { describe, it, expect } from 'vitest';
import { newCampaign } from '../src/core/campaign';
import {
  activeRoutesThrough,
  advanceCaravans,
  canDispatch,
  caravanLocation,
  caravanOutlay,
  caravanPace,
  caravansIn,
  caravansOf,
  captorOf,
  dispatchCaravan,
  endTurn,
  expectedReturn,
  factionState,
  hoardingCost,
  HOARD_THRESHOLD,
  newArmyId,
  regionState,
  routeStandings,
  setStance,
  stepOpen,
  type CampaignState,
} from '../src/core/campaign';
import { TRADE_ROUTES, getTradeRoute, positionOn, routesInYear, routesThrough, tradeRouteId } from '../src/core/data/trade';
import { borderBetween } from '../src/core/data/adjacency';
import { tryGetRegion, getRegion } from '../src/core/data/regions';
import { INDEPENDENT_ID } from '../src/core/data/factions';
import { Rng } from '../src/core/rng';
import { factionId, regionId } from '../src/core/types';

const VENICE = factionId('venice');
const CROATIA = factionId('croatia');

describe('the trade roads', () => {
  it('are a decent number of real roads', () => {
    expect(TRADE_ROUTES.length).toBeGreaterThanOrEqual(15);
    expect(new Set(TRADE_ROUTES.map((route) => route.id)).size).toBe(TRADE_ROUTES.length);
    expect(new Set(TRADE_ROUTES.map((route) => route.name)).size).toBe(TRADE_ROUTES.length);
  });

  it('pass only through provinces that exist', () => {
    for (const route of TRADE_ROUTES) {
      expect(route.path.length, route.name).toBeGreaterThanOrEqual(3);
      for (const region of route.path) {
        expect(tryGetRegion(region), `${route.name} passes through ${region}`).toBeDefined();
      }
      expect(new Set(route.path).size, `${route.name} visits a province twice`)
        .toBe(route.path.length);
    }
  });

  it('are contiguous, so a caravan can actually walk them', () => {
    for (const route of TRADE_ROUTES) {
      for (let i = 0; i < route.path.length - 1; i++) {
        const border = borderBetween(route.path[i]!, route.path[i + 1]!);
        expect(
          border,
          `${route.name}: ${getRegion(route.path[i]!).settlement} to ` +
            `${getRegion(route.path[i + 1]!).settlement} is not a border`,
        ).toBeDefined();
      }
    }
  });

  it('price the great roads above the regional ones', () => {
    const silk = TRADE_ROUTES.find((route) => route.id === tradeRouteId('spice_route'))!;
    const fur = TRADE_ROUTES.find((route) => route.id === tradeRouteId('fur_road'))!;
    expect(silk.value).toBeGreaterThan(fur.value);
    for (const route of TRADE_ROUTES) {
      expect(route.value, route.name).toBeGreaterThan(100);
      expect(route.value, route.name).toBeLessThan(1500);
      expect(route.description.length).toBeGreaterThan(80);
    }
  });

  it('respects the years a road was in use', () => {
    const early = routesInYear(1080).map((route) => route.id as string);
    const late = routesInYear(1450).map((route) => route.id as string);
    expect(early).not.toContain('hanseatic');
    expect(late).toContain('hanseatic');
    expect(early).toContain('silk_road');
    expect(late).not.toContain('champagne');
  });

  it('indexes the roads through each province', () => {
    for (const route of TRADE_ROUTES) {
      for (const region of route.path) {
        expect(routesThrough(region)).toContain(route.id);
      }
      expect(positionOn(route, route.path[0]!)).toBe(0);
    }
    expect(routesThrough(regionId('prague'))).toEqual([]);
  });
});

describe('sending a caravan', () => {
  it('refuses a province that is not on the road', () => {
    const state = newCampaign({ seed: 'dispatch' });
    const result = canDispatch(state, regionId('prague'), tradeRouteId('silk_road'));
    expect(result.ok).toBe(false);
  });

  it('refuses a road that is not yet in use', () => {
    const state = newCampaign({ seed: 'early' });
    expect(canDispatch(state, regionId('bruges'), tradeRouteId('hanseatic')).ok).toBe(false);
  });

  it('refuses when the treasury cannot pay for the goods', () => {
    const state = newCampaign({ seed: 'poor' });
    factionState(state, VENICE).treasury = 0;
    expect(canDispatch(state, regionId('venice'), tradeRouteId('spice_route')).ok).toBe(false);
  });

  it('charges the outlay and puts a caravan on the road', () => {
    const state = newCampaign({ seed: 'send' });
    factionState(state, VENICE).treasury = 20000;
    const route = getTradeRoute(tradeRouteId('spice_route'));
    const before = factionState(state, VENICE).treasury;
    expect(dispatchCaravan(state, regionId('venice'), route.id).ok).toBe(true);
    expect(factionState(state, VENICE).treasury).toBe(before - caravanOutlay(route));
    const mine = caravansOf(state, VENICE);
    expect(mine.length).toBe(1);
    expect(caravanLocation(mine[0]!)).toBe(regionId('venice'));
    expect(mine[0]!.value).toBe(route.value);
  });

  it('will not put more on one road than it can look after', () => {
    const state = newCampaign({ seed: 'limit' });
    factionState(state, VENICE).treasury = 90000;
    const route = tradeRouteId('spice_route');
    expect(dispatchCaravan(state, regionId('venice'), route).ok).toBe(true);
    expect(dispatchCaravan(state, regionId('venice'), route).ok).toBe(true);
    expect(dispatchCaravan(state, regionId('venice'), route).ok).toBe(false);
  });

  it('sends it towards the far end of the road', () => {
    const state = newCampaign({ seed: 'direction' });
    factionState(state, VENICE).treasury = 20000;
    const route = getTradeRoute(tradeRouteId('spice_route'));
    dispatchCaravan(state, regionId('venice'), route.id);
    const caravan = caravansOf(state, VENICE)[0]!;
    // Venice is the last province on the Spice Road, so it heads back up it.
    expect(positionOn(route, regionId('venice'))).toBe(route.path.length - 1);
    expect(caravan.direction).toBe(-1);
    expect(caravan.destination).toBe(0);
  });
});

describe('a caravan on the road', () => {
  function sendOne(seed: string): { state: CampaignState; route: ReturnType<typeof getTradeRoute> } {
    const state = newCampaign({ seed });
    factionState(state, VENICE).treasury = 40000;
    const route = getTradeRoute(tradeRouteId('spice_route'));
    dispatchCaravan(state, regionId('venice'), route.id);
    return { state, route };
  }

  it('moves along the road each turn', () => {
    const { state } = sendOne('moves');
    const caravan = caravansOf(state, VENICE)[0]!;
    const before = caravan.position;
    advanceCaravans(state, new Rng('a'));
    expect(caravan.position).toBeLessThan(before);
  });

  it('travels further in summer than in winter', () => {
    const state = newCampaign({ seed: 'pace' });
    expect(caravanPace({ ...state, season: 'summer' })).toBeGreaterThan(
      caravanPace({ ...state, season: 'winter' }),
    );
  });

  it('pays a toll to every lord whose land it crosses', () => {
    const { state, route } = sendOne('tolls');
    const caravan = caravansOf(state, VENICE)[0]!;
    // Split is Croatian and is the next stop down the Spice Road from Venice.
    expect(route.path[caravan.position - 1]).toBe(regionId('split'));
    const croatian = factionState(state, CROATIA).treasury;
    const cargo = caravan.value;
    advanceCaravans(state, new Rng('b'));
    expect(factionState(state, CROATIA).treasury).toBeGreaterThan(croatian);
    const survivor = caravansOf(state, VENICE)[0];
    if (survivor) expect(survivor.value).toBeLessThan(cargo);
  });

  it('is stopped by a road that is shut', () => {
    const state = newCampaign({ seed: 'shut' });
    expect(stepOpen(state, VENICE, regionId('venice'), regionId('split'))).toBe(true);
    setStance(state, VENICE, CROATIA, 'war');
    expect(stepOpen(state, VENICE, regionId('venice'), regionId('split'))).toBe(false);
  });

  it('turns back when it has waited too long, and is lost if it cannot', () => {
    const { state } = sendOne('blocked');
    setStance(state, VENICE, CROATIA, 'war');
    const caravan = caravansOf(state, VENICE)[0]!;
    const start = caravan.position;
    for (let turn = 0; turn < 3; turn++) advanceCaravans(state, new Rng(`t${turn}`));
    // It has not moved, and after three turns of waiting it gives up and turns.
    expect(caravan.position).toBe(start);
    expect(caravan.direction).toBe(1);
  });

  it('is seized by an army at war with its owner', () => {
    const { state } = sendOne('seize');
    const caravan = caravansOf(state, VENICE)[0]!;
    const here = caravanLocation(caravan)!;
    setStance(state, VENICE, CROATIA, 'war');
    // A Croatian army arrives where the caravan stands.
    const id = newArmyId(state);
    state.armies.set(id, {
      id,
      faction: CROATIA,
      location: here,
      regiments: [...regionState(state, regionId('knin')).garrison],
      general: undefined,
      movement: 0,
      embarked: false,
    });
    expect(captorOf(state, caravan)).toBe(CROATIA);
    const before = factionState(state, CROATIA).treasury;
    advanceCaravans(state, new Rng('c'));
    expect(caravansOf(state, VENICE).length).toBe(0);
    expect(factionState(state, CROATIA).treasury).toBeGreaterThan(before);
  });

  it('pays its owner on arrival', () => {
    const state = newCampaign({ seed: 'arrive' });
    factionState(state, VENICE).treasury = 40000;
    const route = getTradeRoute(tradeRouteId('english_wool'));
    // Put Venice on a short road for the sake of the test.
    const start = route.path[0]!;
    regionState(state, start).owner = VENICE;
    for (const region of route.path) regionState(state, region).owner = VENICE;
    expect(dispatchCaravan(state, start, route.id).ok).toBe(true);
    const before = factionState(state, VENICE).treasury;
    for (let turn = 0; turn < 4; turn++) advanceCaravans(state, new Rng(`d${turn}`));
    expect(caravansOf(state, VENICE).length).toBe(0);
    expect(factionState(state, VENICE).treasury).toBeGreaterThan(before);
  });

  it('reports where every caravan stands', () => {
    const { state } = sendOne('where');
    const caravan = caravansOf(state, VENICE)[0]!;
    const here = caravanLocation(caravan)!;
    expect(caravansIn(state, here).map((c) => c.id)).toContain(caravan.id);
  });
});

describe('judging a road', () => {
  it('values an open road above a cut one', () => {
    const state = newCampaign({ seed: 'judge' });
    const route = getTradeRoute(tradeRouteId('spice_route'));
    const open = expectedReturn(state, VENICE, route, regionId('venice'));
    setStance(state, VENICE, CROATIA, 'war');
    const cut = expectedReturn(state, VENICE, route, regionId('venice'));
    expect(cut).toBeLessThan(open);
  });

  it('reports what a faction holds of each road', () => {
    const state = newCampaign({ seed: 'standing' });
    const standings = routeStandings(state, VENICE);
    expect(standings.length).toBe(routesInYear(state.year).length);
    const spice = standings.find((s) => s.route.id === tradeRouteId('spice_route'))!;
    expect(spice.held).toBeGreaterThanOrEqual(1);
    expect(spice.open).toBeGreaterThan(0);
    expect(spice.open).toBeLessThanOrEqual(1);
  });

  it('lists the roads through a province', () => {
    const state = newCampaign({ seed: 'through' });
    const names = activeRoutesThrough(state, regionId('venice')).map((route) => route.name);
    expect(names).toContain('The Spice Road');
    expect(activeRoutesThrough(state, regionId('prague'))).toEqual([]);
  });
});

describe('a hoard', () => {
  it('costs nothing while it is only a working reserve', () => {
    expect(hoardingCost(0)).toBe(0);
    expect(hoardingCost(HOARD_THRESHOLD)).toBe(0);
  });

  it('leaks once it is larger than that, and more the larger it is', () => {
    expect(hoardingCost(HOARD_THRESHOLD + 10_000)).toBeGreaterThan(0);
    expect(hoardingCost(100_000)).toBeGreaterThan(hoardingCost(50_000));
  });
});

describe('a century of trade', () => {
  it('sends caravans, pays tolls and enriches the roads', () => {
    const state = newCampaign({ seed: 'century-trade' });
    let arrived = 0;
    let seized = 0;
    let seen = 0;
    for (let turn = 0; turn < 160; turn++) {
      endTurn(state);
      for (const entry of state.log.slice(seen)) {
        if (entry.text.includes('A caravan reaches')) arrived += 1;
        else if (entry.text.includes('seizes a')) seized += 1;
      }
      seen = state.log.length;
      // A caravan must never be somewhere its road does not go.
      for (const caravan of state.caravans.values()) {
        const route = getTradeRoute(caravan.route);
        expect(caravan.position).toBeGreaterThanOrEqual(0);
        expect(caravan.position).toBeLessThan(route.path.length);
        expect(caravan.value).toBeGreaterThanOrEqual(0);
        expect(state.factions.has(caravan.faction)).toBe(true);
        expect(caravan.faction).not.toBe(INDEPENDENT_ID);
      }
    }
    expect(arrived, 'no caravan ever arrived').toBeGreaterThan(50);
    expect(seized + arrived).toBeGreaterThan(arrived);
  }, 180_000);

  it('keeps treasuries inside a medieval order of magnitude', () => {
    const state = newCampaign({ seed: 'trade-wealth' });
    for (let turn = 0; turn < 200; turn++) endTurn(state);
    for (const [id, faction] of state.factions) {
      if (id === INDEPENDENT_ID) continue;
      expect(faction.treasury, `${id} holds ${Math.round(faction.treasury)}`).toBeLessThan(200_000);
    }
  }, 180_000);
});
