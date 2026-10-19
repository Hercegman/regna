/**
 * Campaign entry points.
 *
 * `createCampaign` in `state.ts` builds the board; this module composes it with
 * the subsystems that need to be seeded afterwards, so that nothing in
 * `state.ts` has to import the rules modules that import it.
 */
import type { CampaignOptions, CampaignState } from './state';
import { commitRng, createCampaign, rngFor } from './state';
import { foundCourt } from './dynasty';
import { INDEPENDENT_ID } from '../data/factions';
import { initialiseRelations } from './diplomacy';
import { movementBudget } from './actions';
import { fleetMovementBudget } from './naval';

export function newCampaign(options: CampaignOptions = {}): CampaignState {
  const state = createCampaign(options);
  initialiseRelations(state);
  // Every living realm starts as a house rather than as one man: a ruler, his
  // wife, and whatever children the marriage has had time for. Done here for
  // the same reason as the rest of this file — state.ts must not import the
  // rules modules that import it.
  const rng = rngFor(state);
  for (const [id, faction] of state.factions) {
    if (!faction.alive || id === INDEPENDENT_ID) continue;
    const leader = faction.characters.find((character) => character.leader);
    if (leader) foundCourt(state, id, leader, rng);
  }
  commitRng(state, rng);
  // Armies are created before the rules modules are available to state.ts, so
  // their first movement allowance is granted here. Without it the opening
  // turn would be the only one in the campaign in which nobody could march.
  for (const army of state.armies.values()) army.movement = movementBudget(state, army);
  for (const fleet of state.fleets.values()) fleet.movement = fleetMovementBudget(state, fleet);
  return state;
}

export * from './state';
export * from './economy';
export * from './actions';
export * from './diplomacy';
export * from './resolve';
export * from './emergence';
export * from './turn';
export * from './naval';
export * from './caravans';
export * from './mercenaries';
export * from './faith';
export * from './agents';
export * from './dynasty';
export * from './civilwar';
export * from './sight';
export * from './save';
export { takeAiTurn } from './ai';
