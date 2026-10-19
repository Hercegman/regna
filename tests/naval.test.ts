import { describe, it, expect } from 'vitest';
import { newCampaign } from '../src/core/campaign';
import {
  blockaderOf,
  buildableShips,
  disembark,
  embark,
  endTurn,
  factionState,
  fleetCapacity,
  fleetsOf,
  isBlockaded,
  mergeFleets,
  moveFleet,
  navalStrength,
  newFleetId,
  reachableWaters,
  regionState,
  scrapShip,
  seaLaneClosed,
  setStance,
  shipCost,
  startShipbuilding,
  strengthOf,
  tradeRoutes,
  type CampaignState,
  type Fleet,
} from '../src/core/campaign';
import { zonesOffPort } from '../src/core/data/seas';
import type { SeaZoneId } from '../src/core/data/seas';
import { getUnitType } from '../src/core/data/units';
import { isShip } from '../src/core/data/roster';
import { REGIONS } from '../src/core/data/regions';
import { factionId, regionId, unitTypeId } from '../src/core/types';

const VENICE = factionId('venice');
const GENOA = factionId('genoa');
const CROATIA = factionId('croatia');

function fleetFor(state: CampaignState, faction: ReturnType<typeof factionId>): Fleet {
  const fleet = fleetsOf(state, faction)[0];
  if (!fleet) throw new Error(`${faction} has no fleet`);
  return fleet;
}

/** Puts a fleet at sea in the given water. */
function putToSea(fleet: Fleet, zone: string): void {
  fleet.location = { kind: 'sea', zone: zone as SeaZoneId };
}

describe('ships', () => {
  it('are a separate arm, not something a drill square produces', () => {
    // Every ship type carries the naval classes and nothing else does.
    const shipTypes = ['longship', 'war_galley', 'cog', 'hulk', 'carrack'].map((id) =>
      getUnitType(unitTypeId(id)),
    );
    for (const ship of shipTypes) {
      expect(isShip(ship), ship.name).toBe(true);
      expect(['warship', 'transport']).toContain(ship.unitClass);
    }
    expect(isShip(getUnitType(unitTypeId('feudal_knights')))).toBe(false);
  });

  it('gives transports room to carry troops and warships little', () => {
    const hulk = getUnitType(unitTypeId('hulk'));
    const galley = getUnitType(unitTypeId('war_galley'));
    expect(hulk.capacity ?? 0).toBeGreaterThan(galley.capacity ?? 0);
    expect(getUnitType(unitTypeId('feudal_knights')).capacity ?? 0).toBe(0);
  });

  it('cannot be mustered in a landlocked province', () => {
    const state = newCampaign({ seed: 'inland' });
    // Esztergom is on the Danube but Prague is not on anything.
    expect(buildableShips(state, regionId('prague'))).toEqual([]);
    expect(buildableShips(state, regionId('venice')).length).toBeGreaterThan(0);
  });

  it('is built at a harbour, paid for, and launched into a fleet', () => {
    const state = newCampaign({ seed: 'launch' });
    const yard = regionId('venice');
    factionState(state, VENICE).treasury = 20000;
    const options = buildableShips(state, yard);
    expect(options.length).toBeGreaterThan(0);
    const before = factionState(state, VENICE).treasury;
    const hullsBefore = navalStrength(state, VENICE);
    expect(startShipbuilding(state, yard, options[0]!).ok).toBe(true);
    expect(factionState(state, VENICE).treasury).toBe(before - shipCost(VENICE, options[0]!));
    for (let i = 0; i < 5; i++) endTurn(state);
    expect(navalStrength(state, VENICE)).toBeGreaterThan(hullsBefore);
  }, 30_000);
});

describe('fleets', () => {
  it('start with the maritime powers and not with the landlocked ones', () => {
    const state = newCampaign({ seed: 'fleets' });
    expect(fleetsOf(state, VENICE).length).toBeGreaterThan(0);
    expect(navalStrength(state, VENICE)).toBeGreaterThan(0);
    expect(fleetsOf(state, factionId('bohemia')).length).toBe(0);
  });

  it('sail from harbour to the waters that harbour opens onto', () => {
    const state = newCampaign({ seed: 'sail' });
    const fleet = fleetFor(state, VENICE);
    expect(fleet.location.kind).toBe('port');
    const options = reachableWaters(state, fleet);
    expect(options.zones.length).toBeGreaterThan(0);
    for (const zone of options.zones) {
      expect(zonesOffPort(regionId('venice'))).toContain(zone);
    }
    const result = moveFleet(state, fleet.id, { kind: 'sea', zone: options.zones[0]! });
    expect(result.kind).toBe('moved');
    expect(fleet.location).toEqual({ kind: 'sea', zone: options.zones[0]! });
  });

  it('cannot sail into a water that does not touch them', () => {
    const state = newCampaign({ seed: 'nosail' });
    const fleet = fleetFor(state, VENICE);
    const result = moveFleet(state, fleet.id, { kind: 'sea', zone: 'baltic_sea' as SeaZoneId });
    expect(result.kind).toBe('blocked');
  });

  it('runs out of movement and stops', () => {
    const state = newCampaign({ seed: 'movement' });
    const fleet = fleetFor(state, VENICE);
    fleet.movement = 0;
    expect(reachableWaters(state, fleet).zones).toEqual([]);
    expect(moveFleet(state, fleet.id, { kind: 'sea', zone: 'adriatic_sea' as SeaZoneId }).kind)
      .toBe('blocked');
  });

  it('meets a hostile squadron instead of sharing the water with it', () => {
    const state = newCampaign({ seed: 'intercept' });
    setStance(state, VENICE, GENOA, 'war');
    const venetian = fleetFor(state, VENICE);
    const genoese = fleetFor(state, GENOA);
    putToSea(genoese, 'adriatic_sea');
    venetian.movement = 3;
    const result = moveFleet(state, venetian.id, {
      kind: 'sea',
      zone: 'adriatic_sea' as SeaZoneId,
    });
    expect(result.kind).toBe('battle');
    if (result.kind === 'battle') {
      expect(result.enemy).toBe(GENOA);
      expect(result.fleets).toContain(genoese.id);
    }
  });

  it('combines two squadrons in the same water and refuses ones apart', () => {
    const state = newCampaign({ seed: 'merge' });
    const first = fleetFor(state, VENICE);
    const second: Fleet = {
      id: newFleetId(state),
      faction: VENICE,
      location: { ...first.location },
      ships: [...first.ships.map((ship) => ({ ...ship }))],
      cargo: [],
      admiral: undefined,
      movement: 2,
    };
    state.fleets.set(second.id, second);
    const hulls = first.ships.length + second.ships.length;
    expect(mergeFleets(state, first.id, second.id).ok).toBe(true);
    expect(first.ships.length).toBe(hulls);
    expect(state.fleets.has(second.id)).toBe(false);
  });

  it('breaks up a hull in harbour and recovers a little of its cost', () => {
    const state = newCampaign({ seed: 'scrap' });
    const fleet = fleetFor(state, VENICE);
    const before = factionState(state, VENICE).treasury;
    const hulls = fleet.ships.length;
    expect(scrapShip(state, fleet.id, 0).ok).toBe(true);
    expect(factionState(state, VENICE).treasury).toBeGreaterThan(before);
    if (hulls > 1) expect(fleet.ships.length).toBe(hulls - 1);
  });
});

describe('carrying an army', () => {
  it('takes regiments aboard and puts them ashore again', () => {
    const state = newCampaign({ seed: 'invasion' });
    const fleet = fleetFor(state, VENICE);
    // Give the fleet room and an army to carry.
    const hulk = getUnitType(unitTypeId('hulk'));
    fleet.ships.push({ type: hulk.id, soldiers: hulk.soldiers, experience: 0 });
    expect(fleetCapacity(fleet)).toBeGreaterThanOrEqual(4);

    const home = fleet.location.kind === 'port' ? fleet.location.region : regionId('venice');
    const army = [...state.armies.values()].find(
      (candidate) => candidate.faction === VENICE && candidate.location === home,
    );
    expect(army, 'Venice has no army at its own harbour').toBeDefined();

    const carried = Math.min(2, army!.regiments.length);
    const indices = Array.from({ length: carried }, (_, index) => index);
    expect(embark(state, fleet.id, army!.id, indices).ok).toBe(true);
    expect(fleet.cargo.length).toBe(carried);

    // Put them back ashore at their own harbour.
    expect(disembark(state, fleet.id, home).ok).toBe(true);
    expect(fleet.cargo.length).toBe(0);
    const ashore = [...state.armies.values()].filter(
      (candidate) => candidate.faction === VENICE && candidate.location === home,
    );
    expect(ashore.length).toBeGreaterThan(0);
  });

  it('refuses to load more than the hulls can hold', () => {
    const state = newCampaign({ seed: 'overload' });
    const fleet = fleetFor(state, VENICE);
    const home = fleet.location.kind === 'port' ? fleet.location.region : regionId('venice');
    const army = [...state.armies.values()].find(
      (candidate) => candidate.faction === VENICE && candidate.location === home,
    )!;
    const tooMany = Array.from({ length: army.regiments.length }, (_, index) => index);
    if (tooMany.length > fleetCapacity(fleet)) {
      const result = embark(state, fleet.id, army.id, tooMany);
      expect(result.ok).toBe(false);
    }
  });

  it('will not land on a shore it is not at war with', () => {
    const state = newCampaign({ seed: 'neutral-shore' });
    const fleet = fleetFor(state, VENICE);
    const hulk = getUnitType(unitTypeId('hulk'));
    fleet.ships.push({ type: hulk.id, soldiers: hulk.soldiers, experience: 0 });
    const home = fleet.location.kind === 'port' ? fleet.location.region : regionId('venice');
    const army = [...state.armies.values()].find(
      (candidate) => candidate.faction === VENICE && candidate.location === home,
    )!;
    embark(state, fleet.id, army.id, [0]);
    putToSea(fleet, 'adriatic_sea');
    // Split is Croatian and Venice is not at war with Croatia.
    const result = disembark(state, fleet.id, regionId('split'));
    expect(result.ok).toBe(false);
  });
});

describe('blockade', () => {
  it('closes the sea road between two harbours', () => {
    const state = newCampaign({ seed: 'blockade' });
    setStance(state, VENICE, CROATIA, 'war');
    const venetian = fleetFor(state, VENICE);
    putToSea(venetian, 'adriatic_sea');
    // Venice and Zadar face each other across the Adriatic.
    expect(seaLaneClosed(state, CROATIA, regionId('zadar'), regionId('venice'))).toBe(true);
    // And the Venetians themselves sail it freely.
    expect(seaLaneClosed(state, VENICE, regionId('venice'), regionId('zadar'))).toBe(false);
  });

  it('is lifted when the owner contests the same water', () => {
    const state = newCampaign({ seed: 'contest' });
    setStance(state, VENICE, CROATIA, 'war');
    putToSea(fleetFor(state, VENICE), 'adriatic_sea');
    expect(seaLaneClosed(state, CROATIA, regionId('zadar'), regionId('venice'))).toBe(true);
    // Croatia sends its own squadron out.
    const croatian = fleetsOf(state, CROATIA)[0];
    if (croatian) {
      putToSea(croatian, 'adriatic_sea');
      expect(seaLaneClosed(state, CROATIA, regionId('zadar'), regionId('venice'))).toBe(false);
    }
  });

  it('cuts the trade of the harbour it closes', () => {
    const state = newCampaign({ seed: 'trade-blockade' });
    const zadar = regionState(state, regionId('zadar'));
    const before = tradeRoutes(state, zadar);
    setStance(state, VENICE, CROATIA, 'war');
    for (const fleet of fleetsOf(state, VENICE)) putToSea(fleet, 'adriatic_sea');
    const after = tradeRoutes(state, zadar);
    expect(after).toBeLessThan(before);
  });

  it('needs every approach closed before a harbour counts as invested', () => {
    const state = newCampaign({ seed: 'invested' });
    setStance(state, VENICE, CROATIA, 'war');
    for (const fleet of fleetsOf(state, VENICE)) putToSea(fleet, 'adriatic_sea');
    // Zadar opens onto the Adriatic alone, so one squadron shuts it.
    expect(zonesOffPort(regionId('zadar'))).toEqual(['adriatic_sea']);
    expect(blockaderOf(state, regionId('zadar'))).toBe(VENICE);
    // Constantinople has three seas in front of it and cannot be shut so easily.
    expect(zonesOffPort(regionId('constantinople')).length).toBeGreaterThan(1);
    expect(isBlockaded(state, regionId('constantinople'))).toBe(false);
  });

  it('stops an army crossing the water it holds', () => {
    const state = newCampaign({ seed: 'army-crossing' });
    setStance(state, VENICE, CROATIA, 'war');
    for (const fleet of fleetsOf(state, VENICE)) putToSea(fleet, 'adriatic_sea');
    expect(seaLaneClosed(state, CROATIA, regionId('zadar'), regionId('venice'))).toBe(true);
  });
});

describe('a naval campaign', () => {
  it('builds navies, fights at sea and lands troops over a century', () => {
    const state = newCampaign({ seed: 'naval-century' });
    const counts = { launched: 0, battles: 0, landings: 0 };
    let seen = 0;
    for (let turn = 0; turn < 160; turn++) {
      endTurn(state);
      for (const entry of state.log.slice(seen)) {
        if (entry.text.includes('is launched at')) counts.launched += 1;
        else if (entry.text.includes('Hulls lost')) counts.battles += 1;
        else if (entry.text.includes('troops land at')) counts.landings += 1;
      }
      seen = state.log.length;
    }
    expect(counts.launched, 'nobody built a ship').toBeGreaterThan(10);
    expect(counts.battles, 'no fleet ever met another').toBeGreaterThan(2);
    expect(counts.landings, 'nobody ever put an army ashore').toBeGreaterThan(0);

    // And the maritime republics should be among the naval powers.
    const venetian = navalStrength(state, VENICE);
    const bohemian = navalStrength(state, factionId('bohemia'));
    expect(bohemian).toBe(0);
    expect(venetian + navalStrength(state, GENOA)).toBeGreaterThan(0);
  }, 180_000);

  it('keeps every fleet consistent with its own cargo and hulls', () => {
    const state = newCampaign({ seed: 'naval-invariants' });
    for (let turn = 0; turn < 120; turn++) {
      endTurn(state);
      for (const fleet of state.fleets.values()) {
        expect(fleet.ships.length, 'an empty fleet was kept').toBeGreaterThan(0);
        expect(fleet.cargo.length).toBeLessThanOrEqual(fleetCapacity(fleet));
        expect(strengthOf(fleet.ships)).toBeGreaterThan(0);
        for (const ship of fleet.ships) {
          expect(isShip(getUnitType(ship.type)), `${ship.type} is not a ship`).toBe(true);
        }
        for (const carried of fleet.cargo) {
          expect(isShip(getUnitType(carried.type)), `${carried.type} is not cargo`).toBe(false);
        }
        const where = fleet.location;
        if (where.kind === 'port') {
          const harbour = REGIONS.find((region) => region.id === where.region);
          expect(harbour?.port, 'a fleet is moored where there is no harbour').toBe(true);
        }
      }
    }
  }, 150_000);
});
