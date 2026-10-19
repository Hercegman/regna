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
 */
import type { CampaignState } from '../../core/campaign';
import type { RegionId, Terrain } from '../../core/types';
import { getRegion } from '../../core/data/regions';
import { tryGetFaction, INDEPENDENT_ID } from '../../core/data/factions';
import type { Ground } from './elevation';
import type { IsoTransform } from './view';
import { METRES_PER_STEP, cornerOf, floorAt } from './view';
import { OWNER_WASH, WATER, mix, rampFor, snap, stepFor } from './palette';
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
      const ramp = sea ? WATER : rampFor(look?.terrain ?? 'plains');
      const owner = look?.owner;
      // Which way the tile leans: west-facing catches the light, and a slope
      // down to the south is brighter than one climbing away northwards.
      const lean = (west - east) * 0.6 + (south - north) * 0.3;

      // The owner's colour goes on the top face only. Washing it over the
      // cliffs as well turned the map into a patchwork and buried the ground
      // underneath whoever happened to hold it.
      const faceColour = (face: 'top' | 'left' | 'right'): string => {
        const base = ramp[stepFor(face, lean)]!;
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

      // Open water is darker than shallows, and nothing else varies: a flat
      // sea is what lets the coast read as a coast.
      ctx.fillStyle = sea
        ? WATER[Math.max(0, Math.min(4, 4 - Math.round(Math.max(0, -metres) / 600)))]!
        : faceColour('top');
      ctx.beginPath();
      ctx.moveTo(sx, yN);
      ctx.lineTo(sx + halfWidth, yE);
      ctx.lineTo(sx, yS);
      ctx.lineTo(sx - halfWidth, yW);
      ctx.closePath();
      ctx.fill();


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
