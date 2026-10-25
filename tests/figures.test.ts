/**
 * What the men are doing.
 *
 * The thing being guarded here is not that any one man is in any one pose —
 * it is that a block of them is never all in the same one. That fault is
 * invisible to the eye at the size a battle draws them and obvious the
 * moment anybody looks closely, which is exactly the shape of bug a test is
 * for: a line of two hundred identical frozen figures reads as a texture,
 * and it is what the field showed for a long time without anybody being
 * able to say why it looked wrong.
 */
import { describe, expect, it } from 'vitest';
import { unitTypeId } from '../src/core/types';
import { facingIndex, figureFor, poseFor, type Pose } from '../src/render/figures';

/** The poses a block of `count` men is in at one moment. */
function block(stance: string, seconds: number, count = 60): Map<Pose, number> {
  const tally = new Map<Pose, number>();
  for (let man = 1; man <= count; man++) {
    const pose = poseFor(stance, seconds, man);
    tally.set(pose, (tally.get(pose) ?? 0) + 1);
  }
  return tally;
}

describe('what a block of men is doing', () => {
  it('never has a standing regiment all in one pose', () => {
    // Every second of the first ten minutes, not one sampled moment: the
    // cycle is slow and a single instant can be unlucky.
    for (let second = 0; second < 600; second += 1) {
      const tally = block('holding', second);
      expect(tally.size, `at ${second}s`).toBeGreaterThan(1);
    }
  });

  it('has a standing regiment bracing and shouting as well as standing', () => {
    const seen = new Set<Pose>();
    for (let second = 0; second < 600; second += 1) {
      for (const pose of block('holding', second).keys()) seen.add(pose);
    }
    expect(seen).toContain('idle');
    expect(seen).toContain('brace');
    expect(seen).toContain('shout');
    expect(seen).toContain('pass');
  });

  it('keeps most of a standing regiment standing', () => {
    // Alive, not restless. If half the line is shouting at any moment it has
    // stopped being a line of men and become a crowd at a football match.
    for (let second = 0; second < 600; second += 1) {
      const tally = block('holding', second);
      const idle = tally.get('idle') ?? 0;
      expect(idle / 60, `at ${second}s`).toBeGreaterThan(0.45);
    }
  });

  it('walks a marching regiment through all four beats', () => {
    const seen = new Set<Pose>();
    for (let second = 0; second < 60; second += 1) {
      for (const pose of block('advancing', second).keys()) seen.add(pose);
    }
    expect(seen).toContain('stepa');
    expect(seen).toContain('stepb');
    expect(seen).toContain('pass');
    // A march is legs, not arms: nobody stops to shout in it.
    expect(seen).not.toContain('shout');
  });

  it('has men bellowing in a charge but never losing the gait', () => {
    const seen = new Set<Pose>();
    for (let second = 0; second < 120; second += 1) {
      for (const pose of block('charging', second).keys()) seen.add(pose);
    }
    expect(seen).toContain('stepa');
    expect(seen).toContain('stepb');
    expect(seen).toContain('shout');
  });

  it('has a line in contact swinging, covering and roaring', () => {
    const seen = new Set<Pose>();
    for (let second = 0; second < 120; second += 1) {
      for (const pose of block('melee', second).keys()) seen.add(pose);
    }
    expect(seen).toContain('fight');
    expect(seen).toContain('brace');
    expect(seen).toContain('shout');
    // Nobody stands at ease with a man swinging at him.
    expect(seen).not.toContain('idle');
  });

  it('runs a rout with no moment of standing still in it', () => {
    for (let second = 0; second < 60; second += 1) {
      for (const pose of block('routing', second).keys()) {
        expect(pose === 'fleea' || pose === 'fleeb', `at ${second}s got ${pose}`).toBe(true);
      }
    }
  });
});

describe('which way a man is facing', () => {
  it('turns a bearing on the ground into one of the eight the sheet has', () => {
    // Direction 0 is up and to the right and they run clockwise, so a man
    // walking due east along the field is the one after it.
    expect(facingIndex(0, 0.5)).toBe(1);
    // Turn him right round and he faces the other way, whatever the squash
    // does to the angle on the way.
    for (let turn = 0; turn < 8; turn++) {
      const bearing = (turn * Math.PI) / 4;
      expect((facingIndex(bearing + Math.PI, 0.5) + 4) % 8).toBe(facingIndex(bearing, 0.5));
    }
    // And the eight come back in range however many times the bearing wraps.
    for (let turn = -8; turn <= 8; turn++) {
      const index = facingIndex(turn * 0.7, 0.5);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(8);
    }
  });
});

describe('which figure a kind of soldier is drawn as', () => {
  it('gives the siege class a machine and not a swordsman', () => {
    expect(figureFor('siege_engine', unitTypeId('trebuchet'))).toBe('engine');
    expect(figureFor('siege_engine', unitTypeId('bombard'))).toBe('cannon');
  });

  it('puts every kind of horse on a horse', () => {
    expect(figureFor('heavy_cavalry')).toBe('knight');
    expect(figureFor('horse_archers')).toBe('lighthorse');
    expect(figureFor('camel_cavalry')).toBe('lighthorse');
  });
});
