import { describe, it, expect } from 'vitest';
import { newCampaign } from '../src/core/campaign';
import {
  campaignOver,
  endTurn,
  reckon,
  regionState,
  strengthOf,
  CAMPAIGN_END_YEAR,
  type CampaignState,
} from '../src/core/campaign';
import { REGIONS } from '../src/core/data/regions';
import { INDEPENDENT_ID } from '../src/core/data/factions';
import { factionId } from '../src/core/types';

const CROATIA = factionId('croatia');

/** Hands every province on the map to one faction. */
function giveEverythingTo(state: CampaignState, faction: ReturnType<typeof factionId>): void {
  for (const region of state.regions.values()) region.owner = faction;
}

describe('the end of a campaign', () => {
  it('does not end while the player holds land and the years remain', () => {
    const state = newCampaign({ seed: 'ongoing', player: CROATIA });
    expect(campaignOver(state)).toBe(false);
    expect(reckon(state)).toBeUndefined();
  });

  it('ends in supremacy when the player holds more than half the map', () => {
    const state = newCampaign({ seed: 'supreme', player: CROATIA });
    giveEverythingTo(state, CROATIA);
    const verdict = reckon(state)!;
    expect(verdict.outcome).toBe('supremacy');
    expect(verdict.provinces).toBe(REGIONS.length);
    expect(verdict.totalProvinces).toBe(REGIONS.length);
    expect(verdict.share).toBeCloseTo(1, 5);
    expect(verdict.rank).toBe(1);
  });

  it('ends in ruin when the player holds nothing and commands nobody', () => {
    const state = newCampaign({ seed: 'ruin', player: CROATIA });
    for (const region of state.regions.values()) {
      if (region.owner === CROATIA) region.owner = INDEPENDENT_ID;
    }
    for (const [id, army] of [...state.armies]) {
      if (army.faction === CROATIA) state.armies.delete(id);
    }
    const verdict = reckon(state)!;
    expect(verdict.outcome).toBe('ruin');
    expect(verdict.provinces).toBe(0);
  });

  it('keeps a landless player alive while an army of theirs is still in the field', () => {
    const state = newCampaign({ seed: 'exile', player: CROATIA });
    for (const region of state.regions.values()) {
      if (region.owner === CROATIA) region.owner = INDEPENDENT_ID;
    }
    const army = [...state.armies.values()].find((candidate) => candidate.faction === CROATIA);
    expect(army, 'Croatia should still have an army').toBeDefined();
    expect(reckon(state)).toBeUndefined();
  });

  it('ends on the clock in 1530, which is what the date is for', () => {
    const state = newCampaign({ seed: 'clock', player: CROATIA });
    expect(reckon(state)).toBeUndefined();
    state.year = CAMPAIGN_END_YEAR + 1;
    expect(campaignOver(state)).toBe(true);
    const verdict = reckon(state)!;
    expect(verdict.outcome).toBe('the clock');
    expect(verdict.year).toBe(CAMPAIGN_END_YEAR + 1);
  });

  it('reports where the realm stood, not merely that it ended', () => {
    const state = newCampaign({ seed: 'standing', player: CROATIA });
    for (let turn = 0; turn < 20; turn++) endTurn(state);
    state.year = CAMPAIGN_END_YEAR + 1;
    const verdict = reckon(state)!;

    expect(verdict.provinces).toBeGreaterThan(0);
    expect(verdict.rank).toBeGreaterThan(0);
    expect(verdict.rank).toBeLessThanOrEqual(verdict.powers.length);
    expect(verdict.powers[0]!.provinces).toBeGreaterThanOrEqual(verdict.provinces);
    expect(verdict.treasury).toBeGreaterThanOrEqual(0);
    expect(verdict.soldiers).toBeGreaterThan(0);

    // The soldiery it reports is the soldiery it actually has.
    let counted = 0;
    for (const army of state.armies.values()) {
      if (army.faction === CROATIA) counted += strengthOf(army.regiments);
    }
    for (const region of state.regions.values()) {
      if (region.owner === CROATIA) counted += strengthOf(region.garrison);
    }
    expect(verdict.soldiers).toBe(Math.round(counted));
  }, 30_000);

  it('ranks the powers by what they hold and leaves the independents out', () => {
    const state = newCampaign({ seed: 'ranking', player: CROATIA });
    state.year = CAMPAIGN_END_YEAR + 1;
    const verdict = reckon(state)!;
    for (let i = 1; i < verdict.powers.length; i++) {
      expect(verdict.powers[i - 1]!.provinces).toBeGreaterThanOrEqual(
        verdict.powers[i]!.provinces,
      );
    }
    expect(verdict.powers.map((entry) => entry.faction)).not.toContain(INDEPENDENT_ID);
    // Every province on the map is either someone's or nobody's.
    const held = verdict.powers.reduce((sum, entry) => sum + entry.provinces, 0);
    const free = [...state.regions.values()].filter((r) => r.owner === INDEPENDENT_ID).length;
    expect(held + free).toBe(REGIONS.length);
  });

  it('is reached by actually playing to the end date', () => {
    const state = newCampaign({ seed: 'to-the-end', player: CROATIA });
    // Jump most of the way, then play the last years out properly.
    state.year = CAMPAIGN_END_YEAR - 2;
    let verdict = reckon(state);
    let guard = 0;
    while (!verdict && guard < 12) {
      endTurn(state);
      verdict = reckon(state);
      guard += 1;
    }
    expect(verdict, 'the campaign never ended').toBeDefined();
    expect(state.year).toBeGreaterThan(CAMPAIGN_END_YEAR);
    void regionState;
  }, 30_000);
});
