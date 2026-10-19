/**
 * What a company does when the money stops.
 *
 * Companies served or left, and that was the whole of it. What they also did
 * — take another prince's offer, and more than once keep the city they had
 * been hired to hold — is what these tests pin down. The hinge is arrears: a
 * paid company keeps its contract, and an unpaid one does not.
 */
import { describe, it, expect } from 'vitest';
import { newCampaign, endTurn } from '../src/core/campaign';
import {
  ARREARS_BEFORE_MUTINY,
  ARREARS_BEFORE_POACHING,
  canPoach,
  isMercenary,
  mutiny,
  poachCost,
  poachCompany,
  poachable,
} from '../src/core/campaign/mercenaries';
import { setStance } from '../src/core/campaign/diplomacy';
import { campaignFromJson, campaignToJson } from '../src/core/campaign/save';
import { Rng } from '../src/core/rng';
import { armyId, factionId, regionId, unitTypeId } from '../src/core/types';
import { getUnitType } from '../src/core/data/units';
import type { CampaignState, Regiment } from '../src/core/campaign';
import { INDEPENDENT_ID } from '../src/core/data/factions';

const VENICE = factionId('venice');
const GENOA = factionId('genoa');

function campaign(): CampaignState {
  return newCampaign({ seed: 'merc-politics', player: VENICE });
}

function company(type = 'swiss_pikemen'): Regiment {
  const unit = getUnitType(unitTypeId(type));
  return { type: unit.id, soldiers: unit.soldiers, experience: 1, mercenary: true };
}

function militia(): Regiment {
  const unit = getUnitType(unitTypeId('town_militia'));
  return { type: unit.id, soldiers: unit.soldiers, experience: 0 };
}

/** Gives Genoa an army of hired men standing somewhere, at war with Venice. */
function hiredArmy(state: CampaignState, where = regionId('genoa')) {
  setStance(state, VENICE, GENOA, 'war');
  const id = armyId('merc-test-army');
  state.armies.set(id, {
    id,
    faction: GENOA,
    location: where,
    regiments: [company(), militia()],
    general: undefined,
    movement: 3,
    embarked: false,
  });
  return state.armies.get(id)!;
}

describe('buying a company out of somebody else\'s service', () => {
  it('is impossible while their employer is paying them', () => {
    const state = campaign();
    hiredArmy(state);
    state.factions.get(GENOA)!.arrears = 0;
    expect(poachable(state, VENICE)).toEqual([]);
  });

  it('becomes possible the season the pay is late', () => {
    const state = campaign();
    hiredArmy(state);
    state.factions.get(GENOA)!.arrears = ARREARS_BEFORE_POACHING;
    const offers = poachable(state, VENICE);
    expect(offers.length).toBe(1);
    expect(isMercenary(offers[0]!.regiment)).toBe(true);
    expect(offers[0]!.employer).toBe(GENOA);
  });

  it('offers only hired companies, never a realm\'s own troops', () => {
    const state = campaign();
    const army = hiredArmy(state);
    state.factions.get(GENOA)!.arrears = 3;
    army.regiments.push(militia(), militia());
    const offers = poachable(state, VENICE);
    expect(offers.length).toBe(1);
    expect(offers.every((offer) => isMercenary(offer.regiment))).toBe(true);
  });

  it('is an act of war, not a labour market', () => {
    const state = campaign();
    hiredArmy(state);
    state.factions.get(GENOA)!.arrears = 3;
    setStance(state, VENICE, GENOA, 'neutral');
    expect(poachable(state, VENICE)).toEqual([]);
  });

  it('needs the money, and takes it', () => {
    const state = campaign();
    hiredArmy(state);
    state.factions.get(GENOA)!.arrears = 3;
    const offer = poachable(state, VENICE)[0]!;
    state.factions.get(VENICE)!.treasury = offer.cost - 1;
    expect(canPoach(state, VENICE, offer).ok).toBe(false);

    state.factions.get(VENICE)!.treasury = offer.cost + 500;
    expect(poachCompany(state, VENICE, offer).ok).toBe(true);
    expect(state.factions.get(VENICE)!.treasury).toBe(500);
    expect(offer.cost).toBe(poachCost(offer.regiment));
  });

  it('takes the company out of their army and puts it in ours', () => {
    const state = campaign();
    const theirs = hiredArmy(state);
    state.factions.get(GENOA)!.arrears = 3;
    state.factions.get(VENICE)!.treasury = 50_000;
    const ours = [...state.armies.values()].find((army) => army.faction === VENICE)!;
    const before = ours.regiments.length;

    const offer = poachable(state, VENICE)[0]!;
    expect(poachCompany(state, VENICE, offer).ok).toBe(true);
    expect(theirs.regiments.some(isMercenary)).toBe(false);
    expect(ours.regiments.length).toBe(before + 1);
    expect(ours.regiments.some(isMercenary)).toBe(true);
  });

  it('dissolves an army whose last company was bought', () => {
    const state = campaign();
    const theirs = hiredArmy(state);
    theirs.regiments = [company()];
    state.factions.get(GENOA)!.arrears = 3;
    state.factions.get(VENICE)!.treasury = 50_000;
    const offer = poachable(state, VENICE)[0]!;
    expect(poachCompany(state, VENICE, offer).ok).toBe(true);
    expect(state.armies.has(theirs.id)).toBe(false);
  });

  it('cannot be done twice with the same company', () => {
    const state = campaign();
    hiredArmy(state);
    state.factions.get(GENOA)!.arrears = 3;
    state.factions.get(VENICE)!.treasury = 50_000;
    const offer = poachable(state, VENICE)[0]!;
    expect(poachCompany(state, VENICE, offer).ok).toBe(true);
    expect(poachCompany(state, VENICE, offer).ok).toBe(false);
  });
});

describe('a company that keeps the town', () => {
  it('does nothing while the pay arrives', () => {
    const state = campaign();
    const province = [...state.regions.values()].find((r) => r.owner === VENICE)!;
    province.garrison = [company(), company()];
    state.factions.get(VENICE)!.arrears = 0;
    for (let turn = 0; turn < 40; turn++) mutiny(state, new Rng(`paid-${turn}`));
    expect(province.owner).toBe(VENICE);
  });

  it('takes it once it has been owed for long enough', () => {
    const state = campaign();
    const province = [...state.regions.values()].find((r) => r.owner === VENICE)!;
    province.garrison = [company(), company(), militia()];
    state.factions.get(VENICE)!.arrears = ARREARS_BEFORE_MUTINY + 4;

    let taken = false;
    for (let turn = 0; turn < 60 && !taken; turn++) {
      mutiny(state, new Rng(`owed-${turn}`));
      taken = province.owner === INDEPENDENT_ID;
    }
    expect(taken).toBe(true);
    // They hold it themselves: the realm's own soldiers in it are gone.
    expect(province.garrison.length).toBeGreaterThan(0);
    expect(province.garrison.every(isMercenary)).toBe(true);
    expect(province.governor).toBeUndefined();
    expect(province.unrest).toBeGreaterThan(0);
  });

  it('cannot take a town it is only a small part of', () => {
    const state = campaign();
    const province = [...state.regions.values()].find((r) => r.owner === VENICE)!;
    province.garrison = [company(), militia(), militia(), militia()];
    state.factions.get(VENICE)!.arrears = 12;
    for (let turn = 0; turn < 60; turn++) mutiny(state, new Rng(`few-${turn}`));
    expect(province.owner).toBe(VENICE);
  });

  it('takes one town a season at most', () => {
    const state = campaign();
    const mine = [...state.regions.values()].filter((r) => r.owner === VENICE);
    for (const province of mine) province.garrison = [company(), company()];
    state.factions.get(VENICE)!.arrears = 20;
    const before = mine.filter((r) => r.owner === VENICE).length;
    mutiny(state, new Rng('all-at-once'));
    const after = mine.filter((r) => r.owner === VENICE).length;
    expect(before - after).toBeLessThanOrEqual(1);
  });
});

describe('arrears', () => {
  it('are counted when the pay is late, not when the vault is empty', () => {
    const state = newCampaign({ seed: 'arrears', player: VENICE });
    // A realm with soldiers it cannot pay for and nothing in hand.
    const faction = state.factions.get(VENICE)!;
    faction.treasury = 50;
    const province = [...state.regions.values()].find((r) => r.owner === VENICE)!;
    for (let i = 0; i < 6; i++) province.garrison.push(militia());
    endTurn(state);
    expect(faction.arrears).toBeGreaterThan(0);
    // And they do not vanish the moment one good season arrives.
    const owed = faction.arrears;
    faction.treasury = 500_000;
    endTurn(state);
    expect(faction.arrears).toBe(Math.max(0, owed - 1));
  }, 60_000);

  it('survive a save', () => {
    const state = campaign();
    state.factions.get(VENICE)!.arrears = 5;
    const restored = campaignFromJson(campaignToJson(state));
    expect(restored.factions.get(VENICE)!.arrears).toBe(5);
  });
});

describe('over a campaign', () => {
  it('changes some sides and keeps the rest honest', () => {
    const state = newCampaign({ seed: 'merc-live' });
    let poached = 0;
    let seized = 0;
    for (let turn = 0; turn < 200; turn++) {
      endTurn(state);
      for (const entry of state.log.slice(-60)) {
        if (entry.turn !== state.turn && entry.turn !== state.turn - 1) continue;
        if (/changes sides at/.test(entry.text)) poached += 1;
        if (/take the town for themselves/.test(entry.text)) seized += 1;
      }
    }
    // Both happen, and neither is common: these are the disasters of a realm
    // that has run out of money, not a routine part of a turn.
    expect(poached).toBeGreaterThan(0);
    expect(poached).toBeLessThan(80);
    expect(seized).toBeLessThan(20);
  }, 300_000);

  it('never leaves a bought company in two places at once', () => {
    const state = newCampaign({ seed: 'merc-live' });
    for (let turn = 0; turn < 120; turn++) endTurn(state);
    const seen = new Set<Regiment>();
    for (const army of state.armies.values()) {
      for (const regiment of army.regiments) {
        expect(seen.has(regiment)).toBe(false);
        seen.add(regiment);
      }
    }
    for (const province of state.regions.values()) {
      for (const regiment of province.garrison) {
        expect(seen.has(regiment)).toBe(false);
        seen.add(regiment);
      }
    }
  }, 180_000);
});
