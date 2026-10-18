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

export function newCampaign(options: CampaignOptions = {}): CampaignState {
  const state = createCampaign(options);
  initialiseRelations(state);
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
