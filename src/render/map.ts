/**
 * Campaign map renderer.
 *
 * The map is drawn as a political network: one disc per province, sized by the
 * rank of its settlement and filled with its owner's colour, joined by solid
 * lines where armies can march and dashed lines where they must sail. That is
 * a deliberate choice over a painted coastline: with 222 provinces it stays
 * legible at every zoom, and it never lies about where a border actually is.
 */
import type { Point, RegionId } from '../core/types';
import { SETTLEMENT_ORDER } from '../core/types';
import type { CampaignState, RegionState } from '../core/campaign';
import { strengthOf, wallTier } from '../core/campaign';
import { REGIONS, getRegion } from '../core/data/regions';
import { BORDERS } from '../core/data/adjacency';
import { tryGetFaction, INDEPENDENT_ID } from '../core/data/factions';
import type { Camera, Viewport } from './projection';
import { project } from './projection';

export interface MapView {
  readonly camera: Camera;
  /** Replaced wholesale when the window is resized. */
  viewport: Viewport;
  selected: RegionId | undefined;
  hovered: RegionId | undefined;
  /** Provinces highlighted as legal destinations for the selected army. */
  reachable: Set<RegionId>;
  /** Draw province names regardless of zoom. */
  alwaysLabel: boolean;
}

const INDEPENDENT_COLOUR = '#8d8578';
const SEA = '#1d2b38';
const LAND = '#2c3a30';

/** Disc radius in pixels for a settlement rank, before zoom scaling. */
function radiusFor(region: RegionState, zoom: number): number {
  const rank = SETTLEMENT_ORDER.indexOf(region.tier);
  const base = 3.4 + rank * 1.5;
  return base * Math.max(0.55, Math.min(1.9, zoom / 14));
}

function colourOf(region: RegionState): string {
  if (region.owner === INDEPENDENT_ID) return INDEPENDENT_COLOUR;
  return tryGetFaction(region.owner)?.colour ?? INDEPENDENT_COLOUR;
}

function darkColourOf(region: RegionState): string {
  if (region.owner === INDEPENDENT_ID) return '#5c564d';
  return tryGetFaction(region.owner)?.colourDark ?? '#5c564d';
}

export function screenPositionOf(view: MapView, id: RegionId): Point {
  const geography = getRegion(id);
  return project(view.camera, view.viewport, geography.lon, geography.lat);
}

/** The province whose disc contains a screen point, if any. */
export function provinceAt(view: MapView, state: CampaignState, x: number, y: number): RegionId | undefined {
  let best: RegionId | undefined;
  let bestDistance = Infinity;
  for (const geography of REGIONS) {
    const region = state.regions.get(geography.id);
    if (!region) continue;
    const point = project(view.camera, view.viewport, geography.lon, geography.lat);
    const radius = radiusFor(region, view.camera.zoom) + 5;
    const dx = point.x - x;
    const dy = point.y - y;
    const distance = Math.hypot(dx, dy);
    if (distance <= radius && distance < bestDistance) {
      bestDistance = distance;
      best = geography.id;
    }
  }
  return best;
}

export function drawMap(
  ctx: CanvasRenderingContext2D,
  state: CampaignState,
  view: MapView,
): void {
  const { width, height } = view.viewport;
  ctx.save();
  ctx.clearRect(0, 0, width, height);

  // Sea, then a broad land wash under the provinces so the map reads as a map
  // rather than as a graph floating in nothing.
  ctx.fillStyle = SEA;
  ctx.fillRect(0, 0, width, height);
  drawLandWash(ctx, state, view);
  drawBorders(ctx, state, view);
  drawReachable(ctx, state, view);
  drawProvinces(ctx, state, view);
  drawArmies(ctx, state, view);
  drawLabels(ctx, state, view);
  drawSelection(ctx, state, view);

  ctx.restore();
}

/** Scratch canvas for the landmass, reused between frames. */
let landLayer: HTMLCanvasElement | undefined;

/**
 * A soft blob under every province, so neighbouring provinces merge into a
 * continent while the sea stays open.
 *
 * The blobs are composed on their own layer at full opacity first and the
 * finished landmass is then drawn once. Painting them straight onto the map
 * would stack one halo on top of another and turn a continent into a cloud.
 */
function drawLandWash(ctx: CanvasRenderingContext2D, state: CampaignState, view: MapView): void {
  const { width, height } = view.viewport;
  if (!landLayer) landLayer = document.createElement('canvas');
  const ratio = window.devicePixelRatio || 1;
  if (landLayer.width !== Math.floor(width * ratio) || landLayer.height !== Math.floor(height * ratio)) {
    landLayer.width = Math.max(1, Math.floor(width * ratio));
    landLayer.height = Math.max(1, Math.floor(height * ratio));
  }
  const layer = landLayer.getContext('2d');
  if (!layer) return;
  layer.setTransform(ratio, 0, 0, ratio, 0, 0);
  layer.clearRect(0, 0, width, height);
  drawLandBlobs(layer, state, view);

  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(landLayer, 0, 0);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.restore();
}

function drawLandBlobs(ctx: CanvasRenderingContext2D, state: CampaignState, view: MapView): void {
  ctx.save();
  for (const geography of REGIONS) {
    const region = state.regions.get(geography.id);
    if (!region) continue;
    const point = project(view.camera, view.viewport, geography.lon, geography.lat);
    const spread = radiusFor(region, view.camera.zoom) * 6.5;
    if (point.x < -spread || point.x > view.viewport.width + spread) continue;
    if (point.y < -spread || point.y > view.viewport.height + spread) continue;
    const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, spread);
    // Opaque at the settlement and fading out, so overlapping provinces merge
    // into a coastline rather than glowing.
    gradient.addColorStop(0, LAND);
    gradient.addColorStop(0.62, LAND);
    gradient.addColorStop(0.86, 'rgba(44, 58, 48, 0.55)');
    gradient.addColorStop(1, 'rgba(44, 58, 48, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(point.x, point.y, spread, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBorders(ctx: CanvasRenderingContext2D, state: CampaignState, view: MapView): void {
  ctx.save();
  for (const border of BORDERS) {
    const from = state.regions.get(border.a);
    const to = state.regions.get(border.b);
    if (!from || !to) continue;
    const a = screenPositionOf(view, border.a);
    const b = screenPositionOf(view, border.b);
    if (offScreen(a, b, view.viewport)) continue;

    if (border.kind === 'sea') {
      ctx.strokeStyle = 'rgba(120, 176, 214, 0.42)';
      ctx.setLineDash([5, 6]);
      ctx.lineWidth = 1;
    } else {
      // A border between two different owners is drawn more strongly: it is
      // the line that matters to the player.
      const contested = from.owner !== to.owner;
      ctx.strokeStyle = contested ? 'rgba(236, 226, 200, 0.5)' : 'rgba(160, 170, 150, 0.25)';
      ctx.setLineDash([]);
      ctx.lineWidth = contested ? 1.6 : 1;
    }
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawReachable(ctx: CanvasRenderingContext2D, state: CampaignState, view: MapView): void {
  if (view.reachable.size === 0) return;
  ctx.save();
  for (const id of view.reachable) {
    const region = state.regions.get(id);
    if (!region) continue;
    const point = screenPositionOf(view, id);
    const radius = radiusFor(region, view.camera.zoom) + 7;
    ctx.strokeStyle = 'rgba(255, 226, 138, 0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawProvinces(ctx: CanvasRenderingContext2D, state: CampaignState, view: MapView): void {
  for (const geography of REGIONS) {
    const region = state.regions.get(geography.id);
    if (!region) continue;
    const point = project(view.camera, view.viewport, geography.lon, geography.lat);
    const radius = radiusFor(region, view.camera.zoom);
    if (point.x < -40 || point.x > view.viewport.width + 40) continue;
    if (point.y < -40 || point.y > view.viewport.height + 40) continue;

    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = colourOf(region);
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = darkColourOf(region);
    ctx.stroke();

    // Walls: a ring whose weight shows how hard the place is to take.
    const walls = wallTier(region);
    if (walls !== 'none') {
      const weight = ['none', 'palisade', 'wooden', 'stone', 'large_stone', 'epic'].indexOf(walls);
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius + 2.5, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(232, 228, 216, ${0.12 + weight * 0.11})`;
      ctx.lineWidth = 1 + weight * 0.3;
      ctx.stroke();
    }

    // A besieged province gets a red crescent, so a siege cannot be missed.
    if (region.siege) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius + 5, -0.6, 0.6);
      ctx.strokeStyle = '#e2574c';
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }

    // Unrest shown as a sliver of warning colour on the disc itself.
    if (region.unrest > 40) {
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.arc(point.x, point.y, radius, -Math.PI / 2, -Math.PI / 2 + (region.unrest / 100) * Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = 'rgba(226, 87, 76, 0.45)';
      ctx.fill();
    }
  }
}

function drawArmies(ctx: CanvasRenderingContext2D, state: CampaignState, view: MapView): void {
  // Armies in the same province are fanned out so each is clickable.
  const byRegion = new Map<RegionId, { faction: string; soldiers: number }[]>();
  for (const army of state.armies.values()) {
    const list = byRegion.get(army.location) ?? [];
    list.push({
      faction: tryGetFaction(army.faction)?.colour ?? INDEPENDENT_COLOUR,
      soldiers: strengthOf(army.regiments),
    });
    byRegion.set(army.location, list);
  }

  for (const [id, armies] of byRegion) {
    const region = state.regions.get(id);
    if (!region) continue;
    const point = screenPositionOf(view, id);
    const radius = radiusFor(region, view.camera.zoom);
    armies.forEach((army, index) => {
      const angle = -Math.PI / 4 + index * 0.7;
      const x = point.x + Math.cos(angle) * (radius + 9);
      const y = point.y + Math.sin(angle) * (radius + 9);
      const size = 3.2 + Math.min(4, Math.sqrt(army.soldiers) / 11);
      // A small shield shape rather than a dot, which reads as "troops".
      ctx.beginPath();
      ctx.moveTo(x - size, y - size);
      ctx.lineTo(x + size, y - size);
      ctx.lineTo(x + size, y + size * 0.3);
      ctx.quadraticCurveTo(x, y + size * 1.6, x - size, y + size * 0.3);
      ctx.closePath();
      ctx.fillStyle = army.faction;
      ctx.fill();
      ctx.strokeStyle = 'rgba(16, 20, 16, 0.85)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }
}

function drawLabels(ctx: CanvasRenderingContext2D, state: CampaignState, view: MapView): void {
  const zoom = view.camera.zoom;
  if (!view.alwaysLabel && zoom < 11) return;
  ctx.save();
  ctx.font = '500 11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const geography of REGIONS) {
    const region = state.regions.get(geography.id);
    if (!region) continue;
    // At low zoom only the important places are named, so labels never collide.
    const rank = SETTLEMENT_ORDER.indexOf(region.tier);
    const threshold = zoom < 16 ? 3 : zoom < 24 ? 2 : zoom < 36 ? 1 : 0;
    if (!view.alwaysLabel && rank < threshold) continue;
    const point = project(view.camera, view.viewport, geography.lon, geography.lat);
    if (point.x < 0 || point.x > view.viewport.width) continue;
    if (point.y < 0 || point.y > view.viewport.height) continue;
    const label = geography.settlement;
    const offset = radiusFor(region, zoom) + 3;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(12, 16, 20, 0.85)';
    ctx.strokeText(label, point.x, point.y + offset);
    ctx.fillStyle = '#ece6d6';
    ctx.fillText(label, point.x, point.y + offset);
  }
  ctx.restore();
}

function drawSelection(ctx: CanvasRenderingContext2D, state: CampaignState, view: MapView): void {
  for (const [id, colour, weight] of [
    [view.hovered, 'rgba(255,255,255,0.55)', 1.5] as const,
    [view.selected, '#ffe28a', 2.6] as const,
  ]) {
    if (!id) continue;
    const region = state.regions.get(id);
    if (!region) continue;
    const point = screenPositionOf(view, id);
    ctx.beginPath();
    ctx.arc(point.x, point.y, radiusFor(region, view.camera.zoom) + 4, 0, Math.PI * 2);
    ctx.strokeStyle = colour;
    ctx.lineWidth = weight;
    ctx.setLineDash([]);
    ctx.stroke();
  }
}

function offScreen(a: Point, b: Point, viewport: Viewport): boolean {
  const margin = 60;
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return (
    maxX < -margin ||
    minX > viewport.width + margin ||
    maxY < -margin ||
    minY > viewport.height + margin
  );
}
