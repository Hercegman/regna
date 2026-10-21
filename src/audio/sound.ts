/**
 * Sound, made rather than recorded.
 *
 * The sprites on this project are modelled and rendered from a script and the
 * coats of arms are drawn from blazons, for the same reason in both cases:
 * nothing in the repository should be a binary that somebody drew once and
 * nobody can change. Sound gets the same treatment. There is no audio file
 * anywhere in here. A volley of arrows is filtered noise with a sweep on it,
 * a sword on a shield is a noise burst and a ring, a horn is two detuned saws
 * through a low-pass, and thunder is the same noise with the top taken off
 * and a long tail. All of it is a few hundred lines and it weighs nothing.
 *
 * The rules it follows:
 *
 *   - It never starts itself. Browsers will not allow it and neither will I:
 *     the context is created on the first click the player makes and not
 *     before, so a page that is opened and left alone is silent.
 *   - It never reaches into the model. Everything here reads state; nothing
 *     here writes any, and the battle sounds the same whether the speakers
 *     are on or off.
 *   - Every voice is short and disposable. Oscillators and sources are
 *     started, scheduled to stop, and dropped; the only long-lived nodes are
 *     the handful of beds in `Bed`.
 */

const STORE = 'regna:muted';

let context: AudioContext | undefined;
let master: GainNode | undefined;
let noise: AudioBuffer | undefined;
let muted = read();

function read(): boolean {
  try {
    return window.localStorage.getItem(STORE) === '1';
  } catch {
    return false;
  }
}

export function soundMuted(): boolean {
  return muted;
}

export function setSoundMuted(value: boolean): void {
  muted = value;
  try {
    window.localStorage.setItem(STORE, value ? '1' : '0');
  } catch {
    // A browser with storage switched off still gets sound; it just forgets.
  }
  if (master && context) {
    master.gain.cancelScheduledValues(context.currentTime);
    master.gain.setTargetAtTime(value ? 0 : VOLUME, context.currentTime, 0.05);
  }
}

/** Loud enough to hear under a laptop fan, quiet enough not to be the point. */
const VOLUME = 0.38;

/**
 * Brings the audio up, on a gesture.
 *
 * Called from a click or a key, which is the only moment a browser will let
 * a context start. Safe to call on every one of them: after the first it
 * only nudges a suspended context awake, which is what happens when a tab
 * has been in the background.
 */
export function wakeAudio(): void {
  if (!context) {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      context = new Ctor();
    } catch {
      return;
    }
    master = context.createGain();
    master.gain.value = muted ? 0 : VOLUME;
    master.connect(context.destination);
  }
  if (context.state === 'suspended') void context.resume().catch(() => undefined);
}

export function audioOn(): boolean {
  return Boolean(context && master && !muted && context.state === 'running');
}

function out(): { ac: AudioContext; bus: GainNode } | undefined {
  if (!context || !master || muted) return undefined;
  if (context.state !== 'running') return undefined;
  return { ac: context, bus: master };
}

/**
 * Two seconds of white noise, built once.
 *
 * Nearly everything on a battlefield is noise with something done to it.
 * Steel on steel is noise with a narrow band left in, rain is noise with the
 * bottom gone, thunder is noise with the top gone, and a crowd is noise with
 * most of it gone and a slow wobble on what is left.
 */
function noiseOf(ac: AudioContext): AudioBuffer {
  if (!noise || noise.sampleRate !== ac.sampleRate) {
    const frames = Math.floor(ac.sampleRate * 2);
    noise = ac.createBuffer(1, frames, ac.sampleRate);
    const data = noise.getChannelData(0);
    // A seeded walk rather than Math.random, so the same hiss comes out of
    // the same machine every time and a recording of the game is comparable
    // with the last one.
    let seed = 0x2f6e2b1;
    for (let i = 0; i < frames; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = (seed / 0x80000000 - 1) * 0.6;
    }
  }
  return noise;
}

export interface BurstOptions {
  /** Seconds from now. */
  readonly delay?: number;
  readonly duration: number;
  readonly gain: number;
  readonly type: BiquadFilterType;
  readonly frequency: number;
  /** Where the filter ends up, for a sweep. */
  readonly sweepTo?: number;
  readonly q?: number;
  /** 0 for a flat tail, 1 for an immediate snap. */
  readonly snap?: number;
}

/** A shaped handful of noise: the workhorse of the whole file. */
export function burst(options: BurstOptions): void {
  const o = out();
  if (!o) return;
  const { ac, bus } = o;
  const at = ac.currentTime + (options.delay ?? 0);
  const source = ac.createBufferSource();
  source.buffer = noiseOf(ac);
  // Start somewhere inside the buffer, so repeated bursts are not the same
  // two hundred milliseconds of hiss over and over.
  source.loop = true;
  const filter = ac.createBiquadFilter();
  filter.type = options.type;
  filter.frequency.setValueAtTime(options.frequency, at);
  if (options.sweepTo !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, options.sweepTo), at + options.duration);
  }
  filter.Q.value = options.q ?? 1;
  const gain = ac.createGain();
  const attack = Math.max(0.002, options.duration * (1 - (options.snap ?? 0.85)) * 0.5);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, options.gain), at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + options.duration);
  source.connect(filter).connect(gain).connect(bus);
  source.start(at, (at * 7.3) % 1.8);
  source.stop(at + options.duration + 0.02);
}

export interface ToneOptions {
  readonly delay?: number;
  readonly duration: number;
  readonly gain: number;
  readonly frequency: number;
  readonly slideTo?: number;
  readonly type?: OscillatorType;
}

/** One pitched voice, for the things on a field that have a pitch. */
export function tone(options: ToneOptions): void {
  const o = out();
  if (!o) return;
  const { ac, bus } = o;
  const at = ac.currentTime + (options.delay ?? 0);
  const osc = ac.createOscillator();
  osc.type = options.type ?? 'sine';
  osc.frequency.setValueAtTime(options.frequency, at);
  if (options.slideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, options.slideTo), at + options.duration);
  }
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, options.gain), at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + options.duration);
  osc.connect(gain).connect(bus);
  osc.start(at);
  osc.stop(at + options.duration + 0.02);
}

// ---------------------------------------------------------------------------
// The things a battlefield actually makes
// ---------------------------------------------------------------------------

/** Steel on steel and on shield-boards: the sound of a line in contact. */
export function clash(pitch = 1): void {
  burst({ duration: 0.07, gain: 0.16, type: 'bandpass', frequency: 2400 * pitch, q: 1.4 });
  tone({ duration: 0.13, gain: 0.05, frequency: 1500 * pitch, slideTo: 1200 * pitch, type: 'triangle' });
}

/** Something heavy meeting something soft: a body, a hoof, a ram. */
export function thud(pitch = 1): void {
  burst({ duration: 0.16, gain: 0.13, type: 'lowpass', frequency: 260 * pitch, q: 0.7, snap: 0.9 });
  tone({ duration: 0.12, gain: 0.07, frequency: 90 * pitch, slideTo: 48 * pitch });
}

/**
 * A volley of arrows.
 *
 * The release and then the flight: a short rattle of staves, and the hiss of
 * a few hundred shafts going away from you, which is a sweep upward in pitch
 * because the sound of them leaving arrives before the sound of them high.
 */
export function volleyArrows(weight = 1): void {
  burst({ duration: 0.09, gain: 0.1 * weight, type: 'bandpass', frequency: 1100, q: 0.8 });
  burst({
    delay: 0.05,
    duration: 0.45,
    gain: 0.075 * weight,
    type: 'bandpass',
    frequency: 900,
    sweepTo: 3200,
    q: 1.1,
    snap: 0.3,
  });
}

/** A crossbow battery: a harder, drier snap and no flight to speak of. */
export function volleyBolts(weight = 1): void {
  burst({ duration: 0.06, gain: 0.12 * weight, type: 'bandpass', frequency: 2000, q: 2.4 });
  burst({ delay: 0.03, duration: 0.2, gain: 0.05 * weight, type: 'highpass', frequency: 1800 });
}

/** Powder. The one thing on a medieval field that is louder than everybody. */
export function volleyGuns(weight = 1): void {
  burst({ duration: 0.3, gain: 0.3 * weight, type: 'lowpass', frequency: 900, q: 0.6, snap: 0.95 });
  tone({ duration: 0.25, gain: 0.2 * weight, frequency: 110, slideTo: 38 });
  burst({ delay: 0.02, duration: 0.5, gain: 0.07 * weight, type: 'lowpass', frequency: 400, snap: 0.4 });
}

/** A siege engine loosing: timber taking the strain, then letting go. */
export function engineLoose(): void {
  burst({ duration: 0.3, gain: 0.09, type: 'lowpass', frequency: 700, q: 0.8, snap: 0.3 });
  tone({ duration: 0.4, gain: 0.08, frequency: 150, slideTo: 70, type: 'sawtooth' });
}

/**
 * A horn.
 *
 * Two saws a fifth apart through a low-pass, which is most of what a cornett
 * or a buisine is. Rising for an advance, falling for a recall — the two
 * calls that matter, because they are the two orders a man in the line could
 * be given once the shouting started.
 */
export function horn(rising: boolean, root = 196): void {
  const o = out();
  if (!o) return;
  const { ac, bus } = o;
  const at = ac.currentTime;
  const length = 1.1;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(900, at);
  filter.frequency.linearRampToValueAtTime(1500, at + 0.3);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.1, at + 0.09);
  gain.gain.setValueAtTime(0.1, at + length * 0.6);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  filter.connect(gain).connect(bus);
  for (const [ratio, level] of [[1, 1], [1.5, 0.55], [2, 0.3]] as const) {
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    const voice = ac.createGain();
    voice.gain.value = level * 0.5;
    osc.frequency.setValueAtTime(root * ratio, at);
    // The call: up a fourth and held, or down a fifth and let go.
    osc.frequency.setValueAtTime(root * ratio, at + 0.26);
    osc.frequency.linearRampToValueAtTime(root * ratio * (rising ? 1.335 : 0.667), at + 0.4);
    osc.connect(voice).connect(filter);
    osc.start(at);
    osc.stop(at + length + 0.05);
  }
}

/** A drum, which is how a line kept its step. */
export function drum(): void {
  burst({ duration: 0.05, gain: 0.07, type: 'bandpass', frequency: 1600, q: 1 });
  tone({ duration: 0.18, gain: 0.14, frequency: 105, slideTo: 58 });
}

/** Thunder, a moment after the flash, which is how far away it is. */
export function thunder(distance = 1): void {
  burst({
    delay: 0.35 * distance,
    duration: 1.6 + distance,
    gain: 0.22,
    type: 'lowpass',
    frequency: 320,
    sweepTo: 90,
    q: 0.5,
    snap: 0.55,
  });
  tone({ delay: 0.35 * distance, duration: 1.2, gain: 0.1, frequency: 60, slideTo: 30 });
}

// ---------------------------------------------------------------------------
// The things an interface makes
// ---------------------------------------------------------------------------

/** A button. Dry and short; an interface that chimes is an interface you mute. */
export function clickSound(): void {
  burst({ duration: 0.035, gain: 0.05, type: 'bandpass', frequency: 2600, q: 2.2 });
}

/** Parchment, drawn across the map and rolled up again. */
export function parchmentSound(opening: boolean): void {
  burst({
    duration: 0.3,
    gain: 0.055,
    type: 'bandpass',
    frequency: opening ? 1400 : 2400,
    sweepTo: opening ? 2800 : 1100,
    q: 0.8,
    snap: 0.35,
  });
}

/** The end of a turn: a bell on a tower, which is what a season sounded like. */
export function turnSound(): void {
  const o = out();
  if (!o) return;
  for (const [ratio, level, length] of [[1, 0.1, 2.4], [2.76, 0.035, 1.6], [5.4, 0.02, 0.9]] as const) {
    tone({ duration: length, gain: level, frequency: 196 * ratio, type: 'sine' });
  }
}

/** Coin. For a treasury that has just changed by enough to notice. */
export function coinSound(): void {
  for (let i = 0; i < 3; i++) {
    burst({
      delay: i * 0.045,
      duration: 0.09,
      gain: 0.04,
      type: 'bandpass',
      frequency: 3200 + i * 700,
      q: 3,
    });
  }
}

// ---------------------------------------------------------------------------
// Beds
// ---------------------------------------------------------------------------

/**
 * A sound that is always there and only changes in how loud it is.
 *
 * Rain, wind, and the noise a few thousand men make. These are the only
 * nodes in the file that outlive the moment they were made, and there are
 * never more than a handful of them.
 */
export class Bed {
  private source: AudioBufferSourceNode | undefined;
  private gain: GainNode | undefined;
  private wobble: OscillatorNode | undefined;

  constructor(
    private readonly shape: {
      readonly type: BiquadFilterType;
      readonly frequency: number;
      readonly q?: number;
      /** Hertz of slow swell, for wind and for a crowd. */
      readonly sway?: number;
      readonly swayDepth?: number;
    },
  ) {}

  /** Sets the level, smoothly. Zero lets the bed idle silently. */
  level(value: number): void {
    if (value <= 0.0005 && !this.source) return;
    if (!this.start()) return;
    const ac = context;
    if (!ac || !this.gain) return;
    this.gain.gain.setTargetAtTime(Math.max(0.0001, value), ac.currentTime, 0.25);
  }

  stop(): void {
    try {
      this.source?.stop();
      this.wobble?.stop();
    } catch {
      // Already stopped, which is the only thing that throws here.
    }
    this.source = undefined;
    this.gain = undefined;
    this.wobble = undefined;
  }

  private start(): boolean {
    if (this.source) return true;
    const o = out();
    if (!o) return false;
    const { ac, bus } = o;
    const source = ac.createBufferSource();
    source.buffer = noiseOf(ac);
    source.loop = true;
    const filter = ac.createBiquadFilter();
    filter.type = this.shape.type;
    filter.frequency.value = this.shape.frequency;
    filter.Q.value = this.shape.q ?? 0.7;
    const gain = ac.createGain();
    gain.gain.value = 0.0001;
    source.connect(filter).connect(gain).connect(bus);
    if (this.shape.sway) {
      // A slow swell on top of the level, so a bed is weather rather than a
      // tone generator left switched on.
      const lfo = ac.createOscillator();
      lfo.frequency.value = this.shape.sway;
      const depth = ac.createGain();
      depth.gain.value = this.shape.swayDepth ?? 0.3;
      lfo.connect(depth).connect(gain.gain);
      lfo.start();
      this.wobble = lfo;
    }
    source.start();
    this.source = source;
    this.gain = gain;
    return true;
  }
}
