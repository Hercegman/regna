/**
 * The opening guide.
 *
 * A step is complete because the thing happened, not because a button was
 * pressed, so every one of them is a pure function of the campaign and of
 * what the interface has recorded. These tests pin down that each step is
 * answered by the right evidence — a guide that ticks itself off before the
 * player has done anything teaches nothing.
 */
import { describe, it, expect } from 'vitest';
import { newCampaign, endTurn } from '../src/core/campaign';
import { GUIDE_STEPS, guideProgress } from '../src/ui/tutorial';
import type { GuideContext } from '../src/ui/tutorial';
import {
  availableBuildings,
  recruitableUnits,
  startConstruction,
  startRecruitment,
} from '../src/core/campaign/actions';
import { recruitAgent } from '../src/core/campaign/agents';
import { dispatchCaravan } from '../src/core/campaign/caravans';
import { routesThrough } from '../src/core/data/trade';
import { Rng } from '../src/core/rng';
import { buildingId, factionId, unitTypeId } from '../src/core/types';
import type { CampaignState } from '../src/core/campaign';

const CROATIA = factionId('croatia');

function campaign(): CampaignState {
  return newCampaign({ seed: 'guide-test', player: CROATIA });
}

function ctx(state: CampaignState, seen: readonly string[] = []): GuideContext {
  return { state, me: CROATIA, seen: new Set(seen) };
}

function step(id: string) {
  const found = GUIDE_STEPS.find((candidate) => candidate.id === id);
  expect(found, `no step called ${id}`).toBeDefined();
  return found!;
}

describe('the guide', () => {
  it('has a title, a reason and a place for every step', () => {
    expect(GUIDE_STEPS.length).toBeGreaterThan(4);
    const ids = new Set<string>();
    for (const entry of GUIDE_STEPS) {
      expect(entry.title.length).toBeGreaterThan(3);
      expect(entry.why.length).toBeGreaterThan(20);
      expect(entry.where.length).toBeGreaterThan(5);
      expect(ids.has(entry.id), `${entry.id} appears twice`).toBe(false);
      ids.add(entry.id);
    }
  });

  it('starts with nothing done on a fresh campaign', () => {
    const state = campaign();
    const progress = guideProgress(ctx(state));
    expect(progress.done).toBe(0);
    expect(progress.next?.id).toBe(GUIDE_STEPS[0]!.id);
    expect(progress.total).toBe(GUIDE_STEPS.length);
  });

  it('does not tick off looking at a province until one is looked at', () => {
    const state = campaign();
    expect(step('select').done(ctx(state))).toBe(false);
    expect(step('select').done(ctx(state, ['province']))).toBe(true);
  });

  it('notices a building actually started', () => {
    const state = campaign();
    expect(step('build').done(ctx(state))).toBe(false);
    const province = [...state.regions.values()].find((r) => r.owner === CROATIA)!;
    province.construction = { building: buildingId('market'), turnsLeft: 2 };
    expect(step('build').done(ctx(state))).toBe(true);
  });

  it('notices a regiment actually ordered', () => {
    const state = campaign();
    expect(step('recruit').done(ctx(state))).toBe(false);
    const province = [...state.regions.values()].find((r) => r.owner === CROATIA)!;
    province.recruitQueue.push({ unit: unitTypeId('town_militia'), turnsLeft: 2 });
    expect(step('recruit').done(ctx(state))).toBe(true);
  });

  it('notices a turn actually ended', () => {
    const state = campaign();
    expect(step('turn').done(ctx(state))).toBe(false);
    endTurn(state);
    expect(step('turn').done(ctx(state))).toBe(true);
  });

  it('notices a march, which only the interface can see', () => {
    const state = campaign();
    expect(step('march').done(ctx(state))).toBe(false);
    expect(step('march').done(ctx(state, ['march']))).toBe(true);
  });

  it('notices a caravan on the road, and only ours', () => {
    const state = campaign();
    expect(step('trade').done(ctx(state))).toBe(false);
    const province = [...state.regions.values()].find(
      (r) => r.owner === CROATIA && routesThrough(r.id).length > 0,
    );
    if (province) {
      const route = routesThrough(province.id)[0]!;
      state.factions.get(CROATIA)!.treasury = 50_000;
      dispatchCaravan(state, province.id, route);
      expect(step('trade').done(ctx(state))).toBe(true);
    }
    // Somebody else's caravan is not ours, whatever the roads look like.
    const other = campaign();
    for (const caravan of other.caravans.values()) {
      other.caravans.set(caravan.id, { ...caravan, faction: factionId('venice') });
    }
    expect(step('trade').done(ctx(other))).toBe(false);
  });

  it('notices a man put in the field', () => {
    const state = campaign();
    expect(step('agent').done(ctx(state))).toBe(false);
    const province = [...state.regions.values()].find((r) => r.owner === CROATIA)!;
    province.buildings.add(buildingId('market'));
    state.factions.get(CROATIA)!.treasury = 50_000;
    expect(recruitAgent(state, province.id, 'merchant', new Rng('guide')).ok).toBe(true);
    expect(step('agent').done(ctx(state))).toBe(true);
  });

  it('does not tick off reading the realm until the panel is opened', () => {
    const state = campaign();
    for (let turn = 0; turn < 12; turn++) endTurn(state);
    expect(step('realm').done(ctx(state))).toBe(false);
    expect(step('realm').done(ctx(state, ['tab:realm']))).toBe(true);
  }, 60_000);

  it('counts progress and finishes', () => {
    const state = campaign();
    const everything = GUIDE_STEPS.map((entry) => entry.id);
    const province = [...state.regions.values()].find((r) => r.owner === CROATIA)!;
    province.construction = { building: buildingId('market'), turnsLeft: 2 };
    province.recruitQueue.push({ unit: unitTypeId('town_militia'), turnsLeft: 2 });
    province.buildings.add(buildingId('market'));
    state.factions.get(CROATIA)!.treasury = 50_000;
    recruitAgent(state, province.id, 'merchant', new Rng('guide'));
    endTurn(state);
    const route = routesThrough(province.id)[0];
    if (route) dispatchCaravan(state, province.id, route);

    const seen = ['province', 'march', 'tab:realm'];
    const progress = guideProgress(ctx(state, seen));
    // Everything except, possibly, the caravan if this province has no road.
    expect(progress.done).toBeGreaterThanOrEqual(everything.length - 1);
    if (progress.done === everything.length) expect(progress.next).toBeUndefined();
  }, 60_000);

  it('uses the campaign rather than the interface wherever it can', () => {
    // Only these consult the interface's record, and each for a stated
    // reason: nothing in the state says a panel was opened or an army was
    // ordered to march, and a project or a muster that has finished would
    // otherwise un-tick a step the player has already done.
    const everyKey = ['province', 'march', 'tab:realm', 'build', 'recruit'];
    const state = campaign();
    const consults = GUIDE_STEPS.filter(
      (entry) => entry.done(ctx(state, [])) !== entry.done(ctx(state, everyKey)),
    ).map((entry) => entry.id);
    expect(consults.sort()).toEqual(['build', 'march', 'realm', 'recruit', 'select']);
    // Everything else is answered by the campaign alone.
    const fromState = GUIDE_STEPS.filter((entry) => !consults.includes(entry.id)).map((e) => e.id);
    expect(fromState.sort()).toEqual(['agent', 'trade', 'turn']);
  });
});

describe('a player working through it', () => {
  it('reaches the end by playing rather than by waiting', () => {
    const state = campaign();
    const seen = new Set<string>();
    const progress = () => guideProgress({ state, me: CROATIA, seen });

    expect(progress().done).toBe(0);
    seen.add('province');
    const province = [...state.regions.values()].find((r) => r.owner === CROATIA)!;
    state.factions.get(CROATIA)!.treasury = 50_000;
    const project = availableBuildings(state, province.id)[0]!;
    expect(startConstruction(state, province.id, project).ok).toBe(true);
    const unit = recruitableUnits(state, province.id)[0]!;
    expect(startRecruitment(state, province.id, unit).ok).toBe(true);
    seen.add('build');
    seen.add('recruit');
    endTurn(state);
    seen.add('march');
    province.buildings.add(buildingId('market'));
    recruitAgent(state, province.id, 'merchant', new Rng('play'));
    seen.add('tab:realm');
    // A caravan needs a province with a road through it.
    const onARoad = [...state.regions.values()].find(
      (r) => r.owner === CROATIA && routesThrough(r.id).length > 0,
    );
    if (onARoad) dispatchCaravan(state, onARoad.id, routesThrough(onARoad.id)[0]!);

    const final = progress();
    const missing = GUIDE_STEPS.filter((entry) => !entry.done({ state, me: CROATIA, seen }));
    expect(final.done, `missing: ${missing.map((m) => m.id).join(', ')}`).toBeGreaterThanOrEqual(
      GUIDE_STEPS.length - 1,
    );
  }, 60_000);
});
