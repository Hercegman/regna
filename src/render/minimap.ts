/**
 * The radar.
 *
 * Every game of this kind has one in the corner and it is not decoration: a
 * campaign map you can only see a duchy of at a time needs somewhere to
 * answer "where am I, and who is around me" without a journey. This is that,
 * and it is deliberately not the same picture as the map — it is flat, it is
 * north-up, and it is drawn out of the province shapes and the owner's
 * colour and nothing else. A small isometric map is unreadable; a small flat
 * one with countries painted in is a map of Europe.
 *
 * The land and the water never change, so they are painted once into a
 * picture that is kept and blitted; only the colours of realms, the armies
 * and the box showing where the player is looking are drawn each time.
 */
import type { CampaignState } from '../core/campaign';
import type { RegionId } from '../core/types';
import { GEO_BOUNDS, LAKE_RINGS, LAND_RINGS } from '../core/data/geography';
import { INDEPENDENT_ID, tryGetFaction } from '../core/data/factions';
import { watchedProvinces } from '../core/campaign/sight';
import { canSeeArmy } from '../core/campaign/sight';
import { getRegion } from '../core/data/regions';
import { mercatorY } from './projection';
import { provinceShapes } from './provinces';

const SEA = '#16304a';
const LAND = '#5b5e3e';
const COAST = '#0d1c2b';

const BOUNDS = {
  west: GEO_BOUNDS.west,
  east: GEO_BOUNDS.east,
  south: mercatorY(GEO_BOUNDS.south),
  north: mercatorY(GEO_BOUNDS.north),
};

export interface MinimapFit {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/** How the whole theatre is squeezed into a box of this size. */
export function fitMinimap(width: number, height: number): MinimapFit {
  const scale = Math.min(
    width / (BOUNDS.east - BOUNDS.west),
    height / (BOUNDS.north - BOUNDS.south),
  );
  return {
    scale,
    offsetX: (width - (BOUNDS.east - BOUNDS.west) * scale) / 2,
    offsetY: (height - (BOUNDS.north - BOUNDS.south) * scale) / 2,
  };
}

function atX(fit: MinimapFit, lon: number): number {
  return fit.offsetX + (lon - BOUNDS.west) * fit.scale;
}

function atY(fit: MinimapFit, merc: number): number {
  return fit.offsetY + (BOUNDS.north - merc) * fit.scale;
}

/** Back the other way, for a click on the radar. */
export function minimapToWorld(
  fit: MinimapFit,
  x: number,
  y: number,
): { lon: number; merc: number } {
  return {
    lon: BOUNDS.west + (x - fit.offsetX) / fit.scale,
    merc: BOUNDS.north - (y - fit.offsetY) / fit.scale,
  };
}

interface Plates {
  /** The water, the land and the coast: everything that never changes. */
  readonly base: HTMLCanvasElement;
  /** The same land, with the water left clear, used to mask the colours. */
  readonly mask: HTMLCanvasElement;
  /** Somewhere to mix a frame's colours before they are masked. */
  readonly scratch: HTMLCanvasElement;
}

let plates: Plates | undefined;
let platesFor = '';

function blank(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** The coast and the water, painted once for a given size. */
function platesFit(width: number, height: number, fit: MinimapFit): Plates {
  const key = `${width}x${height}`;
  if (plates && platesFor === key) return plates;

  const trace = (
    ctx: CanvasRenderingContext2D,
    rings: readonly (readonly (readonly [number, number])[])[],
  ): void => {
    ctx.beginPath();
    for (const ring of rings) {
      ring.forEach(([lon, lat], index) => {
        const x = atX(fit, lon);
        const y = atY(fit, mercatorY(lat));
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
  };

  const base = blank(width, height);
  const paint = base.getContext('2d')!;
  paint.fillStyle = SEA;
  paint.fillRect(0, 0, width, height);
  paint.fillStyle = LAND;
  trace(paint, LAND_RINGS);
  paint.fill();
  paint.fillStyle = SEA;
  trace(paint, LAKE_RINGS);
  paint.fill();
  paint.strokeStyle = COAST;
  paint.lineWidth = 1;
  trace(paint, LAND_RINGS);
  paint.stroke();

  const mask = blank(width, height);
  const cut = mask.getContext('2d')!;
  cut.fillStyle = '#fff';
  trace(cut, LAND_RINGS);
  cut.fill();
  cut.globalCompositeOperation = 'destination-out';
  trace(cut, LAKE_RINGS);
  cut.fill();

  plates = { base, mask, scratch: blank(width, height) };
  platesFor = key;
  return plates;
}

export interface MinimapScene {
  readonly state: CampaignState;
  /** The four corners of what the player can see, in world coordinates. */
  readonly corners: readonly { readonly lon: number; readonly merc: number }[];
  readonly selected: RegionId | undefined;
}

export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scene: MinimapScene,
): void {
  const fit = fitMinimap(width, height);
  const { state } = scene;
  const { base, mask, scratch } = platesFit(width, height, fit);
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(base, 0, 0);

  const watched = watchedProvinces(state, state.player);

  // Realms, in their own colours. Who holds a place is public knowledge, so
  // this is not kept back by the fog; what the fog hides is everything that
  // moves, which is drawn after.
  //
  // Painted on their own plate first and then cut to the coast, because a
  // province is the ground nearest its own town and that reaches well out
  // to sea: a Venice spilling into the Adriatic is worse than no colour.
  const tint = scratch.getContext('2d')!;
  tint.globalCompositeOperation = 'source-over';
  tint.clearRect(0, 0, width, height);
  for (const shape of provinceShapes()) {
    const region = state.regions.get(shape.id);
    if (!region || shape.cell.length < 3) continue;
    const faction = region.owner === INDEPENDENT_ID ? undefined : tryGetFaction(region.owner);
    if (!faction) continue;
    tint.beginPath();
    shape.cell.forEach(([lon, merc], index) => {
      const x = atX(fit, lon);
      const y = atY(fit, merc);
      if (index === 0) tint.moveTo(x, y);
      else tint.lineTo(x, y);
    });
    tint.closePath();
    tint.fillStyle = faction.colour;
    tint.globalAlpha = region.owner === state.player ? 0.95 : 0.72;
    tint.fill();
    tint.globalAlpha = 1;
  }
  tint.globalCompositeOperation = 'destination-in';
  tint.drawImage(mask, 0, 0);
  ctx.drawImage(scratch, 0, 0);

  // Armies, as a mark each. Only the ones somebody of ours can see.
  for (const army of state.armies.values()) {
    if (!canSeeArmy(state, state.player, army.id, watched)) continue;
    const where = getRegion(army.location);
    const x = atX(fit, where.lon);
    const y = atY(fit, mercatorY(where.lat));
    const mine = army.faction === state.player;
    ctx.fillStyle = mine ? '#ffe9a8' : tryGetFaction(army.faction)?.colour ?? '#ccc';
    ctx.fillRect(Math.round(x) - 1, Math.round(y) - 2, 3, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(Math.round(x) - 2, Math.round(y) + 2, 5, 1);
  }

  if (scene.selected) {
    const where = getRegion(scene.selected);
    const x = atX(fit, where.lon);
    const y = atY(fit, mercatorY(where.lat));
    ctx.strokeStyle = '#ffe28a';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) - 3.5, Math.round(y) - 3.5, 7, 7);
  }

  // Where the player is looking. The map is isometric, so what is on screen
  // is a slanted box out here rather than a rectangle.
  if (scene.corners.length === 4) {
    ctx.beginPath();
    scene.corners.forEach((corner, index) => {
      const x = atX(fit, corner.lon);
      const y = atY(fit, corner.merc);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 244, 214, 0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
