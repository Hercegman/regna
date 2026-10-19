/**
 * The authority of a faith, and the wars it calls.
 *
 * A crusade and a jihad are one mechanism seen from two sides. An authority
 * (the pope at Rome, the caliph at Baghdad) keeps a standing for every ruler of
 * its own faith, preaches a war for a place that faith claims, and censures
 * those who turn their swords on their co-religionists instead.
 *
 * None of this is a separate diplomacy. Standing is earned and lost by what a
 * ruler actually does with his armies, and censure makes him fair game to
 * everyone who shares his faith.
 */
import type { FactionId, RegionId } from '../types';
import { clamp } from '../types';
import type { CampaignState } from './state';
import { factionState, isAtWar, logEvent, regionState } from './state';
import type { SacredPlace } from '../data/faith';
import { HOLY_AUTHORITY, belongsTo, claimsOn, sacredTo } from '../data/faith';
import { getRegion } from '../data/regions';
import { factionName, tryGetFaction, INDEPENDENT_ID } from '../data/factions';
import { RELIGION_FAMILY } from '../types';
import type { Rng } from '../rng';

export type HolyFaith = 'christian' | 'muslim';

export interface HolyWar {
  readonly faith: HolyFaith;
  /** The authority that preached it. */
  readonly caller: FactionId;
  readonly target: RegionId;
  /** Turn it was called. */
  readonly calledOn: number;
  /** Turn it lapses if nobody has taken the place. */
  readonly expires: number;
  /** Rulers who answered the call. */
  participants: FactionId[];
}

export interface FaithState {
  /** Standing with the authority of one's own faith, from -100 to 100. */
  standing: Map<FactionId, number>;
  /** Turn a ruler was censured, for those under censure. */
  censured: Map<FactionId, number>;
  holyWar: HolyWar | undefined;
  /** Turn the last war ended, so that they are not preached back to back. */
  lastWarEnded: number;
}

export function initialFaith(): FaithState {
  return { standing: new Map(), censured: new Map(), holyWar: undefined, lastWarEnded: -99 };
}

/** Standing below which the authority loses patience. */
export const CENSURE_THRESHOLD = -55;
/** Standing a censured ruler must climb back to before he is absolved. */
export const ABSOLUTION_THRESHOLD = -15;
/** How long a preached war stands before it lapses, in turns. */
export const HOLY_WAR_TURNS = 20;
/** Turns of quiet between one war and the next. */
export const HOLY_WAR_COOLDOWN = 10;
/** What a participant saves on upkeep while the war is preached. */
export const CRUSADER_UPKEEP_RELIEF = 0.25;

// ---------------------------------------------------------------------------
// Who speaks for a faith
// ---------------------------------------------------------------------------

/**
 * Whose authority a ruler actually answers to.
 *
 * Only Latin rulers answer to Rome. The schism of 1054 is the point: an
 * Orthodox emperor was head of his own church and no pope could excommunicate
 * him in any sense that mattered, and the Armenian and Coptic churches had been
 * outside that communion for six hundred years. Sunni and Shia rulers both
 * answer to a caliph, which is a quarrel of a different kind.
 */
export function faithOf(faction: FactionId): HolyFaith | undefined {
  const religion = tryGetFaction(faction)?.religion;
  if (!religion) return undefined;
  if (religion === 'catholic') return 'christian';
  if (religion === 'sunni' || religion === 'shia') return 'muslim';
  return undefined;
}

/**
 * The broader communion a ruler belongs to, which is what decides whether a
 * war is a war on one's own. Byzantium answers to no pope but is still
 * Christendom, and no crusade is preached against it for simply existing.
 */
export function familyOf(faction: FactionId): 'christian' | 'muslim' | 'other' | undefined {
  const religion = tryGetFaction(faction)?.religion;
  return religion ? RELIGION_FAMILY[religion] : undefined;
}

/**
 * The living power that can preach for a faith.
 *
 * Authority is not an office that survives its holder here: if Rome falls and
 * no listed successor is left, nobody can call a crusade at all, which is a
 * real consequence of conquering the Papal States.
 */
export function authorityFor(state: CampaignState, faith: HolyFaith): FactionId | undefined {
  for (const candidate of HOLY_AUTHORITY[faith]) {
    const faction = state.factions.get(candidate);
    if (!faction?.alive) continue;
    const owned = [...state.regions.values()].some((region) => region.owner === candidate);
    if (owned) return candidate;
  }
  return undefined;
}

/** Is this faction the one that speaks for its faith? */
export function isAuthority(state: CampaignState, faction: FactionId): boolean {
  const faith = faithOf(faction);
  return faith !== undefined && authorityFor(state, faith) === faction;
}

// ---------------------------------------------------------------------------
// Standing and censure
// ---------------------------------------------------------------------------

export function standingOf(state: CampaignState, faction: FactionId): number {
  return state.faith.standing.get(faction) ?? 0;
}

export function adjustStanding(
  state: CampaignState,
  faction: FactionId,
  delta: number,
): void {
  if (faction === INDEPENDENT_ID) return;
  if (!faithOf(faction)) return;
  state.faith.standing.set(faction, clamp(standingOf(state, faction) + delta, -100, 100));
}

export function isCensured(state: CampaignState, faction: FactionId): boolean {
  return state.faith.censured.has(faction);
}

export function censure(state: CampaignState, faction: FactionId): void {
  if (isCensured(state, faction)) return;
  const faith = faithOf(faction);
  if (!faith) return;
  const authority = authorityFor(state, faith);
  if (!authority || authority === faction) return;

  state.faith.censured.set(faction, state.turn);
  logEvent(
    state,
    faction,
    faith === 'christian'
      ? `${factionName(faction)} is excommunicated by ${factionName(authority)}.`
      : `${factionName(faction)} is declared a rebel against the faith by ${factionName(authority)}.`,
  );

  // The sentence dissolves the oaths of its allies.
  const own = state.factions.get(faction);
  if (!own) return;
  for (const [other, relation] of own.relations) {
    if (relation.stance !== 'alliance') continue;
    if (faithOf(other) !== faith) continue;
    own.relations.set(other, { stance: 'neutral', attitude: relation.attitude - 15, since: state.turn });
    const theirs = state.factions.get(other);
    const back = theirs?.relations.get(faction);
    if (theirs && back) {
      theirs.relations.set(faction, {
        stance: 'neutral',
        attitude: back.attitude - 15,
        since: state.turn,
      });
    }
  }
}

export function absolve(state: CampaignState, faction: FactionId): void {
  if (!isCensured(state, faction)) return;
  state.faith.censured.delete(faction);
  logEvent(state, faction, `${factionName(faction)} is restored to the communion of the faithful.`);
}

/** What it costs to buy absolution: more the longer the quarrel has run. */
export function absolutionPrice(state: CampaignState, faction: FactionId): number {
  const since = state.faith.censured.get(faction);
  if (since === undefined) return 0;
  const turns = Math.max(1, state.turn - since);
  const provinces = [...state.regions.values()].filter((r) => r.owner === faction).length;
  return Math.round(600 + provinces * 220 + turns * 40);
}

/** Same shape as a land order's result; re-exported from `actions`. */
type Outcome = { ok: true } | { ok: false; reason: string };

/** Pays the authority for absolution, which is how most of them ended. */
export function seekAbsolution(state: CampaignState, faction: FactionId): Outcome {
  if (!isCensured(state, faction)) return { ok: false, reason: 'We are in good standing.' };
  const faith = faithOf(faction);
  const authority = faith ? authorityFor(state, faith) : undefined;
  if (!authority) return { ok: false, reason: 'Nobody can absolve us: the see is empty.' };
  if (isAtWar(state, faction, authority)) {
    return { ok: false, reason: 'We are at war with the very power that would absolve us.' };
  }
  const price = absolutionPrice(state, faction);
  const own = factionState(state, faction);
  if (own.treasury < price) return { ok: false, reason: 'The treasury cannot pay for it.' };

  own.treasury -= price;
  factionState(state, authority).treasury += price;
  adjustStanding(state, faction, 35);
  absolve(state, faction);
  return { ok: true };
}

/** Gifts to the authority buy goodwill, as they always did. */
export function donate(state: CampaignState, faction: FactionId, amount: number): Outcome {
  const faith = faithOf(faction);
  const authority = faith ? authorityFor(state, faith) : undefined;
  if (!authority) return { ok: false, reason: 'There is nobody to receive it.' };
  if (authority === faction) return { ok: false, reason: 'We are the authority.' };
  if (amount <= 0) return { ok: false, reason: 'That is not a gift.' };
  const own = factionState(state, faction);
  if (own.treasury < amount) return { ok: false, reason: 'The treasury cannot pay for it.' };
  own.treasury -= amount;
  factionState(state, authority).treasury += amount;
  // Generous but not purchasable outright: a great gift moves standing by ten.
  adjustStanding(state, faction, Math.min(12, Math.sqrt(amount) / 9));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The deeds that move standing
// ---------------------------------------------------------------------------

/** Called when one faction declares war on another. */
export function noteWarDeclared(
  state: CampaignState,
  attacker: FactionId,
  defender: FactionId,
): void {
  const faith = faithOf(attacker);
  if (!faith) return;
  const authority = authorityFor(state, faith);

  if (authority === defender) {
    // Turning on the authority itself is the one unforgivable act.
    adjustStanding(state, attacker, -60);
    censure(state, attacker);
    return;
  }
  if (familyOf(defender) === faith) {
    // Making war on one's own communion, whether or not it answers to the same
    // authority. Rome cared that Catholics fought Catholics; it also cared, if
    // less, that they fought Greeks.
    adjustStanding(state, attacker, faithOf(defender) === faith ? -12 : -6);
    if (standingOf(state, attacker) <= CENSURE_THRESHOLD) censure(state, attacker);
    return;
  }
  // A war against another faith is what the authority wants its rulers doing.
  adjustStanding(state, attacker, 6);
}

/** Called when a province changes hands. */
export function noteProvinceTaken(
  state: CampaignState,
  region: RegionId,
  captor: FactionId,
  loser: FactionId,
): void {
  const faith = faithOf(captor);
  if (!faith) return;
  const province = state.regions.get(region);

  if (familyOf(loser) === faith) {
    adjustStanding(state, captor, faithOf(loser) === faith ? -8 : -4);
    if (standingOf(state, captor) <= CENSURE_THRESHOLD) censure(state, captor);
    return;
  }
  // Taking a place our own faith claims is the whole point of the exercise.
  const claimed = claimsOn(region).some((place) => place.faith === faith);
  adjustStanding(state, captor, claimed ? 16 : 5);
  if (province && !belongsTo(province.religion, faith)) adjustStanding(state, captor, 2);
}

/** Called when a cathedral or its equivalent is finished. */
export function notePiety(state: CampaignState, faction: FactionId, weight: number): void {
  adjustStanding(state, faction, weight);
}

// ---------------------------------------------------------------------------
// Preaching a war
// ---------------------------------------------------------------------------

/** The place a faith would most like taken back, and who holds it. */
export function bestTarget(
  state: CampaignState,
  faith: HolyFaith,
): { readonly place: SacredPlace; readonly holder: FactionId } | undefined {
  let best: { place: SacredPlace; holder: FactionId; score: number } | undefined;
  for (const place of sacredTo(faith, state.year)) {
    const province = state.regions.get(place.region);
    if (!province) continue;
    // A place already in the hands of the same communion is nobody's grievance.
    // Rome did eventually preach against Constantinople, but not by default.
    if (familyOf(province.owner) === faith) continue;
    const score = place.weight + (belongsTo(province.religion, faith) ? 15 : 0);
    if (!best || score > best.score) best = { place, holder: province.owner, score };
  }
  return best ? { place: best.place, holder: best.holder } : undefined;
}

/** Each turn the authority may preach, if it has reason and has waited. */
export function considerHolyWar(state: CampaignState, rng: Rng): void {
  if (state.faith.holyWar) return;
  if (state.turn - state.faith.lastWarEnded < HOLY_WAR_COOLDOWN) return;

  for (const faith of ['christian', 'muslim'] as const) {
    const authority = authorityFor(state, faith);
    if (!authority) continue;
    const target = bestTarget(state, faith);
    if (!target) continue;
    // The greater the prize, the likelier the call.
    if (!rng.chance(0.09 + target.place.weight / 900)) continue;

    state.faith.holyWar = {
      faith,
      caller: authority,
      target: target.place.region,
      calledOn: state.turn,
      expires: state.turn + HOLY_WAR_TURNS,
      participants: [],
    };
    logEvent(
      state,
      authority,
      faith === 'christian'
        ? `${factionName(authority)} preaches a crusade for ${getRegion(target.place.region).settlement}.`
        : `${factionName(authority)} proclaims a jihad for ${getRegion(target.place.region).settlement}.`,
    );
    return;
  }
}

export function canJoinHolyWar(state: CampaignState, faction: FactionId): Outcome {
  const war = state.faith.holyWar;
  if (!war) return { ok: false, reason: 'No holy war is being preached.' };
  if (faithOf(faction) !== war.faith) return { ok: false, reason: 'It is not our faith that calls.' };
  if (war.participants.includes(faction)) return { ok: false, reason: 'We have already taken the cross.' };
  if (isCensured(state, faction)) {
    return { ok: false, reason: 'A ruler under censure cannot take the cross.' };
  }
  if (faction === war.caller) return { ok: false, reason: 'We are the ones preaching it.' };
  const holder = state.regions.get(war.target)?.owner;
  if (holder && holder === faction) return { ok: false, reason: 'We hold the place already.' };
  return { ok: true };
}

/** Takes the cross. The vow is cheap; keeping it is not. */
export function joinHolyWar(state: CampaignState, faction: FactionId): Outcome {
  const allowed = canJoinHolyWar(state, faction);
  if (!allowed.ok) return allowed;
  const war = state.faith.holyWar!;
  war.participants.push(faction);
  adjustStanding(state, faction, 12);
  logEvent(
    state,
    faction,
    `${factionName(faction)} takes the ${war.faith === 'christian' ? 'cross' : 'oath'} ` +
      `for ${getRegion(war.target).settlement}.`,
  );
  return { ok: true };
}

/** Who holds the place the present holy war is for. */
export function holyWarHolder(state: CampaignState): FactionId | undefined {
  const war = state.faith.holyWar;
  if (!war) return undefined;
  return state.regions.get(war.target)?.owner;
}

/** Is this ruler sworn to the war now being preached? */
export function isSworn(state: CampaignState, faction: FactionId): boolean {
  return state.faith.holyWar?.participants.includes(faction) ?? false;
}

/** What a sworn ruler saves on keeping his soldiers, while the vow stands. */
export function holyWarRelief(state: CampaignState, faction: FactionId): number {
  return isSworn(state, faction) ? CRUSADER_UPKEEP_RELIEF : 0;
}

/**
 * Ends the war when the place is taken or the years run out.
 *
 * Taking it is worth a great deal of standing to whoever did it; letting the
 * call lapse costs everyone who swore and did nothing.
 */
export function progressHolyWar(state: CampaignState): void {
  const war = state.faith.holyWar;
  if (!war) return;

  const province = state.regions.get(war.target);
  if (province && familyOf(province.owner) === war.faith) {
    const taker = province.owner;
    adjustStanding(state, taker, isSworn(state, taker) ? 40 : 22);
    if (isCensured(state, taker) && standingOf(state, taker) > ABSOLUTION_THRESHOLD) {
      absolve(state, taker);
    }
    factionState(state, taker).treasury += 1200;
    logEvent(
      state,
      taker,
      `${getRegion(war.target).settlement} falls to ${factionName(taker)}, and the ` +
        `${war.faith === 'christian' ? 'crusade' : 'jihad'} is fulfilled.`,
    );
    state.faith.holyWar = undefined;
    state.faith.lastWarEnded = state.turn;
    return;
  }

  if (state.turn < war.expires) return;
  for (const participant of war.participants) adjustStanding(state, participant, -10);
  logEvent(
    state,
    war.caller,
    `The ${war.faith === 'christian' ? 'crusade' : 'jihad'} for ` +
      `${getRegion(war.target).settlement} comes to nothing.`,
  );
  state.faith.holyWar = undefined;
  state.faith.lastWarEnded = state.turn;
}

/** Standing drifts back towards indifference when nothing is happening. */
export function driftStanding(state: CampaignState): void {
  for (const [faction, value] of state.faith.standing) {
    if (Math.abs(value) < 0.5) {
      state.faith.standing.set(faction, 0);
      continue;
    }
    state.faith.standing.set(faction, value - Math.sign(value) * 0.8);
  }
  // A ruler who has mended his ways is forgiven in time.
  for (const [faction] of state.faith.censured) {
    if (standingOf(state, faction) > ABSOLUTION_THRESHOLD) absolve(state, faction);
  }
}

/**
 * What censure costs a ruler in his own provinces: the churches are shut, the
 * dead go unburied, and the people blame the man who brought it on them.
 */
export function censureUnrest(state: CampaignState, region: RegionId): number {
  const province = regionState(state, region);
  if (!isCensured(state, province.owner)) return 0;
  const faith = faithOf(province.owner);
  if (!faith) return 0;
  return belongsTo(province.religion, faith) ? 5 : 1.5;
}

/** Co-religionists may make war on a censured ruler without waiting. */
export function isFairGame(state: CampaignState, target: FactionId, by: FactionId): boolean {
  if (!isCensured(state, target)) return false;
  const faith = faithOf(target);
  return faith !== undefined && faithOf(by) === faith;
}
