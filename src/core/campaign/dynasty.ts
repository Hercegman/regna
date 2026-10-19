/**
 * Houses, marriages and who gets the throne.
 *
 * Characters existed from the beginning: they aged, governed, commanded and
 * died, and when a ruler died the realm handed the crown to whoever happened
 * to be standing nearest. That is not what succession was. A medieval crown
 * was a claim, the claim came from descent, and the whole apparatus of
 * medieval diplomacy — the marriages above all — existed to manufacture and
 * defend one.
 *
 * So: characters have a father and a sex, houses marry each other, children
 * are born and come of age, and when a ruler dies the crown goes to his
 * eldest son if he has one. When it cannot, the realm's legitimacy suffers in
 * proportion to how far from the direct line the new man is, and a realm that
 * does not believe in its own king is measurably harder to hold.
 *
 * Nothing here is a special case for the player. The same succession runs for
 * seventy-three realms every time a ruler dies.
 */
import type { CharacterId, FactionId } from '../types';
import { clamp } from '../types';
import type { Rng } from '../rng';
import type { CampaignState, Character, FactionState } from './state';
import {
  factionState,
  givenName,
  givenNameOf,
  logEvent,
  nameRuler,
  newCharacter,
} from './state';
import { getFaction, tryGetFaction, INDEPENDENT_ID } from '../data/factions';
import { adjustAttitude, relation } from './diplomacy';

type Outcome = { ok: true } | { ok: false; reason: string };
const ok: Outcome = { ok: true };
const no = (reason: string): Outcome => ({ ok: false, reason });

/** Below this a character is a child: no post, no marriage, no command. */
export const COMES_OF_AGE = 16;

/** Nobody keeps a court larger than this; see `addCharacter`. */
export const MAX_COURT = 8;

// ---------------------------------------------------------------------------
// Descent
// ---------------------------------------------------------------------------

export function isAdult(character: Character): boolean {
  return character.age >= COMES_OF_AGE;
}

export function leaderOf(state: CampaignState, id: FactionId): Character | undefined {
  return state.factions.get(id)?.characters.find((character) => character.leader);
}

/** Everyone in this court descended from the given man. */
export function childrenOf(faction: FactionState, father: CharacterId): Character[] {
  return faction.characters
    .filter((character) => character.father === father)
    .sort((a, b) => b.age - a.age);
}

/**
 * How good a claim this character has on the throne, from the point of view of
 * the man who last held it.
 *
 * Sons first and eldest first, then brothers, then anyone of the house, then
 * everybody else. Women are not excluded from the count — several realms here
 * had reigning queens — but they come after their brothers, as they did
 * nearly everywhere in this period.
 */
export function claimOf(
  faction: FactionState,
  character: Character,
  lateRuler: Character | undefined,
): number {
  if (!isAdult(character)) return 0;
  let claim = 10;
  if (lateRuler) {
    if (character.father === lateRuler.id) claim = 100 - Math.max(0, 60 - character.age);
    else if (character.father && character.father === lateRuler.father) claim = 55;
    else if (character.id === lateRuler.spouse) claim = 45;
    else if (sharesDescent(faction, character, lateRuler)) claim = 35;
  }
  // Descent from any king this realm has had, not only from the last one.
  // This is what a pretender's whole argument rested on, and without it a
  // magnate who had taken a throne outranked the dead king's own son.
  if (character.father && faction.crowned.includes(character.father as string)) {
    claim = Math.max(claim, 60);
  }
  if (character.sex === 'f') claim -= 12;
  // A man the realm already trusts with something is easier to accept.
  claim += character.governance * 0.4 + character.command * 0.3;
  return Math.max(1, claim);
}

function sharesDescent(
  faction: FactionState,
  a: Character,
  b: Character,
): boolean {
  const line = (start: Character): Set<string> => {
    const seen = new Set<string>();
    let current: Character | undefined = start;
    for (let depth = 0; depth < 8 && current?.father; depth++) {
      seen.add(current.father as string);
      const next: Character | undefined = faction.characters.find(
        (candidate) => candidate.id === current!.father,
      );
      current = next;
    }
    return seen;
  };
  const theirs = line(b);
  for (const ancestor of line(a)) if (theirs.has(ancestor)) return true;
  return false;
}

/**
 * The court a realm starts with.
 *
 * Courts used to contain exactly one person — the ruler — because nothing ever
 * called the function that added anyone else. A realm with one man in it
 * cannot marry, cannot breed, and cannot hand its crown to a son, so every
 * succession in the game was a stranger taking a vacant throne.
 *
 * A house in 1080 is a ruler, his wife, and whatever children they have had
 * by now. That is the whole of it, and it is enough for the rest of the model
 * to work: the children grow up, marry abroad, govern provinces, lead armies
 * and inherit.
 */
export function foundCourt(state: CampaignState, id: FactionId, leader: Character, rng: Rng): void {
  const faction = factionState(state, id);

  const consort = newCharacter(state, id, {
    sex: 'f',
    name: givenName(id, 'f', rng),
    command: rng.int(1, 4),
    governance: rng.int(2, 7),
    guile: rng.int(2, 8),
    age: Math.max(COMES_OF_AGE + 2, leader.age - rng.int(0, 9)),
  });
  // Both born here, so neither carries a bond to anywhere else.
  consort.spouse = leader.id;
  leader.spouse = consort.id;
  faction.characters.push(consort);

  // Children, as many as the marriage has had years for.
  const married = Math.max(0, Math.min(leader.age, consort.age) - 18);
  const count = Math.min(3, Math.floor(married / 6) + (rng.chance(0.5) ? 1 : 0));
  for (let child = 0; child < count; child++) {
    const sex: 'm' | 'f' = rng.chance(0.55) ? 'm' : 'f';
    faction.characters.push(
      newCharacter(state, id, {
        sex,
        father: leader.id,
        name: givenName(id, sex, rng),
        command: rng.int(1, 8),
        governance: rng.int(1, 8),
        guile: rng.int(1, 8),
        age: rng.int(1, Math.max(2, married)),
      }),
    );
  }
}

/**
 * Somebody turns up at court: a cousin from a cadet branch, a useful magnate,
 * a bishop's nephew. A realm that has lost its whole family needs a way back
 * from that, and this is it — but such a man has no father the realm
 * remembers, so his claim on the throne is weak and the realm knows it.
 */
export function attendCourt(state: CampaignState, rng: Rng): void {
  if (state.season !== 'summer') return;
  for (const [id, faction] of state.factions) {
    if (!faction.alive || id === INDEPENDENT_ID) continue;
    if (faction.characters.length >= MAX_COURT) continue;
    // Only when the house actually needs the help. Letting kinsmen drift in
    // whenever there was room filled every court with men who had no claim,
    // and then they inherited: magnates were taking more thrones than sons.
    const leader = faction.characters.find((character) => character.leader);
    const hasHeir = leader
      ? faction.characters.some(
          (character) =>
            character.id !== leader.id &&
            (character.father === leader.id || character.father === leader.father),
        )
      : false;
    if (faction.characters.length >= 3 && hasHeir) continue;
    if (!rng.chance(0.2)) continue;
    const sex: 'm' | 'f' = rng.chance(0.7) ? 'm' : 'f';
    const arrival = newCharacter(state, id, {
      sex,
      name: givenName(id, sex, rng),
      command: rng.int(1, 7),
      governance: rng.int(1, 7),
      guile: rng.int(1, 7),
      age: rng.int(18, 30),
    });
    faction.characters.push(arrival);
    logEvent(state, id, `${arrival.name}, of the wider house, comes to court.`);
  }
}

// ---------------------------------------------------------------------------
// Succession
// ---------------------------------------------------------------------------

export interface Succession {
  readonly heir: Character;
  /** How the crown came to him, for the chronicle. */
  readonly by: 'son' | 'brother' | 'consort' | 'kin' | 'magnate' | 'stranger';
  /** What the realm's legitimacy becomes. */
  readonly legitimacy: number;
}

/** What legitimacy a realm is left with after each kind of succession. */
const AFTER: Readonly<Record<Succession['by'], number>> = {
  son: 100,
  brother: 82,
  consort: 70,
  kin: 62,
  magnate: 45,
  stranger: 35,
};

/**
 * Hands the crown on, and says what it cost the realm to do so.
 *
 * The eldest adult son takes it cleanly. Failing that the realm reaches
 * further and further from the direct line, and every step costs it.
 */
/**
 * Who would take the crown, without taking it.
 *
 * The same answer `succeed` acts on, so what the player is shown before a
 * ruler dies is what actually happens when he does. Returns nothing when the
 * house has nobody and the crown would fall to whoever is strongest.
 */
export function chooseHeir(
  faction: FactionState,
  late: Character | undefined,
): { heir: Character; by: Succession['by'] } | undefined {
  const eligible = faction.characters.filter(
    (character) => isAdult(character) && character.id !== late?.id,
  );

  if (late) {
    const children = childrenOf(faction, late.id);
    const sons = children.filter((child) => isAdult(child) && child.sex === 'm');
    const daughters = children.filter((child) => isAdult(child) && child.sex === 'f');
    const brothers = late.father
      ? eligible.filter((other) => other.father === late.father && other.sex === 'm')
      : [];
    // A boy king: the crown goes to the line even when the line is nine years
    // old, and the realm pays for it in a regency rather than in a civil war.
    const infantSons = children.filter((child) => !isAdult(child) && child.sex === 'm');
    const consort = eligible.find((other) => other.id === late.spouse);

    if (sons[0]) return { heir: sons[0], by: 'son' };
    if (daughters[0]) return { heir: daughters[0], by: 'son' };
    if (brothers[0]) return { heir: brothers[0], by: 'brother' };
    if (infantSons[0]) return { heir: infantSons[0], by: 'son' };
    if (consort) return { heir: consort, by: 'consort' };
  }

  if (eligible.length === 0) return undefined;
  // No one of the blood: the strongest claim in the realm takes it, and the
  // realm knows the difference.
  const ranked = [...eligible].sort(
    (a, b) => claimOf(faction, b, late) - claimOf(faction, a, late),
  );
  const heir = ranked[0]!;
  return { heir, by: late && sharesDescent(faction, heir, late) ? 'kin' : 'magnate' };
}

/** Who succeeds the realm's present ruler if he dies today. */
export function heirApparent(state: CampaignState, id: FactionId): Character | undefined {
  const faction = state.factions.get(id);
  if (!faction) return undefined;
  const ruler = faction.characters.find((character) => character.leader);
  return chooseHeir(faction, ruler)?.heir;
}

/**
 * Hands the crown on, and says what it cost the realm to do so.
 *
 * The eldest adult son takes it cleanly. Failing that the realm reaches
 * further and further from the direct line, and every step costs it.
 */
export function succeed(
  state: CampaignState,
  id: FactionId,
  rng: Rng,
  lateRuler?: Character | undefined,
): Succession {
  const faction = factionState(state, id);
  // The late ruler has usually already been struck from the court by the time
  // anyone asks who succeeds him, so he is passed in. Without him the whole
  // question of descent is unanswerable and every succession falls to the
  // strongest magnate, which is what used to happen.
  const late = lateRuler ?? faction.characters.find((character) => character.leader);
  for (const character of faction.characters) {
    if (character.id === late?.id) character.leader = false;
  }

  const chosen = chooseHeir(faction, late);
  let heir = chosen?.heir;
  let by: Succession['by'] = chosen?.by ?? 'stranger';

  if (!heir) {
    // The house is extinct. Somebody takes the crown; nobody is pleased.
    heir = newCharacter(state, id, {
      sex: 'm',
      name: givenName(id, 'm', rng),
      command: rng.int(2, 7),
      governance: rng.int(2, 7),
      guile: rng.int(1, 7),
      age: rng.int(24, 44),
    });
    faction.characters.push(heir);
    by = 'stranger';
  }

  heir.leader = true;
  heir.name = nameRuler(faction, givenNameOf(heir));
  faction.crowned.push(heir.id as string);
  const legitimacy = AFTER[by];
  faction.legitimacy = legitimacy;

  const realm = tryGetFaction(id)?.name ?? 'the realm';
  const how: Record<Succession['by'], string> = {
    son: `succeeds his father to the throne of ${realm}`,
    brother: `succeeds his brother to the throne of ${realm}`,
    consort: `takes the throne of ${realm} as the late ruler's consort`,
    kin: `takes the throne of ${realm} as the nearest of the blood`,
    magnate: `takes the throne of ${realm} with no claim but his own standing`,
    stranger: `is raised to the throne of ${realm}, the old house being extinct`,
  };
  logEvent(state, id, `${heir.name} ${how[by]}.`);
  if (legitimacy < 80) {
    logEvent(state, id, `The succession in ${realm} is disputed.`);
  }
  return { heir, by, legitimacy };
}

/**
 * Takes a character out of the world, wherever he was and whatever he held.
 *
 * Death came from three places — old age, a lost battle, an assassin — and
 * each of them used to do its own cleanup. Two of the three forgot that the
 * man might be the ruler, so a king killed in battle left his realm with
 * nobody on the throne at all and no one ever noticed. One function now, and
 * the crown goes where it has to go.
 */
export function removeFromCourt(
  state: CampaignState,
  id: FactionId,
  who: CharacterId,
  rng: Rng,
): void {
  const faction = state.factions.get(id);
  if (!faction) return;
  const gone = faction.characters.find((character) => character.id === who);
  faction.characters = faction.characters.filter((character) => character.id !== who);

  for (const region of state.regions.values()) {
    if (region.governor?.id === who) region.governor = undefined;
  }
  for (const army of state.armies.values()) {
    if (army.general?.id === who) army.general = undefined;
  }
  for (const fleet of state.fleets.values()) {
    if (fleet.admiral?.id === who) fleet.admiral = undefined;
  }
  // A widow or widower is free to marry again.
  if (gone?.spouse) {
    for (const realm of state.factions.values()) {
      for (const character of realm.characters) {
        if (character.id === gone.spouse) character.spouse = undefined;
      }
    }
  }
  if (gone?.leader) succeed(state, id, rng, gone);
}

// ---------------------------------------------------------------------------
// Marriage
// ---------------------------------------------------------------------------

/** Whoever in this court could still be married off. */
export function marriageable(faction: FactionState, sex?: 'm' | 'f'): Character[] {
  return faction.characters.filter(
    (character) =>
      isAdult(character) &&
      character.age < 50 &&
      !character.spouse &&
      (sex === undefined || character.sex === sex),
  );
}

/**
 * Whoever could be married *out* of this court.
 *
 * A reigning ruler is not among them. The bride goes to her husband's court,
 * and a realm cannot hand its own crowned head to the neighbours — a reigning
 * queen married abroad was leaving her realm with nobody on the throne at all.
 * She may marry; she simply does not move.
 */
function marriageableAbroad(faction: FactionState, sex: 'm' | 'f'): Character[] {
  return marriageable(faction, sex).filter((character) => !character.leader);
}

export function canMarry(state: CampaignState, a: FactionId, b: FactionId): Outcome {
  if (a === b) return no('A house does not marry itself.');
  if (a === INDEPENDENT_ID || b === INDEPENDENT_ID) return no('There is no house there.');
  const ours = state.factions.get(a);
  const theirs = state.factions.get(b);
  if (!ours?.alive || !theirs?.alive) return no('No such realm.');
  if (relation(state, a, b).stance === 'war') return no('Not while we are at war.');
  const pair = matchFor(ours, theirs);
  if (!pair) return no('Neither house has anyone of an age to marry.');
  return ok;
}

/** A man of one court and a woman of the other, if the pair exists. */
function matchFor(
  ours: FactionState,
  theirs: FactionState,
): { groom: Character; bride: Character } | undefined {
  const ourMen = marriageable(ours, 'm');
  const theirWomen = marriageableAbroad(theirs, 'f');
  if (ourMen[0] && theirWomen[0]) return { groom: ourMen[0], bride: theirWomen[0] };
  const theirMen = marriageable(theirs, 'm');
  const ourWomen = marriageableAbroad(ours, 'f');
  if (theirMen[0] && ourWomen[0]) return { groom: theirMen[0], bride: ourWomen[0] };
  return undefined;
}

/** How willing the other court is, given what it thinks of us. */
export function marriageOdds(state: CampaignState, a: FactionId, b: FactionId): number {
  const attitude = relation(state, b, a).attitude;
  const stance = relation(state, a, b).stance;
  let chance = 0.3 + attitude / 160;
  if (stance === 'alliance') chance += 0.25;
  if (stance === 'trade') chance += 0.1;
  return clamp(chance, 0.05, 0.95);
}

/**
 * Marries one house into another.
 *
 * The bride goes to her husband's court, which is what made these marriages
 * worth making: her descendants are in his line, and her birth realm has an
 * interest in his. Both courts think a great deal better of each other for it.
 */
export function proposeMarriage(
  state: CampaignState,
  a: FactionId,
  b: FactionId,
  rng: Rng,
): Outcome {
  const allowed = canMarry(state, a, b);
  if (!allowed.ok) return allowed;
  if (!rng.chance(marriageOdds(state, a, b))) {
    adjustAttitude(state, a, b, -3);
    return no('The offer is declined.');
  }

  const ours = factionState(state, a);
  const theirs = factionState(state, b);
  const pair = matchFor(ours, theirs)!;
  const { groom, bride } = pair;
  const groomRealm = groom.faction === a ? ours : theirs;
  const brideRealm = bride.faction === a ? ours : theirs;

  // The bride moves to her husband's court and keeps the house she came from.
  // That single fact is the bond: her birth realm now has someone of its own
  // blood in a neighbour's court, and a claim through her if it ever matters.
  brideRealm.characters = brideRealm.characters.filter(
    (character) => character.id !== bride.id,
  );
  const settled: Character = {
    ...bride,
    faction: groomRealm.id,
    spouse: groom.id,
    bornIn: brideRealm.id,
  };
  groomRealm.characters.push(settled);
  groom.spouse = settled.id;

  adjustAttitude(state, a, b, 25);
  adjustAttitude(state, b, a, 25);
  logEvent(
    state,
    a,
    `${groom.name} of ${getFaction(groomRealm.id).name} marries ${settled.name} of ${getFaction(brideRealm.id).name}.`,
  );
  logEvent(
    state,
    b,
    `${settled.name} of ${getFaction(brideRealm.id).name} marries ${groom.name} of ${getFaction(groomRealm.id).name}.`,
  );
  return ok;
}

/** True while a living marriage joins the two houses. */
export function marriedTo(state: CampaignState, a: FactionId, b: FactionId): boolean {
  const bound = (here: FactionId, there: FactionId): boolean => {
    for (const character of state.factions.get(here)?.characters ?? []) {
      if (character.spouse && character.bornIn === there) return true;
    }
    return false;
  };
  return bound(a, b) || bound(b, a);
}

// ---------------------------------------------------------------------------
// Children
// ---------------------------------------------------------------------------

/**
 * Births, once a year.
 *
 * A married couple in a court produces children while the wife is of an age
 * to bear them. This is slow on purpose: a realm that wants an heir in the
 * next twenty years has to have married somebody twenty years ago, which is
 * exactly the planning horizon these houses worked on.
 */
export function bearChildren(state: CampaignState, rng: Rng): void {
  if (state.season !== 'summer') return;
  for (const [id, faction] of state.factions) {
    if (!faction.alive || id === INDEPENDENT_ID) continue;
    if (faction.characters.length >= MAX_COURT) continue;
    for (const mother of [...faction.characters]) {
      if (mother.sex !== 'f' || !mother.spouse) continue;
      if (mother.age < COMES_OF_AGE || mother.age > 45) continue;
      const father = faction.characters.find((other) => other.id === mother.spouse);
      if (!father) continue;
      if (!rng.chance(0.2)) continue;
      const sex: 'm' | 'f' = rng.chance(0.52) ? 'm' : 'f';
      const child = newCharacter(state, id, {
        sex,
        father: father.id,
        name: givenName(id, sex, rng),
        // What a child will turn out to be is not known until he is grown;
        // these are the ratings he will have when he comes of age.
        command: rng.int(1, 8),
        governance: rng.int(1, 8),
        guile: rng.int(1, 8),
        age: 0,
      });
      faction.characters.push(child);
      logEvent(state, id, `A ${sex === 'm' ? 'son' : 'daughter'} is born to ${father.name}.`);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// What a shaky title costs
// ---------------------------------------------------------------------------

/**
 * Unrest added in every province of a realm whose king is not believed in.
 *
 * A disputed succession was not an abstraction: it was lords refusing musters,
 * towns shutting their gates, and somebody else's army invited in. Here it is
 * the same number public order already works in, so it compounds with
 * everything else that makes a province hard to hold.
 */
export function legitimacyUnrest(faction: FactionState): number {
  return Math.max(0, (100 - faction.legitimacy) * 0.12);
}

/** A ruler too young to rule is a regency, and everyone can see it. */
export function isMinor(state: CampaignState, id: FactionId): boolean {
  const leader = leaderOf(state, id);
  return leader !== undefined && !isAdult(leader);
}

/**
 * Time settles a title.
 *
 * A king who simply goes on being king for twenty years ends up legitimate,
 * which is how most of these dynasties got there.
 */
export function settleLegitimacy(state: CampaignState): void {
  if (state.season !== 'summer') return;
  for (const [id, faction] of state.factions) {
    if (!faction.alive || id === INDEPENDENT_ID) continue;
    const floor = isMinor(state, id) ? 55 : 100;
    if (faction.legitimacy < floor) {
      faction.legitimacy = Math.min(floor, faction.legitimacy + 2);
    } else if (faction.legitimacy > floor) {
      faction.legitimacy = Math.max(floor, faction.legitimacy - 4);
    }
  }
}
