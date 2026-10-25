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
import type { FactionId, Point } from '../core/types';
import { UNIT_ROLE } from '../core/types';
import { getUnitType } from '../core/data/units';
import { tryGetFaction } from '../core/data/factions';
import { deviceOf } from '../core/data/heraldry';
import type { BattleState } from '../core/battle/sim';
import { frontage, isShooting } from '../core/battle/sim';
import type { BattleSettlement, BattleUnit, Fallen, Side } from '../core/battle/types';
import { FIELD_DEPTH, FIELD_WIDTH } from '../core/battle/types';
import { WATER, patchOf, rampFor, snap, snowy, stepFor, tileNoise } from './iso/palette';
import { armsCanvas } from './arms';
import {
  FALL_SECONDS,
  facingIndex,
  fallingSprite,
  figureFor,
  figureSprite,
  isEngine,
  kitFor,
  poseFor,
} from './figures';
import { drawPrecipitation, drawSky, snowCover, veilOf } from './weather';
import { drawGrade } from './grade';
import { dressGround, grainOf } from './iso/terrain';
import { atManHeight, loadSprites, stamp } from './iso/sprites';

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
  /**
   * Whose eyes this is. Enemy regiments fade out past what the weather and
   * the hour allow anyone to see; your own never do, because you know where
   * you put them. Left undefined for a battle nobody is commanding, which
   * is drawn with the whole field visible.
   */
  side: Side | undefined;
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
  drawFallen(paint, state, frame);
  drawMelee(paint, state, frame);

  // Back to front, so that a rank in front hides the one behind it.
  const ordered = [...state.units]
    .filter((unit) => unit.stance !== 'destroyed' && !unit.fled)
    .sort((a, b) => a.position.y - b.position.y);
  // How plainly each one can be seen from where the player is standing,
  // worked out once: the standard over a regiment fades with the regiment.
  const seen = new Map<string, number>();
  for (const unit of ordered) {
    seen.set(unit.id, veilOf(state, unit.position, view.side, unit.side));
  }
  for (const unit of ordered) drawUnit(paint, state, frame, unit, seen.get(unit.id) ?? 1);
  drawVolleys(paint, state, frame, seen);
  // The light, and then what is falling through it. The wash goes under the
  // rain rather than over it, because rain you cannot see is not weather,
  // it is a grey screen.
  drawSky(paint, state, width, height, state.time);
  drawPrecipitation(paint, state, width, height, state.time);
  // And the camera's own two pence: the corners down, and everything pulled
  // a little towards the same afternoon. On the small canvas, so the corner
  // shade is made of picture pixels like the rest of it.
  drawGrade(paint, width, height);

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, view.width, view.height);
  ctx.drawImage(small!, 0, 0, width, height, 0, 0, width * PIXEL, height * PIXEL);

  for (const unit of ordered) drawStandard(ctx, view, frame, unit, state, seen.get(unit.id) ?? 1);
  for (const unit of ordered) {
    if ((seen.get(unit.id) ?? 1) > 0.3) drawMoraleBar(ctx, view, frame, unit);
  }
  drawSelection(ctx, state, view, frame);
}

// ---------------------------------------------------------------------------
// The dead
// ---------------------------------------------------------------------------

/**
 * Where the bodies are, nearest last.
 *
 * The list only ever grows, so it is sorted again when it has grown and not
 * once a frame. A long battle ends with a few thousand men on the ground and
 * re-sorting them sixty times a second to draw the same picture would be the
 * most expensive thing on this screen by a wide margin.
 */
let bodies: { state: BattleState; count: number; sorted: Fallen[] } | undefined;

function fallenInOrder(state: BattleState): readonly Fallen[] {
  if (!bodies || bodies.state !== state || bodies.count !== state.fallen.length) {
    bodies = {
      state,
      count: state.fallen.length,
      sorted: [...state.fallen].sort((a, b) => a.y - b.y),
    };
  }
  return bodies.sorted;
}

/**
 * A realm's two colours, looked up once.
 *
 * A field of four thousand bodies asks for these four thousand times a
 * frame, and both of them are a table lookup and a parse behind a function
 * call that will give the same answer every time until the game is closed.
 */
const liveries = new Map<string, { colour: string; device: string }>();

function liveryOf(faction: FactionId): { colour: string; device: string } {
  let livery = liveries.get(faction);
  if (!livery) {
    livery = {
      colour: tryGetFaction(faction)?.colour ?? '#9a9a9a',
      device: deviceOf(faction),
    };
    liveries.set(faction, livery);
  }
  return livery;
}

/**
 * The dead, where they died.
 *
 * They used to be a scatter pinned to the regiment that had lost them, which
 * meant a regiment dragged its own dead across the field behind it and took
 * them away when it marched off. These are the men the simulation actually
 * killed, at the place and the moment it killed them, and they stay there
 * for the rest of the day — which is what a battlefield is.
 *
 * A man takes a second to go down. For that second he is drawn falling, at
 * a size running from a standing man's down to a body's, so that the moment
 * of dying is the one thing on this field that is not a cut between two
 * pictures. They are never veiled by the weather: a corpse is ground, not
 * intelligence, and knowing men died over there tells you nothing about who
 * is standing there now.
 */
function drawFallen(ctx: CanvasRenderingContext2D, state: BattleState, frame: Frame): void {
  if (frame.scale < 0.45 || state.fallen.length === 0) return;
  const lying = Math.max(5, Math.min(22, frame.scale * 9));
  const standing = Math.max(6, Math.min(32, frame.scale * 12));
  for (const body of fallenInOrder(state)) {
    const at = floorOf(frame, body);
    const y = at.y - lift(frame, state.terrainHeight(body));
    if (at.x < -40 || at.x > frame.width + 40) continue;
    if (y < -60 || y > frame.height + 60) continue;
    const livery = liveryOf(body.faction);
    const since = state.time - body.at;
    if (since >= 0 && since < FALL_SECONDS) {
      const through = since / FALL_SECONDS;
      const going = fallingSprite(body.kit, facingIndex(body.facing, SQUASH), since);
      stamp(
        ctx,
        going,
        at.x,
        y,
        atManHeight(going, standing + (lying - standing) * through),
        livery.colour,
        true,
        livery.device,
      );
    } else {
      const down = body.kit ? 'fallen2' : 'fallen';
      stamp(ctx, down, at.x, y, atManHeight(down, lying), livery.colour, false, livery.device);
    }
  }
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
  // Snow lies on the ground rather than only falling through the air. The
  // wash over the finished picture can only ever darken or veil, so a field
  // under a snowstorm came out looking like mud until the ladder itself went
  // white — and because the cover follows the sky, it melts back off over
  // the half minute a change takes.
  const cover = state.setup.naval ? 0 : snowCover(state) * 0.78;
  const ramp = state.setup.naval ? WATER : snowy(rampFor(state.setup.terrain), cover);
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
      // A field is not one colour, and it is not one colour per tile either.
      //
      // The tile's own number gives the speckle, which is grass. What gives
      // the ground its shape at any distance is coarser than a tile and has
      // to be: a stretch of thicker growing a dozen tiles across, and a bare
      // one beside it. Judged on the same patches that decide what grows
      // here, so the colour and the cover agree — the dark going is the
      // going with the trees in it.
      const grain = Math.sin(tx * 127.1 + ty * 311.7) * 43758.5453;
      const speck = grain - Math.floor(grain) > 0.88 ? 1 : 0;
      const place = patchOf(tx, ty, 7, 23);
      const nudge = speck + (place > 0.63 ? 1 : place < 0.33 ? -1 : 0);
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
          cover,
          patchOf(tx, ty, 7, 23),
        );
      }
    }
  }
}

/** The walls, when the battle is an assault. */
function drawWorks(ctx: CanvasRenderingContext2D, state: BattleState, frame: Frame): void {
  const settlement = state.settlement;
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
  // A few roofs inside, enough to say it is a town — in the colours of
  // whoever is defending it. They were stamped with no colour at all, which
  // meant the marker survived the recolour it never got: every town under
  // assault had magenta banners over magenta roofs.
  const livery = liveryOf(state.setup.defender);
  for (let i = 0; i < 14; i++) {
    const angle = (i * 2.399963) % (Math.PI * 2);
    const reach = radius * 0.72 * Math.sqrt((i + 0.5) / 14);
    stamp(
      ctx,
      'town0',
      centre.x + Math.cos(angle) * reach,
      centre.y + Math.sin(angle) * reach * SQUASH,
      Math.max(8, radius * 0.34),
      livery.colour,
      true,
      livery.device,
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
  veil: number,
): void {
  if (veil <= 0.02) return;
  const type = getUnitType(unit.type);
  const mounted = type.mounted;
  const afloat = type.unitClass === 'warship' || type.unitClass === 'transport';
  const { colour, device } = liveryOf(unit.faction);
  const across = frontage(unit) * frame.scale;
  const standing = Math.max(0.05, unit.soldiers / Math.max(1, unit.startingSoldiers));
  const ground = state.terrainHeight(unit.position);
  const at = floorOf(frame, unit.position);
  const baseY = at.y - lift(frame, ground);
  if (at.x < -40 || at.x > frame.width + 40) return;
  if (baseY < -60 || baseY > frame.height + 60) return;

  ctx.globalAlpha = (unit.stance === 'routing' ? 0.6 : 1) * veil;

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

  const kind = figureFor(type.unitClass, unit.type);
  const facing = facingIndex(unit.facing, SQUASH);

  if (isEngine(kind)) {
    // A siege train is machines, not ranks: one engine to a dozen crew, laid
    // out along whatever frontage it has, and never fewer than one. Each
    // sprite carries its own gunners, which is why no men are drawn here.
    const pieces = Math.max(1, Math.min(6, Math.round(unit.soldiers / 14)));
    const size = Math.max(10, Math.min(52, frame.scale * 22));
    const span = Math.max(across, size * pieces * 0.85);
    const loosing = isShooting(state, unit);
    for (let i = 0; i < pieces; i++) {
      // A battery does not loose together. The model fires at a steady rate
      // rather than in shots, so this is the one thing on the field drawn to
      // a cadence of its own: each piece shows its loosing frame in turn for
      // as long as it takes to see, while the regiment is in fact shooting.
      const working = loosing && (state.time + i * 3.1) % 9 < 1.3;
      const piece = figureSprite(kind, 0, facing, working ? 'fight' : 'idle');
      stamp(
        ctx,
        piece,
        at.x - span / 2 + (span / pieces) * (i + 0.5),
        baseY,
        atManHeight(piece, size),
        colour,
        true,
        device,
      );
    }
    ctx.globalAlpha = 1;
    return;
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
  // How tall the men are, in pixels, and it means the men: every sprite is
  // framed to fit what is in it, so a pike or a horse in the frame used to
  // shrink the man to make room. `atManHeight` undoes that at the stamp, so
  // this number is the height of a figure and not the height of a picture
  // that has a figure somewhere in it.
  const manSize = Math.max(6, Math.min(32, frame.scale * 12));
  // As many files as will stand shoulder to shoulder across the frontage the
  // simulation is using, and no more. A horse takes a good deal more room
  // than a man both ways, and now that it is drawn at the size a horse
  // actually is, it has to be given that room: packed at a footman's
  // spacing a troop of cavalry is one brown mass with heads on top.
  const abreast = manSize * (mounted ? 0.78 : 0.4);
  const files = Math.max(
    1,
    Math.min(Math.round(unit.soldiers / ranks), Math.round(across / abreast)),
  );
  const rankStep = manSize * (mounted ? 0.82 : 0.42);
  const figures = Math.max(1, Math.round(files * ranks * standing));
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
      // And a pixel of slop per man, fixed to who he is, so that a block is
      // a body of men rather than a lattice of them.
      const slop = Math.round(tileNoise(file, rank, 71) * 2) - 1;
      // Only the rank in contact is swinging; the ones behind it are
      // waiting, which is what the ranks behind were actually doing.
      const pose = poseFor(
        rank === 0 ? unit.stance : quietStance(unit.stance),
        state.time,
        placed,
      );
      const sprite = figureSprite(kind, kitFor(file, rank), facing, pose);
      stamp(
        ctx,
        sprite,
        x + (rank === 0 ? press : 0),
        baseY - back + slop,
        atManHeight(sprite, manSize),
        colour,
        true,
        device,
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
  veil: number,
): void {
  if (unit.stance === 'destroyed' || unit.fled) return;
  if (veil <= 0.02) return;
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
  ctx.globalAlpha = (unit.stance === 'routing' ? 0.55 : 1) * veil;
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

/** How many puffs go up along one contact, and how long each one lasts. */
const PUFFS = 7;
const PUFF_SECONDS = 3.4;

/**
 * Dust where two units are actually in contact.
 *
 * It used to be one flat ellipse laid between the two regiments, which says
 * that something is happening there and nothing else: a disc of the same
 * paint, the same size, in the same place, for as long as the fight lasts.
 * Dust does not do that. It goes up in gouts where feet are, it thins as it
 * rises, and it is never the same shape twice.
 *
 * So: a line of puffs across the contact, each with its own size and its own
 * moment, every one of them a function of the clock and of which pair of
 * regiments it belongs to and of nothing else. Nothing is stored, nothing
 * accumulates, and a battle paused at the same second draws the same dust —
 * which is the rule the whole field is drawn under.
 */
function drawMelee(ctx: CanvasRenderingContext2D, state: BattleState, frame: Frame): void {
  const byId = new Map(state.units.map((unit) => [unit.id, unit]));
  const seen = new Set<string>();
  let index = 0;
  for (const unit of state.units) {
    if (unit.fled || unit.stance === 'destroyed') continue;
    for (const otherId of unit.engagedWith) {
      const pair = unit.id < otherId ? `${unit.id}|${otherId}` : `${otherId}|${unit.id}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      const other = byId.get(otherId);
      if (!other || other.fled) continue;
      index += 1;
      const a = floorOf(frame, unit.position);
      const b = floorOf(frame, other.position);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      // Along the line between the two of them, which is where the men are.
      const span = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
      const alongX = (b.x - a.x) / span;
      const alongY = (b.y - a.y) / span;
      const reach = Math.max(6, span * 0.7);
      for (let puff = 0; puff < PUFFS; puff++) {
        const own = tileNoise(index, puff, 13);
        const drift = tileNoise(index, puff, 29);
        // Each puff keeps its own place in the cycle, so the line of them is
        // never one breath in and out together.
        const age = ((state.time / PUFF_SECONDS) + own) % 1;
        const along = ((puff + 0.5) / PUFFS - 0.5) * reach * 1.5;
        const size = reach * (0.2 + own * 0.22) * (0.55 + age * 0.75);
        const x = mx + alongX * along + (drift - 0.5) * reach * 0.3;
        // Up and off the ground as it ages, which is the whole of what makes
        // it dust rather than a stain.
        const y = my + alongY * along * SQUASH - age * reach * 0.42;
        const fade = (1 - age) * (age < 0.18 ? age / 0.18 : 1) * 0.3;
        ctx.fillStyle = `rgba(216, 206, 180, ${fade.toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(x, y, size, size * 0.72, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

/** Arrows, only where the simulation would have that unit shooting. */
function drawVolleys(
  ctx: CanvasRenderingContext2D,
  state: BattleState,
  frame: Frame,
  seen: ReadonlyMap<string, number>,
): void {
  const byId = new Map(state.units.map((unit) => [unit.id, unit]));
  ctx.strokeStyle = 'rgba(240, 234, 214, 0.7)';
  ctx.lineWidth = 1;
  for (const unit of state.units) {
    if ((seen.get(unit.id) ?? 1) <= 0.25) continue;
    const type = getUnitType(unit.type);
    if (UNIT_ROLE[type.unitClass] !== 'missile') continue;
    if (!isShooting(state, unit)) continue;
    const target = unit.order.targetUnit ? byId.get(unit.order.targetUnit) : undefined;
    if (!target) continue;

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

