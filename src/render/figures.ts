/**
 * Which figure a kind of soldier is drawn as, which way it is facing, and
 * what it is doing.
 *
 * One place, because two screens ask the same question: the battlefield,
 * which draws a hundred of them in ranks and wants them facing the men they
 * are fighting, and the card under an army, which draws one standing still.
 */
import type { UnitClass } from '../core/types';
import type { SpriteName } from './iso/sprites';

/** The eight kinds the sheet has a man for. */
export type Figure =
  | 'spearman' | 'swordsman' | 'pikeman' | 'archer'
  | 'crossbowman' | 'gunner' | 'knight' | 'lighthorse';

/** What he is doing. The two steps are mirrors and play either side of idle. */
export type Pose = 'idle' | 'stepa' | 'stepb' | 'fight';

export function figureFor(unitClass: UnitClass): Figure {
  switch (unitClass) {
    case 'spearmen':
      return 'spearman';
    case 'pikemen':
      return 'pikeman';
    case 'heavy_infantry':
    case 'light_infantry':
      return 'swordsman';
    case 'archers':
    case 'javelinmen':
      return 'archer';
    case 'crossbowmen':
      return 'crossbowman';
    case 'gunpowder_infantry':
      return 'gunner';
    case 'heavy_cavalry':
    case 'general':
      return 'knight';
    case 'light_cavalry':
    case 'horse_archers':
    case 'camel_cavalry':
      return 'lighthorse';
    default:
      return 'swordsman';
  }
}

export function figureSprite(kind: Figure, facing: number, pose: Pose): SpriteName {
  return `${kind}_${facing}_${pose}` as SpriteName;
}

/**
 * Which of the four renders to use for a facing.
 *
 * The field is drawn squashed to half its depth, so a bearing on the ground
 * is not the bearing you see: a man walking due north on the field goes up
 * the screen at twice the angle he would on a map. The squash goes in here,
 * and what comes out is the quarter of the screen's own compass he is
 * facing. Direction 0 is up and to the right, and they run clockwise.
 */
export function facingIndex(facing: number, squash: number): number {
  const screen = Math.atan2(Math.sin(facing) * squash, Math.cos(facing));
  const degrees = (screen * 180) / Math.PI;
  return ((Math.round((degrees + 45) / 90) % 4) + 4) % 4;
}

/**
 * The pose a man in this regiment is in, this second.
 *
 * Every man gets his own phase, so a marching block is a crowd of men out of
 * step with each other rather than a chorus line. A four-beat cycle out of
 * three pictures: step, stand, other step, stand.
 */
export function poseFor(
  stance: string,
  seconds: number,
  index: number,
): Pose {
  if (stance === 'melee' || stance === 'skirmishing') {
    // Not all at once: a line in contact has men swinging and men recovering.
    return Math.floor(seconds * 2.2 + index * 0.41) % 2 === 0 ? 'fight' : 'idle';
  }
  if (stance === 'advancing' || stance === 'charging' || stance === 'routing') {
    const beat = Math.floor(seconds * (stance === 'charging' ? 4.5 : 2.8) + index * 0.37) % 4;
    return beat === 0 ? 'stepa' : beat === 2 ? 'stepb' : 'idle';
  }
  return 'idle';
}
