/**
 * Campaign entry points.
 *
 * `createCampaign` in `state.ts` builds the board; this module composes it with
 * the subsystems that need to be seeded afterwards, so that nothing in
 * `state.ts` has to import the rules modules that import it.
 */
import type { CampaignOptions, CampaignState } from './state';
import { createCampaign } from './state';
import { initialiseRelations } from './diplomacy';
import { movementBudget } from './actions';

export function newCampaign(options: CampaignOptions = {}): CampaignState {
  const state = createCampaign(options);
  initialiseRelations(state);
  // Armies are created before the rules modules are available to state.ts, so
  // their first movement allowance is granted here. Without it the opening
  // turn would be the only one in the campaign in which nobody could march.
  for (const army of state.armies.values()) army.movement = movementBudget(state, army);
  return state;
}

export * from './state';
export * from './economy';
export * from './actions';
export * from './diplomacy';
export * from './resolve';
export * from './emergence';
export * from './turn';
export { takeAiTurn } from './ai';
