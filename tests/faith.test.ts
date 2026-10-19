import { describe, it, expect } from 'vitest';
import { newCampaign } from '../src/core/campaign';
import {
  absolutionPrice,
  adjustStanding,
  authorityFor,
  bestTarget,
  canJoinHolyWar,
  censure,
  censureUnrest,
  considerHolyWar,
  donate,
  driftStanding,
  endTurn,
  factionState,
  faithOf,
  familyOf,
  holyWarHolder,
  holyWarRelief,
  isAuthority,
  isCensured,
  isFairGame,
  isSworn,
  joinHolyWar,
  noteProvinceTaken,
  noteWarDeclared,
  progressHolyWar,
  publicOrder,
  regionState,
  seekAbsolution,
  setStance,
  standingOf,
  transferProvince,
  CENSURE_THRESHOLD,
  CRUSADER_UPKEEP_RELIEF,
  type CampaignState,
} from '../src/core/campaign';
import { SACRED_PLACES, claimsOn, sacredTo, belongsTo } from '../src/core/data/faith';
import { tryGetRegion } from '../src/core/data/regions';
import { tryGetFaction, INDEPENDENT_ID } from '../src/core/data/factions';
import { Rng } from '../src/core/rng';
import { factionId, regionId } from '../src/core/types';

const POPE = factionId('papal_states');
const FRANCE = factionId('france');
const HRE = factionId('hre');
const BYZANTIUM = factionId('byzantium');
const FATIMIDS = factionId('fatimids');
const ABBASIDS = factionId('abbasids');

/** A ruler who could plausibly answer the call now being preached. */
function eligibleJoiner(state: CampaignState): ReturnType<typeof factionId> {
  const war = state.faith.holyWar!;
  const candidate = [...state.factions.keys()].find(
    (id) => faithOf(id) === war.faith && canJoinHolyWar(state, id).ok,
  );
  if (!candidate) throw new Error('nobody can answer the call');
  return candidate;
}

describe('sacred places', () => {
  it('name only real provinces and give a reason', () => {
    expect(SACRED_PLACES.length).toBeGreaterThanOrEqual(25);
    for (const place of SACRED_PLACES) {
      expect(tryGetRegion(place.region), `${place.region}`).toBeDefined();
      expect(place.weight).toBeGreaterThan(0);
      expect(place.weight).toBeLessThanOrEqual(100);
      expect(place.reason.length).toBeGreaterThan(40);
    }
  });

  it('let both faiths claim the same ground, because both did', () => {
    const jerusalem = claimsOn(regionId('jerusalem'));
    expect(jerusalem.map((place) => place.faith).sort()).toEqual(['christian', 'muslim']);
    // And Jerusalem outranks everything for both of them.
    for (const place of jerusalem) expect(place.weight).toBeGreaterThan(90);
  });

  it('respect the year a place became worth marching for', () => {
    const early = sacredTo('christian', 1080).map((place) => place.region as string);
    const later = sacredTo('christian', 1250).map((place) => place.region as string);
    expect(early).not.toContain('jerusalem');
    expect(later).toContain('jerusalem');
    expect(early).toContain('toledo');
  });

  it('knows which religions belong to which communion', () => {
    expect(belongsTo('catholic', 'christian')).toBe(true);
    expect(belongsTo('orthodox', 'christian')).toBe(true);
    expect(belongsTo('miaphysite', 'christian')).toBe(true);
    expect(belongsTo('sunni', 'muslim')).toBe(true);
    expect(belongsTo('shia', 'muslim')).toBe(true);
    expect(belongsTo('pagan', 'christian')).toBe(false);
  });
});

describe('who answers to whom', () => {
  it('puts Latin rulers under Rome and leaves the Orthodox out of it', () => {
    // The schism of 1054 is the point: no pope could excommunicate a Greek
    // emperor in any sense that mattered to the Greek emperor.
    expect(faithOf(FRANCE)).toBe('christian');
    expect(faithOf(BYZANTIUM)).toBeUndefined();
    expect(faithOf(factionId('armenia'))).toBeUndefined();
    expect(faithOf(FATIMIDS)).toBe('muslim');
    expect(faithOf(ABBASIDS)).toBe('muslim');
    expect(faithOf(factionId('cumans'))).toBeUndefined();
  });

  it('still counts the Orthodox as Christendom', () => {
    expect(familyOf(BYZANTIUM)).toBe('christian');
    expect(familyOf(factionId('armenia'))).toBe('christian');
    expect(familyOf(factionId('lithuania'))).toBe('other');
  });

  it('names the pope and the caliph, and passes authority on if they fall', () => {
    const state = newCampaign({ seed: 'authority' });
    expect(authorityFor(state, 'christian')).toBe(POPE);
    expect(authorityFor(state, 'muslim')).toBe(ABBASIDS);
    expect(isAuthority(state, POPE)).toBe(true);
    expect(isAuthority(state, FRANCE)).toBe(false);

    // Rome falls: the senior crowned defender of the faith speaks instead.
    for (const region of state.regions.values()) {
      if (region.owner === POPE) region.owner = FATIMIDS;
    }
    expect(authorityFor(state, 'christian')).not.toBe(POPE);
  });
});

describe('standing and censure', () => {
  function campaign(seed: string): CampaignState {
    return newCampaign({ seed });
  }

  it('falls for making war on ones own communion and rises for the other', () => {
    const state = campaign('standing');
    noteWarDeclared(state, FRANCE, HRE);
    expect(standingOf(state, FRANCE)).toBeLessThan(0);

    const before = standingOf(state, HRE);
    noteWarDeclared(state, HRE, FATIMIDS);
    expect(standingOf(state, HRE)).toBeGreaterThan(before);
  });

  it('costs less to fight a Christian who answers to another church', () => {
    const state = campaign('schism');
    noteWarDeclared(state, FRANCE, HRE);
    const onCatholic = standingOf(state, FRANCE);
    const other = campaign('schism');
    noteWarDeclared(other, FRANCE, BYZANTIUM);
    const onGreek = standingOf(other, FRANCE);
    expect(onGreek).toBeGreaterThan(onCatholic);
    expect(onGreek).toBeLessThan(0);
  });

  it('rewards taking a place the faith claims', () => {
    const state = campaign('claimed');
    const before = standingOf(state, FRANCE);
    noteProvinceTaken(state, regionId('jerusalem'), FRANCE, FATIMIDS);
    const claimed = standingOf(state, FRANCE) - before;
    const plain = (() => {
      const other = campaign('claimed');
      noteProvinceTaken(other, regionId('damietta'), FRANCE, FATIMIDS);
      return standingOf(other, FRANCE);
    })();
    expect(claimed).toBeGreaterThan(plain);
  });

  it('censures a ruler who turns on the authority itself, at once', () => {
    const state = campaign('on-rome');
    expect(isCensured(state, FRANCE)).toBe(false);
    noteWarDeclared(state, FRANCE, POPE);
    expect(isCensured(state, FRANCE)).toBe(true);
    expect(standingOf(state, FRANCE)).toBeLessThan(CENSURE_THRESHOLD);
  });

  it('never censures a ruler who answers to nobody', () => {
    const state = campaign('greek');
    adjustStanding(state, BYZANTIUM, -100);
    censure(state, BYZANTIUM);
    expect(isCensured(state, BYZANTIUM)).toBe(false);
    expect(standingOf(state, BYZANTIUM)).toBe(0);
  });

  it('dissolves the alliances of a censured ruler', () => {
    const state = campaign('oaths');
    setStance(state, FRANCE, HRE, 'alliance');
    expect(factionState(state, FRANCE).relations.get(HRE)!.stance).toBe('alliance');
    censure(state, FRANCE);
    expect(factionState(state, FRANCE).relations.get(HRE)!.stance).toBe('neutral');
    expect(factionState(state, HRE).relations.get(FRANCE)!.stance).toBe('neutral');
  });

  it('makes a censured ruler fair game to his own communion and nobody else', () => {
    const state = campaign('fair-game');
    censure(state, FRANCE);
    expect(isFairGame(state, FRANCE, HRE)).toBe(true);
    expect(isFairGame(state, FRANCE, FATIMIDS)).toBe(false);
    expect(isFairGame(state, HRE, FRANCE)).toBe(false);
  });

  it('costs order at home, and more where the people share the faith', () => {
    const state = campaign('unrest');
    const paris = regionId('paris');
    const calm = publicOrder(state, regionState(state, paris));
    censure(state, FRANCE);
    expect(censureUnrest(state, paris)).toBeGreaterThan(0);
    expect(publicOrder(state, regionState(state, paris))).toBeLessThan(calm);
  });

  it('is bought off, which is how most of them ended', () => {
    const state = campaign('absolution');
    censure(state, FRANCE);
    const price = absolutionPrice(state, FRANCE);
    expect(price).toBeGreaterThan(0);

    factionState(state, FRANCE).treasury = price - 1;
    expect(seekAbsolution(state, FRANCE).ok).toBe(false);

    factionState(state, FRANCE).treasury = price + 500;
    const papal = factionState(state, POPE).treasury;
    expect(seekAbsolution(state, FRANCE).ok).toBe(true);
    expect(isCensured(state, FRANCE)).toBe(false);
    expect(factionState(state, POPE).treasury).toBe(papal + price);
  });

  it('cannot be bought while at war with the one who would grant it', () => {
    const state = campaign('at-war');
    setStance(state, FRANCE, POPE, 'war');
    censure(state, FRANCE);
    factionState(state, FRANCE).treasury = 500_000;
    expect(seekAbsolution(state, FRANCE).ok).toBe(false);
  });

  it('is lifted in time by a ruler who mends his ways', () => {
    const state = campaign('mended');
    adjustStanding(state, FRANCE, -60);
    censure(state, FRANCE);
    adjustStanding(state, FRANCE, 50);
    driftStanding(state);
    expect(isCensured(state, FRANCE)).toBe(false);
  });

  it('accepts a gift without being purchasable outright', () => {
    const state = campaign('gift');
    factionState(state, FRANCE).treasury = 100_000;
    const before = standingOf(state, FRANCE);
    expect(donate(state, FRANCE, 10_000).ok).toBe(true);
    const gained = standingOf(state, FRANCE) - before;
    expect(gained).toBeGreaterThan(0);
    expect(gained).toBeLessThanOrEqual(12);
    expect(donate(state, POPE, 1000).ok).toBe(false);
  });
});

describe('a holy war', () => {
  it('is preached for a place the faith claims and somebody else holds', () => {
    const state = newCampaign({ seed: 'preach' });
    state.year = 1100;
    const target = bestTarget(state, 'christian')!;
    expect(target).toBeDefined();
    expect(claimsOn(target.place.region).some((p) => p.faith === 'christian')).toBe(true);
    expect(familyOf(target.holder)).not.toBe('christian');
  });

  it('is not preached against its own communion', () => {
    const state = newCampaign({ seed: 'no-friendly-fire' });
    // Byzantium is Orthodox and answers to no pope, but it is still Christendom.
    expect(regionState(state, regionId('constantinople')).owner).toBe(BYZANTIUM);
    for (let year = 1080; year <= 1400; year += 40) {
      state.year = year;
      const target = bestTarget(state, 'christian');
      if (target) expect(target.place.region).not.toBe(regionId('constantinople'));
    }
  });

  it('is called, joined, and relieves the upkeep of those who swore', () => {
    const state = newCampaign({ seed: 'call' });
    state.year = 1100;
    // Preach until one is called; the roll is a chance, not a certainty.
    const rng = new Rng('preach');
    for (let i = 0; i < 200 && !state.faith.holyWar; i++) considerHolyWar(state, rng);
    const war = state.faith.holyWar;
    expect(war, 'no war was ever preached').toBeDefined();

    const joiner = eligibleJoiner(state);
    expect(holyWarRelief(state, joiner)).toBe(0);
    expect(joinHolyWar(state, joiner).ok).toBe(true);
    expect(isSworn(state, joiner)).toBe(true);
    expect(holyWarRelief(state, joiner)).toBe(CRUSADER_UPKEEP_RELIEF);
    // And not twice.
    expect(joinHolyWar(state, joiner).ok).toBe(false);
  });

  it('refuses the vow to a censured ruler and to the one preaching it', () => {
    const state = newCampaign({ seed: 'refuse' });
    state.year = 1100;
    const rng = new Rng('refuse');
    for (let i = 0; i < 200 && !state.faith.holyWar; i++) considerHolyWar(state, rng);
    expect(state.faith.holyWar).toBeDefined();
    const joiner = eligibleJoiner(state);
    censure(state, joiner);
    expect(canJoinHolyWar(state, joiner).ok).toBe(false);
    expect(canJoinHolyWar(state, state.faith.holyWar!.caller).ok).toBe(false);
    // And to a ruler of the wrong communion.
    const wrongFaith = state.faith.holyWar!.faith === 'christian' ? FATIMIDS : FRANCE;
    expect(canJoinHolyWar(state, wrongFaith).ok).toBe(false);
  });

  it('ends when the place is taken, and pays whoever took it', () => {
    const state = newCampaign({ seed: 'fulfil' });
    state.year = 1100;
    const rng = new Rng('fulfil');
    for (let i = 0; i < 200 && !state.faith.holyWar; i++) considerHolyWar(state, rng);
    const war = state.faith.holyWar!;
    const taker = eligibleJoiner(state);
    joinHolyWar(state, taker);
    const before = standingOf(state, taker);
    const purse = factionState(state, taker).treasury;

    transferProvince(state, war.target, taker);
    progressHolyWar(state);

    expect(state.faith.holyWar).toBeUndefined();
    expect(standingOf(state, taker)).toBeGreaterThan(before);
    expect(factionState(state, taker).treasury).toBeGreaterThan(purse);
  });

  it('lapses when the years run out, at the cost of those who swore', () => {
    const state = newCampaign({ seed: 'lapse' });
    state.year = 1100;
    const rng = new Rng('lapse');
    for (let i = 0; i < 200 && !state.faith.holyWar; i++) considerHolyWar(state, rng);
    const joiner = eligibleJoiner(state);
    joinHolyWar(state, joiner);
    const sworn = standingOf(state, joiner);

    state.turn = state.faith.holyWar!.expires + 1;
    progressHolyWar(state);
    expect(state.faith.holyWar).toBeUndefined();
    expect(standingOf(state, joiner)).toBeLessThan(sworn);
  });

  it('names who holds the objective', () => {
    const state = newCampaign({ seed: 'holder' });
    state.year = 1100;
    const rng = new Rng('holder');
    for (let i = 0; i < 200 && !state.faith.holyWar; i++) considerHolyWar(state, rng);
    const war = state.faith.holyWar!;
    expect(holyWarHolder(state)).toBe(regionState(state, war.target).owner);
  });
});

describe('a century of holy war', () => {
  it('preaches, is answered, and keeps its own books straight', () => {
    const state = newCampaign({ seed: 'faith-century' });
    let everPreached = 0;
    let everSworn = 0;
    let active = undefined as string | undefined;

    for (let turn = 0; turn < 300; turn++) {
      endTurn(state);
      const war = state.faith.holyWar;
      const key = war ? `${war.faith}:${war.target}:${war.calledOn}` : undefined;
      if (key && key !== active) everPreached += 1;
      active = key;
      if (war) everSworn = Math.max(everSworn, war.participants.length);

      if (war) {
        // Everything a war asserts about itself must stay true.
        expect(tryGetRegion(war.target)).toBeDefined();
        expect(war.expires).toBeGreaterThan(war.calledOn);
        expect(new Set(war.participants).size).toBe(war.participants.length);
        for (const participant of war.participants) {
          expect(faithOf(participant)).toBe(war.faith);
          expect(isCensured(state, participant)).toBe(false);
        }
      }
      for (const [faction] of state.faith.censured) {
        expect(faithOf(faction), `${faction} is censured but answers to nobody`).toBeDefined();
      }
      for (const [faction, value] of state.faith.standing) {
        expect(value).toBeGreaterThanOrEqual(-100);
        expect(value).toBeLessThanOrEqual(100);
        expect(faction).not.toBe(INDEPENDENT_ID);
      }
    }

    expect(everPreached, 'no holy war was ever preached').toBeGreaterThan(3);
    expect(everSworn, 'nobody ever took the cross').toBeGreaterThan(0);
  }, 240_000);

  it('does not censure the Orthodox or the pagans, ever', () => {
    const state = newCampaign({ seed: 'faith-schism' });
    for (let turn = 0; turn < 200; turn++) {
      endTurn(state);
      for (const [faction] of state.faith.censured) {
        const religion = tryGetFaction(faction)?.religion;
        expect(['catholic', 'sunni', 'shia']).toContain(religion);
      }
    }
  }, 180_000);
});
