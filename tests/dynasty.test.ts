/**
 * Houses, marriages and succession.
 *
 * The properties that matter: a realm always has exactly one ruler, the crown
 * follows descent when descent allows it, a succession that leaves the direct
 * line costs the realm something measurable, and a marriage moves a real
 * person from one court to another.
 */
import { describe, it, expect } from 'vitest';
import { newCampaign, endTurn } from '../src/core/campaign';
import {
  COMES_OF_AGE,
  attendCourt,
  bearChildren,
  canMarry,
  childrenOf,
  claimOf,
  foundCourt,
  isAdult,
  isMinor,
  leaderOf,
  legitimacyUnrest,
  marriageOdds,
  marriageable,
  marriedTo,
  proposeMarriage,
  settleLegitimacy,
  succeed,
} from '../src/core/campaign/dynasty';
import { publicOrder } from '../src/core/campaign/economy';
import { campaignFromJson, campaignToJson } from '../src/core/campaign/save';
import { unassignedCharacters } from '../src/core/campaign/actions';
import { givenNameOf, newCharacter, factionState } from '../src/core/campaign/state';
import type { CampaignState, Character } from '../src/core/campaign';
import { Rng } from '../src/core/rng';
import { factionId, regionId } from '../src/core/types';
import { INDEPENDENT_ID } from '../src/core/data/factions';

const VENICE = factionId('venice');
const GENOA = factionId('genoa');

function campaign(seed = 'dynasty-test'): CampaignState {
  return newCampaign({ seed, player: VENICE });
}

function rng(seed = 'dyn'): Rng {
  return new Rng(seed);
}

function court(state: CampaignState, id = VENICE) {
  return factionState(state, id);
}

/** Adds an adult child of the ruler, for tests that need an heir to exist. */
function son(state: CampaignState, id = VENICE, age = 24, sex: 'm' | 'f' = 'm'): Character {
  const faction = factionState(state, id);
  const ruler = leaderOf(state, id)!;
  const child = newCharacter(state, id, {
    sex,
    father: ruler.id,
    name: `Heir ${faction.characters.length}`,
    command: 5,
    governance: 5,
    guile: 5,
    age,
  });
  faction.characters.push(child);
  return child;
}

describe('a house at the start', () => {
  it('is a family rather than one man', () => {
    const state = campaign();
    for (const [id, faction] of state.factions) {
      if (id === INDEPENDENT_ID || !faction.alive) continue;
      expect(faction.characters.length, `${id} has a court of one`).toBeGreaterThan(1);
      const leader = faction.characters.filter((character) => character.leader);
      expect(leader.length, `${id} has ${leader.length} rulers`).toBe(1);
      expect(faction.characters.some((character) => character.sex === 'f')).toBe(true);
    }
  });

  it('marries its ruler to someone', () => {
    const state = campaign();
    const ruler = leaderOf(state, VENICE)!;
    expect(ruler.spouse).toBeDefined();
    const consort = court(state).characters.find((c) => c.id === ruler.spouse)!;
    expect(consort.spouse).toBe(ruler.id);
  });

  it('numbers its rulers by its own history, not at random', () => {
    const state = campaign();
    const faction = court(state);
    const ruler = leaderOf(state, VENICE)!;
    expect(ruler.name.endsWith(' I')).toBe(true);
    expect(faction.rulers).toEqual([givenNameOf(ruler)]);
    // A second ruler of the same name is the second of that name.
    faction.rulers = ['Pietro', 'Enrico', 'Pietro'];
    const heir = son(state);
    heir.name = 'Pietro';
    succeed(state, VENICE, rng(), ruler);
    expect(leaderOf(state, VENICE)!.name).toBe('Pietro III');
  });
});

describe('succession', () => {
  it('goes to the eldest adult son', () => {
    const state = campaign();
    const ruler = leaderOf(state, VENICE)!;
    const elder = son(state, VENICE, 30);
    const younger = son(state, VENICE, 20);
    const result = succeed(state, VENICE, rng(), ruler);
    expect(result.by).toBe('son');
    expect(result.heir.id).toBe(elder.id);
    expect(younger.leader).toBe(false);
    expect(court(state).legitimacy).toBe(100);
  });

  it('goes to a daughter before it leaves the line', () => {
    const state = campaign();
    const faction = court(state);
    const ruler = leaderOf(state, VENICE)!;
    // Clear the court down to the ruler, then give him one daughter.
    faction.characters = [ruler];
    const daughter = son(state, VENICE, 25, 'f');
    const result = succeed(state, VENICE, rng(), ruler);
    expect(result.heir.id).toBe(daughter.id);
    expect(result.by).toBe('son');
  });

  it('falls to a brother when there is no child, and costs the realm for it', () => {
    const state = campaign();
    const faction = court(state);
    const ruler = leaderOf(state, VENICE)!;
    const grandfather = newCharacter(state, VENICE, {
      sex: 'm', name: 'Old Pietro', command: 4, governance: 4, guile: 4, age: 80,
    });
    ruler.father = grandfather.id;
    const brother = newCharacter(state, VENICE, {
      sex: 'm', father: grandfather.id, name: 'Brother', command: 4, governance: 4, guile: 4, age: 40,
    });
    faction.characters = [ruler, brother];
    const result = succeed(state, VENICE, rng(), ruler);
    expect(result.by).toBe('brother');
    expect(result.heir.id).toBe(brother.id);
    expect(faction.legitimacy).toBeLessThan(100);
  });

  it('puts a boy on the throne rather than leaving the line', () => {
    const state = campaign();
    const faction = court(state);
    const ruler = leaderOf(state, VENICE)!;
    faction.characters = [ruler];
    const boy = son(state, VENICE, 9);
    const result = succeed(state, VENICE, rng(), ruler);
    expect(result.heir.id).toBe(boy.id);
    expect(isMinor(state, VENICE)).toBe(true);
  });

  it('falls to a magnate when the house has nobody, and costs more', () => {
    const state = campaign();
    const faction = court(state);
    const ruler = leaderOf(state, VENICE)!;
    const magnate = newCharacter(state, VENICE, {
      sex: 'm', name: 'A Magnate', command: 6, governance: 6, guile: 6, age: 40,
    });
    faction.characters = [ruler, magnate];
    const result = succeed(state, VENICE, rng(), ruler);
    expect(result.by).toBe('magnate');
    expect(faction.legitimacy).toBeLessThan(70);
  });

  it('produces somebody even when the house is extinct', () => {
    const state = campaign();
    const faction = court(state);
    const ruler = leaderOf(state, VENICE)!;
    faction.characters = [];
    const result = succeed(state, VENICE, rng(), ruler);
    expect(result.by).toBe('stranger');
    expect(faction.characters).toContain(result.heir);
    expect(result.heir.leader).toBe(true);
  });

  it('never leaves two rulers or none', () => {
    const state = campaign();
    const ruler = leaderOf(state, VENICE)!;
    son(state, VENICE, 30);
    son(state, VENICE, 28);
    succeed(state, VENICE, rng(), ruler);
    const leaders = court(state).characters.filter((character) => character.leader);
    expect(leaders.length).toBe(1);
  });

  it('ranks a son above a brother above a stranger', () => {
    const state = campaign();
    const faction = court(state);
    const ruler = leaderOf(state, VENICE)!;
    const grandfather = newCharacter(state, VENICE, {
      sex: 'm', name: 'Old', command: 4, governance: 4, guile: 4, age: 80,
    });
    ruler.father = grandfather.id;
    const heir = son(state, VENICE, 25);
    const brother = newCharacter(state, VENICE, {
      sex: 'm', father: grandfather.id, name: 'Brother', command: 5, governance: 5, guile: 5, age: 40,
    });
    const stranger = newCharacter(state, VENICE, {
      sex: 'm', name: 'Nobody', command: 5, governance: 5, guile: 5, age: 40,
    });
    faction.characters.push(brother, stranger);
    expect(claimOf(faction, heir, ruler)).toBeGreaterThan(claimOf(faction, brother, ruler));
    expect(claimOf(faction, brother, ruler)).toBeGreaterThan(claimOf(faction, stranger, ruler));
    expect(claimOf(faction, son(state, VENICE, 8), ruler)).toBe(0);
  });
});

describe('legitimacy', () => {
  it('makes every province of the realm harder to hold', () => {
    const state = campaign();
    const province = [...state.regions.values()].find((r) => r.owner === VENICE)!;
    const faction = court(state);
    faction.legitimacy = 100;
    const secure = publicOrder(state, province);
    faction.legitimacy = 40;
    expect(publicOrder(state, province)).toBeLessThan(secure);
    expect(legitimacyUnrest(faction)).toBeGreaterThan(0);
  });

  it('costs a realm with a boy on the throne as well', () => {
    const state = campaign();
    const province = [...state.regions.values()].find((r) => r.owner === VENICE)!;
    const grown = publicOrder(state, province);
    const ruler = leaderOf(state, VENICE)!;
    court(state).characters = [ruler];
    const boy = son(state, VENICE, 8);
    succeed(state, VENICE, rng(), ruler);
    expect(boy.leader).toBe(true);
    expect(publicOrder(state, province)).toBeLessThan(grown);
  });

  it('settles over time, because reigning is what made a king legitimate', () => {
    const state = campaign();
    const faction = court(state);
    faction.legitimacy = 40;
    state.season = 'summer';
    for (let year = 0; year < 40; year++) settleLegitimacy(state);
    expect(faction.legitimacy).toBe(100);
  });

  it('does not settle while the ruler is still a child', () => {
    const state = campaign();
    const faction = court(state);
    const ruler = leaderOf(state, VENICE)!;
    faction.characters = [ruler];
    son(state, VENICE, 8);
    succeed(state, VENICE, rng(), ruler);
    state.season = 'summer';
    for (let year = 0; year < 40; year++) settleLegitimacy(state);
    expect(faction.legitimacy).toBeLessThan(100);
  });
});

describe('marriage', () => {
  it('needs two houses, peace, and somebody of an age', () => {
    const state = campaign();
    expect(canMarry(state, VENICE, VENICE).ok).toBe(false);
    expect(canMarry(state, VENICE, INDEPENDENT_ID).ok).toBe(false);
    const allowed = canMarry(state, VENICE, GENOA);
    if (!allowed.ok) expect(allowed.reason).toBeTruthy();

    // Give both houses somebody unmarried of each sex, and it is possible.
    son(state, VENICE, 22, 'm');
    son(state, GENOA, 21, 'f');
    expect(canMarry(state, VENICE, GENOA).ok).toBe(true);
  });

  it('moves the bride to her husband\'s court and binds the two realms', () => {
    const state = campaign();
    son(state, VENICE, 22, 'm');
    son(state, VENICE, 23, 'f');
    son(state, GENOA, 21, 'f');
    son(state, GENOA, 24, 'm');
    const before = state.factions.get(GENOA)!.relations.get(VENICE)?.attitude ?? 0;

    // A willing court. Even a willing one refuses now and then, so the offer
    // is made until it is taken, as it would be.
    state.factions.get(GENOA)!.relations.set(VENICE, { stance: 'alliance', attitude: 90, since: 0 });
    state.factions.get(VENICE)!.relations.set(GENOA, { stance: 'alliance', attitude: 90, since: 0 });
    let agreed = false;
    for (let attempt = 0; attempt < 20 && !agreed; attempt++) {
      agreed = proposeMarriage(state, VENICE, GENOA, rng(`yes-${attempt}`)).ok;
    }
    expect(agreed).toBe(true);
    expect(marriedTo(state, VENICE, GENOA)).toBe(true);

    // Whichever way round it went, the bride is now in her husband's court,
    // she still belongs to the house she came from, and the two of them point
    // at each other.
    const everyone = [...court(state, VENICE).characters, ...court(state, GENOA).characters];
    const brides = everyone.filter(
      (character) =>
        character.bornIn !== undefined && character.bornIn !== character.faction,
    );
    expect(brides.length).toBe(1);
    const bride = brides[0]!;
    const home = court(state, bride.faction).characters;
    const husband = home.find((character) => character.id === bride.spouse);
    expect(husband, 'the bride is not in her husband\'s court').toBeDefined();
    expect(husband!.spouse).toBe(bride.id);
    expect(husband!.faction).toBe(bride.faction);

    expect(state.factions.get(GENOA)!.relations.get(VENICE)!.attitude).toBeGreaterThan(before);
  });

  it('can be refused, and being refused costs a little', () => {
    const state = campaign();
    son(state, VENICE, 22, 'm');
    son(state, GENOA, 21, 'f');
    state.factions.get(GENOA)!.relations.set(VENICE, { stance: 'neutral', attitude: -90, since: 0 });
    const before = state.factions.get(VENICE)!.relations.get(GENOA)?.attitude ?? 0;
    const outcome = proposeMarriage(state, VENICE, GENOA, rng('no'));
    expect(outcome.ok).toBe(false);
    expect(state.factions.get(VENICE)!.relations.get(GENOA)!.attitude).toBeLessThan(before);
  });

  it('is likelier with a friendly court than a hostile one', () => {
    const state = campaign();
    state.factions.get(GENOA)!.relations.set(VENICE, { stance: 'alliance', attitude: 80, since: 0 });
    const friendly = marriageOdds(state, VENICE, GENOA);
    state.factions.get(GENOA)!.relations.set(VENICE, { stance: 'neutral', attitude: -80, since: 0 });
    expect(marriageOdds(state, VENICE, GENOA)).toBeLessThan(friendly);
  });

  it('offers nobody who is a child or already married', () => {
    const state = campaign();
    const faction = court(state);
    const ruler = leaderOf(state, VENICE)!;
    faction.characters = [ruler];
    son(state, VENICE, 8);
    expect(marriageable(faction).length).toBe(0);
    const grown = son(state, VENICE, 22);
    expect(marriageable(faction).map((c) => c.id)).toEqual([grown.id]);
  });
});

describe('children', () => {
  it('are born to a married couple and come of age', () => {
    const state = campaign();
    const faction = court(state);
    const ruler = leaderOf(state, VENICE)!;
    const consort = faction.characters.find((c) => c.id === ruler.spouse)!;
    consort.age = 22;
    const before = childrenOf(faction, ruler.id).length;
    state.season = 'summer';
    for (let year = 0; year < 30; year++) bearChildren(state, rng(`born-${year}`));
    const after = childrenOf(faction, ruler.id).length;
    expect(after).toBeGreaterThan(before);
    const child = childrenOf(faction, ruler.id)[after - 1]!;
    expect(isAdult(child)).toBe(false);
    child.age = COMES_OF_AGE;
    expect(isAdult(child)).toBe(true);
  });

  it('hold no post until they are grown', () => {
    const state = campaign();
    const faction = court(state);
    const ruler = leaderOf(state, VENICE)!;
    faction.characters = [ruler];
    const boy = son(state, VENICE, 7);
    expect(unassignedCharacters(state, VENICE).some((c) => c.id === boy.id)).toBe(false);
    boy.age = 20;
    expect(unassignedCharacters(state, VENICE).some((c) => c.id === boy.id)).toBe(true);
  });

  it('bring a kinsman to court only when the house needs one', () => {
    const state = campaign();
    const faction = court(state);
    const ruler = leaderOf(state, VENICE)!;
    son(state, VENICE, 20);
    son(state, VENICE, 22);
    const full = faction.characters.length;
    state.season = 'summer';
    for (let year = 0; year < 20; year++) attendCourt(state, rng(`court-${year}`));
    expect(faction.characters.length).toBe(full);

    faction.characters = [ruler];
    for (let year = 0; year < 20; year++) attendCourt(state, rng(`thin-${year}`));
    expect(faction.characters.length).toBeGreaterThan(1);
  });
});

describe('a house over a campaign', () => {
  it('always has exactly one living ruler in every living realm', () => {
    const state = newCampaign({ seed: 'dynasty-live', player: VENICE });
    for (let turn = 0; turn < 80; turn++) {
      endTurn(state);
      for (const [id, faction] of state.factions) {
        if (id === INDEPENDENT_ID || !faction.alive) continue;
        const leaders = faction.characters.filter((character) => character.leader);
        expect(leaders.length, `${id} has ${leaders.length} rulers on turn ${turn}`).toBe(1);
      }
    }
  }, 180_000);

  it('hands crowns down the line more often than outside it', () => {
    const state = newCampaign({ seed: 'dynasty-line', player: VENICE });
    const tally: Record<string, number> = {};
    for (let turn = 0; turn < 200; turn++) {
      endTurn(state);
      for (const entry of state.log.slice(-40)) {
        if (entry.turn !== state.turn && entry.turn !== state.turn - 1) continue;
        if (/succeeds his father|succeeds his brother/.test(entry.text)) {
          tally.blood = (tally.blood ?? 0) + 1;
        } else if (/own standing|house being extinct/.test(entry.text)) {
          tally.outside = (tally.outside ?? 0) + 1;
        }
      }
    }
    expect(tally.blood ?? 0).toBeGreaterThan(0);
    expect(tally.blood ?? 0).toBeGreaterThan(tally.outside ?? 0);
  }, 300_000);

  it('marries its houses to each other without being told to', () => {
    const state = newCampaign({ seed: 'dynasty-live', player: VENICE });
    for (let turn = 0; turn < 60; turn++) endTurn(state);
    let bonds = 0;
    for (const [id, faction] of state.factions) {
      if (id === INDEPENDENT_ID || !faction.alive) continue;
      for (const character of faction.characters) {
        if (character.spouse && character.bornIn && character.bornIn !== id) bonds += 1;
      }
    }
    expect(bonds).toBeGreaterThan(0);
  }, 180_000);

  it('keeps every spouse pointing at a real person', () => {
    const state = newCampaign({ seed: 'dynasty-live', player: VENICE });
    for (let turn = 0; turn < 80; turn++) endTurn(state);
    const everyone = new Map<string, Character>();
    for (const faction of state.factions.values()) {
      for (const character of faction.characters) everyone.set(character.id as string, character);
    }
    for (const character of everyone.values()) {
      if (!character.spouse) continue;
      const spouse = everyone.get(character.spouse as string);
      // A widow keeps her late husband's name on her record; what must never
      // happen is a spouse who points at somebody married to a third person.
      if (spouse?.spouse) expect(spouse.spouse).toBe(character.id);
      if (character.father) {
        expect(character.father).not.toBe(character.id);
      }
    }
  }, 180_000);
});

describe('across a save', () => {
  it('keeps descent, marriages, legitimacy and the line of rulers', () => {
    const state = campaign();
    const ruler = leaderOf(state, VENICE)!;
    son(state, VENICE, 20);
    court(state).legitimacy = 61;
    court(state).rulers = ['Pietro', 'Enrico'];

    const restored = campaignFromJson(campaignToJson(state));
    const faction = factionState(restored, VENICE);
    expect(faction.legitimacy).toBe(61);
    expect(faction.rulers).toEqual(['Pietro', 'Enrico']);
    const copy = faction.characters.find((c) => c.id === ruler.id)!;
    expect(copy.sex).toBe(ruler.sex);
    expect(copy.spouse).toBe(ruler.spouse);
    const heir = faction.characters.find((c) => c.father === ruler.id)!;
    expect(heir).toBeDefined();
    expect(childrenOf(faction, ruler.id).length).toBe(childrenOf(court(state), ruler.id).length);
  });
});

void foundCourt;
void regionId;
