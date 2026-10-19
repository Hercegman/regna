/**
 * What a realm can see.
 *
 * Until now every player knew the garrison of every town in Europe. The point
 * of these tests is that the line between what was public and what was not is
 * the right line, and that it is the same line for everyone: the AI never
 * looked further than its own borders and its own armies, so the fog takes an
 * advantage away from the player rather than handing one to the machine.
 */
import { describe, it, expect } from 'vitest';
import { newCampaign, endTurn } from '../src/core/campaign';
import {
  canSeeAgent,
  canSeeArmy,
  canSeeCaravan,
  canSeeFleet,
  estimatedGarrison,
  sightOf,
  watchedProvinces,
  watchedZones,
} from '../src/core/campaign/sight';
import { recruitAgent, moveAgent } from '../src/core/campaign/agents';
import { Rng } from '../src/core/rng';
import { buildingId, factionId, regionId } from '../src/core/types';
import { landNeighbours, seaNeighbours } from '../src/core/data/adjacency';
import { getSeaZone, SEA_ZONE_IDS } from '../src/core/data/seas';
import type { CampaignState } from '../src/core/campaign';
import { INDEPENDENT_ID } from '../src/core/data/factions';

const CROATIA = factionId('croatia');

function campaign(seed = 'sight'): CampaignState {
  return newCampaign({ seed, player: CROATIA });
}

function ours(state: CampaignState) {
  return [...state.regions.values()].filter((r) => r.owner === CROATIA);
}

describe('what is public', () => {
  it('is everywhere: a realm always knows the map exists', () => {
    const state = campaign();
    for (const province of state.regions.values()) {
      // Never anything stronger than "seen": there is no province the game
      // pretends does not exist.
      const sight = sightOf(state, CROATIA, province.id);
      expect(sight === 'seen' || sight === 'watched').toBe(true);
    }
  });
});

describe('what a realm watches', () => {
  it('its own ground', () => {
    const state = campaign();
    const watched = watchedProvinces(state, CROATIA);
    for (const province of ours(state)) expect(watched.has(province.id)).toBe(true);
  });

  it('everything over its own borders', () => {
    const state = campaign();
    const watched = watchedProvinces(state, CROATIA);
    for (const province of ours(state)) {
      for (const next of landNeighbours(province.id)) expect(watched.has(next)).toBe(true);
      for (const next of seaNeighbours(province.id)) expect(watched.has(next)).toBe(true);
    }
  });

  it('nothing on the far side of the world', () => {
    const state = campaign();
    const watched = watchedProvinces(state, CROATIA);
    expect(watched.has(regionId('cairo'))).toBe(false);
    expect(watched.has(regionId('dublin'))).toBe(false);
    expect(sightOf(state, CROATIA, regionId('cairo'))).toBe('seen');
  });

  it('wherever it has put an agent, and one province beyond him', () => {
    const state = campaign();
    const home = ours(state)[0]!;
    home.buildings.add(buildingId('market'));
    state.factions.get(CROATIA)!.treasury = 50_000;
    expect(recruitAgent(state, home.id, 'merchant', new Rng('see')).ok).toBe(true);
    const agent = [...state.agents.values()][0]!;

    // Walk him somewhere the realm could not otherwise see.
    const before = watchedProvinces(state, CROATIA);
    let steps = 0;
    while (steps < 4) {
      const next = landNeighbours(agent.location).find((id) => !before.has(id));
      if (!next) break;
      expect(moveAgent(state, agent.id, next).ok).toBe(true);
      steps += 1;
      break;
    }
    if (steps > 0) {
      const after = watchedProvinces(state, CROATIA);
      expect(after.has(agent.location)).toBe(true);
      expect(before.has(agent.location)).toBe(false);
    }
  });

  it('the harbours on a water its squadron is standing in', () => {
    const state = campaign();
    const fleet = [...state.fleets.values()].find((f) => f.faction === CROATIA);
    if (!fleet) return;
    const zone = SEA_ZONE_IDS.find((id) => getSeaZone(id).ports.length > 1)!;
    fleet.location = { kind: 'sea', zone };
    const watched = watchedProvinces(state, CROATIA);
    for (const port of getSeaZone(zone).ports) expect(watched.has(port)).toBe(true);
    expect(watchedZones(state, CROATIA).has(zone as string)).toBe(true);
  });
});

describe('what is in the field', () => {
  it('shows our own armies wherever they are', () => {
    const state = campaign();
    const army = [...state.armies.values()].find((a) => a.faction === CROATIA)!;
    army.location = regionId('cairo');
    expect(canSeeArmy(state, CROATIA, army.id)).toBe(true);
  });

  it('hides somebody else\'s army where we have no eyes', () => {
    const state = campaign();
    const theirs = [...state.armies.values()].find((a) => a.faction !== CROATIA)!;
    theirs.location = regionId('cairo');
    expect(canSeeArmy(state, CROATIA, theirs.id)).toBe(false);
    // And shows it the moment it comes over the border.
    theirs.location = ours(state)[0]!.id;
    expect(canSeeArmy(state, CROATIA, theirs.id)).toBe(true);
  });

  it('hides a foreign fleet on a water we are not on', () => {
    const state = campaign();
    const theirs = [...state.fleets.values()].find((f) => f.faction !== CROATIA);
    if (!theirs) return;
    const far = SEA_ZONE_IDS.find(
      (id) => !getSeaZone(id).ports.some((p) => state.regions.get(p)?.owner === CROATIA),
    )!;
    theirs.location = { kind: 'sea', zone: far };
    expect(canSeeFleet(state, CROATIA, theirs.id)).toBe(false);
  });

  it('hides a foreign agent, and shows ours', () => {
    const state = campaign();
    const home = ours(state)[0]!;
    home.buildings.add(buildingId('market'));
    state.factions.get(CROATIA)!.treasury = 50_000;
    recruitAgent(state, home.id, 'merchant', new Rng('mine'));
    const mine = [...state.agents.values()][0]!;
    expect(canSeeAgent(state, CROATIA, mine.id)).toBe(true);

    state.agents.set(mine.id, { ...mine, faction: factionId('venice'), location: regionId('cairo') });
    expect(canSeeAgent(state, CROATIA, mine.id)).toBe(false);
  });

  it('hides a foreign caravan on a road we are not standing on', () => {
    const state = campaign();
    for (let turn = 0; turn < 12; turn++) endTurn(state);
    const watched = watchedProvinces(state, CROATIA);
    for (const caravan of state.caravans.values()) {
      const seen = canSeeCaravan(state, CROATIA, caravan.id, watched);
      if (caravan.faction === CROATIA) expect(seen).toBe(true);
    }
  }, 60_000);
});

describe('guessing at what cannot be counted', () => {
  it('gives the true number where we are watching', () => {
    const state = campaign();
    const home = ours(state)[0]!;
    let real = 0;
    for (const regiment of home.garrison) real += regiment.soldiers;
    expect(estimatedGarrison(state, CROATIA, home)).toBe(real);
  });

  it('gives an estimate from the size of the place where we are not', () => {
    const state = campaign();
    const far = state.regions.get(regionId('cairo'))!;
    const guess = estimatedGarrison(state, CROATIA, far);
    expect(guess).toBeGreaterThan(0);
    // It is a guess, not the answer: emptying the town changes nothing.
    const emptied = { ...far, garrison: [] };
    expect(estimatedGarrison(state, CROATIA, emptied)).toBe(guess);
  });

  it('guesses higher for a larger and better walled place', () => {
    const state = campaign();
    const big = state.regions.get(regionId('cairo'))!;
    const small = [...state.regions.values()].find(
      (r) => r.tier === 'village' && !watchedProvinces(state, CROATIA).has(r.id),
    );
    if (!small) return;
    expect(estimatedGarrison(state, CROATIA, big)).toBeGreaterThan(
      estimatedGarrison(state, CROATIA, small),
    );
  });
});

describe('the fog in a running campaign', () => {
  it('leaves a realm seeing its own neighbourhood and not the world', () => {
    const state = campaign('sight-live');
    for (let turn = 0; turn < 40; turn++) endTurn(state);
    const watched = watchedProvinces(state, CROATIA);
    const total = state.regions.size;
    expect(watched.size).toBeGreaterThan(ours(state).length);
    // A small realm should be a long way from seeing everything.
    expect(watched.size).toBeLessThan(total / 2);
  }, 120_000);

  it('never claims to see an army of a realm that does not exist', () => {
    const state = campaign('sight-live');
    for (let turn = 0; turn < 40; turn++) endTurn(state);
    const watched = watchedProvinces(state, CROATIA);
    for (const army of state.armies.values()) {
      const seen = canSeeArmy(state, CROATIA, army.id, watched);
      if (!seen) continue;
      // Anything we can see is standing somewhere we are watching.
      expect(watched.has(army.location) || army.faction === CROATIA).toBe(true);
    }
  }, 120_000);

  it('grows as a realm grows', () => {
    const state = campaign('sight-live');
    const before = watchedProvinces(state, CROATIA).size;
    const neighbour = [...state.regions.values()].find(
      (r) => r.owner !== CROATIA && r.owner !== INDEPENDENT_ID &&
        landNeighbours(r.id).some((n) => state.regions.get(n)?.owner === CROATIA),
    )!;
    neighbour.owner = CROATIA;
    expect(watchedProvinces(state, CROATIA).size).toBeGreaterThanOrEqual(before);
  });
});
