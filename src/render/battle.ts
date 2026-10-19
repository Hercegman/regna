/**
 * Battle renderer.
 *
 * A regiment is drawn as the men in it: a block of individual figures in
 * ranks and files, as many of them as are still standing, facing the way the
 * unit faces. Losses thin the block from the back, so a line that is about to
 * give way looks like one. The ground is shaded by its own slope and carries
 * the growth it would carry, which is what makes a ridge worth holding look
 * like a ridge.
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
import { drawTerrainMark, jitter, terrainColour } from './mapArt';

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

/** Close enough that a man is a man rather than a dot. */
export const MAX_BATTLE_ZOOM = 6;

/** The zoom at which the whole field is on screen. */
export function fitZoom(view: BattleView): number {
  return Math.min(view.width / FIELD_WIDTH, view.height / FIELD_DEPTH);
}

/** Puts the whole field on screen. */
export function fitBattleCamera(view: BattleView): void {
  view.zoom = fitZoom(view);
  view.centre = { x: FIELD_WIDTH / 2, y: FIELD_DEPTH / 2 };
}

/**
 * Frames the two armies rather than the field.
 *
 * Deployment uses the middle of the ground and leaves the rest as room to
 * manoeuvre, so a camera that fits the whole field spends most of the screen
 * on empty grass. Framing the men instead roughly doubles the scale, which is
 * the difference between seeing regiments and seeing marks.
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
  // The place being stormed is the point of the battle, so it is in the frame
  // whether or not anyone is standing on the far side of it.
  if (settlement) {
    minX = Math.min(minX, settlement.centre.x - settlement.radius);
    maxX = Math.max(maxX, settlement.centre.x + settlement.radius);
    minY = Math.min(minY, settlement.centre.y - settlement.radius);
    maxY = Math.max(maxY, settlement.centre.y + settlement.radius);
  }
  // Room for the standards above the line and for an advance to begin.
  const margin = 90;
  const width = Math.max(200, maxX - minX + margin * 2);
  const depth = Math.max(160, maxY - minY + margin * 2);
  view.centre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  view.zoom = Math.max(
    fitZoom(view) * 0.9,
    Math.min(MAX_BATTLE_ZOOM * 0.65, Math.min(view.width / width, view.height / depth)),
  );
  clampBattleCamera(view);
}

/**
 * Zooms about a point on screen, so the ground under the cursor stays under
 * the cursor. The field may not be left entirely: there is nothing out there.
 */
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
  view.centre = { x: view.centre.x - dx / view.zoom, y: view.centre.y - dy / view.zoom };
  clampBattleCamera(view);
  view.touched = true;
}

/** Keeps at least the middle of the screen over the field. */
export function clampBattleCamera(view: BattleView): void {
  const marginX = view.width / view.zoom / 2;
  const marginY = view.height / view.zoom / 2;
  view.centre = {
    x: Math.max(-marginX * 0.4, Math.min(FIELD_WIDTH + marginX * 0.4, view.centre.x)),
    y: Math.max(-marginY * 0.4, Math.min(FIELD_DEPTH + marginY * 0.4, view.centre.y)),
  };
}

function fieldToScreen(view: BattleView, point: Point): Point {
  return {
    x: (point.x - view.centre.x) * view.zoom + view.width / 2,
    y: (point.y - view.centre.y) * view.zoom + view.height / 2,
  };
}

export function screenToField(view: BattleView, x: number, y: number): Point {
  return {
    x: (x - view.width / 2) / view.zoom + view.centre.x,
    y: (y - view.height / 2) / view.zoom + view.centre.y,
  };
}

/** The unit whose block contains a screen point. */
export function unitAt(state: BattleState, view: BattleView, x: number, y: number): string | undefined {
  const field = screenToField(view, x, y);
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const unit of state.units) {
    if (unit.stance === 'destroyed' || unit.fled) continue;
    const dx = unit.position.x - field.x;
    const dy = unit.position.y - field.y;
    const distance = Math.hypot(dx, dy);
    const reach = Math.max(25, frontage(unit) / 2);
    if (distance < reach && distance < bestDistance) {
      bestDistance = distance;
      best = unit.id;
    }
  }
  return best;
}

export function drawBattle(
  ctx: CanvasRenderingContext2D,
  state: BattleState,
  view: BattleView,
): void {
  ctx.clearRect(0, 0, view.width, view.height);
  drawGround(ctx, state, view);
  drawMelee(ctx, state, view);
  // Routed units go underneath, so the standing line stays readable.
  for (const unit of state.units) if (unit.stance === 'routing') drawUnit(ctx, view, unit);
  for (const unit of state.units) if (unit.stance !== 'routing') drawUnit(ctx, view, unit);
  drawVolleys(ctx, state, view);
  for (const unit of state.units) drawMoraleBar(ctx, view, unit);
  drawSelection(ctx, state, view);
  drawVignette(ctx, view);
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

/**
 * The ground: its colour, its slopes and what grows on it.
 *
 * Shading is by slope rather than by height. A uniform rise is invisible when
 * you colour by altitude, but the moment you light it from one side the shape
 * of the land appears, and the player can see at a glance which way the charge
 * will be running.
 */
function drawGround(ctx: CanvasRenderingContext2D, state: BattleState, view: BattleView): void {
  if (state.setup.naval) {
    drawOpenWater(ctx, view);
  } else {
    drawLand(ctx, state, view);
  }

  const settlement = state.setup.settlement;
  if (settlement) drawSettlementWorks(ctx, view, state, settlement.integrity);
}

function drawOpenWater(ctx: CanvasRenderingContext2D, view: BattleView): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, view.height);
  gradient.addColorStop(0, '#16222e');
  gradient.addColorStop(0.5, '#1d3345');
  gradient.addColorStop(1, '#16222e');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, view.width, view.height);

  ctx.strokeStyle = 'rgba(140, 186, 220, 0.07)';
  ctx.lineWidth = 1;
  for (let y = 18; y < view.height; y += 34) {
    ctx.beginPath();
    for (let x = 0; x <= view.width; x += 16) {
      const lift = Math.sin(x / 70 + y / 40) * 4 + Math.sin(x / 23 - y / 90) * 2;
      if (x === 0) ctx.moveTo(x, y + lift);
      else ctx.lineTo(x, y + lift);
    }
    ctx.stroke();
  }
}

function drawLand(ctx: CanvasRenderingContext2D, state: BattleState, view: BattleView): void {
  const terrain = state.setup.terrain;
  ctx.fillStyle = terrainColour(terrain);
  ctx.fillRect(0, 0, view.width, view.height);

  // Hillshade. The sample step is the shading's resolution; 14px is fine
  // enough for a smooth slope and coarse enough to stay cheap at 8x speed.
  const step = 14;
  const metres = (step / view.width) * FIELD_WIDTH;
  for (let y = 0; y < view.height; y += step) {
    for (let x = 0; x < view.width; x += step) {
      const here = screenToField(view, x + step / 2, y + step / 2);
      const h = state.terrainHeight(here);
      const dx = (state.terrainHeight({ x: here.x + metres, y: here.y }) - h) / metres;
      const dy = (state.terrainHeight({ x: here.x, y: here.y + metres }) - h) / metres;
      // Light from the north-west, as every map in Christendom is lit.
      const light = (-dx - dy) * 2.6 + h / 900;
      const shade = Math.max(-0.3, Math.min(0.3, light));
      ctx.fillStyle = shade >= 0 ? `rgba(255,250,232,${shade})` : `rgba(26,24,16,${-shade})`;
      ctx.fillRect(x, y, step, step);
    }
  }

  drawGrowth(ctx, state, view, terrain);
}

/**
 * What stands on the ground, in metres: how far apart, and how big. A tree is
 * about eight metres across, a stook of corn about two, a crag twenty.
 */
const GROWTH: Partial<Record<string, { spacing: number; size: number }>> = {
  forest: { spacing: 20, size: 4 },
  mountains: { spacing: 58, size: 10 },
  hills: { spacing: 66, size: 7 },
  marsh: { spacing: 24, size: 2.6 },
  farmland: { spacing: 30, size: 3 },
  steppe: { spacing: 22, size: 2 },
  desert: { spacing: 64, size: 9 },
  plains: { spacing: 32, size: 2 },
  coastal: { spacing: 32, size: 2.4 },
};

/**
 * What grows on the field, scattered on a jittered grid. The scatter is a
 * function of position alone, so it does not crawl as the battle runs.
 */
function drawGrowth(
  ctx: CanvasRenderingContext2D,
  state: BattleState,
  view: BattleView,
  terrain: string,
): void {
  const growth = GROWTH[terrain];
  if (!growth) return;
  const { spacing, size } = growth;
  const settlement = state.setup.settlement;

  // Zoomed out there is no room on screen for every tree, so a deterministic
  // fraction of them is drawn. The test is a threshold on each point's own
  // number, which means zooming in only ever adds trees: the ones already
  // standing stay where they were.
  const onScreen = size * view.zoom;
  const keep = Math.max(0.06, Math.min(1, onScreen / 3));
  const mark = Math.max(1.6, onScreen);

  ctx.save();
  ctx.globalAlpha = 0.5;
  let n = 0;
  for (let y = spacing * 0.5; y < FIELD_DEPTH + spacing; y += spacing) {
    for (let x = spacing * 0.5; x < FIELD_WIDTH + spacing; x += spacing) {
      n += 1;
      if (jitter(n, 53) > keep) continue;
      const fx = x + (jitter(n, 13) - 0.5) * spacing * 0.9;
      const fy = y + (jitter(n, 29) - 0.5) * spacing * 0.9;
      // Nothing grows inside the walls.
      if (settlement) {
        const dx = fx - settlement.centre.x;
        const dy = fy - settlement.centre.y;
        if (Math.hypot(dx, dy) < settlement.radius * 1.1) continue;
      }
      const point = fieldToScreen(view, { x: fx, y: fy });
      if (point.x < -40 || point.x > view.width + 40) continue;
      if (point.y < -40 || point.y > view.height + 40) continue;
      drawTerrainMark(ctx, terrain as never, point.x, point.y, mark * (0.75 + jitter(n, 41) * 0.6));
    }
  }
  ctx.restore();
}

function drawSettlementWorks(
  ctx: CanvasRenderingContext2D,
  view: BattleView,
  state: BattleState,
  integrity: number,
): void {
  const settlement = state.setup.settlement;
  if (!settlement) return;
  const centre = fieldToScreen(view, settlement.centre);
  const radius = settlement.radius * view.zoom;
  const breached = integrity <= 0.35;

  // The ground inside the walls: roofs packed together.
  ctx.save();
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#9a8f74';
  ctx.fill();
  ctx.clip();
  // The shadow the wall throws inwards, which is what makes it a wall and not
  // a drawn circle.
  ctx.strokeStyle = 'rgba(32, 28, 20, 0.3)';
  ctx.lineWidth = radius * 0.16;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, radius - radius * 0.08, 0, Math.PI * 2);
  ctx.stroke();

  for (let i = 0; i < 34; i++) {
    const angle = jitter(i, 7) * Math.PI * 2;
    const reach = radius * 0.84 * Math.sqrt(jitter(i, 17));
    const hx = centre.x + Math.cos(angle) * reach;
    const hy = centre.y + Math.sin(angle) * reach;
    const w = radius * (0.06 + jitter(i, 31) * 0.04);
    // Walls, then the roof over them: a triangle alone reads as a tent.
    ctx.fillStyle = '#b6a98c';
    ctx.fillRect(hx - w * 0.8, hy - w * 0.1, w * 1.6, w * 0.9);
    ctx.beginPath();
    ctx.moveTo(hx - w, hy);
    ctx.lineTo(hx, hy - w * 0.85);
    ctx.lineTo(hx + w, hy);
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? '#8a5a3c' : '#5f3c28';
    ctx.fill();
  }
  ctx.restore();

  // The wall itself, with towers, broken open where it has been breached.
  const towers = 10;
  ctx.save();
  ctx.lineWidth = Math.max(4, radius * 0.07);
  ctx.strokeStyle = breached ? '#9a6b60' : '#cfc8b4';
  if (breached) {
    // A gap where the siege engines got through.
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, radius, Math.PI * 0.18, Math.PI * 1.82);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = breached ? '#9a6b60' : '#cfc8b4';
  ctx.strokeStyle = '#6f6859';
  ctx.lineWidth = Math.max(1, radius * 0.02);
  for (let i = 0; i < towers; i++) {
    const angle = (i / towers) * Math.PI * 2;
    if (breached && angle > Math.PI * 1.82) continue;
    const tx = centre.x + Math.cos(angle) * radius;
    const ty = centre.y + Math.sin(angle) * radius;
    const t = Math.max(3, radius * 0.09);
    ctx.beginPath();
    ctx.rect(tx - t, ty - t, t * 2, t * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Men
// ---------------------------------------------------------------------------

/** At most this many figures per regiment, for the sake of the frame rate. */
const MAX_FIGURES = 72;

/**
 * One regiment, drawn as its men.
 *
 * The block is laid out in the unit's own formation: frontage across, three
 * or four ranks deep. Figures are drawn from the front rank backwards, so
 * casualties eat the block from behind and the frontage a player is looking
 * at is the frontage the simulation is using.
 */
function drawUnit(ctx: CanvasRenderingContext2D, view: BattleView, unit: BattleUnit): void {
  if (unit.stance === 'destroyed' || unit.fled) return;
  const centre = fieldToScreen(view, unit.position);
  const type = getUnitType(unit.type);
  const role = UNIT_ROLE[type.unitClass];
  const mounted = type.mounted;
  const faction = tryGetFaction(unit.faction);
  const fill = faction?.colour ?? '#9a9a9a';
  const edge = faction?.colourDark ?? '#555';
  const afloat = type.unitClass === 'warship' || type.unitClass === 'transport';

  // The block on the ground, in metres, then on screen.
  const ranks = type.unitClass === 'pikemen' || type.unitClass === 'spearmen' ? 4 : 3;
  const width = Math.max(8, frontage(unit) * view.zoom);
  const depth = Math.max(6, ranks * (mounted ? 2.6 : 1.4) * view.zoom);
  const standing = Math.max(0.05, unit.soldiers / Math.max(1, unit.startingSoldiers));

  if (centre.x < -width || centre.x > view.width + width) return;
  if (centre.y < -depth * 3 || centre.y > view.height + depth * 3) return;

  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.rotate(unit.facing + Math.PI / 2);
  ctx.globalAlpha = unit.stance === 'routing' ? 0.6 : 1;

  // A crew is not a company of foot: at sea the thing on the water is the
  // hull, and its crew is how well it still answers the helm.
  if (afloat) {
    // A hull's length is her own, not a function of how many men are aboard
    // this morning: a galley is forty metres whether she is full or half dead.
    const metres = 16 + type.soldiers * 0.28;
    drawVessel(ctx, Math.max(12, metres * view.zoom), type.unitClass === 'warship', standing, fill, edge);
    ctx.restore();
    return;
  }

  // A shadow under the whole body of men, which gives the block its weight.
  ctx.fillStyle = 'rgba(14, 14, 10, 0.18)';
  ctx.fillRect(
    -width / 2 + 1,
    -depth / 2 + Math.max(1, depth * 0.16),
    width - 2,
    depth * (unit.soldiers / Math.max(1, unit.startingSoldiers)),
  );

  // How many figures the block has room for. A man is never drawn smaller
  // than this, because below it he stops reading as a man.
  const CELL = 3.3;
  let files = Math.max(1, Math.min(Math.round(unit.soldiers / ranks), Math.round(width / CELL)));
  let drawnRanks = Math.max(1, Math.min(ranks, Math.round(depth / CELL)));
  while (files * drawnRanks > MAX_FIGURES && files > 1) files -= 1;

  const across = width / files;
  const back = depth / drawnRanks;
  const figure = Math.min(across, back) * 1.25;

  if (figure < 2) {
    // Nothing legible fits: a bar, thinned from the back by its losses.
    ctx.fillStyle = fill;
    ctx.fillRect(-width / 2, -depth / 2, width, depth * standing);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-width / 2, -depth / 2, width, depth);
  } else {
    // Losses eat the block from the back, so a thinning line looks thin.
    const figures = Math.max(1, Math.round(files * drawnRanks * standing));
    let placed = 0;
    for (let rank = 0; rank < drawnRanks && placed < figures; rank++) {
      for (let file = 0; file < files && placed < figures; file++) {
        placed += 1;
        const fx = -width / 2 + across * (file + 0.5);
        const fy = -depth / 2 + back * (rank + 0.5);
        // A hand's breadth of raggedness, so a line of men is not a lattice.
        drawFigure(
          ctx,
          fx + (jitter(placed, rank + 3) - 0.5) * across * 0.34,
          fy + (jitter(placed, rank + 11) - 0.5) * back * 0.34,
          figure,
          fill,
          edge,
          role,
          mounted,
        );
      }
    }
  }

  // The standard over the unit, and a star for the man commanding the army.
  const pole = Math.max(5, Math.min(18, figure * 2.4));
  drawStandard(ctx, 0, -depth / 2 - pole * 0.2, pole, fill, edge);
  if (type.unitClass === 'general') {
    ctx.fillStyle = '#ffe28a';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? pole * 0.55 : pole * 0.22;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const px = Math.cos(a) * r;
      const py = -depth / 2 - pole * 1.45 + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * One man, seen from above and slightly behind: a helmet, the shoulders, and
 * whatever he is carrying. At three pixels this is a coloured dot with a dark
 * crown, which is all it needs to be; at twelve it is recognisably a soldier.
 */
function drawFigure(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  colour: string,
  dark: string,
  role: string,
  mounted: boolean,
): void {
  if (mounted) {
    // The horse first, a dark oval along the line of advance.
    ctx.fillStyle = 'rgba(48, 36, 24, 0.95)';
    ctx.beginPath();
    ctx.ellipse(x, y + size * 0.18, size * 0.36, size * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Shoulders and surcoat in the lord's colours.
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.ellipse(x, y, size * 0.42, size * (mounted ? 0.4 : 0.46), 0, 0, Math.PI * 2);
  ctx.fill();

  // The helmet, which is what makes a dot read as a man.
  ctx.fillStyle = 'rgba(32, 30, 24, 0.9)';
  ctx.beginPath();
  ctx.arc(x, y - size * 0.1, size * 0.24, 0, Math.PI * 2);
  ctx.fill();

  if (size < 4) return;

  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(0.5, size * 0.12);
  if (role === 'missile') {
    // A bow, held across the body.
    ctx.beginPath();
    ctx.arc(x, y - size * 0.1, size * 0.5, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  } else if (!mounted) {
    // A spear, carried upright.
    ctx.strokeStyle = 'rgba(40, 34, 24, 0.85)';
    ctx.beginPath();
    ctx.moveTo(x + size * 0.42, y + size * 0.5);
    ctx.lineTo(x + size * 0.3, y - size * 1.1);
    ctx.stroke();
  } else {
    // A lance, couched forward.
    ctx.strokeStyle = 'rgba(40, 34, 24, 0.85)';
    ctx.beginPath();
    ctx.moveTo(x + size * 0.42, y + size * 0.42);
    ctx.lineTo(x + size * 0.12, y - size * 1.25);
    ctx.stroke();
  }
}

/**
 * A hull seen from above, bow towards the top of the unit's own frame.
 *
 * A galley is long, low and has her oars out; a round ship is beamier and
 * carries a sail instead. Losses among the crew show as the deck emptying and
 * the oars falling still, which is what a ship about to be boarded looks like.
 */
function drawVessel(
  ctx: CanvasRenderingContext2D,
  length: number,
  oared: boolean,
  crew: number,
  colour: string,
  dark: string,
): void {
  const beam = length * (oared ? 0.17 : 0.3);
  const bow = -length / 2;
  const stern = length / 2;

  // Her shadow on the water.
  ctx.fillStyle = 'rgba(8, 16, 22, 0.4)';
  ctx.beginPath();
  ctx.ellipse(beam * 0.3, length * 0.05, beam * 1.1, length * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  if (oared && length > 20) {
    // Oars, as many as there are men left to pull them.
    const banks = Math.max(2, Math.round((length / 16) * crew));
    ctx.strokeStyle = 'rgba(206, 190, 154, 0.4)';
    ctx.lineWidth = Math.max(0.5, beam * 0.1);
    ctx.beginPath();
    for (let i = 0; i < banks; i++) {
      const y = bow + length * 0.26 + ((length * 0.48) / Math.max(1, banks - 1)) * i;
      ctx.moveTo(-beam * 0.7, y);
      ctx.lineTo(-beam * 1.7, y + length * 0.035);
      ctx.moveTo(beam * 0.7, y);
      ctx.lineTo(beam * 1.7, y + length * 0.035);
    }
    ctx.stroke();
  }

  // The hull: a point forward, a rounded stern, planked in oak.
  ctx.beginPath();
  ctx.moveTo(0, bow);
  ctx.quadraticCurveTo(beam * 1.05, bow + length * 0.32, beam * 0.8, stern - length * 0.14);
  ctx.quadraticCurveTo(0, stern + length * 0.05, -beam * 0.8, stern - length * 0.14);
  ctx.quadraticCurveTo(-beam * 1.05, bow + length * 0.32, 0, bow);
  ctx.closePath();
  ctx.fillStyle = '#7a5836';
  ctx.fill();
  ctx.strokeStyle = '#33240f';
  ctx.lineWidth = Math.max(0.6, beam * 0.14);
  ctx.stroke();

  // The deck down the middle, in her owner's colours, emptying as her people
  // are killed. This is the only part a player reads at a glance.
  const deck = beam * 0.44;
  ctx.beginPath();
  ctx.rect(-deck, bow + length * 0.22, deck * 2, length * 0.56 * crew);
  ctx.fillStyle = colour;
  ctx.fill();

  if (!oared && length > 18) {
    // A round ship's yard and the belly of her sail.
    ctx.strokeStyle = '#3f2f1c';
    ctx.lineWidth = Math.max(0.7, beam * 0.14);
    ctx.beginPath();
    ctx.moveTo(-beam * 0.85, -length * 0.04);
    ctx.lineTo(beam * 0.85, -length * 0.04);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -length * 0.1, beam * 0.7, length * 0.12, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(239, 231, 210, 0.92)';
    ctx.fill();
    ctx.strokeStyle = dark;
    ctx.lineWidth = Math.max(0.4, beam * 0.08);
    ctx.stroke();
  } else if (oared && length > 24) {
    // A galley's spur, which is what she fights with before the boarding.
    ctx.strokeStyle = '#33240f';
    ctx.lineWidth = Math.max(0.6, beam * 0.3);
    ctx.beginPath();
    ctx.moveTo(0, bow);
    ctx.lineTo(0, bow - length * 0.1);
    ctx.stroke();
  }

  // Her pennant, at the stern where a helmsman would fly it.
  ctx.beginPath();
  ctx.moveTo(0, stern - length * 0.1);
  ctx.lineTo(beam * 1.5, stern - length * 0.02);
  ctx.lineTo(0, stern + length * 0.02);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(0.4, beam * 0.1);
  ctx.stroke();
}

function drawStandard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  colour: string,
  dark: string,
): void {
  ctx.strokeStyle = '#2f2a20';
  ctx.lineWidth = Math.max(0.7, size * 0.11);
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.3);
  ctx.lineTo(x, y - size);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size * 0.8, y - size * 0.78);
  ctx.lineTo(x, y - size * 0.5);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(0.4, size * 0.08);
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// What is happening
// ---------------------------------------------------------------------------

/** Dust and the flash of steel where two units are actually in contact. */
function drawMelee(ctx: CanvasRenderingContext2D, state: BattleState, view: BattleView): void {
  const byId = new Map(state.units.map((unit) => [unit.id, unit]));
  const seen = new Set<string>();
  ctx.save();
  for (const unit of state.units) {
    if (unit.fled || unit.stance === 'destroyed') continue;
    for (const otherId of unit.engagedWith) {
      const key = unit.id < otherId ? `${unit.id}|${otherId}` : `${otherId}|${unit.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const other = byId.get(otherId);
      if (!other || other.fled) continue;
      const a = fieldToScreen(view, unit.position);
      const b = fieldToScreen(view, other.position);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const reach = Math.max(14, Math.hypot(a.x - b.x, a.y - b.y) * 0.7);

      const dust = ctx.createRadialGradient(mx, my, 0, mx, my, reach);
      dust.addColorStop(0, 'rgba(226, 214, 184, 0.34)');
      dust.addColorStop(1, 'rgba(226, 214, 184, 0)');
      ctx.fillStyle = dust;
      ctx.beginPath();
      ctx.arc(mx, my, reach, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * Arrows in the air.
 *
 * Only for a unit that the simulation would have shooting this tick: a missile
 * unit with ammunition left, an attack order, a target within its range, and
 * no one at its throat.
 */
function drawVolleys(ctx: CanvasRenderingContext2D, state: BattleState, view: BattleView): void {
  const byId = new Map(state.units.map((unit) => [unit.id, unit]));
  ctx.save();
  ctx.strokeStyle = 'rgba(240, 234, 214, 0.65)';
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  for (const unit of state.units) {
    if (unit.fled || unit.stance === 'destroyed' || unit.stance === 'routing') continue;
    if (unit.engagedWith.length > 0 || unit.ammunition <= 0) continue;
    const type = getUnitType(unit.type);
    if (UNIT_ROLE[type.unitClass] !== 'missile' || type.range <= 0) continue;
    const targetId = unit.order.targetUnit;
    if (!targetId) continue;
    const target = byId.get(targetId);
    if (!target || target.fled || target.stance === 'destroyed') continue;
    const distance = Math.hypot(
      target.position.x - unit.position.x,
      target.position.y - unit.position.y,
    );
    if (distance > type.range) continue;

    const from = fieldToScreen(view, unit.position);
    const to = fieldToScreen(view, target.position);
    // A handful of shafts spread across the flight, each a short dash along it.
    const shafts = 7;
    ctx.beginPath();
    for (let i = 0; i < shafts; i++) {
      const t = (i + 0.5) / shafts;
      const spread = (jitter(i, unit.soldiers) - 0.5) * 16;
      const x = from.x + (to.x - from.x) * t + spread;
      const y = from.y + (to.y - from.y) * t + spread * 0.4;
      const dx = (to.x - from.x) / Math.max(1, distance);
      const dy = (to.y - from.y) / Math.max(1, distance);
      ctx.moveTo(x, y);
      ctx.lineTo(x + dx * 7, y + dy * 7);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawMoraleBar(ctx: CanvasRenderingContext2D, view: BattleView, unit: BattleUnit): void {
  if (unit.stance === 'destroyed' || unit.fled) return;
  const type = getUnitType(unit.type);
  const threshold = Math.max(1, type.morale);
  const wavering = unit.shock / threshold;
  if (wavering <= 0.25 && unit.stance !== 'routing') return;

  const centre = fieldToScreen(view, unit.position);
  const width = Math.max(14, frontage(unit) * view.zoom);
  const top = centre.y - Math.max(12, width * 0.22) - 8;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(centre.x - width / 2, top, width, 3);
  ctx.fillStyle = unit.stance === 'routing' ? '#e2574c' : wavering > 0.7 ? '#e5a33a' : '#d8d2a8';
  ctx.fillRect(centre.x - width / 2, top, width * Math.max(0, Math.min(1, 1 - wavering)), 3);
}

function drawSelection(ctx: CanvasRenderingContext2D, state: BattleState, view: BattleView): void {
  for (const [id, colour, weight] of [
    [view.hovered, 'rgba(255,255,255,0.6)', 1.5] as const,
    [view.selected, '#ffe28a', 2.4] as const,
  ]) {
    if (!id) continue;
    const unit = state.units.find((candidate) => candidate.id === id);
    if (!unit || unit.fled || unit.stance === 'destroyed') continue;
    const centre = fieldToScreen(view, unit.position);
    const radius = Math.max(12, (frontage(unit) * view.zoom) / 2 + 8);
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = colour;
    ctx.lineWidth = weight;
    ctx.setLineDash(id === view.hovered ? [4, 4] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** A darkening at the edges, so the eye stays on the fighting. */
function drawVignette(ctx: CanvasRenderingContext2D, view: BattleView): void {
  const gradient = ctx.createRadialGradient(
    view.width / 2,
    view.height / 2,
    Math.min(view.width, view.height) * 0.42,
    view.width / 2,
    view.height / 2,
    Math.max(view.width, view.height) * 0.78,
  );
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(1, 'rgba(10, 12, 8, 0.42)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, view.width, view.height);
}
