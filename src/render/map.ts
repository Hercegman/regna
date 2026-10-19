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
import type { SeaZoneId } from '../core/data/seas';
import { SEA_ZONES, getSeaZone } from '../core/data/seas';
import { caravanLocation, seaLaneClosed } from '../core/campaign';
import { TRADE_ROUTES, routesThrough } from '../core/data/trade';
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
  /** The water currently selected, if any. */
  selectedZone: SeaZoneId | undefined;
  hoveredZone: SeaZoneId | undefined;
  /** Waters highlighted as legal destinations for the selected fleet. */
  reachableZones: Set<SeaZoneId>;
  /** Draw province names regardless of zoom. */
  alwaysLabel: boolean;
  /** Draw every trade road, not only the ones through the selection. */
  showRoutes: boolean;
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
  drawSeaZones(ctx, state, view);
  drawBorders(ctx, state, view);
  drawTradeRoutes(ctx, state, view);
  drawReachable(ctx, state, view);
  drawProvinces(ctx, state, view);
  drawArmies(ctx, state, view);
  drawFleets(ctx, state, view);
  drawCaravans(ctx, state, view);
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

export function zonePosition(view: MapView, id: SeaZoneId): Point {
  const zone = getSeaZone(id);
  return project(view.camera, view.viewport, zone.lon, zone.lat);
}

/** How large a sea zone's marker is on screen. */
function zoneRadius(zoom: number): number {
  return Math.max(10, Math.min(34, zoom * 1.1));
}

/** The water whose marker contains a screen point. */
export function zoneAt(view: MapView, x: number, y: number): SeaZoneId | undefined {
  let best: SeaZoneId | undefined;
  let bestDistance = Infinity;
  const radius = zoneRadius(view.camera.zoom);
  for (const zone of SEA_ZONES) {
    const point = project(view.camera, view.viewport, zone.lon, zone.lat);
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance <= radius && distance < bestDistance) {
      bestDistance = distance;
      best = zone.id;
    }
  }
  return best;
}

/**
 * The waters, drawn as faint anchor points rather than painted areas. A zone
 * is where fleets are, not a shape with a boundary, and a ring at its centre
 * says that more honestly than a coloured blob would.
 */
function drawSeaZones(ctx: CanvasRenderingContext2D, state: CampaignState, view: MapView): void {
  const zoom = view.camera.zoom;
  const radius = zoneRadius(zoom);
  ctx.save();
  for (const zone of SEA_ZONES) {
    const point = project(view.camera, view.viewport, zone.lon, zone.lat);
    if (point.x < -60 || point.x > view.viewport.width + 60) continue;
    if (point.y < -60 || point.y > view.viewport.height + 60) continue;

    const reachable = view.reachableZones.has(zone.id);
    const selected = view.selectedZone === zone.id;
    const hovered = view.hoveredZone === zone.id;
    const occupied = [...state.fleets.values()].some(
      (fleet) => fleet.location.kind === 'sea' && fleet.location.zone === zone.id,
    );
    if (!reachable && !selected && !hovered && !occupied && zoom < 11) continue;

    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.setLineDash(reachable ? [4, 4] : [2, 5]);
    ctx.lineWidth = selected ? 2.4 : reachable ? 2 : 1;
    ctx.strokeStyle = selected
      ? '#ffe28a'
      : reachable
        ? 'rgba(255, 226, 138, 0.8)'
        : hovered
          ? 'rgba(180, 220, 245, 0.7)'
          : 'rgba(120, 176, 214, 0.3)';
    ctx.stroke();
    ctx.setLineDash([]);

    if (zoom >= 13 || selected || hovered) {
      ctx.font = '500 10px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(12, 16, 20, 0.85)';
      ctx.strokeText(zone.name, point.x, point.y);
      ctx.fillStyle = 'rgba(176, 208, 232, 0.9)';
      ctx.fillText(zone.name, point.x, point.y);
    }
  }
  ctx.restore();
}

/** Fleets, at anchor beside their harbour or on station in open water. */
function drawFleets(ctx: CanvasRenderingContext2D, state: CampaignState, view: MapView): void {
  const groups = new Map<string, { x: number; y: number; colour: string; hulls: number; cargo: boolean }[]>();
  for (const fleet of state.fleets.values()) {
    const colour = tryGetFaction(fleet.faction)?.colour ?? INDEPENDENT_COLOUR;
    const anchor =
      fleet.location.kind === 'port'
        ? screenPositionOf(view, fleet.location.region)
        : zonePosition(view, fleet.location.zone);
    const key =
      fleet.location.kind === 'port'
        ? `port:${fleet.location.region}`
        : `sea:${fleet.location.zone}`;
    const list = groups.get(key) ?? [];
    list.push({
      x: anchor.x,
      y: anchor.y,
      colour,
      hulls: fleet.ships.length,
      cargo: fleet.cargo.length > 0,
    });
    groups.set(key, list);
  }

  for (const [key, fleets] of groups) {
    const atSea = key.startsWith('sea:');
    fleets.forEach((fleet, index) => {
      // Fan several fleets apart so each one can be picked out and clicked.
      const angle = Math.PI * 0.75 + index * 0.55;
      const spread = atSea ? 0 : 14;
      const x = fleet.x + Math.cos(angle) * spread + (atSea ? (index - (fleets.length - 1) / 2) * 13 : 0);
      const y = fleet.y + Math.sin(angle) * spread;
      drawHull(ctx, x, y, fleet.colour, fleet.hulls, fleet.cargo);
    });
  }
}

/** A small hull glyph: a boat is more legible here than a dot. */
function drawHull(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  colour: string,
  hulls: number,
  laden: boolean,
): void {
  const size = 4 + Math.min(4, hulls * 0.5);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.quadraticCurveTo(x, y + size * 1.1, x + size, y);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.strokeStyle = 'rgba(12, 18, 24, 0.9)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // A mast, and a crossyard when the ship is carrying troops.
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - size * 1.4);
  if (laden) {
    ctx.moveTo(x - size * 0.6, y - size * 0.9);
    ctx.lineTo(x + size * 0.6, y - size * 0.9);
  }
  ctx.strokeStyle = laden ? '#ffe28a' : 'rgba(236, 230, 214, 0.9)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
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
      // A lane an enemy fleet has closed is drawn in warning colour, because
      // an army that marches at it will simply be refused.
      const closed =
        from.owner !== to.owner
          ? seaLaneClosed(state, from.owner, border.a, border.b)
          : false;
      ctx.strokeStyle = closed ? 'rgba(226, 87, 76, 0.65)' : 'rgba(120, 176, 214, 0.42)';
      ctx.setLineDash([5, 6]);
      ctx.lineWidth = closed ? 1.8 : 1;
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

/**
 * The trade roads, drawn as thin gold threads along their paths.
 *
 * Every road at once would bury the map, so by default only the roads through
 * the selected province are drawn in full; the rest are a hint. `T` shows them
 * all.
 */
function drawTradeRoutes(ctx: CanvasRenderingContext2D, state: CampaignState, view: MapView): void {
  const selected = view.selected;
  const highlighted = new Set(selected ? routesThrough(selected) : []);
  ctx.save();
  for (const route of TRADE_ROUTES) {
    if (state.year < (route.fromYear ?? -Infinity)) continue;
    if (state.year > (route.untilYear ?? Infinity)) continue;
    const strong = highlighted.has(route.id);
    if (!strong && !view.showRoutes) continue;

    ctx.beginPath();
    route.path.forEach((region, index) => {
      const point = screenPositionOf(view, region);
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.setLineDash(strong ? [] : [2, 7]);
    ctx.lineWidth = strong ? 2.4 : 1;
    ctx.strokeStyle = strong ? 'rgba(217, 181, 95, 0.85)' : 'rgba(217, 181, 95, 0.3)';
    ctx.stroke();

    if (strong && view.camera.zoom >= 12) {
      const middle = route.path[Math.floor(route.path.length / 2)]!;
      const point = screenPositionOf(view, middle);
      ctx.setLineDash([]);
      ctx.font = 'italic 500 11px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(12, 16, 20, 0.85)';
      ctx.strokeText(route.name, point.x, point.y - 14);
      ctx.fillStyle = '#d9b55f';
      ctx.fillText(route.name, point.x, point.y - 14);
    }
  }
  ctx.restore();
}

/** Caravans, as small laden marks beside the province they are passing through. */
function drawCaravans(ctx: CanvasRenderingContext2D, state: CampaignState, view: MapView): void {
  const byRegion = new Map<RegionId, { colour: string; value: number }[]>();
  for (const caravan of state.caravans.values()) {
    const where = caravanLocation(caravan);
    if (!where) continue;
    const list = byRegion.get(where) ?? [];
    list.push({
      colour: tryGetFaction(caravan.faction)?.colour ?? INDEPENDENT_COLOUR,
      value: caravan.value,
    });
    byRegion.set(where, list);
  }

  for (const [region, caravans] of byRegion) {
    const province = state.regions.get(region);
    if (!province) continue;
    const point = screenPositionOf(view, region);
    const radius = radiusFor(province, view.camera.zoom);
    caravans.forEach((caravan, index) => {
      const angle = Math.PI * 1.25 - index * 0.5;
      const x = point.x + Math.cos(angle) * (radius + 8);
      const y = point.y + Math.sin(angle) * (radius + 8);
      const size = 2.4 + Math.min(2.2, caravan.value / 400);
      // A pack-load: a small square with a strap across it.
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - size, y - size * 0.8, size * 2, size * 1.6);
      ctx.fillStyle = caravan.colour;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(14, 18, 22, 0.9)';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - size, y);
      ctx.lineTo(x + size, y);
      ctx.strokeStyle = '#d9b55f';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    });
  }
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
