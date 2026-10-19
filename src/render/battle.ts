/**
 * Battle renderer.
 *
 * Each regiment is drawn as a block whose width is its frontage and whose fill
 * fades as it takes losses, so the state of the line is readable at a glance:
 * where it is thin, where it is flanked, and which units are about to break.
 */
import type { Point } from '../core/types';
import { UNIT_ROLE } from '../core/types';
import { getUnitType } from '../core/data/units';
import { tryGetFaction } from '../core/data/factions';
import type { BattleState } from '../core/battle/sim';
import { frontage } from '../core/battle/sim';
import type { BattleUnit } from '../core/battle/types';
import { FIELD_DEPTH, FIELD_WIDTH } from '../core/battle/types';

export interface BattleView {
  /** Updated when the window is resized. */
  width: number;
  height: number;
  selected: string | undefined;
  hovered: string | undefined;
}

function fieldToScreen(view: BattleView, point: Point): Point {
  return {
    x: (point.x / FIELD_WIDTH) * view.width,
    y: (point.y / FIELD_DEPTH) * view.height,
  };
}

export function screenToField(view: BattleView, x: number, y: number): Point {
  return {
    x: (x / view.width) * FIELD_WIDTH,
    y: (y / view.height) * FIELD_DEPTH,
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
  // Routed units go underneath, so the standing line stays readable.
  for (const unit of state.units) if (unit.stance === 'routing') drawUnit(ctx, view, unit);
  for (const unit of state.units) if (unit.stance !== 'routing') drawUnit(ctx, view, unit);
  drawSelection(ctx, state, view);
}

/**
 * The ground, shaded by height so that a ridge is visible and the player can
 * see what the uphill and downhill modifiers refer to.
 */
function drawGround(ctx: CanvasRenderingContext2D, state: BattleState, view: BattleView): void {
  const base = state.setup.naval ? '#1d3346' : groundColour(state.setup.terrain);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, view.width, view.height);

  if (state.setup.naval) {
    // Swell rather than contours: there is no ground to read at sea, only the
    // set of the water.
    ctx.strokeStyle = 'rgba(140, 186, 220, 0.10)';
    ctx.lineWidth = 1;
    for (let y = 18; y < view.height; y += 26) {
      ctx.beginPath();
      for (let x = 0; x <= view.width; x += 18) {
        const lift = Math.sin((x / 90) + y / 55) * 3;
        if (x === 0) ctx.moveTo(x, y + lift);
        else ctx.lineTo(x, y + lift);
      }
      ctx.stroke();
    }
  } else {
    const step = 22;
    for (let y = 0; y < view.height; y += step) {
      for (let x = 0; x < view.width; x += step) {
        const field = screenToField(view, x + step / 2, y + step / 2);
        const height = state.terrainHeight(field);
        const shade = Math.max(-0.22, Math.min(0.22, height / 150));
        ctx.fillStyle =
          shade >= 0 ? `rgba(255,255,255,${shade})` : `rgba(0,0,0,${-shade})`;
        ctx.fillRect(x, y, step, step);
      }
    }
  }

  // The settlement, when the battle is an assault.
  const settlement = state.setup.settlement;
  if (settlement) {
    const centre = fieldToScreen(view, settlement.centre);
    const radius = (settlement.radius / FIELD_WIDTH) * view.width;
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(80, 76, 66, 0.55)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = settlement.integrity > 0.35 ? '#cfc8b4' : '#9a6b60';
    ctx.stroke();
  }
}

function groundColour(terrain: string): string {
  switch (terrain) {
    case 'desert': return '#9c8759';
    case 'steppe': return '#8a8a56';
    case 'forest': return '#2f4430';
    case 'marsh': return '#3b4a42';
    case 'mountains': return '#5b5750';
    case 'hills': return '#56603f';
    case 'coastal': return '#5f6a4a';
    case 'farmland': return '#5c6b3c';
    default: return '#55653c';
  }
}

function drawUnit(
  ctx: CanvasRenderingContext2D,
  view: BattleView,
  unit: BattleUnit,
): void {
  if (unit.stance === 'destroyed' || unit.fled) return;
  const centre = fieldToScreen(view, unit.position);
  const scale = view.width / FIELD_WIDTH;
  const width = Math.max(8, frontage(unit) * scale);
  const depth = Math.max(5, width * 0.32);

  const faction = tryGetFaction(unit.faction);
  const fill = faction?.colour ?? '#9a9a9a';
  const edge = faction?.colourDark ?? '#555';
  const strength = unit.soldiers / Math.max(1, unit.startingSoldiers);

  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.rotate(unit.facing + Math.PI / 2);

  // The block, drawn at full width with the losses shown as a gap at the back.
  ctx.globalAlpha = unit.stance === 'routing' ? 0.45 : 1;
  ctx.fillStyle = fill;
  ctx.fillRect(-width / 2, -depth / 2, width, depth * strength);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(-width / 2, -depth / 2 + depth * strength, width, depth * (1 - strength));

  ctx.lineWidth = unit.side === 'attacker' ? 1.6 : 1.2;
  ctx.strokeStyle = edge;
  ctx.strokeRect(-width / 2, -depth / 2, width, depth);

  // A line along the front edge marks facing, which is what flanking depends on.
  ctx.beginPath();
  ctx.moveTo(-width / 2, -depth / 2);
  ctx.lineTo(width / 2, -depth / 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.restore();

  // Role marker, so cavalry and missiles are identifiable without clicking.
  const type = getUnitType(unit.type);
  const role = UNIT_ROLE[type.unitClass];
  ctx.fillStyle = 'rgba(16,18,14,0.8)';
  ctx.font = 'bold 9px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const glyph =
    type.unitClass === 'general'
      ? '*'
      : type.unitClass === 'warship'
        ? 'W'
        : type.unitClass === 'transport'
          ? 'T'
          : role === 'cavalry'
            ? 'C'
            : role === 'missile'
              ? 'M'
              : role === 'siege'
                ? 'S'
                : 'I';
  ctx.fillText(glyph, centre.x, centre.y);

  // Morale bar above anything that is wavering.
  const threshold = Math.max(1, type.morale);
  const wavering = unit.shock / threshold;
  if (wavering > 0.25 || unit.stance === 'routing') {
    const barWidth = Math.max(14, width);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(centre.x - barWidth / 2, centre.y - depth - 7, barWidth, 3);
    ctx.fillStyle = unit.stance === 'routing' ? '#e2574c' : wavering > 0.7 ? '#e5a33a' : '#d8d2a8';
    ctx.fillRect(
      centre.x - barWidth / 2,
      centre.y - depth - 7,
      barWidth * Math.max(0, Math.min(1, 1 - wavering)),
      3,
    );
  }
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
    const scale = view.width / FIELD_WIDTH;
    const radius = Math.max(12, (frontage(unit) * scale) / 2 + 6);
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = colour;
    ctx.lineWidth = weight;
    ctx.stroke();
  }
}
