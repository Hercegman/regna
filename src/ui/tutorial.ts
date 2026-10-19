/**
 * The opening guide.
 *
 * The interface has eight panels and nine systems behind them, and until now
 * it said nothing at all about how any of it is played. This is not a scripted
 * sequence that takes the game away from the player: it is a short list of the
 * things a ruler has to be able to do, each one marked done the moment the
 * player does it, in whatever order he likes.
 *
 * Every step's completion is a pure function of the campaign state, which is
 * what makes the guide testable and what stops it from ever disagreeing with
 * the game: a step is complete because the thing happened, not because a
 * button was pressed.
 */
import type { CampaignState } from '../core/campaign';
import { provincesOf } from '../core/campaign';
import type { FactionId } from '../core/types';
import { agentsOf } from '../core/campaign/agents';

/**
 * What a step is judged against.
 *
 * Most steps are answered by the campaign itself: a building under
 * construction, a caravan on the road, a man in the field. A few cannot be —
 * nothing in the state records that the player looked at a panel — so the
 * screen also reports what has actually been opened and ordered. Keeping both
 * in one plain object leaves every step a pure function, which is what makes
 * them testable and what stops the guide ever disagreeing with the game.
 */
export interface GuideContext {
  readonly state: CampaignState;
  readonly me: FactionId;
  /** Things only the interface can know: panels opened, orders given. */
  readonly seen: ReadonlySet<string>;
}

export interface GuideStep {
  readonly id: string;
  readonly title: string;
  /** Why a ruler would care, in one sentence. */
  readonly why: string;
  /** Where to do it. */
  readonly where: string;
  readonly done: (ctx: GuideContext) => boolean;
}

/**
 * True when the realm is building something, anywhere.
 *
 * The interface's own record is accepted as well, because a project finishes:
 * a step that un-ticks itself the moment the thing is done would be a poor
 * teacher.
 */
function building({ state, me, seen }: GuideContext): boolean {
  if (seen.has('build')) return true;
  return provincesOf(state, me).some((province) => province.construction !== undefined);
}

function mustering({ state, me, seen }: GuideContext): boolean {
  if (seen.has('recruit')) return true;
  return provincesOf(state, me).some(
    (province) => province.recruitQueue.length > 0 || province.shipyardQueue.length > 0,
  );
}

export const GUIDE_STEPS: readonly GuideStep[] = [
  {
    id: 'select',
    title: 'Look at a province',
    why:
      'Everything a realm does happens in a province: it is where the money comes from, ' +
      'where soldiers are raised, and what the whole war is about.',
    where: 'Click any province on the map.',
    done: ({ seen }) => seen.has('province'),
  },
  {
    id: 'build',
    title: 'Start building something',
    why:
      'A building is a standing charge that pays for itself: order, income, growth, walls, ' +
      'or the institution that produces an agent. Nothing else compounds the way this does.',
    where: 'Province panel → Build.',
    done: building,
  },
  {
    id: 'recruit',
    title: 'Raise a regiment',
    why:
      'Troops take seasons to muster, so they have to be ordered before they are needed. ' +
      'A garrison holds a town; an army in the field is what takes someone else\'s.',
    where: 'Province panel → Recruit.',
    done: mustering,
  },
  {
    id: 'turn',
    title: 'End the turn',
    why:
      'Two turns a year, summer and winter. Construction advances, troops muster, money is ' +
      'counted, and every other realm in Europe moves at once.',
    where: 'The End turn button, or Enter.',
    done: ({ state }) => state.turn > 1,
  },
  {
    id: 'march',
    title: 'March an army',
    why:
      'Select an army, press March, and choose a highlighted province. Moving into a defended ' +
      'enemy province offers battle; a walled settlement has to be stormed or starved out.',
    where: 'Province panel → an army → March.',
    done: ({ seen }) => seen.has('march'),
  },
  {
    id: 'trade',
    title: 'Send a caravan',
    why:
      'A trade road is a wager, not an allowance: it costs money now and pays more on arrival, ' +
      'less a toll to every lord whose land it crosses. War shuts a road rather than taxing it.',
    where: 'Province panel → Trade.',
    done: ({ state, me }) =>
      [...state.caravans.values()].some((caravan) => caravan.faction === me),
  },
  {
    id: 'agent',
    title: 'Put a man in the field',
    why:
      'A spy, an envoy, a priest or a factor goes where an army cannot and nobody declares war ' +
      'over him. What he risks is himself.',
    where: 'Province panel → Agents.',
    done: ({ state, me }) => agentsOf(state, me).length > 0,
  },
  {
    id: 'realm',
    title: 'Read the realm',
    why:
      'The Realm panel holds the accounts, your house and who would inherit it, your standing ' +
      'with the authority of your faith, and every province you hold. It is the whole state on ' +
      'one page.',
    where: 'The Realm tab.',
    done: ({ seen }) => seen.has('tab:realm'),
  },
];

const DONE_KEY = 'regna.guide.dismissed';

/** Whether the player has put the guide away for good. */
export function guideDismissed(): boolean {
  try {
    return window.localStorage.getItem(DONE_KEY) === '1';
  } catch {
    // A browser with storage switched off simply gets the guide every time,
    // which is a better failure than a crash on the opening screen.
    return false;
  }
}

export function dismissGuide(): void {
  try {
    window.localStorage.setItem(DONE_KEY, '1');
  } catch {
    // Nothing to be done; the guide is dismissible again next session.
  }
}

export function restoreGuide(): void {
  try {
    window.localStorage.removeItem(DONE_KEY);
  } catch {
    // As above.
  }
}

/** How much of the guide the player has worked through. */
export function guideProgress(
  ctx: GuideContext,
): { done: number; total: number; next: GuideStep | undefined } {
  let done = 0;
  let next: GuideStep | undefined;
  for (const step of GUIDE_STEPS) {
    if (step.done(ctx)) {
      done += 1;
    } else if (!next) {
      next = step;
    }
  }
  return { done, total: GUIDE_STEPS.length, next };
}
