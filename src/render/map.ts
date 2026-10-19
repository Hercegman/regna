/**
 * The campaign map.
 *
 * Drawn as a painted map rather than a diagram: a real coastline, every
 * province a shape in its owner's colour, the ground marked with the terrain
 * it is, and settlements, armies and fleets standing on it as the things they
 * are. Nothing here is an image file. Every mark is vector work, so it stays
 * sharp at any zoom and takes any faction's colour.
 *
 * The order of drawing is the order a painter would use: water, land, the
 * division of the land, what grows on it, what runs through it, and last what
 * is standing on it.
 */
import type { Point, RegionId, Terrain } from '../core/types';
import { SETTLEMENT_ORDER } from '../core/types';
import type { CampaignState, RegionState } from '../core/campaign';
import { caravanLocation, seaLaneClosed, strengthOf, wallTier } from '../core/campaign';
import { REGIONS, getRegion } from '../core/data/regions';
import { BORDERS } from '../core/data/adjacency';
import { tryGetFaction, INDEPENDENT_ID } from '../core/data/factions';
import { TRADE_ROUTES, routesThrough } from '../core/data/trade';
import { LAKE_RINGS, RIVER_LINES } from '../core/data/geography';
import type { SeaZoneId } from '../core/data/seas';
import { SEA_ZONES, getSeaZone } from '../core/data/seas';
import type { Camera, Viewport } from './projection';
import { mercatorY, project, viewTransform } from './projection';
import { provinceShapes, landInMercator, terrainScatter, toMercator, cellExtent } from './provinces';
import {
  drawArmy,
  drawCaravan,
  drawSettlement,
  drawShip,
  drawTerrainMark,
  terrainColour,
} from './mapArt';

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
const SEA_DEEP = '#16222e';
const SEA_SHALLOW = '#1d3345';
const INK = 'rgba(26, 22, 17, 0.55)';
const INK_STRONG = 'rgba(22, 18, 14, 0.9)';

/** Pixels per degree below which the map is too small for detail work. */
const DETAIL_ZOOM = 10;

interface Transform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

const sx = (t: Transform, lon: number): number => lon * t.scale + t.offsetX;
const sy = (t: Transform, mercY: number): number => t.offsetY - mercY * t.scale;

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

export function screenPositionOf(view: MapView, id: RegionId): Point {
  const geography = getRegion(id);
  return project(view.camera, view.viewport, geography.lon, geography.lat);
}

/** The province whose ground contains a screen point. */
export function provinceAt(
  view: MapView,
  state: CampaignState,
  x: number,
  y: number,
): RegionId | undefined {
  // Nearest settlement in projected space is exactly the province the point
  // falls in, because the provinces are that division of the map.
  const t = viewTransform(view.camera, view.viewport);
  let best: RegionId | undefined;
  let bestDistance = Infinity;
  for (const shape of provinceShapes()) {
    if (!state.regions.has(shape.id)) continue;
    const px = sx(t, shape.site[0]);
    const py = sy(t, shape.site[1]);
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = shape.id;
    }
  }
  // Off the edge of the drawn world, nothing is selected.
  return bestDistance < 1e9 ? best : undefined;
}

function zoneRadius(zoom: number): number {
  return Math.max(10, Math.min(30, zoom * 0.9));
}

export function zonePosition(view: MapView, id: SeaZoneId): Point {
  const zone = getSeaZone(id);
  return project(view.camera, view.viewport, zone.lon, zone.lat);
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

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

export function drawMap(
  ctx: CanvasRenderingContext2D,
  state: CampaignState,
  view: MapView,
): void {
  const { width, height } = view.viewport;
  const t = viewTransform(view.camera, view.viewport);
  const zoom = view.camera.zoom;

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  drawSea(ctx, view);

  const land = buildLandPath(t);
  drawLandBody(ctx, land);

  // Everything that belongs to the ground is drawn inside the coastline, with
  // a little allowance around each settlement so that a harbour on a lagoon or
  // up a fjord still has ground under it.
  ctx.save();
  const groundPath = new Path2D(land);
  for (const shape of provinceShapes()) {
    const px = sx(t, shape.site[0]);
    const py = sy(t, shape.site[1]);
    groundPath.moveTo(px + zoom * 0.22, py);
    groundPath.arc(px, py, zoom * 0.22, 0, Math.PI * 2);
  }
  ctx.clip(groundPath);

  drawProvinceFills(ctx, state, view, t);
  drawRealmBands(ctx, state, t, zoom);
  drawTerrain(ctx, state, view, t);
  drawProvinceBorders(ctx, state, view, t);
  ctx.restore();

  drawWater(ctx, t, zoom);
  drawCoast(ctx, land, zoom);
  drawSeaBorders(ctx, state, view);
  drawSeaZones(ctx, state, view);
  drawTradeRoutes(ctx, state, view);
  drawReachable(ctx, state, view, t);
  drawSettlements(ctx, state, view, t);
  drawForces(ctx, state, view, t);
  drawCaravans(ctx, state, view);
  drawHolyWar(ctx, state, view);
  drawLabels(ctx, state, view, t);
  drawSelection(ctx, state, view, t);
  ctx.restore();
}

function drawSea(ctx: CanvasRenderingContext2D, view: MapView): void {
  const { width, height } = view.viewport;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, SEA_DEEP);
  gradient.addColorStop(0.55, SEA_SHALLOW);
  gradient.addColorStop(1, SEA_DEEP);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // A suggestion of swell, so the water is not a flat field of colour.
  ctx.save();
  ctx.strokeStyle = 'rgba(140, 186, 220, 0.06)';
  ctx.lineWidth = 1;
  for (let y = 14; y < height; y += 26) {
    ctx.beginPath();
    for (let x = 0; x <= width; x += 22) {
      const lift = Math.sin(x / 110 + y / 70) * 3.2;
      if (x === 0) ctx.moveTo(x, y + lift);
      else ctx.lineTo(x, y + lift);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function buildLandPath(t: Transform): Path2D {
  const path = new Path2D();
  for (const ring of landInMercator()) {
    ring.forEach(([lon, mercY], index) => {
      const x = sx(t, lon);
      const y = sy(t, mercY);
      if (index === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    path.closePath();
  }
  return path;
}

function drawLandBody(ctx: CanvasRenderingContext2D, land: Path2D): void {
  ctx.save();
  // A shelf of shallower water around the coast, so the land sits in the sea.
  ctx.shadowColor = 'rgba(96, 148, 180, 0.5)';
  ctx.shadowBlur = 16;
  ctx.fillStyle = '#8d9169';
  ctx.fill(land);
  ctx.shadowBlur = 0;
  ctx.fill(land);
  ctx.restore();
}

function ownerColours(region: RegionState): { fill: string; dark: string } {
  if (region.owner === INDEPENDENT_ID) return { fill: INDEPENDENT_COLOUR, dark: '#5c564d' };
  const faction = tryGetFaction(region.owner);
  return { fill: faction?.colour ?? INDEPENDENT_COLOUR, dark: faction?.colourDark ?? '#5c564d' };
}

function tracePath(ctx: CanvasRenderingContext2D, cell: readonly (readonly [number, number])[], t: Transform): void {
  ctx.beginPath();
  cell.forEach(([lon, mercY], index) => {
    const x = sx(t, lon);
    const y = sy(t, mercY);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

function drawProvinceFills(
  ctx: CanvasRenderingContext2D,
  state: CampaignState,
  view: MapView,
  t: Transform,
): void {
  ctx.save();
  for (const shape of provinceShapes()) {
    const region = state.regions.get(shape.id);
    if (!region || shape.cell.length < 3) continue;
    const geography = getRegion(shape.id);
    tracePath(ctx, shape.cell, t);
    // The ground first, so that a province reads as the country it is.
    ctx.fillStyle = terrainColour(geography.terrain);
    ctx.fill();
    // Then whose it is, as a wash over the ground rather than instead of it.
    // Zoomed out, the wash has to carry the whole answer to "whose is it?",
    // because the frontier band is then too thin to read. Zoomed in, the band
    // does that work and the wash gets out of the way of the ground.
    const wash = view.camera.zoom < 16 ? 0.46 : view.camera.zoom > 32 ? 0.26 : 0.36;
    ctx.globalAlpha = region.owner === INDEPENDENT_ID ? wash * 0.6 : wash;
    ctx.fillStyle = ownerColours(region).fill;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Unrest shows as a hatch, not as a pie chart on a disc.
    if (region.unrest > 45) {
      ctx.save();
      ctx.clip();
      ctx.globalAlpha = Math.min(0.4, (region.unrest - 45) / 140);
      ctx.strokeStyle = '#e2574c';
      ctx.lineWidth = 1.4;
      const px = sx(t, shape.site[0]);
      const py = sy(t, shape.site[1]);
      const reach = view.camera.zoom * 1.6;
      ctx.beginPath();
      for (let i = -6; i <= 6; i++) {
        ctx.moveTo(px - reach + i * 9, py - reach);
        ctx.lineTo(px + i * 9, py + reach);
      }
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}

/**
 * A band of the owner's colour laid along the inside of every realm's
 * frontier, coast included.
 *
 * This is what lets a player read who holds what at a glance without the
 * whole province being painted over: the ground stays the ground, and the
 * colour gathers where the question of ownership is actually being asked.
 * Drawn by stroking the frontier edges with a fat line and clipping it to the
 * province, so only the inner half survives.
 */
function drawRealmBands(
  ctx: CanvasRenderingContext2D,
  state: CampaignState,
  t: Transform,
  zoom: number,
): void {
  for (const shape of provinceShapes()) {
    const region = state.regions.get(shape.id);
    if (!region || shape.cell.length < 3) continue;
    // Proportional to the province, so a band never swallows a small one.
    const width = Math.max(2, Math.min(zoom * 0.45, cellExtent(shape) * t.scale * 0.13));

    let any = false;
    ctx.save();
    tracePath(ctx, shape.cell, t);
    ctx.clip();
    ctx.beginPath();
    for (let i = 0; i < shape.cell.length; i++) {
      const across = shape.edgeNeighbours[i];
      const other = across ? state.regions.get(across) : undefined;
      // An edge shared with a province of the same realm is internal and gets
      // no band; anything else is a frontier, including the open sea.
      if (other && other.owner === region.owner) continue;
      const a = shape.cell[i]!;
      const b = shape.cell[(i + 1) % shape.cell.length]!;
      ctx.moveTo(sx(t, a[0]), sy(t, a[1]));
      ctx.lineTo(sx(t, b[0]), sy(t, b[1]));
      any = true;
    }
    if (any) {
      ctx.globalAlpha = region.owner === INDEPENDENT_ID ? 0.42 : 0.72;
      ctx.strokeStyle = ownerColours(region).fill;
      ctx.lineWidth = width * 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    ctx.restore();
  }
}

/**
 * The marks that say what the ground is.
 *
 * Mountains, forest and marsh are scattered over the whole of a province, so
 * that a mountainous province reads as a range rather than as one symbol in a
 * polygon. High ground is shaded under its marks, which is most of what makes
 * a map look like country rather than like a chart.
 */
function drawTerrain(
  ctx: CanvasRenderingContext2D,
  state: CampaignState,
  view: MapView,
  t: Transform,
): void {
  const zoom = view.camera.zoom;
  if (zoom < DETAIL_ZOOM * 0.55) return;
  const base = Math.min(8.5, Math.max(1.8, zoom * 0.105));
  ctx.save();
  for (const shape of provinceShapes()) {
    const region = state.regions.get(shape.id);
    if (!region) continue;
    const px = sx(t, shape.site[0]);
    const py = sy(t, shape.site[1]);
    const reach = cellExtent(shape) * t.scale;
    if (px < -reach - 60 || px > view.viewport.width + reach + 60) continue;
    if (py < -reach - 60 || py > view.viewport.height + reach + 60) continue;

    const terrain = getRegion(shape.id).terrain as Terrain;
    const points = terrainScatter(shape);

    // Relief under the symbols, so high ground sits above the plain.
    if (terrain === 'mountains' || terrain === 'hills') {
      ctx.globalAlpha = terrain === 'mountains' ? 0.3 : 0.17;
      ctx.fillStyle = '#2f2a1d';
      for (const point of points) {
        const x = sx(t, point.x);
        const y = sy(t, point.y);
        ctx.beginPath();
        ctx.ellipse(x, y + base * 0.3, base * 1.5, base * 0.75, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalAlpha = terrain === 'forest' ? 0.62 : 0.55;
    for (const point of points) {
      const x = sx(t, point.x);
      const y = sy(t, point.y);
      if (x < -20 || x > view.viewport.width + 20) continue;
      if (y < -20 || y > view.viewport.height + 20) continue;
      drawTerrainMark(ctx, terrain, x, y, base * (0.72 + point.seed * 0.55));
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawProvinceBorders(
  ctx: CanvasRenderingContext2D,
  state: CampaignState,
  view: MapView,
  t: Transform,
): void {
  ctx.save();
  ctx.lineJoin = 'round';

  // Province lines first, thin and everywhere.
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(0.5, view.camera.zoom * 0.035);
  for (const shape of provinceShapes()) {
    if (!state.regions.has(shape.id) || shape.cell.length < 3) continue;
    tracePath(ctx, shape.cell, t);
    ctx.stroke();
  }

  // Then the borders between realms, heavily, because those are the lines a
  // player is actually reading.
  ctx.strokeStyle = INK_STRONG;
  ctx.lineWidth = Math.max(1.2, view.camera.zoom * 0.1);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const shape of provinceShapes()) {
    const region = state.regions.get(shape.id);
    if (!region) continue;
    for (let i = 0; i < shape.cell.length; i++) {
      const across = shape.edgeNeighbours[i];
      if (!across) continue;
      const other = state.regions.get(across);
      if (!other || other.owner === region.owner) continue;
      // Draw each shared edge once: the province whose id sorts first owns it.
      if (shape.id > across) continue;
      const a = shape.cell[i]!;
      const b = shape.cell[(i + 1) % shape.cell.length]!;
      ctx.moveTo(sx(t, a[0]), sy(t, a[1]));
      ctx.lineTo(sx(t, b[0]), sy(t, b[1]));
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** Lakes and the great rivers. */
function drawWater(ctx: CanvasRenderingContext2D, t: Transform, zoom: number): void {
  ctx.save();
  ctx.fillStyle = SEA_SHALLOW;
  for (const ring of LAKE_RINGS) {
    const projected = toMercator(ring);
    ctx.beginPath();
    projected.forEach(([lon, mercY], index) => {
      const x = sx(t, lon);
      const y = sy(t, mercY);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
  }

  if (zoom >= DETAIL_ZOOM * 0.8) {
    ctx.strokeStyle = 'rgba(110, 160, 196, 0.72)';
    ctx.lineWidth = Math.max(0.7, zoom * 0.045);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const line of RIVER_LINES) {
      const projected = toMercator(line);
      ctx.beginPath();
      projected.forEach(([lon, mercY], index) => {
        const x = sx(t, lon);
        const y = sy(t, mercY);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawCoast(ctx: CanvasRenderingContext2D, land: Path2D, zoom: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(22, 18, 14, 0.8)';
  ctx.lineWidth = Math.max(0.8, zoom * 0.055);
  ctx.lineJoin = 'round';
  ctx.stroke(land);
  ctx.restore();
}

/** The sea crossings an army can make, and which of them a fleet has closed. */
function drawSeaBorders(ctx: CanvasRenderingContext2D, state: CampaignState, view: MapView): void {
  ctx.save();
  ctx.setLineDash([5, 6]);
  for (const border of BORDERS) {
    if (border.kind !== 'sea') continue;
    const from = state.regions.get(border.a);
    const to = state.regions.get(border.b);
    if (!from || !to) continue;
    const a = screenPositionOf(view, border.a);
    const b = screenPositionOf(view, border.b);
    if (offScreen(a, b, view.viewport)) continue;
    const closed =
      from.owner !== to.owner ? seaLaneClosed(state, from.owner, border.a, border.b) : false;
    ctx.strokeStyle = closed ? 'rgba(226, 87, 76, 0.65)' : 'rgba(150, 196, 226, 0.3)';
    ctx.lineWidth = closed ? 1.8 : 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

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
    if (reachable || selected || hovered) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.setLineDash(reachable ? [4, 4] : []);
      ctx.lineWidth = selected ? 2.4 : 2;
      ctx.strokeStyle = selected
        ? '#ffe28a'
        : reachable
          ? 'rgba(255, 226, 138, 0.8)'
          : 'rgba(180, 220, 245, 0.7)';
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (zoom >= 13 || selected || hovered || occupied) {
      ctx.font = 'italic 500 11px ui-serif, Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(12, 20, 28, 0.8)';
      ctx.strokeText(zone.name, point.x, point.y);
      ctx.fillStyle = 'rgba(168, 202, 228, 0.78)';
      ctx.fillText(zone.name, point.x, point.y);
    }
  }
  ctx.restore();
}

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
    ctx.setLineDash(strong ? [9, 5] : [2, 8]);
    ctx.lineWidth = strong ? 2.2 : 1;
    ctx.lineCap = 'round';
    ctx.strokeStyle = strong ? 'rgba(226, 196, 112, 0.9)' : 'rgba(226, 196, 112, 0.35)';
    ctx.stroke();
    ctx.setLineDash([]);

    if (strong && view.camera.zoom >= 12) {
      const middle = route.path[Math.floor(route.path.length / 2)]!;
      const point = screenPositionOf(view, middle);
      ctx.font = 'italic 600 11px ui-serif, Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(16, 14, 10, 0.85)';
      ctx.strokeText(route.name, point.x, point.y - 18);
      ctx.fillStyle = '#e2c470';
      ctx.fillText(route.name, point.x, point.y - 18);
    }
  }
  ctx.restore();
}

function drawReachable(
  ctx: CanvasRenderingContext2D,
  state: CampaignState,
  view: MapView,
  t: Transform,
): void {
  if (view.reachable.size === 0) return;
  ctx.save();
  for (const id of view.reachable) {
    const shape = provinceShapes().find((candidate) => candidate.id === id);
    if (!shape || !state.regions.has(id)) continue;
    tracePath(ctx, shape.cell, t);
    ctx.fillStyle = 'rgba(255, 226, 138, 0.2)';
    ctx.fill();
    ctx.strokeStyle = '#ffe28a';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

const WALL_ORDER = ['none', 'palisade', 'wooden', 'stone', 'large_stone', 'epic'];

function drawSettlements(
  ctx: CanvasRenderingContext2D,
  state: CampaignState,
  view: MapView,
  t: Transform,
): void {
  const zoom = view.camera.zoom;
  for (const geography of REGIONS) {
    const region = state.regions.get(geography.id);
    if (!region) continue;
    const x = sx(t, geography.lon);
    const y = sy(t, mercatorY(geography.lat));
    if (x < -40 || x > view.viewport.width + 40) continue;
    if (y < -40 || y > view.viewport.height + 40) continue;

    const rank = SETTLEMENT_ORDER.indexOf(region.tier);
    const scale = Math.max(3.2, Math.min(16, zoom * (0.2 + rank * 0.045)));
    const colours = ownerColours(region);
    drawSettlement(ctx, x, y, scale, {
      rank,
      walls: WALL_ORDER.indexOf(wallTier(region)),
      colour: colours.fill,
      colourDark: colours.dark,
      port: geography.port,
    });

    // A besieged place gets a ring of the besieger's intent.
    if (region.siege) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, scale * 2.1, 0, Math.PI * 2);
      ctx.strokeStyle = '#e2574c';
      ctx.lineWidth = 2.2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawForces(
  ctx: CanvasRenderingContext2D,
  state: CampaignState,
  view: MapView,
  t: Transform,
): void {
  const zoom = view.camera.zoom;
  const size = Math.max(3.5, Math.min(13, zoom * 0.3));

  // Armies, fanned out where several share a province.
  const byRegion = new Map<RegionId, { colour: string; dark: string; men: number }[]>();
  for (const army of state.armies.values()) {
    const faction = tryGetFaction(army.faction);
    const list = byRegion.get(army.location) ?? [];
    list.push({
      colour: faction?.colour ?? INDEPENDENT_COLOUR,
      dark: faction?.colourDark ?? '#5c564d',
      men: strengthOf(army.regiments),
    });
    byRegion.set(army.location, list);
  }
  for (const [id, armies] of byRegion) {
    const geography = getRegion(id);
    const x = sx(t, geography.lon);
    const y = sy(t, mercatorY(geography.lat));
    armies.forEach((army, index) => {
      const offset = (index - (armies.length - 1) / 2) * size * 1.9;
      drawArmy(ctx, x + offset, y + size * 1.7, size, army.colour, army.dark, army.men);
    });
  }

  // Fleets, at anchor beside their harbour or on station in open water.
  const fleetGroups = new Map<string, { x: number; y: number; colour: string; dark: string; laden: boolean }[]>();
  for (const fleet of state.fleets.values()) {
    const faction = tryGetFaction(fleet.faction);
    const anchor =
      fleet.location.kind === 'port'
        ? screenPositionOf(view, fleet.location.region)
        : zonePosition(view, fleet.location.zone);
    const key =
      fleet.location.kind === 'port' ? `port:${fleet.location.region}` : `sea:${fleet.location.zone}`;
    const list = fleetGroups.get(key) ?? [];
    list.push({
      x: anchor.x,
      y: anchor.y,
      colour: faction?.colour ?? INDEPENDENT_COLOUR,
      dark: faction?.colourDark ?? '#5c564d',
      laden: fleet.cargo.length > 0,
    });
    fleetGroups.set(key, list);
  }
  for (const [key, fleets] of fleetGroups) {
    const atSea = key.startsWith('sea:');
    fleets.forEach((fleet, index) => {
      const offset = (index - (fleets.length - 1) / 2) * size * 2;
      const x = fleet.x + (atSea ? offset : offset * 0.7 - size * 1.8);
      const y = fleet.y + (atSea ? 0 : size * 1.1);
      drawShip(ctx, x, y, size * 0.85, fleet.colour, fleet.dark, fleet.laden);
    });
  }
}

function drawCaravans(ctx: CanvasRenderingContext2D, state: CampaignState, view: MapView): void {
  if (view.camera.zoom < DETAIL_ZOOM) return;
  const size = Math.max(2.4, Math.min(7, view.camera.zoom * 0.17));
  const byRegion = new Map<RegionId, string[]>();
  for (const caravan of state.caravans.values()) {
    const where = caravanLocation(caravan);
    if (!where) continue;
    const colour = tryGetFaction(caravan.faction)?.colour ?? INDEPENDENT_COLOUR;
    byRegion.set(where, [...(byRegion.get(where) ?? []), colour]);
  }
  for (const [id, colours] of byRegion) {
    const point = screenPositionOf(view, id);
    colours.forEach((colour, index) => {
      drawCaravan(ctx, point.x - size * 2.6, point.y - size * (2.2 + index * 1.4), size, colour);
    });
  }
}

function drawHolyWar(ctx: CanvasRenderingContext2D, state: CampaignState, view: MapView): void {
  const war = state.faith.holyWar;
  if (!war) return;
  const province = state.regions.get(war.target);
  if (!province) return;
  const point = screenPositionOf(view, war.target);
  const radius = Math.max(14, view.camera.zoom * 0.55);

  ctx.save();
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = war.faith === 'christian' ? 'rgba(244, 238, 216, 0.95)' : 'rgba(126, 210, 166, 0.95)';
  ctx.lineWidth = 2.4;
  ctx.setLineDash([7, 5]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = war.faith === 'christian' ? '#f4eed8' : '#7ed2a6';
  ctx.lineWidth = 2.4;
  const mark = radius + 10;
  ctx.beginPath();
  if (war.faith === 'christian') {
    ctx.moveTo(point.x, point.y - mark - 6);
    ctx.lineTo(point.x, point.y - mark + 6);
    ctx.moveTo(point.x - 5, point.y - mark - 1);
    ctx.lineTo(point.x + 5, point.y - mark - 1);
  } else {
    ctx.arc(point.x, point.y - mark, 6, Math.PI * 0.35, Math.PI * 1.65);
  }
  ctx.stroke();
  ctx.restore();
}

function drawLabels(
  ctx: CanvasRenderingContext2D,
  state: CampaignState,
  view: MapView,
  t: Transform,
): void {
  const zoom = view.camera.zoom;
  if (!view.alwaysLabel && zoom < 9) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const geography of REGIONS) {
    const region = state.regions.get(geography.id);
    if (!region) continue;
    const rank = SETTLEMENT_ORDER.indexOf(region.tier);
    const threshold = zoom < 14 ? 3 : zoom < 22 ? 2 : zoom < 34 ? 1 : 0;
    if (!view.alwaysLabel && rank < threshold) continue;
    const x = sx(t, geography.lon);
    const y = sy(t, mercatorY(geography.lat));
    if (x < 0 || x > view.viewport.width) continue;
    if (y < 0 || y > view.viewport.height) continue;

    const scale = Math.max(3.2, Math.min(16, zoom * (0.2 + rank * 0.045)));
    const fontSize = Math.max(9, Math.min(15, 8 + rank * 1.1 + zoom * 0.05));
    ctx.font = `${rank >= 4 ? '600' : '500'} ${fontSize}px ui-serif, Georgia, serif`;
    const label = geography.settlement;
    const offset = scale * 0.9;
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = 'rgba(14, 16, 12, 0.88)';
    ctx.strokeText(label, x, y + offset);
    ctx.fillStyle = rank >= 4 ? '#f3ecd8' : '#e2dcc6';
    ctx.fillText(label, x, y + offset);
  }
  ctx.restore();
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  state: CampaignState,
  view: MapView,
  t: Transform,
): void {
  for (const [id, colour, weight] of [
    [view.hovered, 'rgba(255,255,255,0.45)', 1.6] as const,
    [view.selected, '#ffe28a', 2.8] as const,
  ]) {
    if (!id) continue;
    const shape = provinceShapes().find((candidate) => candidate.id === id);
    if (!shape || !state.regions.has(id)) continue;
    tracePath(ctx, shape.cell, t);
    ctx.strokeStyle = colour;
    ctx.lineWidth = weight;
    ctx.setLineDash([]);
    ctx.stroke();
  }
}

function offScreen(a: Point, b: Point, viewport: Viewport): boolean {
  const margin = 60;
  return (
    Math.max(a.x, b.x) < -margin ||
    Math.min(a.x, b.x) > viewport.width + margin ||
    Math.max(a.y, b.y) < -margin ||
    Math.min(a.y, b.y) > viewport.height + margin
  );
}
