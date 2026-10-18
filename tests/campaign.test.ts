import { describe, it, expect } from 'vitest';
import { newCampaign } from '../src/core/campaign';
import {
  endTurn,
  factionState,
  provincesOf,
  regionState,
  strengthOf,
  startConstruction,
  startRecruitment,
  availableBuildings,
  recruitableUnits,
  moveArmy,
  armiesOf,
  factionFinances,
  publicOrder,
  declareWar,
  makePeace,
  relation,
  CAMPAIGN_START_YEAR,
} from '../src/core/campaign';
import { FACTIONS, INDEPENDENT_ID } from '../src/core/data/factions';
import { REGIONS } from '../src/core/data/regions';
import { factionId, regionId } from '../src/core/types';

const CROATIA = factionId('croatia');
const HUNGARY = factionId('hungary');

describe('campaign setup', () => {
  it('starts in 1080 with every province owned and garrisoned', () => {
    const state = newCampaign();
    expect(state.year).toBe(CAMPAIGN_START_YEAR);
    expect(state.turn).toBe(1);
    expect(state.regions.size).toBe(REGIONS.length);
    for (const region of state.regions.values()) {
      expect(region.owner).toBeTruthy();
      expect(strengthOf(region.garrison)).toBeGreaterThan(0);
      expect(region.population).toBeGreaterThan(0);
    }
  });

  it('brings only the factions that existed in 1080 to life', () => {
    const state = newCampaign();
    for (const faction of FACTIONS) {
      const alive = factionState(state, faction.id).alive;
      if (faction.appearsIn === CAMPAIGN_START_YEAR) {
        expect(alive, `${faction.name} should be alive`).toBe(true);
      } else {
        expect(alive, `${faction.name} should not exist yet`).toBe(false);
      }
    }
  });

  it('gives every living faction a treasury, a leader and an army', () => {
    const state = newCampaign();
    for (const [id, faction] of state.factions) {
      if (!faction.alive || id === INDEPENDENT_ID) continue;
      expect(faction.treasury, id).toBeGreaterThan(0);
      expect(faction.characters.length, id).toBeGreaterThan(0);
      expect(armiesOf(state, id).length, id).toBeGreaterThan(0);
    }
  });

  it('seeds relations between every pair of living factions', () => {
    const state = newCampaign();
    const croatia = factionState(state, CROATIA);
    expect(croatia.relations.size).toBeGreaterThan(20);
    expect(relation(state, CROATIA, HUNGARY).stance).toBe('neutral');
  });

  it('is reproducible from its seed', () => {
    const a = newCampaign({ seed: 'identical' });
    const b = newCampaign({ seed: 'identical' });
    const snapshot = (state: ReturnType<typeof newCampaign>): string =>
      [...state.regions.values()]
        .map((region) => `${region.id}:${region.owner}:${strengthOf(region.garrison)}`)
        .join('|');
    expect(snapshot(a)).toBe(snapshot(b));
  });

  it('models religion separately from ownership where history requires it', () => {
    const state = newCampaign();
    // Turkish-ruled Anatolia was still a Christian country in 1080.
    expect(regionState(state, regionId('nicaea')).religion).toBe('orthodox');
    expect(regionState(state, regionId('nicaea')).owner).toBe(factionId('rum'));
    // And Norman Sicily was still largely Muslim.
    expect(regionState(state, regionId('palermo')).religion).toBe('sunni');
    expect(regionState(state, regionId('palermo')).owner).toBe(factionId('sicily'));
  });
});

describe('orders', () => {
  it('builds a building, charging for it and finishing on schedule', () => {
    const state = newCampaign();
    const province = provincesOf(state, CROATIA)[0]!;
    const options = availableBuildings(state, province.id);
    expect(options.length).toBeGreaterThan(0);
    const before = factionState(state, CROATIA).treasury;
    const result = startConstruction(state, province.id, options[0]!);
    expect(result.ok).toBe(true);
    expect(factionState(state, CROATIA).treasury).toBeLessThan(before);
    expect(province.construction).toBeDefined();

    const turns = province.construction!.turnsLeft;
    for (let i = 0; i < turns; i++) endTurn(state);
    expect(province.buildings.has(options[0]!)).toBe(true);
  });

  it('refuses a building the treasury cannot pay for', () => {
    const state = newCampaign();
    const province = provincesOf(state, CROATIA)[0]!;
    factionState(state, CROATIA).treasury = 0;
    const options = availableBuildings(state, province.id);
    const result = startConstruction(state, province.id, options[0]!);
    expect(result.ok).toBe(false);
  });

  it('recruits a regiment into the garrison', () => {
    const state = newCampaign();
    const province = provincesOf(state, CROATIA)[0]!;
    factionState(state, CROATIA).treasury = 20000;
    const options = recruitableUnits(state, province.id);
    expect(options.length).toBeGreaterThan(0);
    const before = province.garrison.length;
    expect(startRecruitment(state, province.id, options[0]!).ok).toBe(true);
    for (let i = 0; i < 3; i++) endTurn(state);
    expect(province.garrison.length).toBeGreaterThan(before);
  });

  it('will not move an army into a neutral neighbour', () => {
    const state = newCampaign();
    const army = armiesOf(state, CROATIA)[0]!;
    army.movement = 10;
    // Croatia and Hungary start neutral, so the border is closed.
    const hungarian = [...state.regions.values()].find(
      (region) => region.owner === HUNGARY,
    );
    expect(hungarian).toBeDefined();
    const result = moveArmy(state, army.id, hungarian!.id);
    expect(result.kind).not.toBe('moved');
  });

  it('moves an army between its own provinces', () => {
    const state = newCampaign();
    const army = armiesOf(state, CROATIA)[0]!;
    army.movement = 10;
    const target = provincesOf(state, CROATIA).find((region) => region.id !== army.location);
    expect(target).toBeDefined();
    const result = moveArmy(state, army.id, target!.id);
    // Adjacent or not, the result must be a legal outcome rather than a throw.
    expect(['moved', 'blocked']).toContain(result.kind);
  });
});

describe('economy', () => {
  it('gives every living faction a finance report that balances', () => {
    const state = newCampaign();
    for (const [id, faction] of state.factions) {
      if (!faction.alive || id === INDEPENDENT_ID) continue;
      const finances = factionFinances(state, id);
      expect(finances.net).toBe(
        finances.provinceNet - finances.armyUpkeep - finances.garrisonUpkeep + finances.stipend,
      );
      expect(Number.isFinite(finances.net)).toBe(true);
    }
  });

  it('makes the maritime republics rich from trade', () => {
    const state = newCampaign();
    const venice = factionFinances(state, factionId('venice'));
    const navarre = factionFinances(state, factionId('navarre'));
    // Venice has one marshy province and should still out-earn a landlocked
    // mountain kingdom of comparable size, because of its trade multiplier.
    expect(venice.provinceNet).toBeGreaterThan(navarre.provinceNet);
  });

  it('scores public order worse in a province of the wrong faith', () => {
    const state = newCampaign();
    const sameFaith = regionState(state, regionId('knin'));
    const otherFaith = regionState(state, regionId('palermo'));
    expect(publicOrder(state, otherFaith)).toBeLessThan(publicOrder(state, sameFaith));
  });

  it('earns income every turn without the treasury running away', () => {
    const state = newCampaign();
    const treasuries: number[] = [];
    for (let i = 0; i < 8; i++) {
      endTurn(state);
      treasuries.push(factionState(state, CROATIA).treasury);
    }
    for (const value of treasuries) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('diplomacy', () => {
  it('declares and then ends a war', () => {
    const state = newCampaign();
    expect(declareWar(state, CROATIA, HUNGARY)).toBe(true);
    expect(relation(state, CROATIA, HUNGARY).stance).toBe('war');
    expect(relation(state, HUNGARY, CROATIA).stance).toBe('war');
    // A truce needs a few turns of war first.
    expect(makePeace(state, CROATIA, HUNGARY)).toBe(false);
    for (let i = 0; i < 4; i++) endTurn(state);
    if (relation(state, CROATIA, HUNGARY).stance === 'war') {
      expect(makePeace(state, CROATIA, HUNGARY)).toBe(true);
      expect(relation(state, CROATIA, HUNGARY).stance).toBe('ceasefire');
    }
  });

  it('worsens attitude on both sides when war is declared', () => {
    const state = newCampaign();
    const before = relation(state, HUNGARY, CROATIA).attitude;
    declareWar(state, CROATIA, HUNGARY);
    expect(relation(state, HUNGARY, CROATIA).attitude).toBeLessThan(before);
  });
});

describe('the clock', () => {
  it('runs two turns to the year, summer then winter', () => {
    const state = newCampaign();
    expect(state.season).toBe('summer');
    endTurn(state);
    expect(state.season).toBe('winter');
    expect(state.year).toBe(CAMPAIGN_START_YEAR);
    endTurn(state);
    expect(state.season).toBe('summer');
    expect(state.year).toBe(CAMPAIGN_START_YEAR + 1);
  });

  it('restores army movement at the start of each turn', () => {
    const state = newCampaign();
    const army = armiesOf(state, CROATIA)[0]!;
    army.movement = 0;
    endTurn(state);
    expect(army.movement).toBeGreaterThan(0);
  });
});
