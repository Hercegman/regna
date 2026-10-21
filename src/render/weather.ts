/**
 * The sky over a battle.
 *
 * Everything here is drawn from `BattleSetup.weather` and `timeOfDay`, which
 * the simulation is already reading: the fog that thins the picture is the
 * same fog that stopped the archers shooting, and the mud you cannot see is
 * the mud the horses are labouring in. There is no decorative weather —
 * if it is on the screen it is in the model.
 *
 * Two parts to it. A wash over the finished picture, which is what the hour
 * and the cloud do to every colour on the field at once; and what is falling
 * through the air, which is drawn as its own thing because rain moves and a
 * wash does not.
 */
import type { BattleState } from '../core/battle/sim';
import type { Side } from '../core/battle/types';
import { clarity } from '../core/battle/weather';
import type { TimeOfDay, Weather } from '../core/battle/weather';

interface Wash {
  /** Multiplied into everything already drawn. */
  readonly tint: string;
  /**
   * Screened in before the tint, for the one kind of weather that makes a
   * field brighter rather than darker. Snow lies on the ground, and a wash
   * that only ever darkens cannot say so: the first version of this drew a
   * snowstorm as mud.
   */
  readonly lift: string | undefined;
  /** A veil laid over the top, strongest at the far edge of the field. */
  readonly haze: string | undefined;
  readonly hazeFar: number;
  readonly hazeNear: number;
}

/**
 * What the hour does to the light.
 *
 * Multiply rather than a flat overlay, because a dark field is not a grey
 * sheet over a bright one: the colours that were bright go dim and the ones
 * that were dim go black, which is the difference between dusk and a dirty
 * window.
 */
const HOUR_TINT: Record<TimeOfDay, string | undefined> = {
  // First light comes up cold and low and takes the saturation out of
  // everything it has not reached yet.
  dawn: '#b5aec4',
  day: undefined,
  // The one hour of the day that is warmer than noon and darker than it.
  dusk: '#c08a5e',
  // Moonlight. Blue because the eye stops reading colour before it stops
  // reading shape, and a night field is shapes.
  night: '#59689c',
};

const WEATHER_WASH: Record<Weather, Wash> = {
  clear: { tint: '#ffffff', lift: undefined, haze: undefined, hazeFar: 0, hazeNear: 0 },
  overcast: { tint: '#bcc0c3', lift: undefined, haze: undefined, hazeFar: 0, hazeNear: 0 },
  rain: { tint: '#93a0ad', lift: undefined, haze: '#8e9ba6', hazeFar: 0.34, hazeNear: 0.06 },
  storm: { tint: '#717d8b', lift: undefined, haze: '#6f7a86', hazeFar: 0.5, hazeNear: 0.12 },
  // The only weather that lifts the ground instead of darkening it, because
  // the ground has snow on it.
  snow: { tint: '#e8eef3', lift: '#3d4650', haze: '#dde3e7', hazeFar: 0.5, hazeNear: 0.18 },
  // Fog is almost all haze and hardly any tint: it does not darken the field,
  // it takes the far half of it away.
  fog: { tint: '#dfe2e2', lift: undefined, haze: '#c9cecf', hazeFar: 0.88, hazeNear: 0.26 },
};

/**
 * A thunderstorm lights the field up every few seconds.
 *
 * Deterministic in the battle's own clock rather than in wall time, so a
 * paused battle is a still picture — including the lightning, which is the
 * rule everything else on this field already follows.
 */
export function lightning(state: BattleState, time: number): number {
  if (state.setup.weather !== 'storm') return 0;
  const period = 7.3;
  const phase = time % period;
  if (phase < 0.14) return 1 - phase / 0.14;
  // The second stroke, which is what makes it lightning rather than a lamp.
  if (phase > 0.2 && phase < 0.3) return (1 - (phase - 0.2) / 0.1) * 0.55;
  return 0;
}

/** The wash, laid over the finished picture. */
export function drawSky(
  ctx: CanvasRenderingContext2D,
  state: BattleState,
  width: number,
  height: number,
  time: number,
): void {
  const wash = WEATHER_WASH[state.setup.weather];
  const hour = HOUR_TINT[state.setup.timeOfDay];

  ctx.save();
  if (wash.lift) {
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = wash.lift;
    ctx.fillRect(0, 0, width, height);
  }
  if (wash.tint !== '#ffffff') {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = wash.tint;
    ctx.fillRect(0, 0, width, height);
  }
  if (hour) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = hour;
    ctx.fillRect(0, 0, width, height);
  }
  const flash = lightning(state, time);
  if (flash > 0) {
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = `rgba(214, 222, 236, ${(flash * 0.55).toFixed(3)})`;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.globalCompositeOperation = 'source-over';
  if (wash.haze) {
    // Thicker towards the top of the screen, because the top of the screen is
    // the far end of the field. It is the cheapest depth there is and it is
    // the one thing that says the fog has a distance in it rather than being
    // a sheet of paper in front of the lens.
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, shade(wash.haze, wash.hazeFar));
    gradient.addColorStop(1, shade(wash.haze, wash.hazeNear));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

function shade(colour: string, alpha: number): string {
  const value = parseInt(colour.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha.toFixed(3)})`;
}

/**
 * What is actually falling.
 *
 * Drawn from a hash of the drop's own number and the battle clock, so no
 * drop is stored anywhere and a paused battle holds the rain where it is.
 * That is the same rule the men follow — there is no animation state on this
 * field, only functions of the time.
 */
export function drawPrecipitation(
  ctx: CanvasRenderingContext2D,
  state: BattleState,
  width: number,
  height: number,
  time: number,
): void {
  const weather = state.setup.weather;
  if (weather !== 'rain' && weather !== 'storm' && weather !== 'snow') return;
  const night = state.setup.timeOfDay === 'night';

  if (weather === 'snow') {
    // Snow drifts. Slow, with a sideways sway that is different for every
    // flake, which is the whole of what tells it from rain.
    const flakes = Math.min(900, Math.round((width * height) / 420));
    ctx.fillStyle = night ? 'rgba(206, 216, 230, 0.55)' : 'rgba(246, 249, 252, 0.8)';
    for (let i = 0; i < flakes; i++) {
      const seed = hash(i);
      const fall = 14 + seed * 22;
      const y = ((hash(i + 9301) * height + time * fall) % (height + 12)) - 6;
      const sway = Math.sin(time * (0.7 + seed) + seed * 11) * 6;
      const x = (hash(i + 4933) * width + sway + width) % width;
      const size = seed > 0.8 ? 2 : 1;
      ctx.fillRect(Math.round(x), Math.round(y), size, size);
    }
    return;
  }

  const heavy = weather === 'storm';
  const drops = Math.min(1600, Math.round((width * height) / (heavy ? 170 : 300)));
  const fall = heavy ? 620 : 420;
  const slant = heavy ? 0.42 : 0.2;
  const length = heavy ? 9 : 6;
  ctx.strokeStyle = night
    ? 'rgba(168, 182, 202, 0.28)'
    : heavy
      ? 'rgba(196, 208, 222, 0.42)'
      : 'rgba(206, 216, 228, 0.32)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < drops; i++) {
    const seed = hash(i);
    const speed = fall * (0.8 + seed * 0.4);
    const y = ((hash(i + 7919) * height + time * speed) % (height + length)) - length;
    const x = (hash(i + 2621) * width - y * slant + width * 2) % width;
    ctx.moveTo(Math.round(x), Math.round(y));
    ctx.lineTo(Math.round(x - length * slant), Math.round(y + length));
  }
  ctx.stroke();
}

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * How plainly a thing at this distance can be seen from the viewer's side.
 *
 * The same number the simulation uses to decide whether a regiment can be
 * shot at, applied to whether it can be drawn. It takes sight away from the
 * player rather than giving it to the machine — the battle AI has been put
 * under the identical limit, and both of them are looking at `conditions`.
 *
 * Measured from the nearest of the viewer's own regiments, because that is
 * who is doing the looking. Your own men are never veiled: you know where
 * you put them.
 */
export function veilOf(
  state: BattleState,
  position: { x: number; y: number },
  side: Side | undefined,
  unitSide: Side,
): number {
  if (!side || unitSide === side) return 1;
  let nearest = Infinity;
  for (const unit of state.units) {
    if (unit.side !== side || unit.fled || unit.stance === 'destroyed') continue;
    const gap = Math.hypot(unit.position.x - position.x, unit.position.y - position.y);
    if (gap < nearest) nearest = gap;
  }
  if (nearest === Infinity) return 1;
  return clarity(state.conditions, nearest);
}
