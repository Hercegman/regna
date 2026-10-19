/**
 * Resolving a battle against the campaign.
 *
 * The campaign never has its own combat rules: it builds a battle, runs the
 * same simulation the player watches, and writes the survivors back. An
 * auto-resolved battle and a fought battle therefore cannot disagree.
 */
import type { FactionId, RegionId } from '../types';
import { SETTLEMENT_ORDER } from '../types';
import type { Army, CampaignState, Fleet, Regiment } from './state';
import {
  factionState,
  fleetCapacity,
  logEvent,
  regionState,
  strengthOf,
  wallTier,
} from './state';
import { getRegion } from '../data/regions';
import type { SeaZoneId } from '../data/seas';
import { getSeaZone } from '../data/seas';
import { getFaction, tryGetFaction } from '../data/factions';
import { getUnitType } from '../data/units';
import type { BattleResult, BattleSetup } from '../battle/types';
import { runBattle } from '../battle/sim';
import { hashString } from '../rng';
import { buildBattle, flattenSide, type SideComposition } from '../battle/setup';
import { transferProvince } from './actions';

export interface BattlePlan {
  readonly setup: BattleSetup;
  readonly attacker: SideComposition;
  readonly defender: SideComposition;
  /** The province a land battle is fought over. */
  readonly region: RegionId | undefined;
  /** The water a sea battle is fought in. */
  readonly zone: SeaZoneId | undefined;
  readonly isAssault: boolean;
  readonly naval: boolean;
}

/** Collects the forces present and draws them up, without fighting yet. */
export function planBattle(
  state: CampaignState,
  region: RegionId,
  attackerArmies: readonly Army[],
  defenderArmies: readonly Army[],
  options: { readonly isAssault?: boolean } = {},
): BattlePlan {
  const province = regionState(state, region);
  const isAssault = options.isAssault ?? false;

  const attackerFaction = attackerArmies[0]?.faction;
  if (!attackerFaction) throw new Error('A battle needs an attacking army');
  const defenderFaction = defenderArmies[0]?.faction ?? province.owner;

  const attacker: SideComposition = {
    faction: attackerFaction,
    armies: attackerArmies,
    fleets: [],
    garrison: [],
    command: commandOf(attackerArmies),
  };
  const defender: SideComposition = {
    faction: defenderFaction,
    armies: defenderArmies,
    fleets: [],
    // The garrison turns out only when its own settlement is assaulted.
    garrison: isAssault && province.owner === defenderFaction ? province.garrison : [],
    command: commandOf(defenderArmies),
  };

  const setup = buildBattle({
    seed: `${state.seed}:${state.turn}:${region}`,
    terrain: getRegion(region).terrain,
    isWinter: state.season === 'winter',
    attacker,
    defender,
    ...(isAssault ? { walls: wallTier(province) } : {}),
  });

  return { setup, attacker, defender, region, zone: undefined, isAssault, naval: false };
}

/**
 * Draws up a sea battle. Both sides fight with their hulls; the land regiments
 * a fleet is carrying take no part, which is why a loaded invasion fleet is
 * such a poor thing to be intercepted with.
 */
export function planNavalBattle(
  state: CampaignState,
  zone: SeaZoneId,
  attackerFleets: readonly Fleet[],
  defenderFleets: readonly Fleet[],
): BattlePlan {
  const attackerFaction = attackerFleets[0]?.faction;
  const defenderFaction = defenderFleets[0]?.faction;
  if (!attackerFaction || !defenderFaction) {
    throw new Error('A sea battle needs a fleet on each side');
  }

  const attacker: SideComposition = {
    faction: attackerFaction,
    armies: [],
    fleets: attackerFleets,
    garrison: [],
    command: admiralOf(attackerFleets),
  };
  const defender: SideComposition = {
    faction: defenderFaction,
    armies: [],
    fleets: defenderFleets,
    garrison: [],
    command: admiralOf(defenderFleets),
  };

  const setup = buildBattle({
    seed: `${state.seed}:${state.turn}:sea:${zone}`,
    // Open water: flat, with no cover and nowhere to run but the horizon.
    terrain: 'coastal',
    isWinter: state.season === 'winter',
    attacker,
    defender,
    naval: true,
  });

  return { setup, attacker, defender, region: undefined, zone, isAssault: false, naval: true };
}

function admiralOf(fleets: readonly Fleet[]): number {
  let best = 0;
  for (const fleet of fleets) if (fleet.admiral) best = Math.max(best, fleet.admiral.command);
  return best;
}

function commandOf(armies: readonly Army[]): number {
  let best = 0;
  for (const army of armies) if (army.general) best = Math.max(best, army.general.command);
  return best;
}

/** Runs a planned battle to its end without presenting it. */
export function autoResolve(plan: BattlePlan): BattleResult {
  return runBattle(plan.setup);
}

/**
 * Writes a finished battle back into the campaign: casualties, experience,
 * destroyed armies, and the fate of the province.
 */
export function applyBattleResult(
  state: CampaignState,
  plan: BattlePlan,
  result: BattleResult,
): void {
  applySide(state, plan.attacker, result, 'attacker');
  applySide(state, plan.defender, result, 'defender');

  // Empty armies are gone; empty garrisons leave the settlement open.
  for (const army of [...plan.attacker.armies, ...plan.defender.armies]) {
    army.regiments = army.regiments.filter((regiment) => regiment.soldiers > 0);
    if (army.regiments.length === 0) state.armies.delete(army.id);
  }
  // A fleet that loses its hulls takes its cargo to the bottom with it.
  for (const fleet of [...plan.attacker.fleets, ...plan.defender.fleets]) {
    fleet.ships = fleet.ships.filter((ship) => ship.soldiers > 0);
    if (fleet.ships.length === 0) {
      if (fleet.cargo.length > 0) {
        logEvent(
          state,
          fleet.faction,
          `${fleet.cargo.length} regiments are lost with the fleet.`,
        );
      }
      state.fleets.delete(fleet.id);
      continue;
    }
    // Survivors crowd onto what is left afloat; anything beyond capacity drowns.
    const room = fleetCapacity(fleet);
    if (fleet.cargo.length > room) {
      fleet.cargo = fleet.cargo.slice(0, Math.max(0, room));
    }
  }
  if (plan.naval) {
    applyNavalOutcome(state, plan, result);
    return;
  }
  const province = regionState(state, plan.region!);
  province.garrison = province.garrison.filter((regiment) => regiment.soldiers > 0);

  const attackerName = nameOf(plan.attacker.faction);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const defenderName = nameOf(plan.defender.faction);
  const place = getRegion(plan.region!).settlement;

  if (result.outcome === 'attacker') {
    logEvent(
      state,
      plan.attacker.faction,
      `${attackerName} defeats ${defenderName} at ${place}. ` +
        `Losses: ${Math.round(result.attackerLosses)} against ${Math.round(result.defenderLosses)}.`,
    );
    if (plan.isAssault || strengthOf(province.garrison) === 0) {
      if (province.owner !== plan.attacker.faction) {
        sackOrOccupy(state, plan.region!, plan.attacker.faction);
      }
    }
  } else if (result.outcome === 'defender') {
    logEvent(
      state,
      plan.defender.faction,
      `${defenderName} holds the field against ${attackerName} at ${place}. ` +
        `Losses: ${Math.round(result.defenderLosses)} against ${Math.round(result.attackerLosses)}.`,
    );
    // A beaten attacker falls back the way it came and lifts any siege.
    province.siege = undefined;
    for (const army of plan.attacker.armies) {
      if (state.armies.has(army.id)) army.movement = 0;
    }
  } else {
    logEvent(state, undefined, `The battle at ${place} ends without a decision.`);
  }
}

function applySide(
  state: CampaignState,
  side: SideComposition,
  result: BattleResult,
  which: 'attacker' | 'defender',
): void {
  const slots = flattenSide(side);
  const won =
    (which === 'attacker' && result.outcome === 'attacker') ||
    (which === 'defender' && result.outcome === 'defender');

  for (const unit of result.units) {
    if (unit.side !== which) continue;
    const slot = slots.find(
      (candidate) =>
        candidate.source === unit.source && candidate.sourceIndex === unit.sourceIndex,
    );
    if (!slot) continue;
    const regiment = slot.regiment;
    // A regiment that ran off the field keeps most of its men: they are
    // scattered, not dead.
    const survivors = unit.fled ? unit.soldiers * 0.8 : unit.soldiers;
    regiment.soldiers = Math.max(0, Math.round(survivors));
    if (regiment.soldiers > 0) {
      const share = 1 - unit.soldiers / Math.max(1, unit.startingSoldiers);
      regiment.experience = Math.min(
        9,
        regiment.experience + (won ? 0.6 : 0.25) + share * 0.8,
      );
    }
  }
  // A defeated general may be killed or captured. The draw comes from the
  // battle's own seed, so replaying the same battle kills the same man.
  if (!won) {
    for (const army of side.armies) {
      if (!army.general) continue;
      const roll = hashString(`${result.duration}:${which}:${army.id}:${army.general.id}`) / 0x100000000;
      if (roll < 0.12) {
        const faction = factionState(state, army.faction);
        logEvent(
          state,
          army.faction,
          `${army.general.name} of ${nameOf(army.faction)} falls in battle.`,
        );
        faction.characters = faction.characters.filter((c) => c.id !== army.general!.id);
        for (const province of state.regions.values()) {
          if (province.governor?.id === army.general.id) province.governor = undefined;
        }
        army.general = undefined;
      }
    }
  }
}

/** Records the result of a sea battle and sends the loser home. */
function applyNavalOutcome(
  state: CampaignState,
  plan: BattlePlan,
  result: BattleResult,
): void {
  const water = plan.zone ? getSeaZone(plan.zone).name : 'open water';
  const winner = result.outcome === 'attacker' ? plan.attacker : result.outcome === 'defender' ? plan.defender : undefined;
  const loser = winner === plan.attacker ? plan.defender : winner === plan.defender ? plan.attacker : undefined;

  if (!winner || !loser) {
    logEvent(state, undefined, `The fleets break off in the ${water} without a decision.`);
    return;
  }
  logEvent(
    state,
    winner.faction,
    `${nameOf(winner.faction)} defeats ${nameOf(loser.faction)} in the ${water}. ` +
      `Hulls lost: ${Math.round(result.defenderLosses)} against ${Math.round(result.attackerLosses)}.`,
  );
  // A beaten fleet that is still afloat runs for the nearest friendly harbour.
  for (const fleet of loser.fleets) {
    if (!state.fleets.has(fleet.id)) continue;
    const refuge = nearestFriendlyPort(state, fleet);
    if (refuge) fleet.location = { kind: 'port', region: refuge };
    fleet.movement = 0;
  }
}

/** The closest harbour of our own that a fleet in this zone can run to. */
function nearestFriendlyPort(state: CampaignState, fleet: Fleet): RegionId | undefined {
  if (fleet.location.kind !== 'sea') return undefined;
  const zone = getSeaZone(fleet.location.zone);
  for (const port of zone.ports) {
    const province = state.regions.get(port);
    if (province && province.owner === fleet.faction) return port;
  }
  return undefined;
}

function nameOf(id: FactionId): string {
  return tryGetFaction(id)?.name ?? 'the independents';
}

/**
 * A captured settlement is occupied. Larger places are also plundered, which
 * fills the treasury and costs population and order.
 */
export function sackOrOccupy(
  state: CampaignState,
  region: RegionId,
  captor: FactionId,
): void {
  const province = regionState(state, region);
  const size = SETTLEMENT_ORDER.indexOf(province.tier) + 1;
  const plunder = Math.round(province.population * 55 * size * 0.25);
  factionState(state, captor).treasury += plunder;
  province.population = Math.max(1, province.population * 0.85);
  transferProvince(state, region, captor);
  logEvent(
    state,
    captor,
    `${getRegion(region).settlement} is plundered for ${plunder} florins.`,
  );
}

/**
 * Chance that an assault succeeds at all, before the battle is fought: scaling
 * ladders against stone is a different proposition from walking into a village.
 */
export function assaultPenalty(walls: string): number {
  switch (walls) {
    case 'none': return 0;
    case 'palisade': return 0.08;
    case 'wooden': return 0.16;
    case 'stone': return 0.28;
    case 'large_stone': return 0.4;
    case 'epic': return 0.55;
    default: return 0;
  }
}

/** Siege engines and ladder-carriers reduce the penalty of storming walls. */
export function siegeCapability(regiments: readonly Regiment[]): number {
  let capability = 0;
  for (const regiment of regiments) {
    const type = getUnitType(regiment.type);
    if (type.unitClass === 'siege_engine') capability += 0.18;
    if (type.abilities.includes('ladder_carrier')) capability += 0.05;
    if (type.abilities.includes('siege_crew')) capability += 0.04;
  }
  return Math.min(0.5, capability);
}

/** Faction trait bonus to assaults. */
export function siegeTraitBonus(faction: FactionId): number {
  return tryGetFaction(faction)?.traits.siege ?? 0;
}

export function assaultOdds(
  state: CampaignState,
  region: RegionId,
  attacker: FactionId,
  regiments: readonly Regiment[],
): number {
  const province = regionState(state, region);
  const penalty = assaultPenalty(wallTier(province));
  const help = siegeCapability(regiments) + siegeTraitBonus(attacker);
  return Math.max(0, penalty - help);
}

export { getFaction };
