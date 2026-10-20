/**
 * The radar on the battlefield.
 *
 * The same argument as the one on the campaign map: the field is 1400 metres
 * across and the camera is usually looking at a tenth of it, so the player
 * needs somewhere that answers "where is everybody" without a journey. And
 * the same answer: a flat picture from straight above, drawn out of the
 * ground and the regiments and nothing else.
 *
 * The ground is shaded by height, which is the one thing about a battlefield
 * that decides battles and the one thing an isometric picture of it hides.
 * On a ridge the crest shows as a pale band across the radar, and holding it
 * is then an obvious thing to be doing rather than a hidden rule.
 */
import type { BattleState } from '../core/battle/sim';
import type { BattleUnit, Side } from '../core/battle/types';
import { FIELD_DEPTH, FIELD_WIDTH } from '../core/battle/types';
import { tryGetFaction } from '../core/data/factions';

/** The ground, which is a pure function of the setup and so drawn once. */
let plate: HTMLCanvasElement | undefined;
let plateFor = '';

function ground(
  width: number,
  height: number,
  state: BattleState,
): HTMLCanvasElement {
  const key = `${width}x${height}|${state.setup.terrain}|${state.setup.naval}`;
  if (plate && plateFor === key) return plate;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // A coarse grid: the radar is two hundred pixels across and the height
  // function is smooth, so sampling it every four is more than enough.
  const step = 4;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const point = {
        x: (x / width) * FIELD_WIDTH,
        y: (y / height) * FIELD_DEPTH,
      };
      const metres = state.terrainHeight(point);
      // Nought to one across whatever range this field happens to have.
      const lift = Math.max(0, Math.min(1, (metres + 10) / 70));
      ctx.fillStyle = state.setup.naval
        ? `rgb(${18 + lift * 10}, ${44 + lift * 14}, ${72 + lift * 20})`
        : `rgb(${44 + lift * 90}, ${58 + lift * 86}, ${30 + lift * 60})`;
      ctx.fillRect(x, y, step, step);
    }
  }
  plate = canvas;
  plateFor = key;
  return canvas;
}

export interface BattleRadarScene {
  readonly state: BattleState;
  readonly selected: string | undefined;
  /** Which side is the player's, so his own men can be told at a glance. */
  readonly playerSide: Side | undefined;
  /** The four corners of what is on screen, in metres of field. */
  readonly corners: readonly { readonly x: number; readonly y: number }[];
}

export function drawBattleRadar(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scene: BattleRadarScene,
): void {
  const { state } = scene;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(ground(width, height, state), 0, 0);

  const atX = (x: number): number => (x / FIELD_WIDTH) * width;
  const atY = (y: number): number => (y / FIELD_DEPTH) * height;

  if (state.setup.settlement) {
    // The place being stormed, which on this picture is where the walls are.
    ctx.strokeStyle = 'rgba(230, 214, 170, 0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(atX(FIELD_WIDTH * 0.34), atY(0), atX(FIELD_WIDTH * 0.32), atY(FIELD_DEPTH * 0.26));
  }

  const mark = (unit: BattleUnit): void => {
    if (unit.stance === 'destroyed' || unit.fled) return;
    const colour = tryGetFaction(unit.faction)?.colour ?? '#8d8578';
    const x = atX(unit.position.x);
    const y = atY(unit.position.y);
    // Wide enough to show a frontage, which is what tells a line from a column.
    const half = Math.max(1.5, atX(unit.width) / 2);
    ctx.globalAlpha = unit.stance === 'routing' ? 0.45 : 1;
    ctx.fillStyle = colour;
    ctx.fillRect(x - half, y - 1.5, half * 2, 3);
    ctx.globalAlpha = 1;
    if (unit.id !== scene.selected) return;
    ctx.strokeStyle = '#ffe9a8';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - half - 1.5, y - 3.5, half * 2 + 3, 7);
  };

  // The player's own men last, so they are never hidden under somebody else's.
  for (const unit of state.units) if (unit.side !== scene.playerSide) mark(unit);
  for (const unit of state.units) if (unit.side === scene.playerSide) mark(unit);

  if (scene.corners.length === 4) {
    ctx.beginPath();
    scene.corners.forEach((corner, index) => {
      const x = atX(corner.x);
      const y = atY(corner.y);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 244, 214, 0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/** Back from a point of the radar to a point of the field. */
export function radarToField(
  width: number,
  height: number,
  x: number,
  y: number,
): { x: number; y: number } {
  return { x: (x / width) * FIELD_WIDTH, y: (y / height) * FIELD_DEPTH };
}
