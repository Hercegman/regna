/**
 * Battle renderer.
 *
 * The same isometric picture as the campaign map, at the scale of one field:
 * diamond tiles of ground raised by the ridge under them, and the men drawn
 * as the sprites that were modelled for them.
 *
 * How a regiment is drawn depends on how close you are. Pulled back it is one
 * token — a body of men under a standard — because at that size a hundred
 * separate figures is a smudge and tells you less. Closed in it is the men
 * themselves, in the ranks and files the simulation is using, thinning from
 * the back as they are killed. The changeover is on the frontage in pixels,
 * so it happens where the detail starts being worth drawing.
 *
 * Everything here is drawn from the simulation's own state. Nothing is
 * invented for effect: arrows are in the air only where a unit with
 * ammunition is shooting at something, and dust rises only where men are
 * actually in contact.
 */
import type { Point } from '../core/types';
import { UNIT_ROLE } from '../core/types';
import { getUnitType } from '../core/data/units';
import { tryGetFaction } from '../core/data/factions';
import type { BattleState } from '../core/battle/sim';
import { frontage } from '../core/battle/sim';
import type { BattleSettlement, BattleUnit } from '../core/battle/types';
import { FIELD_DEPTH, FIELD_WIDTH } from '../core/battle/types';
import { WATER, rampFor, snap, stepFor, tileNoise } from './iso/palette';
import { armsCanvas } from './arms';
import { facingIndex, figureFor, figureSprite, poseFor } from './figures';
import { dressGround, grainOf } from './iso/terrain';
import { loadSprites, stamp } from './iso/sprites';

export interface BattleView {
  /** Updated when the window is resized. */
  width: number;
  height: number;
  selected: string | undefined;
  hovered: string | undefined;
  /** Screen pixels per metre of ground. */
  zoom: number;
  /** The point of the field under the middle of the screen, in metres. */
  centre: Point;
  /** True once the player has moved the camera themselves. */
  touched: boolean;
}

/** How many screen pixels go to one pixel of the picture. */
export const PIXEL = 2;

/** The ground is flattened towards the viewer by the usual two to one. */
const SQUASH = 0.5;

/** Close enough that a man is a man rather than a dot. */
export const MAX_BATTLE_ZOOM = 11;

/** Metres of rise to a pixel. The ridge is only forty metres tall. */
const RISE = 1.6;

/**
 * Below this many picture pixels to the metre, a regiment is one token.
 *
 * Judged on the scale rather than on a regiment's frontage, because frontage
 * varies with how many men are left: a unit would otherwise flick between a
 * token and a crowd as it took losses, which is the one thing that must not
 * happen while you are watching it fight.
 *
 * Low, because a battle is the men in it. Above this the regiment is drawn
 * as the men themselves at every zoom the camera will give you, and how many
 * of them fit is decided by the frontage rather than by a threshold — so a
 * line pulled back is a thin crowd rather than a counter.
 */
const DETAIL_SCALE = 0.42;

let spritesAsked = false;

// ---------------------------------------------------------------------------
// Where things are
// ---------------------------------------------------------------------------

interface Frame {
  /** Picture pixels per metre. */
  readonly scale: number;
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly height: number;
}

function frameOf(view: BattleView): Frame {
  const scale = view.zoom / PIXEL;
  const width = view.width / PIXEL;
  const height = view.height / PIXEL;
  return {
    scale,
    width,
    height,
    originX: width / 2 - view.centre.x * scale,
    originY: height / 2 - view.centre.y * scale * SQUASH,
  };
}

/** Where a point of the field floor lands in the picture. */
function floorOf(frame: Frame, point: Point): { x: number; y: number } {
  return {
    x: frame.originX + point.x * frame.scale,
    y: frame.originY + point.y * frame.scale * SQUASH,
  };
}

/** How far up ground of a given height lifts whatever stands on it. */
function lift(frame: Frame, metres: number): number {
  return Math.round((metres / RISE) * frame.scale * SQUASH);
}

export function fitZoom(view: BattleView): number {
  return Math.min(view.width / FIELD_WIDTH, view.height / (FIELD_DEPTH * SQUASH));
}

export function fitBattleCamera(view: BattleView): void {
  view.zoom = fitZoom(view);
  view.centre = { x: FIELD_WIDTH / 2, y: FIELD_DEPTH / 2 };
}

/**
 * Frames the two armies rather than the field.
 *
 * Deployment uses the middle of the ground and leaves the rest as room to
 * manoeuvre, so a camera that fits the whole field spends most of the screen
 * on empty grass.
 */
export function frameBattleCamera(
  view: BattleView,
  units: readonly BattleUnit[],
  settlement?: BattleSettlement | undefined,
): void {
  const standing = units.filter((unit) => !unit.fled && unit.stance !== 'destroyed');
  if (standing.length === 0) {
    fitBattleCamera(view);
    return;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const unit of standing) {
    const half = frontage(unit) / 2;
    minX = Math.min(minX, unit.position.x - half);
    maxX = Math.max(maxX, unit.position.x + half);
    minY = Math.min(minY, unit.position.y);
    maxY = Math.max(maxY, unit.position.y);
  }
  if (settlement) {
    minX = Math.min(minX, settlement.centre.x - settlement.radius);
    maxX = Math.max(maxX, settlement.centre.x + settlement.radius);
    minY = Math.min(minY, settlement.centre.y - settlement.radius);
    maxY = Math.max(maxY, settlement.centre.y + settlement.radius);
  }
  const margin = 55;
  const across = Math.max(200, maxX - minX + margin * 2);
  const deep = Math.max(160, maxY - minY + margin * 2);
  view.centre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  view.zoom = Math.max(
    fitZoom(view) * 0.9,
    Math.min(MAX_BATTLE_ZOOM * 0.65, Math.min(view.width / across, view.height / (deep * SQUASH))),
  );
  clampBattleCamera(view);
}

export function zoomBattleCamera(view: BattleView, factor: number, atX: number, atY: number): void {
  const before = screenToField(view, atX, atY);
  const low = fitZoom(view) * 0.9;
  view.zoom = Math.max(low, Math.min(MAX_BATTLE_ZOOM, view.zoom * factor));
  const after = screenToField(view, atX, atY);
  view.centre = {
    x: view.centre.x + (before.x - after.x),
    y: view.centre.y + (before.y - after.y),
  };
  clampBattleCamera(view);
  view.touched = true;
}

export function panBattleCamera(view: BattleView, dx: number, dy: number): void {
  view.centre = {
    x: view.centre.x - dx / view.zoom,
    y: view.centre.y - dy / (view.zoom * SQUASH),
  };
  clampBattleCamera(view);
  view.touched = true;
}

export function clampBattleCamera(view: BattleView): void {
  const marginX = view.width / view.zoom / 2;
  const marginY = view.height / (view.zoom * SQUASH) / 2;
  view.centre = {
    x: Math.max(-marginX * 0.4, Math.min(FIELD_WIDTH + marginX * 0.4, view.centre.x)),
    y: Math.max(-marginY * 0.4, Math.min(FIELD_DEPTH + marginY * 0.4, view.centre.y)),
  };
}

/**
 * Where a point of the field lands on the screen.
 *
 * The inverse of `screenToField`, and exported so that nothing else has to
 * write the projection out again. A test that reimplemented it was the first
 * thing to break when the picture became isometric, which is the usual
 * argument against copying a formula.
 */
export function fieldToScreen(view: BattleView, point: Point): Point {
  const frame = frameOf(view);
  const at = floorOf(frame, point);
  return { x: at.x * PIXEL, y: at.y * PIXEL };
}

/**
 * Back from the screen to the field floor.
 *
 * The floor, not the ground: a point on screen sits above every height at
 * once. Orders are given on the floor, which is what a commander pointing at
 * a map is doing anyway.
 */
export function screenToField(view: BattleView, x: number, y: number): Point {
  const frame = frameOf(view);
  return {
    x: (x / PIXEL - frame.originX) / frame.scale,
    y: (y / PIXEL - frame.originY) / (frame.scale * SQUASH),
  };
}

/** The unit whose block contains a screen point. */
export function unitAt(
  state: BattleState,
  view: BattleView,
  x: number,
  y: number,
): string | undefined {
  const field = screenToField(view, x, y);
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const unit of state.units) {
    if (unit.stance === 'destroyed' || unit.fled) continue;
    const dx = unit.position.x - field.x;
    // The picture is squashed, so a click is further off in depth than it
    // looks: an arm's length on screen is two on the ground.
    const dy = (unit.position.y - field.y) * SQUASH;
    const distance = Math.hypot(dx, dy);
    const reach = Math.max(25, frontage(unit) / 2);
    if (distance < reach && distance < bestDistance) {
      bestDistance = distance;
      best = unit.id;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

let small: HTMLCanvasElement | undefined;

function picture(width: number, height: number): CanvasRenderingContext2D {
  if (!small) small = document.createElement('canvas');
  if (small.width !== width || small.height !== height) {
    small.width = width;
    small.height = height;
  }
  const ctx = small.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

export function drawBattle(
  ctx: CanvasRenderingContext2D,
  state: BattleState,
  view: BattleView,
): void {
  if (!spritesAsked) {
    spritesAsked = true;
    void loadSprites().catch(() => undefined);
  }
  const frame = frameOf(view);
  const width = Math.max(1, Math.floor(frame.width));
  const height = Math.max(1, Math.floor(frame.height));
  const paint = picture(width, height);

  paint.fillStyle = state.setup.naval ? '#10243a' : '#1b2418';
  paint.fillRect(0, 0, width, height);

  drawGround(paint, state, frame);
  drawWorks(paint, state, frame);
  drawMelee(paint, state, frame);

  // Back to front, so that a rank in front hides the one behind it.
  const ordered = [...state.units]
    .filter((unit) => unit.stance !== 'destroyed' && !unit.fled)
    .sort((a, b) => a.position.y - b.position.y);
  for (const unit of ordered) drawUnit(paint, state, frame, unit);
  drawVolleys(paint, state, frame);

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, view.width, view.height);
  ctx.drawImage(small!, 0, 0, width, height, 0, 0, width * PIXEL, height * PIXEL);

  for (const unit of ordered) drawStandard(ctx, view, frame, unit, state);
  for (const unit of ordered) drawMoraleBar(ctx, view, frame, unit);
  drawSelection(ctx, state, view, frame);
}

/**
 * The field.
 *
 * One ridge and a lot of grass, but the ridge is the whole reason position
 * matters, so it is drawn the same way the campaign map draws the Alps:
 * diamond tiles with a height at each corner.
 */
function drawGround(ctx: CanvasRenderingContext2D, state: BattleState, frame: Frame): void {
  const metresPerTile = Math.max(8, 10 / frame.scale);
  const halfWidth = metresPerTile * frame.scale;
  const halfHeight = halfWidth * SQUASH;
  if (halfWidth < 1) return;
  const ramp = state.setup.naval ? WATER : rampFor(state.setup.terrain);
  const skirt = 120;

  const height = (tx: number, ty: number): number =>
    state.terrainHeight({ x: (tx - ty) * metresPerTile, y: -(tx + ty) * metresPerTile });

  const origin = floorOf(frame, { x: 0, y: 0 });
  const acrossSpan = Math.ceil(frame.width / (halfWidth * 2)) + 3;
  const upFrom = Math.floor((origin.y - frame.height - skirt) / halfHeight) - 2;
  const upTo = Math.ceil((origin.y + skirt) / halfHeight) + 4;
  const acrossCentre = Math.round((frame.width / 2 - origin.x) / halfWidth);

  for (let up = upTo; up >= upFrom; up--) {
    for (let offset = -acrossSpan; offset <= acrossSpan; offset++) {
      const across = acrossCentre + offset;
      if (((across + up) & 1) !== 0) continue;
      const tx = (up + across) / 2;
      const ty = (up - across) / 2;

      const sx = Math.round(origin.x + across * halfWidth);
      const sy = origin.y - up * halfHeight;

      const south = height(tx, ty);
      const east = height(tx + 1, ty);
      const north = height(tx + 1, ty + 1);
      const west = height(tx, ty + 1);
      const yS = Math.round(sy - lift(frame, south));
      const yE = Math.round(sy - halfHeight - lift(frame, east));
      const yW = Math.round(sy - halfHeight - lift(frame, west));
      const yN = Math.round(sy - 2 * halfHeight - lift(frame, north));
      if (Math.min(yN, yE, yS, yW) > frame.height + 4) continue;
      if (Math.max(yN, yE, yS, yW) + skirt < -4) continue;

      const lean = (west - east) * 0.08 + (south - north) * 0.04;
      // A field is not one colour. A tile's own number nudges it a step up or
      // down the ladder, which is most of what makes these pictures look like
      // country instead of a sheet of paint.
      // Subtle. A field is not a chequerboard, and at two screen pixels to
      // the picture pixel a quarter of the tiles a step lighter reads as a
      // pattern rather than as grass.
      const grain = Math.sin(tx * 127.1 + ty * 311.7) * 43758.5453;
      const nudge = grain - Math.floor(grain) > 0.86 ? 1 : 0;
      const face = (which: 'top' | 'left' | 'right'): string =>
        snap(ramp[Math.max(0, Math.min(4, stepFor(which, lean) - (which === 'top' ? nudge : 0)))]!);

      ctx.fillStyle = face('left');
      ctx.beginPath();
      ctx.moveTo(sx - halfWidth, yW);
      ctx.lineTo(sx, yS);
      ctx.lineTo(sx, yS + skirt);
      ctx.lineTo(sx - halfWidth, yW + skirt);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = face('right');
      ctx.beginPath();
      ctx.moveTo(sx, yS);
      ctx.lineTo(sx + halfWidth, yE);
      ctx.lineTo(sx + halfWidth, yE + skirt);
      ctx.lineTo(sx, yS + skirt);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = face('top');
      ctx.beginPath();
      ctx.moveTo(sx, yN);
      ctx.lineTo(sx + halfWidth, yE);
      ctx.lineTo(sx, yS);
      ctx.lineTo(sx - halfWidth, yW);
      ctx.closePath();
      ctx.fill();

      // And whatever grows on it. A battle on farmland is fought across
      // furrows and one in a wood among trees, which is worth having for
      // itself and is also the only thing on the field that gives the eye a
      // sense of how far away anything is.
      if (!state.setup.naval && halfWidth > 3) {
        grainOf(
          ctx,
          sx,
          Math.round((yE + yW) / 2),
          halfWidth,
          halfHeight,
          ramp,
          tx,
          ty,
        );
        dressGround(
          ctx,
          sx,
          Math.round((yE + yW) / 2),
          halfWidth,
          halfHeight,
          state.setup.terrain,
          0,
          tx,
          ty,
          tileNoise(tx, ty),
        );
      }
    }
  }
}

/** The walls, when the battle is an assault. */
function drawWorks(ctx: CanvasRenderingContext2D, state: BattleState, frame: Frame): void {
  const settlement = state.setup.settlement;
  if (!settlement) return;
  const centre = floorOf(frame, settlement.centre);
  const radius = settlement.radius * frame.scale;
  const breached = settlement.integrity <= 0.35;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y, radius, radius * SQUASH, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#9a8f74';
  ctx.fill();
  ctx.strokeStyle = breached ? '#9a6b60' : '#cfc8b4';
  ctx.lineWidth = Math.max(1, radius * 0.06);
  if (breached) {
    ctx.beginPath();
    ctx.ellipse(centre.x, centre.y, radius, radius * SQUASH, 0, Math.PI * 0.18, Math.PI * 1.82);
    ctx.stroke();
  } else {
    ctx.stroke();
  }
  // A few roofs inside, enough to say it is a town.
  for (let i = 0; i < 14; i++) {
    const angle = (i * 2.399963) % (Math.PI * 2);
    const reach = radius * 0.72 * Math.sqrt((i + 0.5) / 14);
    stamp(
      ctx,
      'town0',
      centre.x + Math.cos(angle) * reach,
      centre.y + Math.sin(angle) * reach * SQUASH,
      Math.max(8, radius * 0.34),
    );
  }
  ctx.restore();
}

/**
 * One regiment.
 *
 * Wide enough on screen and it is drawn as the men in it, in the ranks and
 * files the simulation is using, thinning from the back as they are killed.
 * Narrower than that and it is one token, because a hundred figures three
 * pixels apart is a smudge that tells you less than a standard does.
 */
function drawUnit(
  ctx: CanvasRenderingContext2D,
  state: BattleState,
  frame: Frame,
  unit: BattleUnit,
): void {
  const type = getUnitType(unit.type);
  const mounted = type.mounted;
  const afloat = type.unitClass === 'warship' || type.unitClass === 'transport';
  const colour = tryGetFaction(unit.faction)?.colour ?? '#9a9a9a';
  const across = frontage(unit) * frame.scale;
  const standing = Math.max(0.05, unit.soldiers / Math.max(1, unit.startingSoldiers));
  const ground = state.terrainHeight(unit.position);
  const at = floorOf(frame, unit.position);
  const baseY = at.y - lift(frame, ground);
  if (at.x < -40 || at.x > frame.width + 40) return;
  if (baseY < -60 || baseY > frame.height + 60) return;

  ctx.globalAlpha = unit.stance === 'routing' ? 0.6 : 1;

  if (afloat) {
    // A hull's length is her own, not a function of how many men are aboard
    // this morning: a galley is forty metres whether she is full or half dead.
    const length = (16 + type.soldiers * 0.28) * frame.scale;
    stamp(ctx, type.unitClass === 'warship' ? 'galley' : 'roundship',
      at.x, baseY, Math.max(16, length), colour);
    ctx.globalAlpha = 1;
    return;
  }

  if (frame.scale < DETAIL_SCALE) {
    stamp(ctx, mounted ? 'horsemen' : 'footmen', at.x, baseY,
      Math.max(10, across * 1.6), colour);
    ctx.globalAlpha = 1;
    return;
  }

  // The dead, where they fell: a mark a man, behind the line, as many as the
  // regiment has lost. The simulation does not keep a body's position and
  // does not need to — what the eye reads off a field is how much of it has
  // been fought over, and that is the count.
  const lost = Math.max(0, unit.startingSoldiers - unit.soldiers);
  if (lost > 0 && frame.scale > 0.6) {
    const marks = Math.min(26, Math.round(lost / Math.max(6, unit.startingSoldiers / 22)));
    ctx.fillStyle = 'rgba(58, 36, 28, 0.55)';
    for (let i = 0; i < marks; i++) {
      const a = tileNoise(Math.round(unit.position.x), i, 13);
      const b = tileNoise(Math.round(unit.position.y), i, 29);
      const px = Math.round(at.x + (a - 0.5) * across * 1.25);
      const py = Math.round(baseY + (b * 0.5 + 0.1) * frame.scale * 26 * SQUASH);
      ctx.fillRect(px, py, Math.max(1, Math.round(frame.scale * 2.4)), 1);
    }
  }

  // The men themselves. Ranks run back into the picture, so each one is
  // drawn a little higher than the one in front of it.
  //
  // A man is drawn far larger than his share of the ground, and on purpose:
  // a field is 1400 metres across and a man is one, so at the ground's own
  // scale he is a pixel. The rank behind is therefore offset by a share of
  // his own height rather than by the metre and a half he is really
  // standing back, or the ranks land on top of each other and a regiment is
  // one row of heads.
  const ranks = type.unitClass === 'pikemen' || type.unitClass === 'spearmen' ? 4 : 3;
  const manSize = Math.max(6, Math.min(34, frame.scale * 13));
  // As many files as will stand shoulder to shoulder across the frontage the
  // simulation is using, and no more.
  const files = Math.max(
    1,
    Math.min(Math.round(unit.soldiers / ranks), Math.round(across / (manSize * 0.4))),
  );
  const rankStep = manSize * (mounted ? 0.5 : 0.42);
  const figures = Math.max(1, Math.round(files * ranks * standing));
  const kind = figureFor(type.unitClass);
  const facing = facingIndex(unit.facing, SQUASH);
  // A regiment pressed up against another leans into it. One offset on the
  // whole block, toward whoever it is fighting, and a line of battle stops
  // being two blocks a pace apart and becomes two blocks in contact.
  const press = unit.stance === 'melee' ? Math.sin(state.time * 2.4) * manSize * 0.08 : 0;

  let placed = 0;
  for (let rank = ranks - 1; rank >= 0 && placed < figures; rank--) {
    const back = rank * rankStep;
    for (let file = 0; file < files && placed < figures; file++) {
      placed += 1;
      // Not a perfect lattice: a rank nudged half a man along reads as men
      // standing in it rather than as a comb.
      const shift = rank % 2 === 1 ? (across / files) * 0.5 : 0;
      const x = at.x - across / 2 + (across / files) * (file + 0.5) + shift;
      // Only the rank in contact is swinging; the ones behind it are
      // waiting, which is what the ranks behind were actually doing.
      const pose = poseFor(
        rank === 0 ? unit.stance : quietStance(unit.stance),
        state.time,
        placed,
      );
      stamp(
        ctx,
        figureSprite(kind, facing, pose),
        x + (rank === 0 ? press : 0),
        baseY - back,
        manSize,
        colour,
      );
    }
  }
  ctx.globalAlpha = 1;
}

/** What the ranks behind the fighting are doing, which is standing. */
function quietStance(stance: string): string {
  return stance === 'melee' ? 'holding' : stance;
}

/**
 * The standard over a regiment.
 *
 * A line of men all in one colour is a line of men; the thing that made a
 * medieval battlefield readable, to the men in it as much as to anybody
 * watching, was the banner over each body of them. This is that, in the
 * realm's own arms, drawn at the screen's own resolution because a coat of
 * arms four pixels across is a smudge.
 */
function drawStandard(
  ctx: CanvasRenderingContext2D,
  view: BattleView,
  frame: Frame,
  unit: BattleUnit,
  state: BattleState,
): void {
  if (unit.stance === 'destroyed' || unit.fled) return;
  const ground = state.terrainHeight(unit.position);
  const at = floorOf(frame, unit.position);
  const baseY = at.y - lift(frame, ground);
  const x = at.x * PIXEL;
  const y = baseY * PIXEL;
  if (x < -30 || x > view.width + 30 || y < -40 || y > view.height + 40) return;

  const height = Math.max(12, Math.min(30, frame.scale * 16));
  const flagWidth = Math.round(height * 0.78);
  const flagHeight = Math.round(height * 0.62);
  // Clear of the men. The back rank stands about three men's heights up the
  // picture from the front one, and a banner through the middle of its own
  // regiment is a banner nobody can see.
  const overhead = Math.max(14, frame.scale * 34) * PIXEL * 0.5;
  const top = y - height - overhead;
  ctx.globalAlpha = unit.stance === 'routing' ? 0.55 : 1;
  ctx.fillStyle = 'rgba(10, 12, 10, 0.85)';
  ctx.fillRect(Math.round(x) - 1, Math.round(top), 2, height + Math.max(8, frame.scale * 14));
  // The cloth moves. Four strips of it, each lagging the one before, which
  // is the cheapest wave there is and the only thing on a battlefield that
  // is never still.
  const cloth = armsCanvas(unit.faction, flagWidth, flagHeight, 'banner');
  const strips = 4;
  const strip = flagWidth / strips;
  for (let i = 0; i < strips; i++) {
    const wave = Math.round(Math.sin(state.time * 2.6 + i * 0.85) * flagHeight * 0.11);
    ctx.drawImage(
      cloth,
      i * strip, 0, strip, flagHeight,
      Math.round(x) + 1 + i * strip, Math.round(top) + wave, strip, flagHeight,
    );
  }
  ctx.globalAlpha = 1;
}

/** Dust where two units are actually in contact. */
function drawMelee(ctx: CanvasRenderingContext2D, state: BattleState, frame: Frame): void {
  const byId = new Map(state.units.map((unit) => [unit.id, unit]));
  const seen = new Set<string>();
  for (const unit of state.units) {
    if (unit.fled || unit.stance === 'destroyed') continue;
    for (const otherId of unit.engagedWith) {
      const pair = unit.id < otherId ? `${unit.id}|${otherId}` : `${otherId}|${unit.id}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      const other = byId.get(otherId);
      if (!other || other.fled) continue;
      const a = floorOf(frame, unit.position);
      const b = floorOf(frame, other.position);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const reach = Math.max(6, Math.hypot(a.x - b.x, a.y - b.y) * 0.7);
      ctx.fillStyle = 'rgba(226, 214, 184, 0.28)';
      ctx.beginPath();
      ctx.ellipse(mx, my, reach, reach * SQUASH, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Arrows, only where the simulation would have that unit shooting. */
function drawVolleys(ctx: CanvasRenderingContext2D, state: BattleState, frame: Frame): void {
  const byId = new Map(state.units.map((unit) => [unit.id, unit]));
  ctx.strokeStyle = 'rgba(240, 234, 214, 0.7)';
  ctx.lineWidth = 1;
  for (const unit of state.units) {
    if (unit.fled || unit.stance === 'destroyed' || unit.stance === 'routing') continue;
    if (unit.engagedWith.length > 0 || unit.ammunition <= 0) continue;
    const type = getUnitType(unit.type);
    if (UNIT_ROLE[type.unitClass] !== 'missile' || type.range <= 0) continue;
    const target = unit.order.targetUnit ? byId.get(unit.order.targetUnit) : undefined;
    if (!target || target.fled || target.stance === 'destroyed') continue;
    const distance = Math.hypot(
      target.position.x - unit.position.x,
      target.position.y - unit.position.y,
    );
    if (distance > type.range) continue;

    const from = floorOf(frame, unit.position);
    const to = floorOf(frame, target.position);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const t = (i + 0.5) / 6;
      const spread = ((i * 37) % 11) - 5;
      const x = from.x + (to.x - from.x) * t + spread;
      // A shaft arcs: highest at the middle of its flight.
      const arc = Math.sin(t * Math.PI) * 6;
      const y = from.y + (to.y - from.y) * t + spread * 0.3 - arc;
      ctx.moveTo(x, y);
      ctx.lineTo(x + (to.x - from.x) * 0.02, y + (to.y - from.y) * 0.02);
    }
    ctx.stroke();
  }
}

function drawMoraleBar(
  ctx: CanvasRenderingContext2D,
  view: BattleView,
  frame: Frame,
  unit: BattleUnit,
): void {
  const type = getUnitType(unit.type);
  const threshold = Math.max(1, type.morale);
  const wavering = unit.shock / threshold;
  if (wavering <= 0.25 && unit.stance !== 'routing') return;
  const at = floorOf(frame, unit.position);
  const width = Math.max(18, frontage(unit) * frame.scale * PIXEL);
  const x = at.x * PIXEL;
  const y = at.y * PIXEL - 22;
  if (x < 0 || x > view.width) return;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x - width / 2, y, width, 3);
  ctx.fillStyle = unit.stance === 'routing' ? '#e2574c' : wavering > 0.7 ? '#e5a33a' : '#d8d2a8';
  ctx.fillRect(x - width / 2, y, width * Math.max(0, Math.min(1, 1 - wavering)), 3);
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  state: BattleState,
  view: BattleView,
  frame: Frame,
): void {
  for (const [id, colour, weight] of [
    [view.hovered, 'rgba(255,255,255,0.6)', 1.5] as const,
    [view.selected, '#ffe28a', 2.4] as const,
  ]) {
    if (!id) continue;
    const unit = state.units.find((candidate) => candidate.id === id);
    if (!unit || unit.fled || unit.stance === 'destroyed') continue;
    const at = floorOf(frame, unit.position);
    const radius = Math.max(14, (frontage(unit) * frame.scale * PIXEL) / 2 + 6);
    ctx.beginPath();
    ctx.ellipse(at.x * PIXEL, at.y * PIXEL, radius, radius * SQUASH, 0, 0, Math.PI * 2);
    ctx.strokeStyle = colour;
    ctx.lineWidth = weight;
    ctx.setLineDash(id === view.hovered ? [4, 4] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

