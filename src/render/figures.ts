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

/**
 * What he is doing.
 *
 * The two steps are mirrors and play either side of idle, which is a
 * four-beat walk out of three pictures. The two flights are mirrors too and
 * play straight against each other, because a man running has no moment of
 * standing still in him — and he has thrown away his shield, which is the
 * one thing that reads as a rout rather than as a march the wrong way.
 */
export type Pose = 'idle' | 'stepa' | 'stepb' | 'fight' | 'fleea' | 'fleeb';

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

/**
 * One man.
 *
 * `kit` is which of the two he is wearing: a surcoat of his lord's colours
 * over a kite shield under a flat helm, or mail with a coloured band over a
 * round shield under a conical one. It is the cheapest variety there is —
 * two renders instead of one — and it is the difference between a regiment
 * and the same man drawn a hundred and twenty times.
 */
export function figureSprite(
  kind: Figure,
  kit: number,
  facing: number,
  pose: Pose,
): SpriteName {
  return `${kind}_${kit}_${facing}_${pose}` as SpriteName;
}

/** Which kit a man wears, fixed to where he stands in his own block. */
export function kitFor(file: number, rank: number): number {
  const hash = (file * 73856093) ^ (rank * 19349663);
  return (hash >>> 3) & 1;
}

/**
 * Which of the eight renders to use for a facing.
 *
 * The field is drawn squashed to half its depth, so a bearing on the ground
 * is not the bearing you see: a man walking due north on the field goes up
 * the screen at twice the angle he would on a map. The squash goes in here,
 * and what comes out is the eighth of the screen's own compass he is facing.
 * Direction 0 is up and to the right, and they run clockwise.
 *
 * Eight rather than four, because four means a regiment wheeling turns in
 * right angles, and a line of battle spends most of its time at an angle to
 * the line it is fighting.
 */
export function facingIndex(facing: number, squash: number): number {
  const screen = Math.atan2(Math.sin(facing) * squash, Math.cos(facing));
  const degrees = (screen * 180) / Math.PI;
  return ((Math.round((degrees + 45) / 45) % 8) + 8) % 8;
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
  if (stance === 'routing') {
    // Faster than a march and with no stand in it: he is running.
    return Math.floor(seconds * 5.5 + index * 0.43) % 2 === 0 ? 'fleea' : 'fleeb';
  }
  if (stance === 'advancing' || stance === 'charging') {
    const beat = Math.floor(seconds * (stance === 'charging' ? 4.5 : 2.8) + index * 0.37) % 4;
    return beat === 0 ? 'stepa' : beat === 2 ? 'stepb' : 'idle';
  }
  return 'idle';
}
