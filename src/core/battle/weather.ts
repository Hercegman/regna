/**
 * The weather, and the hour the battle is fought at.
 *
 * A medieval battle was not fought on a flat green field at noon. It was
 * fought in whatever the morning gave, and the two things that decided more
 * fights than any general's plan were the ground underfoot and whether the
 * men could see. Crecy was fought after a thunderstorm that had soaked the
 * Genoese crossbowmen's strings, Agincourt across a ploughed field turned to
 * mud, Barnet in a fog thick enough that one Lancastrian wing shot into
 * another and the cry of treason broke the army. Towton was fought in
 * driving snow, into the faces of one side and the backs of the other.
 *
 * So this is not a filter over the picture. Every value below is read by the
 * simulation, and the same conditions that dim the field also slacken the
 * bowstrings, wet the powder, mire the horses, tire the men and shorten the
 * tempers of everybody standing in it.
 *
 * Nothing here draws from the battle's own generator. Conditions are rolled
 * once from the battle's seed before a shot is fired, so a saved campaign
 * fights the same battle in the same weather every time it is replayed.
 */
import type { Terrain } from '../types';
import { clamp } from '../types';
import { Rng } from '../rng';
import { BATTLE_TIME_LIMIT } from './types';

export type Weather = 'clear' | 'overcast' | 'rain' | 'storm' | 'snow' | 'fog';

/**
 * Four hours rather than a clock.
 *
 * Armies deployed at first light and fought in the morning, because forming
 * up took hours and because nobody wanted to be caught doing it in the dark.
 * Dawn and dusk are the edges of that, and a night battle is a rare and
 * usually accidental thing — which is why it is rare here.
 */
export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';

/** What the conditions are worth, once, so nothing has to work it out twice. */
export interface Conditions {
  /**
   * How far a man can pick another man out of the ground behind him, in
   * metres. It caps missile range and it is what the field is drawn through.
   */
  readonly visibility: number;
  /** Multiplier on missile accuracy: wind, wet strings, and poor light. */
  readonly aim: number;
  /** Multiplier on firearms only. Wet powder does not go off. */
  readonly powder: number;
  /** Multiplier on movement. Mud, snow and ground nobody can see. */
  readonly footing: number;
  /** Multiplier on how fast men tire. Heat, cold and heavy going. */
  readonly toil: number;
  /** Added to every morale threshold on the field. */
  readonly morale: number;
  /** Seconds of usable light the battle begins with. */
  readonly light: number;
}

interface WeatherEffect {
  readonly visibility: number;
  readonly aim: number;
  readonly powder: number;
  readonly footing: number;
  readonly toil: number;
  readonly morale: number;
}

/**
 * What each kind of day does.
 *
 * `visibility` is in metres and is deliberately generous for anything short
 * of fog: the longest-ranged thing in the game shoots 360 metres, so a
 * number above that is the same as no limit at all, and only weather that
 * actually closed a field down is allowed to bite.
 */
const WEATHER: Record<Weather, WeatherEffect> = {
  // Further than the far corner of the field, so a clear day veils nothing:
  // the longest-ranged thing in the game shoots 360 metres, and anything
  // above about two thousand here is the same as no limit at all.
  clear: { visibility: 2600, aim: 1, powder: 1, footing: 1, toil: 1, morale: 0 },
  overcast: { visibility: 2100, aim: 0.97, powder: 1, footing: 1, toil: 0.97, morale: 0 },
  // Rain is the one that beat the Genoese: a wet bowstring loses its cast,
  // and powder that has taken water does not fire at all.
  rain: { visibility: 520, aim: 0.8, powder: 0.3, footing: 0.88, toil: 1.18, morale: -1 },
  storm: { visibility: 330, aim: 0.62, powder: 0.12, footing: 0.8, toil: 1.32, morale: -2.5 },
  // Snow is the worst ground there is and the men are cold before it starts.
  snow: { visibility: 380, aim: 0.78, powder: 0.55, footing: 0.76, toil: 1.4, morale: -2 },
  // Fog leaves the footing alone and takes everything else. A battle in it is
  // fought at the length of a street.
  fog: { visibility: 105, aim: 0.8, powder: 0.95, footing: 0.98, toil: 1, morale: -1.5 },
};

interface HourEffect {
  /** Multiplier on how far anyone can see. */
  readonly sight: number;
  readonly aim: number;
  readonly morale: number;
  readonly light: number;
}

const HOUR: Record<TimeOfDay, HourEffect> = {
  dawn: { sight: 0.62, aim: 0.88, morale: 0, light: BATTLE_TIME_LIMIT },
  day: { sight: 1, aim: 1, morale: 0, light: BATTLE_TIME_LIMIT },
  // A battle begun at dusk has about ten minutes of fighting light. Armies
  // that had not broken each other by dark went back to their fires, and so
  // do these.
  dusk: { sight: 0.7, aim: 0.86, morale: -0.5, light: 11 * 60 },
  // Already dark, so there is no light left to run out: a night battle is
  // fought until somebody breaks, blind, and everyone in it hates it.
  night: { sight: 0.22, aim: 0.55, morale: -3, light: BATTLE_TIME_LIMIT },
};

export function conditionsOf(weather: Weather, hour: TimeOfDay, terrain: Terrain): Conditions {
  const w = WEATHER[weather];
  const h = HOUR[hour];
  // Heat is the one condition that comes off the ground rather than the sky:
  // a clear day in the desert is the hardest marching in the game, and the
  // armies that fought at Hattin lost to it before they lost to anybody.
  const heat = terrain === 'desert' && hour === 'day' && (weather === 'clear' || weather === 'overcast')
    ? 1.3
    : 1;
  return {
    visibility: Math.max(40, w.visibility * h.sight),
    aim: w.aim * h.aim,
    powder: w.powder,
    footing: w.footing * (hour === 'night' ? 0.9 : 1),
    toil: w.toil * heat,
    morale: w.morale + h.morale,
    light: h.light,
  };
}

/** The sky a battle is fought under, drawn once from its own seed. */
export function rollWeather(seed: string, winter: boolean, terrain: Terrain): Weather {
  const rng = new Rng(`${seed}:sky`);
  const weights: Record<Weather, number> = winter
    ? { clear: 16, overcast: 24, rain: 14, storm: 8, snow: 26, fog: 12 }
    : { clear: 42, overcast: 24, rain: 17, storm: 6, snow: 0, fog: 6 };

  // Where the battle is fought decides a great deal of what falls on it.
  if (terrain === 'marsh' || terrain === 'coastal' || terrain === 'forest') weights.fog *= 2.6;
  if (terrain === 'mountains') {
    weights.storm *= 1.6;
    weights.snow *= 1.8;
    weights.clear *= 0.7;
  }
  if (terrain === 'desert') {
    weights.clear *= 2.2;
    weights.snow = 0;
    weights.rain *= 0.15;
    weights.fog *= 0.2;
    weights.storm *= 0.3;
  }
  if (terrain === 'steppe') {
    weights.clear *= 1.3;
    weights.fog *= 0.6;
  }
  const kinds = Object.keys(weights) as Weather[];
  return rng.weighted(kinds, (kind) => weights[kind]);
}

/**
 * The hour it is fought at.
 *
 * Weighted heavily towards the morning, because that is when armies that had
 * spent the night in sight of each other formed up and went at it. A battle
 * at dusk is one that took all day to bring on, and a battle at night is an
 * accident — a camp stormed, a river crossing gone wrong, an assault that
 * went in under the dark on purpose.
 */
export function rollTimeOfDay(seed: string, naval: boolean, assault: boolean): TimeOfDay {
  const rng = new Rng(`${seed}:hour`);
  const weights: Record<TimeOfDay, number> = { dawn: 20, day: 56, dusk: 18, night: 6 };
  // Fleets did not find each other in the dark, and would not have fought if
  // they had.
  if (naval) {
    weights.night = 0;
    weights.dusk *= 0.5;
  }
  // Escalade was a night trade. A storming party went over the wall in the
  // dark because the dark is most of what it had going for it.
  if (assault) {
    weights.night *= 4;
    weights.dawn *= 1.6;
  }
  const hours = Object.keys(weights) as TimeOfDay[];
  return rng.weighted(hours, (hour) => weights[hour]);
}

/** How much of a thing at this distance can be made out at all, 0 to 1. */
export function clarity(conditions: Conditions, metres: number): number {
  const full = conditions.visibility * 0.72;
  const gone = conditions.visibility * 1.25;
  if (metres <= full) return 1;
  if (metres >= gone) return 0;
  return clamp((gone - metres) / (gone - full), 0, 1);
}

/** What to call it in the interface. */
export const WEATHER_NAME: Record<Weather, string> = {
  clear: 'Clear',
  overcast: 'Overcast',
  rain: 'Rain',
  storm: 'Storm',
  snow: 'Snow',
  fog: 'Fog',
};

export const HOUR_NAME: Record<TimeOfDay, string> = {
  dawn: 'Dawn',
  day: 'Day',
  dusk: 'Dusk',
  night: 'Night',
};
