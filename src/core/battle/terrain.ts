/**
 * Battlefield ground.
 *
 * Height is a function rather than a grid: it costs nothing to sample, it is
 * perfectly deterministic, and one ridge across the field is enough to make
 * position matter. Hilly and mountainous provinces fight on a ridge; everything
 * else fights on ground that is flat for practical purposes.
 */
import type { Point, Terrain } from '../types';
import type { BattleTerrain } from './types';
import { FIELD_DEPTH, FIELD_WIDTH } from './types';

export function flatTerrain(kind: Terrain): BattleTerrain {
  return {
    kind,
    height: (point: Point) =>
      // A gentle, deterministic undulation so that "flat" is not perfectly flat.
      2 * Math.sin(point.x / 220) + 1.5 * Math.cos(point.y / 190),
  };
}

/**
 * A ridge running across the field, higher on the defender's side. Holding the
 * crest is worth real combat and missile advantage, which is the whole reason
 * to care about where a battle is fought.
 */
export function ridgeTerrain(kind: Terrain): BattleTerrain {
  const peak = kind === 'mountains' ? 70 : 38;
  const crest = FIELD_DEPTH * 0.38;
  const spread = FIELD_DEPTH * 0.3;
  return {
    kind,
    height: (point: Point) => {
      const along = (point.x - FIELD_WIDTH / 2) / FIELD_WIDTH;
      const across = (point.y - crest) / spread;
      const ridge = peak * Math.exp(-across * across);
      // The ridge is not a perfect wall: it dips towards the flanks.
      return ridge * (1 - 0.35 * along * along) + 3 * Math.sin(point.x / 160);
    },
  };
}

export function terrainFor(kind: Terrain): BattleTerrain {
  return kind === 'hills' || kind === 'mountains' ? ridgeTerrain(kind) : flatTerrain(kind);
}
