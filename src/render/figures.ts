/**
 * Which figure a kind of soldier is drawn as, which way it is facing, and
 * what it is doing.
 *
 * One place, because two screens ask the same question: the battlefield,
 * which draws a hundred of them in ranks and wants them facing the men they
 * are fighting, and the card under an army, which draws one standing still.
 */
import type { UnitClass, UnitTypeId } from '../core/types';
import type { SpriteName } from './iso/sprites';

/**
 * The eight kinds the sheet has a man for, and the two it has a machine for.
 *
 * The engines are here rather than in a corner of their own because a siege
 * train stands in the line like everything else and the renderer should not
 * have to ask twice. They carry their own crew in the sprite, which is why
 * there is no `kit` for them: a trebuchet is not wearing anything.
 */
export type Figure =
  | 'spearman' | 'swordsman' | 'pikeman' | 'archer'
  | 'crossbowman' | 'gunner' | 'knight' | 'lighthorse'
  | 'engine' | 'cannon';

/** True for the two that are machines, which have one kit and two poses. */
export function isEngine(kind: Figure): boolean {
  return kind === 'engine' || kind === 'cannon';
}

/**
 * What he is doing.
 *
 * The two steps are mirrors, and `pass` is the beat between them: the leg
 * that has just swung through coming under the body with the knee up before
 * it goes out again. A four-beat walk out of four pictures — step, pass,
 * other step, pass.
 *
 * It used to be three, with `idle` standing in for the pass, and that worked
 * for exactly as long as the legs were straight posts: a man standing still
 * and a man with his weight over one foot are the same picture when neither
 * has a knee. They are not the same picture now, and a march that stopped
 * dead twice a cycle was the first thing anybody noticed.
 *
 * The two flights are mirrors too and play straight against each other,
 * because a man running has no moment of standing still in him — and he has
 * thrown away his shield, which is the one thing that reads as a rout rather
 * than as a march the wrong way.
 */
export type Pose = 'idle' | 'pass' | 'stepa' | 'stepb' | 'fight' | 'fleea' | 'fleeb';

/**
 * Which figure a kind of soldier is drawn as.
 *
 * The type id matters for exactly one class. A siege train is a ballista, a
 * catapult, a trebuchet, a bombard or a culverin, and the first three are a
 * frame with an arm on it while the last two are a barrel on a bed — which
 * is two silhouettes, not five and not one. Until the sheet had either of
 * them every engine on the field was drawn as a swordsman.
 */
export function figureFor(unitClass: UnitClass, type?: UnitTypeId): Figure {
  if (unitClass === 'siege_engine') {
    return type === 'bombard' || type === 'culverin' ? 'cannon' : 'engine';
  }
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
  if (isEngine(kind)) {
    // One kit, and only two things it does: wait, and loose.
    const working = pose === 'fight' ? 'fight' : 'idle';
    return `${kind}_0_${facing}_${working}` as SpriteName;
  }
  return `${kind}_${kit}_${facing}_${pose}` as SpriteName;
}

/** How long a man takes to go down, in seconds of battle time. */
export const FALL_SECONDS = 1;

/**
 * A man in the act of being killed.
 *
 * Two frames, and then he is a body. He is not any particular kind of
 * soldier here and the sheet does not render him as one: the first thing a
 * man lets go of is what he was holding, so a spearman going down and an
 * archer going down are the same picture. See `falling` in the sprite tool.
 *
 * `since` is how long ago he was hit. Past `FALL_SECONDS` there is no sprite
 * for him and the caller should be drawing `fallen` instead.
 */
export function fallingSprite(kit: number, facing: number, since: number): SpriteName {
  const frame = since < FALL_SECONDS * 0.45 ? 'falla' : 'fallb';
  return `falling_${kit}_${facing}_${frame}` as SpriteName;
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
    return beat === 0 ? 'stepa' : beat === 2 ? 'stepb' : 'pass';
  }
  // Standing, which is not the same as being a statue.
  //
  // A regiment waiting in line was every man in one pose, held exactly, for
  // as long as the order lasted — and a hundred identical frozen figures is
  // the one arrangement that reads as a texture rather than as men. Nothing
  // dramatic is wanted here: a man shifts his weight onto the other foot
  // every ten seconds or so, each on his own clock, so at any moment a few
  // in the block are moving and the rest are not. That is what a body of men
  // standing in a field actually looks like from a distance.
  return Math.floor(seconds * 0.6 + index * 0.31) % 7 === 0 ? 'pass' : 'idle';
}
