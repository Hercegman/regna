/**
 * Civil war.
 *
 * A disputed succession already cost a realm order everywhere. What it did
 * not do was what a disputed succession actually was: somebody else with a
 * claim, provinces declaring for him, and an army marching on the capital.
 *
 * The properties that matter: a realm that believes in its king never splits,
 * a pretender is a real person with a real argument, his provinces leave the
 * realm, and the war ends one of exactly three ways.
 */
import { describe, it, expect } from 'vitest';
import { newCampaign, endTurn } from '../src/core/campaign';
import {
  AMBITION,
  CIVIL_WAR_COOLDOWN,
  LEGITIMACY_FOR_PEACE,
  MIN_PROVINCES_FOR_WAR,
  PRETENDER_PATIENCE,
  civilWarAgainst,
  civilWarStanding,
  considerCivilWar,
  isPretenderArmy,
  pretenderFor,
  progressCivilWars,
  provincesInRevolt,
} from '../src/core/campaign/civilwar';
import { leaderOf } from '../src/core/campaign/dynasty';
import { transferProvince } from '../src/core/campaign/actions';
import { campaignFromJson, campaignToJson } from '../src/core/campaign/save';
import { newCharacter, factionState, strengthOf } from '../src/core/campaign/state';
import { Rng } from '../src/core/rng';
import { factionId } from '../src/core/types';
import type { CampaignState } from '../src/core/campaign';
import { INDEPENDENT_ID } from '../src/core/data/factions';

const FRANCE = factionId('france');

function campaign(seed = 'civil-war'): CampaignState {
  return newCampaign({ seed, player: factionId('venice') });
}

function rng(seed = 'cw'): Rng {
  return new Rng(seed);
}

/** Puts a realm in the state where a rising is possible. */
function unsteady(state: CampaignState, id = FRANCE) {
  const faction = factionState(state, id);
  faction.legitimacy = 35;
  faction.lastCivilWar = -999;
  for (const province of state.regions.values()) {
    if (province.owner === id) province.unrest = 60;
  }
  return faction;
}

/** A capable man at court with no royal descent: the opportunist. */
function magnate(state: CampaignState, id = FRANCE, command = AMBITION + 2) {
  const faction = factionState(state, id);
  const man = newCharacter(state, id, {
    sex: 'm',
    name: 'An Ambitious Man',
    command,
    governance: 4,
    guile: 6,
    age: 36,
  });
  faction.characters.push(man);
  return man;
}

/** Runs the trigger until a war starts, or gives up. */
function untilRising(state: CampaignState, id = FRANCE, tries = 400): boolean {
  for (let attempt = 0; attempt < tries; attempt++) {
    considerCivilWar(state, rng(`rise-${attempt}`));
    if (civilWarAgainst(state, id)) return true;
  }
  return false;
}

describe('who rises', () => {
  it('nobody, while the realm believes in its king', () => {
    const state = campaign();
    const faction = unsteady(state);
    magnate(state);
    faction.legitimacy = LEGITIMACY_FOR_PEACE;
    expect(untilRising(state, FRANCE, 200)).toBe(false);
  });

  it('nobody, without a man to raise a standard', () => {
    const state = campaign();
    const faction = unsteady(state);
    const ruler = leaderOf(state, FRANCE)!;
    faction.characters = [ruler];
    expect(pretenderFor(state, FRANCE)).toBeUndefined();
    expect(untilRising(state, FRANCE, 200)).toBe(false);
  });

  it('a capable magnate, once a king is weak enough', () => {
    const state = campaign();
    unsteady(state);
    const man = magnate(state);
    expect(pretenderFor(state, FRANCE)?.id).toBe(man.id);
  });

  it('nobody of no ability, however weak the king', () => {
    const state = campaign();
    unsteady(state);
    const faction = factionState(state, FRANCE);
    const ruler = leaderOf(state, FRANCE)!;
    faction.characters = [ruler];
    magnate(state, FRANCE, AMBITION - 3);
    expect(pretenderFor(state, FRANCE)).toBeUndefined();
  });

  it('a king\'s son, over a usurper who has no descent at all', () => {
    const state = campaign();
    const faction = unsteady(state);
    const oldKing = leaderOf(state, FRANCE)!;
    // The old king's son, and then a stranger who has taken the throne.
    const son = newCharacter(state, FRANCE, {
      sex: 'm', father: oldKing.id, name: 'The Rightful Son',
      command: 3, governance: 3, guile: 3, age: 26,
    });
    const usurper = newCharacter(state, FRANCE, {
      sex: 'm', name: 'The Usurper', command: 7, governance: 7, guile: 7, age: 40,
    });
    oldKing.leader = false;
    usurper.leader = true;
    faction.characters = [son, usurper];
    faction.crowned = [oldKing.id as string, usurper.id as string];
    expect(pretenderFor(state, FRANCE)?.id).toBe(son.id);
  });

  it('nobody in a realm too small to divide', () => {
    const state = campaign();
    unsteady(state);
    magnate(state);
    const mine = [...state.regions.values()].filter((r) => r.owner === FRANCE);
    for (const province of mine.slice(MIN_PROVINCES_FOR_WAR - 1)) {
      transferProvince(state, province.id, INDEPENDENT_ID);
    }
    expect(untilRising(state, FRANCE, 200)).toBe(false);
  });

  it('nobody twice in a generation', () => {
    const state = campaign();
    const faction = unsteady(state);
    magnate(state);
    faction.lastCivilWar = state.turn;
    expect(untilRising(state, FRANCE, 200)).toBe(false);
    faction.lastCivilWar = state.turn - CIVIL_WAR_COOLDOWN;
    expect(untilRising(state, FRANCE)).toBe(true);
  });
});

describe('the rising itself', () => {
  function rising(): { state: CampaignState; before: number } {
    const state = campaign();
    unsteady(state);
    magnate(state);
    const before = [...state.regions.values()].filter((r) => r.owner === FRANCE).length;
    expect(untilRising(state)).toBe(true);
    return { state, before };
  }

  it('takes provinces out of the realm, but never the capital', () => {
    const { state, before } = rising();
    const war = civilWarAgainst(state, FRANCE)!;
    expect(war.provinces.length).toBeGreaterThan(0);
    expect(war.provinces.length).toBeLessThanOrEqual(Math.round(before / 3));
    const capital = factionState(state, FRANCE).capital!;
    expect(war.provinces).not.toContain(capital);
    for (const id of war.provinces) {
      expect(state.regions.get(id)!.owner).toBe(INDEPENDENT_ID);
    }
    const after = [...state.regions.values()].filter((r) => r.owner === FRANCE).length;
    expect(after).toBe(before - war.provinces.length);
  });

  it('takes the pretender out of the court and puts him at the head of a host', () => {
    const { state } = rising();
    const war = civilWarAgainst(state, FRANCE)!;
    const court = factionState(state, FRANCE).characters;
    expect(court.some((character) => character.id === war.claimant.id)).toBe(false);
    expect(war.armies.length).toBe(1);
    const host = state.armies.get(war.armies[0]!)!;
    expect(host.faction).toBe(INDEPENDENT_ID);
    expect(host.general?.id).toBe(war.claimant.id);
    expect(strengthOf(host.regiments)).toBeGreaterThan(0);
    expect(isPretenderArmy(state, host.id)).toBe(true);
  });

  it('costs the realm what little faith it had left', () => {
    const state = campaign();
    const faction = unsteady(state);
    magnate(state);
    const before = faction.legitimacy;
    expect(untilRising(state)).toBe(true);
    expect(faction.legitimacy).toBeLessThan(before);
  });

  it('reports where it stands', () => {
    const { state } = rising();
    const standing = civilWarStanding(state, FRANCE)!;
    expect(standing.declared).toBeGreaterThan(0);
    expect(standing.men).toBeGreaterThan(0);
    expect(standing.seasonsLeft).toBeLessThanOrEqual(PRETENDER_PATIENCE);
    expect(civilWarStanding(state, factionId('venice'))).toBeUndefined();
  });
});

describe('how it ends', () => {
  function rising(seed = 'ending'): CampaignState {
    const state = campaign(seed);
    unsteady(state);
    magnate(state);
    expect(untilRising(state)).toBe(true);
    return state;
  }

  it('with the crown, when everything that declared is taken back', () => {
    const state = rising();
    const war = civilWarAgainst(state, FRANCE)!;
    const before = factionState(state, FRANCE).legitimacy;
    for (const id of war.provinces) transferProvince(state, id, FRANCE);
    for (const id of war.armies) state.armies.delete(id);
    progressCivilWars(state);
    expect(civilWarAgainst(state, FRANCE)).toBeUndefined();
    expect(factionState(state, FRANCE).legitimacy).toBeGreaterThan(before);
    expect(provincesInRevolt(state, FRANCE)).toEqual([]);
  });

  it('with the pretender, when he has the capital', () => {
    const state = rising();
    const war = civilWarAgainst(state, FRANCE)!;
    const capital = factionState(state, FRANCE).capital!;
    const deposed = leaderOf(state, FRANCE)!;
    transferProvince(state, capital, INDEPENDENT_ID);
    progressCivilWars(state);

    expect(civilWarAgainst(state, FRANCE)).toBeUndefined();
    const faction = factionState(state, FRANCE);
    // He is king, the realm is whole again, and the old king is gone.
    const king = leaderOf(state, FRANCE)!;
    expect(king.name.startsWith(war.claimant.name.split(' ')[0]!)).toBe(true);
    expect(faction.characters.some((c) => c.id === deposed.id)).toBe(false);
    expect(state.regions.get(capital)!.owner).toBe(FRANCE);
    for (const id of war.provinces) expect(state.regions.get(id)!.owner).toBe(FRANCE);
    expect(faction.legitimacy).toBe(75);
    expect(faction.crowned).toContain(king.id as string);
  });

  it('with nothing, when the cause outlives its moment', () => {
    const state = rising();
    const war = civilWarAgainst(state, FRANCE)!;
    state.turn = war.expires;
    progressCivilWars(state);
    expect(civilWarAgainst(state, FRANCE)).toBeUndefined();
    // His men go home; the provinces he took do not come back.
    for (const id of war.armies) expect(state.armies.has(id)).toBe(false);
    for (const id of war.provinces) {
      expect(state.regions.get(id)!.owner).toBe(INDEPENDENT_ID);
    }
  });

  it('with nothing, when there is no crown left to fight over', () => {
    const state = rising();
    factionState(state, FRANCE).alive = false;
    progressCivilWars(state);
    expect(civilWarAgainst(state, FRANCE)).toBeUndefined();
  });

  it('never leaves a dead army on the books', () => {
    const state = rising();
    const war = civilWarAgainst(state, FRANCE)!;
    state.armies.delete(war.armies[0]!);
    progressCivilWars(state);
    const still = civilWarAgainst(state, FRANCE);
    if (still) expect(still.armies).toEqual([]);
  });
});

describe('across a save', () => {
  it('keeps the pretender, his provinces and his host', () => {
    const state = campaign();
    unsteady(state);
    magnate(state);
    expect(untilRising(state)).toBe(true);
    const war = civilWarAgainst(state, FRANCE)!;

    const restored = campaignFromJson(campaignToJson(state));
    const copy = civilWarAgainst(restored, FRANCE)!;
    expect(copy.claimant.id).toBe(war.claimant.id);
    expect(copy.claimant.name).toBe(war.claimant.name);
    expect(copy.provinces).toEqual(war.provinces);
    expect(copy.armies).toEqual(war.armies);
    expect(copy.expires).toBe(war.expires);
    expect(factionState(restored, FRANCE).lastCivilWar).toBe(
      factionState(state, FRANCE).lastCivilWar,
    );
    expect(factionState(restored, FRANCE).crowned).toEqual(
      factionState(state, FRANCE).crowned,
    );
  });
});

describe('over a campaign', () => {
  it('tears a few realms in two, and no more than that', () => {
    const state = newCampaign({ seed: 'civil-live' });
    let risen = 0;
    let settled = 0;
    let peak = 0;
    for (let turn = 0; turn < 200; turn++) {
      endTurn(state);
      peak = Math.max(peak, state.civilWars.size);
      for (const entry of state.log.slice(-60)) {
        if (entry.turn !== state.turn && entry.turn !== state.turn - 1) continue;
        if (/raises his standard/.test(entry.text)) risen += 1;
        if (/is put down|takes the capital, and with it|cause is abandoned/.test(entry.text)) {
          settled += 1;
        }
      }
    }
    expect(risen).toBeGreaterThan(0);
    expect(risen).toBeLessThan(25);
    expect(settled).toBeGreaterThan(0);
    expect(peak).toBeLessThan(10);
  }, 300_000);

  it('never leaves a realm with two rulers, or a war against a dead crown', () => {
    const state = newCampaign({ seed: 'civil-live' });
    for (let turn = 0; turn < 150; turn++) {
      endTurn(state);
      for (const [crown, war] of state.civilWars) {
        const faction = state.factions.get(crown);
        expect(faction?.alive, `war against dead ${crown}`).toBe(true);
        expect(faction!.characters.some((c) => c.id === war.claimant.id)).toBe(false);
        for (const id of war.armies) expect(state.armies.has(id)).toBe(true);
      }
      for (const [id, faction] of state.factions) {
        if (id === INDEPENDENT_ID || !faction.alive) continue;
        expect(faction.characters.filter((c) => c.leader).length).toBe(1);
      }
    }
  }, 300_000);
});
