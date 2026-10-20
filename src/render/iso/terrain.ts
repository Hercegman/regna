/**
 * The ground, tile by tile.
 *
 * Every tile is a diamond with a height at each of its four corners, so a
 * hillside is a run of leaning quads rather than a staircase of boxes. The
 * two faces that can be seen hang well below the tile and are painted over by
 * whatever is drawn in front, which is what makes a cliff a cliff without
 * anybody having to work out where the cliffs are.
 *
 * Drawn strictly back to front. That ordering is the whole of the depth in an
 * isometric picture, and it is also what lets anything standing on a tile be
 * drawn in its right place: the caller is handed each tile as it is painted.
 *
 * A tile is not one flat colour. Three things happen to it on the way out:
 * height decides whether it is still growing anything or has gone to rock and
 * snow, the coast decides whether the water over it is deep or a shelf, and a
 * number fixed for ever to its coordinates mottles it and scatters whatever
 * stands on it. The last is what stops the Hungarian plain being a sheet of
 * one green, and it costs a multiply: nothing is stored per tile.
 */
import type { CampaignState } from '../../core/campaign';
import type { RegionId, Terrain } from '../../core/types';
import { getRegion } from '../../core/data/regions';
import { tryGetFaction, INDEPENDENT_ID } from '../../core/data/factions';
import type { Ground } from './elevation';
import type { IsoTransform } from './view';
import { METRES_PER_STEP, cornerOf, floorAt } from './view';
import {
  DECOR,
  OWNER_WASH,
  ROCK_LINE,
  SAND,
  SHALLOWS,
  SNOW_LINE,
  WATER,
  groundRamp,
  mix,
  snap,
  stepFor,
  tileNoise,
} from './palette';
import { isLand } from './landmask';
import { provinceNear } from './sites';
import { inverseMercator } from '../projection';

/** Hangs far enough below a tile to cover any drop behind it. */
const SKIRT = 160;

export interface TilePaint {
  readonly tx: number;
  readonly ty: number;
  /** The middle of the tile's top face. */
  readonly x: number;
  readonly y: number;
  readonly province: RegionId | undefined;
  readonly metres: number;
  readonly sea: boolean;
}

/** Everything the ground needs to know about the world to be drawn. */
export interface GroundScene {
  readonly state: CampaignState;
  readonly ground: Ground;
  readonly transform: IsoTransform;
  readonly width: number;
  readonly height: number;
  /** Trees, fields and rocks. Turned off while the player is dragging. */
  readonly detail?: boolean;
}

interface Look {
  readonly terrain: Terrain;
  readonly owner: string | undefined;
}

/**
 * Paints the ground.
 *
 * `onTile` is called for every tile as it is painted, in the same back to
 * front order, so that anything standing on the ground can be drawn into the
 * same pass and come out at the right depth.
 */
export function drawGround(
  ctx: CanvasRenderingContext2D,
  scene: GroundScene,
  onTile?: (tile: TilePaint) => void,
): number {
  const { transform, ground, width, height } = scene;
  const step = transform.stepPixels;
  const halfWidth = transform.halfWidth;
  const halfHeight = transform.halfHeight;
  const detail = scene.detail !== false;

  // What a province looks like, worked out once per province per frame
  // rather than once per tile.
  const looks = new Map<RegionId, Look>();
  const lookFor = (id: RegionId | undefined): Look | undefined => {
    if (!id) return undefined;
    const known = looks.get(id);
    if (known) return known;
    const region = scene.state.regions.get(id);
    const owner =
      region && region.owner !== INDEPENDENT_ID
        ? tryGetFaction(region.owner)?.colour
        : undefined;
    const fresh: Look = { terrain: getRegion(id).terrain, owner };
    looks.set(id, fresh);
    return fresh;
  };

  // Read the ground from a copy of the grid whose posts are about as far
  // apart as a tile is wide, so a coarse tile is the average of the ground it
  // covers rather than whichever single point its corner happened to land on.
  const level = ground.levelFor(transform.unitsPerTile);

  /** Height in steps at a tile corner. */
  const cornerSteps = (tx: number, ty: number): number => {
    const corner = cornerOf(transform, tx, ty);
    if (!isLand(corner.lon, corner.merc)) return 0;
    const metres = ground.metresAtLevel(corner.lon, inverseMercator(corner.merc), level);
    return metres <= 0 ? 0 : metres / METRES_PER_STEP;
  };

  /** Whether the middle of the tile one step away is dry. */
  const dryNear = (tx: number, ty: number): boolean => {
    const at = cornerOf(transform, tx + 0.5, ty + 0.5);
    return isLand(at.lon, at.merc);
  };

  // A tile's screen position depends on (tx - ty) across and (tx + ty) up,
  // so the sweep walks those two directly: that is what guarantees the
  // picture is covered rather than guessing at a rectangle of tiles.
  const origin = floorAt(transform, 0, 0);
  const acrossSpan = Math.ceil(width / (halfWidth * 2)) + 3;
  // Ground that is high rides up the picture, so the sweep carries on past
  // the top edge to put the tops of mountains in.
  const upFrom = Math.floor((origin.y - height - SKIRT) / halfHeight) - 2;
  const upTo = Math.ceil((origin.y + SKIRT) / halfHeight) + Math.ceil(SKIRT / halfHeight) + 4;
  const acrossCentre = Math.round((width / 2 - origin.x) / halfWidth);

  let painted = 0;
  // Back to front is north to south, which is `up` counting downwards.
  for (let up = upTo; up >= upFrom; up--) {
    for (let offset = -acrossSpan; offset <= acrossSpan; offset++) {
      const across = acrossCentre + offset;
      // tx and ty come out whole only when the two share a parity.
      if (((across + up) & 1) !== 0) continue;
      const tx = (up + across) / 2;
      const ty = (up - across) / 2;

      // This is where the tile's SOUTH corner falls: the diamond is drawn
      // upwards from it, two half-heights to its north corner.
      const sx = Math.round(origin.x + across * halfWidth);
      const sy = origin.y - up * halfHeight;

      // The four corners, each with its own height: that is what makes a
      // hillside a run of leaning quads instead of a staircase of boxes.
      const north = cornerSteps(tx + 1, ty + 1);
      const east = cornerSteps(tx + 1, ty);
      const south = cornerSteps(tx, ty);
      const west = cornerSteps(tx, ty + 1);

      const yS = Math.round(sy - south * step);
      const yE = Math.round(sy - halfHeight - east * step);
      const yW = Math.round(sy - halfHeight - west * step);
      const yN = Math.round(sy - 2 * halfHeight - north * step);
      if (Math.min(yN, yE, yS, yW) > height + 4) continue;
      if (Math.max(yN, yE, yS, yW) + SKIRT < -4) continue;
      painted += 1;

      const middle = cornerOf(transform, tx + 0.5, ty + 0.5);
      const metres = ground.metresAtLevel(middle.lon, inverseMercator(middle.merc), level);
      // Whether a tile is sea comes from the coastline, not from its average
      // height: a tile covering seven kilometres of Dalmatian shore averages
      // to a metre either side of zero and would flicker.
      const sea = !isLand(middle.lon, middle.merc);

      // One lookup, used for the ground's colour, its owner's wash, and
      // whatever the caller wants to stand on it.
      const province = sea ? undefined : provinceNear(middle.lon, middle.merc);
      const look = lookFor(province);
      const terrain = look?.terrain ?? 'plains';
      const jitter = tileNoise(tx, ty);
      const owner = look?.owner;

      // Does this tile have the other element on its doorstep? A field
      // above a beach and the shelf under a harbour are both this question.
      const edged =
        dryNear(tx + 1, ty) !== !sea ||
        dryNear(tx - 1, ty) !== !sea ||
        dryNear(tx, ty + 1) !== !sea ||
        dryNear(tx, ty - 1) !== !sea;

      // Height overrules the province, and the shore overrules height: the
      // strand is sand whatever grows behind it.
      const ramp = sea
        ? edged
          ? SHALLOWS
          : WATER
        : edged && metres < 260
          ? SAND
          : groundRamp(terrain, metres, jitter);

      // Which way the tile leans: west-facing catches the light, and a slope
      // down to the south is brighter than one climbing away northwards.
      const lean = (west - east) * 0.6 + (south - north) * 0.3;
      // The mottle. One step either way on a fifth of the tiles, which is
      // enough to break a plain up and little enough to keep the banding.
      const mottle = jitter < 0.18 ? -1 : jitter > 0.84 ? 1 : 0;

      // The owner's colour goes on the top face only. Washing it over the
      // cliffs as well turned the map into a patchwork and buried the ground
      // underneath whoever happened to hold it.
      const faceColour = (face: 'top' | 'left' | 'right'): string => {
        const index = stepFor(face, lean) + (face === 'top' ? mottle : 0);
        const base = ramp[Math.max(0, Math.min(4, index))]!;
        return snap(owner && face === 'top' ? mix(base, owner, OWNER_WASH) : base);
      };

      if (!sea) {
        ctx.fillStyle = faceColour('left');
        ctx.beginPath();
        ctx.moveTo(sx - halfWidth, yW);
        ctx.lineTo(sx, yS);
        ctx.lineTo(sx, yS + SKIRT);
        ctx.lineTo(sx - halfWidth, yW + SKIRT);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = faceColour('right');
        ctx.beginPath();
        ctx.moveTo(sx, yS);
        ctx.lineTo(sx + halfWidth, yE);
        ctx.lineTo(sx + halfWidth, yE + SKIRT);
        ctx.lineTo(sx, yS + SKIRT);
        ctx.closePath();
        ctx.fill();
      }

      // Open water darkens with depth; the shelf does not, because what the
      // shelf is for is telling the eye where the land stops.
      // Depth in three steps rather than five. The elevation grid under the
      // sea is coarse and averaged, and reading five shades off it gave the
      // Mediterranean a herringbone of trenches that are not there.
      ctx.fillStyle = sea
        ? edged
          ? SHALLOWS[2 + (jitter > 0.7 ? 1 : 0)]!
          : WATER[Math.max(0, Math.min(3, 3 - Math.round(Math.max(0, -metres) / 1400)))]!
        : faceColour('top');
      ctx.beginPath();
      ctx.moveTo(sx, yN);
      ctx.lineTo(sx + halfWidth, yE);
      ctx.lineTo(sx, yS);
      ctx.lineTo(sx - halfWidth, yW);
      ctx.closePath();
      ctx.fill();

      if (detail) {
        // The middle of the top face, which is where anything standing on
        // the tile is standing.
        const cx = sx;
        const cy = Math.round((yE + yW) / 2);
        if (sea) {
          if (edged && jitter > 0.55) surf(ctx, cx, cy, halfWidth, jitter);
        } else {
          dressGround(ctx, cx, cy, halfWidth, halfHeight, terrain, metres, tx, ty, jitter);
        }
      }

      if (onTile) {
        onTile({
          tx,
          ty,
          x: sx,
          y: Math.round((yE + yW) / 2),
          province,
          metres,
          sea,
        });
      }
    }
  }
  return painted;
}

/**
 * What is growing on a tile.
 *
 * Drawn here rather than handed to the caller because it has to go on
 * between this tile's top face and the next tile's, which is the only place
 * a tree can stand without something behind it being drawn over its head.
 * Exported because the battlefield wants the same treatment: a battle on
 * farmland should be fought across furrows and one in a wood among trees,
 * and there is no reason for two kinds of ground in one game.
 *
 * Nothing here is random. Every position and every count comes out of the
 * tile's own coordinates, so a wood is in the same place on every frame and
 * panning the map does not make the forest crawl.
 */
export function dressGround(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
  terrain: Terrain,
  metres: number,
  tx: number,
  ty: number,
  jitter: number,
): void {
  // Above the treeline nothing grows; what is up there is stone.
  if (metres > SNOW_LINE) return;
  if (metres > ROCK_LINE) {
    if (jitter > 0.6) boulder(ctx, x, y, halfWidth, jitter);
    return;
  }

  const spread = halfWidth * 0.52;
  const at = (n: number): { x: number; y: number } => {
    const a = tileNoise(tx, ty, n + 1);
    const b = tileNoise(tx, ty, n + 9);
    return {
      x: Math.round(x + (a - 0.5) * 2 * spread),
      y: Math.round(y + (b - 0.5) * 2 * spread * 0.5),
    };
  };

  switch (terrain) {
    case 'forest': {
      // A wood is trees all over it, in two kinds, because a forest of one
      // tree repeated is a wallpaper.
      const count = jitter > 0.3 ? 3 : 2;
      for (let i = 0; i < count; i++) {
        const spot = at(i * 3);
        tree(ctx, spot.x, spot.y, halfWidth, tileNoise(tx, ty, i + 40) > 0.45, metres > 800);
      }
      break;
    }
    case 'hills':
      if (jitter > 0.52) {
        const spot = at(0);
        tree(ctx, spot.x, spot.y, halfWidth * 0.85, false, metres > 700);
      }
      if (jitter < 0.3) bush(ctx, at(5).x, at(5).y, halfWidth);
      break;
    case 'mountains':
      if (jitter > 0.45) boulder(ctx, x, y, halfWidth, jitter);
      else if (jitter < 0.2) tree(ctx, at(0).x, at(0).y, halfWidth * 0.8, false, true);
      break;
    case 'farmland':
      furrows(ctx, x, y, halfWidth, halfHeight, tx, ty, jitter);
      break;
    case 'plains':
    case 'coastal':
      if (jitter > 0.88) tree(ctx, at(0).x, at(0).y, halfWidth * 0.9, true, false);
      else if (jitter > 0.74) furrows(ctx, x, y, halfWidth, halfHeight, tx, ty, jitter);
      break;
    case 'steppe':
    case 'desert':
      if (jitter > 0.9) bush(ctx, at(0).x, at(0).y, halfWidth);
      break;
    case 'marsh':
      if (jitter > 0.7) bush(ctx, at(0).x, at(0).y, halfWidth);
      break;
    default:
      break;
  }
}

/**
 * One tree.
 *
 * Three strokes: a trunk, the mass of the crown, and a light on the side the
 * sun is on. At the size a tile is drawn that is all there is room for, and
 * it is also all these games ever gave a tree.
 */
function tree(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  halfWidth: number,
  broad: boolean,
  high: boolean,
): void {
  // Kept well under a tile. A tree the height of a tile is a tree the height
  // of the village next to it, and then the map is a forest with some
  // buildings lost in it.
  const h = Math.max(3, Math.round(halfWidth * (broad ? 0.5 : 0.62)));
  const w = Math.max(1, Math.round(halfWidth * (broad ? 0.34 : 0.24)));
  const palette = high ? DECOR.conifer : broad ? DECOR.leaf : DECOR.conifer;

  ctx.fillStyle = palette[2]!;
  ctx.fillRect(x, y - 1, 1, 2);
  if (broad) {
    ctx.fillStyle = palette[0]!;
    ctx.fillRect(x - w, y - h, w * 2, h - 1);
    ctx.fillStyle = palette[1]!;
    ctx.fillRect(x - w, y - h, w, Math.max(1, Math.round(h * 0.5)));
  } else {
    // A spire: each course narrower than the one under it.
    ctx.fillStyle = palette[0]!;
    for (let i = 0; i < h - 1; i++) {
      const span = Math.max(1, Math.round(w * (1 - i / h)));
      ctx.fillRect(x - span, y - 1 - i, span * 2, 1);
    }
    ctx.fillStyle = palette[1]!;
    ctx.fillRect(x - 1, y - h + 1, 1, Math.max(1, h - 2));
  }
}

/** Scrub: a tree's worth of ground cover and none of its height. */
function bush(ctx: CanvasRenderingContext2D, x: number, y: number, halfWidth: number): void {
  const w = Math.max(1, Math.round(halfWidth * 0.3));
  ctx.fillStyle = DECOR.scrub[0]!;
  ctx.fillRect(x - w, y - w, w * 2, w);
  ctx.fillStyle = DECOR.scrub[1]!;
  ctx.fillRect(x - w, y - w, w, 1);
}

/** Stone showing through, up where the ground has given up growing. */
function boulder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  halfWidth: number,
  jitter: number,
): void {
  const w = Math.max(1, Math.round(halfWidth * (0.3 + jitter * 0.22)));
  ctx.fillStyle = DECOR.rock[2]!;
  ctx.fillRect(x - w, y - w, w * 2, w + 1);
  ctx.fillStyle = DECOR.rock[0]!;
  ctx.fillRect(x - w, y - w, w * 2, w);
  ctx.fillStyle = DECOR.rock[1]!;
  ctx.fillRect(x - w, y - w, w, 1);
}

/**
 * A worked field.
 *
 * Three furrows along one of the tile's two diagonals, which is the whole of
 * what makes ground look farmed from above: it is the only straight line in
 * a landscape and the eye finds it instantly. Drawn as three strokes rather
 * than as the pixels of three strokes, because there are a thousand fields
 * on the screen and a thousand times thirty fills is a dropped frame.
 */
function furrows(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
  tx: number,
  ty: number,
  jitter: number,
): void {
  // Which way the plough went, fixed to the tile so a field never turns.
  const along = tileNoise(tx, ty, 77) > 0.5 ? 1 : -1;
  const reach = halfWidth * 0.62;
  ctx.strokeStyle = jitter > 0.5 ? DECOR.furrow[0]! : DECOR.furrow[2]!;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = -1; i <= 1; i++) {
    // Offset across the furrows, which is the tile's other diagonal.
    const ox = i * halfWidth * 0.3 * -along;
    const oy = i * halfHeight * 0.3;
    ctx.moveTo(x + ox - reach, y + oy + along * reach * 0.5);
    ctx.lineTo(x + ox + reach, y + oy - along * reach * 0.5);
  }
  ctx.stroke();
}

/** White water, where the sea is working on a shore. */
function surf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  halfWidth: number,
  jitter: number,
): void {
  const w = Math.max(1, Math.round(halfWidth * 0.45));
  ctx.fillStyle = DECOR.surf;
  ctx.globalAlpha = 0.35 + jitter * 0.25;
  ctx.fillRect(x - w, y, w * 2, 1);
  ctx.globalAlpha = 1;
}
