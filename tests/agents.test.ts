/**
 * Agents.
 *
 * The properties that matter are: a man can only be raised where the
 * institution that produces him exists, he goes where an army cannot, every
 * mission is a gamble whose odds the player was shown, and losing him is
 * permanent. Each test below pins one of those down.
 */
import { describe, it, expect } from 'vitest';
import { newCampaign, endTurn } from '../src/core/campaign';
import {
  MAX_AGENTS,
  agentDestinations,
  agentUpkeep,
  agentsAt,
  agentsOf,
  attemptMission,
  canRecruitAgent,
  dismissAgent,
  guard,
  merchantIncome,
  missionsFor,
  moveAgent,
  odds,
  peril,
  recruitAgent,
  recruitableAgents,
  refreshAgents,
  victimAt,
} from '../src/core/campaign/agents';
import type { MissionKind } from '../src/core/campaign/agents';
import { factionFinances } from '../src/core/campaign/economy';
import { campaignFromJson, campaignToJson } from '../src/core/campaign/save';
import { unassignedCharacters } from '../src/core/campaign/actions';
import type { AgentKind } from '../src/core/data/agents';
import { AGENT_TYPES, getAgentType } from '../src/core/data/agents';
import { Rng } from '../src/core/rng';
import { buildingId, factionId, regionId } from '../src/core/types';
import type { CampaignState } from '../src/core/campaign';
import { INDEPENDENT_ID } from '../src/core/data/factions';

const VENICE = factionId('venice');
const VENETO = regionId('venice');

function campaign(): CampaignState {
  return newCampaign({ seed: 'agent-test', player: VENICE });
}

function rng(seed = 'agents'): Rng {
  return new Rng(seed);
}

/** Puts a man of the given kind in the field, whatever the province has. */
function plant(state: CampaignState, kind: AgentKind, where = VENETO) {
  const region = state.regions.get(where)!;
  region.buildings.add(getAgentType(kind).requires);
  state.factions.get(region.owner)!.treasury = 50_000;
  const before = new Set(state.agents.keys());
  const outcome = recruitAgent(state, where, kind, rng(`plant-${kind}-${where}`));
  expect(outcome.ok, outcome.ok ? '' : outcome.reason).toBe(true);
  const id = [...state.agents.keys()].find((key) => !before.has(key))!;
  const agent = state.agents.get(id)!;
  agent.movement = getAgentType(kind).movement;
  return agent;
}

describe('raising an agent', () => {
  it('needs the institution that produces him', () => {
    const state = campaign();
    const region = state.regions.get(VENETO)!;
    state.factions.get(VENICE)!.treasury = 50_000;
    for (const type of AGENT_TYPES) region.buildings.delete(type.requires);
    for (const type of AGENT_TYPES) {
      expect(canRecruitAgent(state, VENETO, type.kind).ok).toBe(false);
    }
    region.buildings.add(buildingId('market'));
    expect(recruitableAgents(state, VENETO)).toContain('merchant');
    expect(canRecruitAgent(state, VENETO, 'merchant').ok).toBe(true);
    expect(canRecruitAgent(state, VENETO, 'spy').ok).toBe(false);
  });

  it('needs the money, and takes it', () => {
    const state = campaign();
    const region = state.regions.get(VENETO)!;
    region.buildings.add(buildingId('market'));
    state.factions.get(VENICE)!.treasury = 10;
    expect(canRecruitAgent(state, VENETO, 'merchant').ok).toBe(false);

    state.factions.get(VENICE)!.treasury = 1000;
    expect(recruitAgent(state, VENETO, 'merchant', rng()).ok).toBe(true);
    expect(state.factions.get(VENICE)!.treasury).toBe(1000 - getAgentType('merchant').cost);
  });

  it('will not raise more than a realm can run', () => {
    const state = campaign();
    const region = state.regions.get(VENETO)!;
    region.buildings.add(buildingId('market'));
    state.factions.get(VENICE)!.treasury = 100_000;
    for (let i = 0; i < MAX_AGENTS; i++) {
      expect(recruitAgent(state, VENETO, 'merchant', rng(`m${i}`)).ok).toBe(true);
    }
    expect(agentsOf(state, VENICE).length).toBe(MAX_AGENTS);
    expect(canRecruitAgent(state, VENETO, 'merchant').ok).toBe(false);
  });

  it('gives a better man where there are schools', () => {
    const plain = campaign();
    const learned = campaign();
    for (const state of [plain, learned]) {
      const region = state.regions.get(VENETO)!;
      region.buildings.add(buildingId('market'));
      for (const id of ['scriptorium', 'university', 'cathedral', 'governors_palace']) {
        region.buildings.delete(buildingId(id));
      }
      state.factions.get(VENICE)!.treasury = 50_000;
    }
    const region = learned.regions.get(VENETO)!;
    for (const id of ['scriptorium', 'university', 'cathedral', 'governors_palace']) {
      region.buildings.add(buildingId(id));
    }
    recruitAgent(plain, VENETO, 'merchant', rng('same'));
    recruitAgent(learned, VENETO, 'merchant', rng('same'));
    const a = [...plain.agents.values()][0]!;
    const b = [...learned.agents.values()][0]!;
    expect(b.skill).toBe(a.skill + 4);
  });

  it('names two men of one service differently', () => {
    const state = campaign();
    state.regions.get(VENETO)!.buildings.add(buildingId('market'));
    state.factions.get(VENICE)!.treasury = 100_000;
    for (let i = 0; i < 6; i++) recruitAgent(state, VENETO, 'merchant', rng('identical'));
    const names = agentsOf(state, VENICE).map((agent) => agent.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('can be sent home again', () => {
    const state = campaign();
    const agent = plant(state, 'merchant');
    expect(dismissAgent(state, agent.id).ok).toBe(true);
    expect(state.agents.has(agent.id)).toBe(false);
  });
});

describe('travel', () => {
  it('crosses any border at all, which is the point of him', () => {
    const state = campaign();
    const agent = plant(state, 'spy');
    const abroad = agentDestinations(state, agent.id).filter(
      (id) => state.regions.get(id)!.owner !== VENICE,
    );
    expect(abroad.length).toBeGreaterThan(0);
    const target = abroad[0]!;
    expect(moveAgent(state, agent.id, target).ok).toBe(true);
    expect(state.agents.get(agent.id)!.location).toBe(target);
  });

  it('will not step somewhere it does not border', () => {
    const state = campaign();
    const agent = plant(state, 'spy');
    expect(moveAgent(state, agent.id, regionId('dublin')).ok).toBe(false);
  });

  it('runs out of travel, and gets it back with the turn', () => {
    const state = campaign();
    const agent = plant(state, 'priest');
    const budget = getAgentType('priest').movement;
    for (let step = 0; step < budget; step++) {
      const next = agentDestinations(state, agent.id)[0];
      expect(next, `nowhere to go on step ${step}`).toBeDefined();
      expect(moveAgent(state, agent.id, next!).ok).toBe(true);
    }
    expect(agent.movement).toBe(0);
    expect(agentDestinations(state, agent.id)).toEqual([]);
    refreshAgents(state);
    expect(agent.movement).toBe(budget);
  });
});

describe('the odds', () => {
  it('are never a certainty and never hopeless', () => {
    for (let skill = 0; skill <= 10; skill++) {
      for (let against = 0; against <= 20; against++) {
        const chance = odds(skill, against);
        expect(chance).toBeGreaterThanOrEqual(0.06);
        expect(chance).toBeLessThanOrEqual(0.93);
      }
    }
  });

  it('rise with skill and fall with the watch on the province', () => {
    expect(odds(8, 3)).toBeGreaterThan(odds(3, 3));
    expect(odds(5, 9)).toBeLessThan(odds(5, 2));
  });

  it('count a counter-spy and a chancery as a watch', () => {
    const state = campaign();
    const region = state.regions.get(VENETO)!;
    region.unrest = 0;
    const quiet = guard(state, region);
    plant(state, 'spy');
    expect(guard(state, region)).toBeGreaterThan(quiet);
  });

  it('count unrest as an opportunity', () => {
    const state = campaign();
    const region = state.regions.get(VENETO)!;
    region.unrest = 0;
    const calm = guard(state, region);
    region.unrest = 80;
    expect(guard(state, region)).toBeLessThan(calm);
  });

  it('put a spy in more danger than a priest', () => {
    const state = campaign();
    const spy = plant(state, 'spy');
    const priest = plant(state, 'priest');
    spy.skill = priest.skill = 5;
    expect(peril(spy, 6)).toBeGreaterThan(peril(priest, 6));
  });
});

describe('missions', () => {
  it('offers nothing at home but counter-espionage and preaching', () => {
    const state = campaign();
    for (const kind of ['spy', 'envoy', 'merchant'] as const) {
      const agent = plant(state, kind);
      const offered = missionsFor(state, agent.id).map((offer) => offer.kind);
      expect(offered.every((mission) => mission === 'unmask')).toBe(true);
    }
    const priest = plant(state, 'priest');
    expect(missionsFor(state, priest.id).map((o) => o.kind)).toEqual(['preach']);
  });

  it('offers a spy abroad the three things a spy does', () => {
    const state = campaign();
    const agent = plant(state, 'spy');
    const abroad = agentDestinations(state, agent.id).find(
      (id) => state.regions.get(id)!.owner !== VENICE,
    )!;
    moveAgent(state, agent.id, abroad);
    const offered = missionsFor(state, agent.id).map((offer) => offer.kind).sort();
    expect(offered).toEqual(['assassinate', 'incite', 'sabotage']);
  });

  it('offers nothing to a man who has already acted', () => {
    const state = campaign();
    const agent = plant(state, 'priest');
    agent.movement = 0;
    expect(missionsFor(state, agent.id)).toEqual([]);
  });

  it('uses a man up for the season, whether or not it worked', () => {
    const state = campaign();
    const agent = plant(state, 'priest');
    attemptMission(state, agent.id, 'preach', rng());
    expect(agent.movement).toBe(0);
    expect(agent.missions).toBe(1);
  });
});

/** Tries a mission until it works, restoring the man between attempts. */
function until(
  state: CampaignState,
  id: Parameters<typeof attemptMission>[1],
  kind: MissionKind,
  limit = 60,
): boolean {
  for (let attempt = 0; attempt < limit; attempt++) {
    const agent = state.agents.get(id);
    if (!agent) return false;
    agent.movement = getAgentType(agent.kind).movement;
    const report = attemptMission(state, id, kind, rng(`try-${attempt}`));
    if (report.ok) return true;
  }
  return false;
}

describe('what agents do', () => {
  it('a priest turns a province to his faith in the end', () => {
    const state = campaign();
    const agent = plant(state, 'priest');
    const target = agentDestinations(state, agent.id).find((id) => {
      const region = state.regions.get(id)!;
      return region.religion !== 'catholic';
    });
    // Venice's neighbours are all Catholic in 1080, so make one otherwise.
    const where = target ?? agentDestinations(state, agent.id)[0]!;
    const region = state.regions.get(where)!;
    region.religion = 'orthodox';
    region.conversion = 0;
    moveAgent(state, agent.id, where);
    agent.skill = 10;

    const faith = () => region.religion as string;
    for (let season = 0; season < 40 && faith() !== 'catholic'; season++) {
      agent.movement = getAgentType('priest').movement;
      attemptMission(state, agent.id, 'preach', rng(`preach-${season}`));
      if (!state.agents.has(agent.id)) break;
    }
    expect(region.religion).toBe('catholic');
  });

  it('a spy burns what is being built', () => {
    const state = campaign();
    const agent = plant(state, 'spy');
    const where = agentDestinations(state, agent.id).find(
      (id) => state.regions.get(id)!.owner !== VENICE,
    )!;
    moveAgent(state, agent.id, where);
    agent.skill = 10;
    const region = state.regions.get(where)!;
    region.construction = { building: buildingId('market'), turnsLeft: 3 };
    expect(until(state, agent.id, 'sabotage')).toBe(true);
    expect(region.construction).toBeUndefined();
  });

  it('a spy leaves a province harder to hold', () => {
    const state = campaign();
    const agent = plant(state, 'spy');
    const where = agentDestinations(state, agent.id).find(
      (id) => state.regions.get(id)!.owner !== VENICE,
    )!;
    moveAgent(state, agent.id, where);
    agent.skill = 10;
    const region = state.regions.get(where)!;
    region.unrest = 0;
    expect(until(state, agent.id, 'incite')).toBe(true);
    expect(region.unrest).toBeGreaterThan(0);
  });

  it('a spy kills the man commanding an army', () => {
    const state = campaign();
    const agent = plant(state, 'spy');
    const where = agentDestinations(state, agent.id).find(
      (id) => state.regions.get(id)!.owner !== VENICE,
    )!;
    const region = state.regions.get(where)!;
    const victimFaction = state.factions.get(region.owner)!;
    const army = [...state.armies.values()].find((a) => a.faction === region.owner);
    expect(army, 'the neighbour has no army to command').toBeDefined();
    army!.location = where;
    army!.general = victimFaction.characters[0];
    const name = army!.general!.name;
    expect(victimAt(state, region)?.commanding).toBe(true);

    moveAgent(state, agent.id, where);
    agent.skill = 10;
    expect(until(state, agent.id, 'assassinate')).toBe(true);
    expect(army!.general).toBeUndefined();
    expect(victimFaction.characters.some((c) => c.name === name)).toBe(false);
  });

  it('a counter-spy takes a stranger at home', () => {
    const state = campaign();
    const ours = plant(state, 'spy');
    // Somebody else's man, standing in our province.
    const theirs = plant(state, 'merchant');
    const foreign = factionId('genoa');
    state.agents.set(theirs.id, { ...theirs, faction: foreign });
    expect(agentsAt(state, VENETO).length).toBe(2);

    ours.skill = 10;
    expect(until(state, ours.id, 'unmask')).toBe(true);
    expect(state.agents.has(theirs.id)).toBe(false);
  });

  it('an envoy makes a court better disposed', () => {
    const state = campaign();
    const agent = plant(state, 'envoy');
    const where = agentDestinations(state, agent.id).find(
      (id) => state.regions.get(id)!.owner !== VENICE && state.regions.get(id)!.owner !== INDEPENDENT_ID,
    )!;
    moveAgent(state, agent.id, where);
    agent.skill = 10;
    const owner = state.regions.get(where)!.owner;
    const before = state.factions.get(owner)!.relations.get(VENICE)?.attitude ?? 0;
    expect(until(state, agent.id, 'treat')).toBe(true);
    const after = state.factions.get(owner)!.relations.get(VENICE)!.attitude;
    expect(after).toBeGreaterThan(before);
  });

  it('a merchant buys out a rival on the same ground', () => {
    const state = campaign();
    const ours = plant(state, 'merchant');
    const theirs = plant(state, 'merchant');
    state.agents.set(theirs.id, { ...theirs, faction: factionId('genoa') });
    const where = agentDestinations(state, ours.id).find(
      (id) => state.regions.get(id)!.owner !== VENICE,
    )!;
    moveAgent(state, ours.id, where);
    state.agents.get(theirs.id)!.location = where;
    ours.skill = 10;
    state.factions.get(VENICE)!.treasury = 50_000;
    expect(until(state, ours.id, 'buy_out')).toBe(true);
    expect(state.agents.has(theirs.id)).toBe(false);
  });
});

describe('being caught', () => {
  it('loses the man for good and sours the court', () => {
    const state = campaign();
    const agent = plant(state, 'spy');
    const where = agentDestinations(state, agent.id).find(
      (id) => state.regions.get(id)!.owner !== VENICE && state.regions.get(id)!.owner !== INDEPENDENT_ID,
    )!;
    moveAgent(state, agent.id, where);
    const owner = state.regions.get(where)!.owner;
    // A hopeless man against a watched province.
    agent.skill = 0;
    state.regions.get(where)!.unrest = 0;
    const before = state.factions.get(owner)!.relations.get(VENICE)?.attitude ?? 0;

    let lost = false;
    for (let attempt = 0; attempt < 80 && !lost; attempt++) {
      agent.movement = 4;
      lost = attemptMission(state, agent.id, 'incite', rng(`caught-${attempt}`)).lost;
    }
    expect(lost).toBe(true);
    expect(state.agents.has(agent.id)).toBe(false);
    expect(state.factions.get(owner)!.relations.get(VENICE)!.attitude).toBeLessThan(before);
  });
});

describe('what they cost and earn', () => {
  it('charges upkeep for every man in the field', () => {
    const state = campaign();
    expect(agentUpkeep(state, VENICE)).toBe(0);
    plant(state, 'spy');
    plant(state, 'priest');
    expect(agentUpkeep(state, VENICE)).toBe(
      getAgentType('spy').upkeep + getAgentType('priest').upkeep,
    );
  });

  it('pays a factor more abroad than at home', () => {
    const state = campaign();
    const agent = plant(state, 'merchant');
    agent.skill = 6;
    const athome = merchantIncome(state, agent);
    const where = agentDestinations(state, agent.id).find((id) => {
      const region = state.regions.get(id)!;
      return region.owner !== VENICE;
    })!;
    // Compare like with like: the same ground, ours and then somebody else's.
    const region = state.regions.get(where)!;
    const owner = region.owner;
    moveAgent(state, agent.id, where);
    const abroad = merchantIncome(state, agent);
    region.owner = VENICE;
    const mine = merchantIncome(state, agent);
    region.owner = owner;
    expect(abroad).toBeGreaterThan(mine);
    void athome;
  });

  it('shows up in the accounts as one net figure', () => {
    const state = campaign();
    const before = factionFinances(state, VENICE).agents;
    expect(before).toBe(0);
    plant(state, 'spy');
    const after = factionFinances(state, VENICE);
    expect(after.agents).toBe(getAgentType('spy').upkeep);
    // And the net is the components, so the breakdown adds up.
    expect(after.net).toBe(
      after.provinceNet -
        after.armyUpkeep -
        after.garrisonUpkeep -
        after.administration -
        after.hoarding -
        after.agents +
        after.stipend,
    );
  });
});

describe('across a save', () => {
  it('keeps every man exactly where he was', () => {
    const state = campaign();
    const spy = plant(state, 'spy');
    const priest = plant(state, 'priest');
    priest.skill = 9;
    priest.missions = 4;
    const where = agentDestinations(state, spy.id)[0]!;
    moveAgent(state, spy.id, where);

    const restored = campaignFromJson(campaignToJson(state));
    expect(restored.agents.size).toBe(state.agents.size);
    for (const [id, agent] of state.agents) {
      const copy = restored.agents.get(id)!;
      expect(copy).toEqual(agent);
    }
    expect(restored.nextAgentSerial).toBe(state.nextAgentSerial);
  });
});

describe('the court that agents kill people from', () => {
  it('posts the realm\'s men instead of leaving them idle', () => {
    const state = newCampaign({ seed: 'court', player: VENICE });
    for (let turn = 0; turn < 40; turn++) endTurn(state);
    const generals = [...state.armies.values()].filter((army) => army.general).length;
    const governors = [...state.regions.values()].filter((region) => region.governor).length;
    expect(generals).toBeGreaterThan(3);
    expect(governors).toBeGreaterThan(3);
  }, 120_000);

  it('never gives one man two posts', () => {
    const state = newCampaign({ seed: 'court', player: VENICE });
    for (let turn = 0; turn < 40; turn++) endTurn(state);
    const posts = new Map<string, number>();
    for (const region of state.regions.values()) {
      if (region.governor) posts.set(region.governor.id as string, (posts.get(region.governor.id as string) ?? 0) + 1);
    }
    for (const army of state.armies.values()) {
      if (army.general) posts.set(army.general.id as string, (posts.get(army.general.id as string) ?? 0) + 1);
    }
    for (const [who, count] of posts) expect(count, `${who} holds ${count} posts`).toBe(1);
    // And nobody posted is counted as idle.
    for (const [id, faction] of state.factions) {
      if (id === INDEPENDENT_ID || !faction.alive) continue;
      for (const free of unassignedCharacters(state, id)) {
        expect(posts.has(free.id as string)).toBe(false);
      }
    }
  }, 120_000);
});

describe('agents in a running campaign', () => {
  it('are raised by realms other than the player, and go abroad', () => {
    const state = newCampaign({ seed: 'agents-live', player: VENICE });
    for (let turn = 0; turn < 60; turn++) endTurn(state);
    const realms = new Set([...state.agents.values()].map((agent) => agent.faction));
    expect(state.agents.size).toBeGreaterThan(10);
    expect(realms.size).toBeGreaterThan(5);
    const abroad = [...state.agents.values()].filter(
      (agent) => state.regions.get(agent.location)?.owner !== agent.faction,
    );
    expect(abroad.length).toBeGreaterThan(0);
  }, 180_000);

  it('never leaves a man standing where no province is', () => {
    const state = newCampaign({ seed: 'agents-live', player: VENICE });
    for (let turn = 0; turn < 60; turn++) endTurn(state);
    for (const agent of state.agents.values()) {
      expect(state.regions.has(agent.location)).toBe(true);
      expect(state.factions.get(agent.faction)?.alive).toBe(true);
      expect(agent.skill).toBeGreaterThanOrEqual(0);
      expect(agent.skill).toBeLessThanOrEqual(10);
    }
  }, 180_000);
});
