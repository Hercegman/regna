/**
 * Deterministic pseudo-random number generator.
 *
 * The whole simulation (campaign turns and battles) must be reproducible from a
 * seed: identical seed + identical inputs => identical outcome. That makes the
 * game testable, makes replays and save games cheap, and makes multiplayer
 * lockstep possible later. Therefore nothing in `core/` may call `Math.random`.
 *
 * Algorithm: xoshiro128** — small, fast, passes PractRand, 128 bits of state.
 */
export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number | string) {
    const n = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    // SplitMix32 expansion of the single seed word into 128 bits of state.
    let x = n === 0 ? 0x9e3779b9 : n >>> 0;
    const next = (): number => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
  }

  /** Raw 32-bit unsigned output. */
  nextUint32(): number {
    const result = (Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    // 53-bit mantissa from two 32-bit draws keeps the float distribution even.
    const hi = this.nextUint32() >>> 5; // 27 bits
    const lo = this.nextUint32() >>> 6; // 26 bits
    return (hi * 67108864 + lo) / 9007199254740992;
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max < min) throw new Error(`Rng.int: empty range [${min}, ${max}]`);
    const span = max - min + 1;
    // Rejection sampling keeps the distribution exactly uniform.
    const limit = Math.floor(0x100000000 / span) * span;
    let draw = this.nextUint32();
    while (draw >= limit) draw = this.nextUint32();
    return min + (draw % span);
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with the given probability. */
  chance(probability: number): boolean {
    if (probability <= 0) return false;
    if (probability >= 1) return true;
    return this.next() < probability;
  }

  /** Picks one element; throws on an empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    return items[this.int(0, items.length - 1)] as T;
  }

  /** Picks an element by weight. Weights must be non-negative and not all zero. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    if (items.length === 0) throw new Error('Rng.weighted: empty array');
    let total = 0;
    for (const item of items) {
      const w = weight(item);
      if (w < 0 || !Number.isFinite(w)) throw new Error(`Rng.weighted: bad weight ${w}`);
      total += w;
    }
    if (total <= 0) return this.pick(items);
    let roll = this.next() * total;
    for (const item of items) {
      roll -= weight(item);
      if (roll < 0) return item;
    }
    return items[items.length - 1] as T;
  }

  /** In-place Fisher-Yates shuffle. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const a = items[i] as T;
      items[i] = items[j] as T;
      items[j] = a;
    }
    return items;
  }

  /** Approximately normal draw (sum of 3 uniforms), clamped to +/- 3 sigma. */
  normal(mean: number, stdDev: number): number {
    const u = this.next() + this.next() + this.next() - 1.5;
    return mean + u * 2 * stdDev;
  }

  /** Serialises the generator state so a save file can resume it exactly. */
  save(): RngState {
    return { s0: this.s0, s1: this.s1, s2: this.s2, s3: this.s3 };
  }

  /** Restores a previously saved state. */
  restore(state: RngState): void {
    this.s0 = state.s0 >>> 0;
    this.s1 = state.s1 >>> 0;
    this.s2 = state.s2 >>> 0;
    this.s3 = state.s3 >>> 0;
  }

  static fromState(state: RngState): Rng {
    const rng = new Rng(0);
    rng.restore(state);
    return rng;
  }

  /** A child generator derived from this one, so subsystems cannot desync each other. */
  fork(label: string): Rng {
    return new Rng((this.nextUint32() ^ hashString(label)) >>> 0);
  }
}

export interface RngState {
  s0: number;
  s1: number;
  s2: number;
  s3: number;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** FNV-1a, so string seeds ("campaign-1080") are usable directly. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
