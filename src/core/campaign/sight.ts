/**
 * What a realm can actually see.
 *
 * Until now every player knew the garrison of every town in Europe, what was
 * being built in it, and where every army on the map was standing. No
 * medieval government knew any of that, and more to the point the AI never
 * used it: look at where it reads an enemy's strength and it is always ground
 * its own army or its own border is touching. So the fog costs the AI almost
 * nothing and takes away an advantage the player had over it, which is the
 * right direction for both.
 *
 * There are two levels and no memory. What is public stays public: who holds
 * a town, how big the town is, what the country is like, what its people
 * believe. Everyone knew that about everywhere. What is not public is what is
 * standing in it — the garrison, the works, the discontent, and every army,
 * fleet and agent in the field.
 *
 * No memory, because a remembered garrison is a lie after one season and
 * storing one per realm per province would be a large thing to save in order
 * to be wrong with. A realm sees what it has eyes on now.
 */
import type { AgentId, ArmyId, CaravanId, FactionId, FleetId, RegionId } from '../types';
import { SETTLEMENT_ORDER } from '../types';
import type { CampaignState, RegionState } from './state';
import { caravanLocation } from './caravans';
import { landNeighbours, seaNeighbours } from '../data/adjacency';
import { getSeaZone, SEA_ZONE_IDS } from '../data/seas';
import { getUnitType } from '../data/units';
import { unitTypeId } from '../types';
import { wallTier } from './state';

export type Sight = 'seen' | 'watched';

/**
 * Every province a realm has eyes on.
 *
 * Its own ground; anywhere it has an army, a fleet, an agent or a caravan
 * standing; everything over its own borders, because a lord knows what is
 * mustering on the other side of his river; everything beside an army of its
 * own in the field, which is what scouts were for; and every harbour on a
 * water it has a squadron in.
 */
export function watchedProvinces(state: CampaignState, viewer: FactionId): Set<RegionId> {
  const watched = new Set<RegionId>();
  const standing = new Set<RegionId>();

  for (const province of state.regions.values()) {
    if (province.owner === viewer) {
      watched.add(province.id);
      standing.add(province.id);
    }
  }
  for (const army of state.armies.values()) {
    if (army.faction !== viewer) continue;
    watched.add(army.location);
    standing.add(army.location);
  }
  for (const fleet of state.fleets.values()) {
    if (fleet.faction !== viewer) continue;
    if (fleet.location.kind === 'port') {
      watched.add(fleet.location.region);
      standing.add(fleet.location.region);
    } else {
      // A squadron on a water sees the harbours on it, which is the whole of
      // what a blockade is for.
      for (const port of getSeaZone(fleet.location.zone).ports) watched.add(port);
    }
  }
  for (const agent of state.agents.values()) {
    if (agent.faction !== viewer) continue;
    watched.add(agent.location);
  }
  for (const caravan of state.caravans.values()) {
    if (caravan.faction !== viewer) continue;
    const where = caravanLocation(caravan);
    if (where) watched.add(where);
  }

  // One province beyond anything of ours that is standing on the ground.
  for (const here of standing) {
    for (const next of landNeighbours(here)) watched.add(next);
    for (const next of seaNeighbours(here)) watched.add(next);
  }
  return watched;
}

/** Every water a realm can see into: the ones its own hulls are on or beside. */
export function watchedZones(state: CampaignState, viewer: FactionId): Set<string> {
  const watched = new Set<string>();
  for (const fleet of state.fleets.values()) {
    if (fleet.faction !== viewer) continue;
    if (fleet.location.kind === 'sea') watched.add(fleet.location.zone as string);
  }
  // A harbour of ours looks out over the water in front of it.
  for (const zone of SEA_ZONE_IDS) {
    const water = getSeaZone(zone);
    for (const port of water.ports) {
      if (state.regions.get(port)?.owner === viewer) {
        watched.add(zone as string);
        break;
      }
    }
  }
  return watched;
}

export function sightOf(
  state: CampaignState,
  viewer: FactionId,
  region: RegionId,
  watched?: ReadonlySet<RegionId>,
): Sight {
  const set = watched ?? watchedProvinces(state, viewer);
  return set.has(region) ? 'watched' : 'seen';
}

// ---------------------------------------------------------------------------
// What is in the field
// ---------------------------------------------------------------------------

export function canSeeArmy(
  state: CampaignState,
  viewer: FactionId,
  army: ArmyId,
  watched?: ReadonlySet<RegionId>,
): boolean {
  const host = state.armies.get(army);
  if (!host) return false;
  if (host.faction === viewer) return true;
  return (watched ?? watchedProvinces(state, viewer)).has(host.location);
}

export function canSeeFleet(
  state: CampaignState,
  viewer: FactionId,
  fleet: FleetId,
  watched?: ReadonlySet<RegionId>,
  zones?: ReadonlySet<string>,
): boolean {
  const squadron = state.fleets.get(fleet);
  if (!squadron) return false;
  if (squadron.faction === viewer) return true;
  if (squadron.location.kind === 'port') {
    return (watched ?? watchedProvinces(state, viewer)).has(squadron.location.region);
  }
  return (zones ?? watchedZones(state, viewer)).has(squadron.location.zone as string);
}

export function canSeeAgent(
  state: CampaignState,
  viewer: FactionId,
  agent: AgentId,
  watched?: ReadonlySet<RegionId>,
): boolean {
  const man = state.agents.get(agent);
  if (!man) return false;
  if (man.faction === viewer) return true;
  return (watched ?? watchedProvinces(state, viewer)).has(man.location);
}

export function canSeeCaravan(
  state: CampaignState,
  viewer: FactionId,
  caravan: CaravanId,
  watched?: ReadonlySet<RegionId>,
): boolean {
  const train = state.caravans.get(caravan);
  if (!train) return false;
  if (train.faction === viewer) return true;
  const where = caravanLocation(train);
  if (!where) return false;
  return (watched ?? watchedProvinces(state, viewer)).has(where);
}

// ---------------------------------------------------------------------------
// Guessing at what cannot be seen
// ---------------------------------------------------------------------------

/**
 * What a realm would put a town's garrison at without being able to count it.
 *
 * The size of a place and the height of its walls were public facts, and a
 * commander estimated from them. He was often wrong, which is the point:
 * deciding to land an army on a coast you have never looked at is a gamble,
 * and it should be.
 */
export function estimatedGarrison(
  state: CampaignState,
  viewer: FactionId,
  province: RegionState,
  watched?: ReadonlySet<RegionId>,
): number {
  if (sightOf(state, viewer, province.id, watched) === 'watched') {
    let real = 0;
    for (const regiment of province.garrison) real += regiment.soldiers;
    return real;
  }
  const militia = getUnitType(unitTypeId('town_militia')).soldiers;
  const size = SETTLEMENT_ORDER.indexOf(province.tier) + 1;
  const walls = ['none', 'palisade', 'wooden', 'stone', 'large_stone', 'epic'].indexOf(
    wallTier(province),
  );
  // A larger, better walled place is assumed to hold more men, because it did.
  return Math.round(militia * (size * 0.8 + Math.max(0, walls) * 0.5));
}
