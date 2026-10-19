/**
 * The campaign map.
 *
 * An isometric picture in the manner of Locomotion: diamond tiles of ground,
 * each raised by the height under it, with everything that stands on them
 * stamped from a sheet of sprites that were modelled and rendered rather than
 * drawn. The world is painted small and blown up with hard edges, so what you
 * are looking at is pixels on purpose.
 *
 * Only the ground and the things standing on it are pixelated. Names are
 * drawn afterwards at the screen's own resolution, because a place name in
 * six-pixel type is not a style, it is unreadable.
 *
 * The public shape of this module has not changed: the campaign screen asks
 * for the same four things it always did.
 */
import type { Point, RegionId } from '../core/types';
import { SETTLEMENT_ORDER } from '../core/types';
import type { CampaignState } from '../core/campaign';
import { caravanLocation, strengthOf, wallTier } from '../core/campaign';
import {
  canSeeAgent,
  canSeeArmy,
  canSeeCaravan,
  canSeeFleet,
  watchedProvinces,
  watchedZones,
} from '../core/campaign/sight';
import { REGIONS, getRegion } from '../core/data/regions';
import { tryGetFaction, INDEPENDENT_ID } from '../core/data/factions';
import { TRADE_ROUTES, routesThrough } from '../core/data/trade';
import type { SeaZoneId } from '../core/data/seas';
import { SEA_ZONES, getSeaZone } from '../core/data/seas';
import type { Camera, Viewport } from './projection';
import { mercatorY } from './projection';
import { provinceShapes } from './provinces';
import { loadGround, type Ground } from './iso/elevation';
import { drawGround, type TilePaint } from './iso/terrain';
import { loadSprites, stamp, type SpriteName } from './iso/sprites';
import {
  floorAt,
  floorAtLatLon,
  floorFrom,
  isoTransform,
  liftFor,
  tileOf,
  type IsoTransform,
} from './iso/view';

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

/**
 * How many screen pixels go to one pixel of the picture.
 *
 * Three is the point at which a tile is unmistakably made of pixels without
 * the map becoming a mosaic you cannot read.
 */
export const PIXEL = 3;

const SKY = '#0c1620';

/** The picture the world is drawn into before it is blown up. */
let small: HTMLCanvasElement | undefined;
let ground: Ground | undefined;
let groundAsked = false;
let spritesAsked = false;

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

// ---------------------------------------------------------------------------
// Where things are
// ---------------------------------------------------------------------------

function transformFor(view: MapView): IsoTransform {
  return isoTransform(view.camera, view.viewport, PIXEL);
}

/** Where a settlement stands, in the picture's own pixels. */
function placeOf(transform: IsoTransform, id: RegionId): Point {
  const geography = getRegion(id);
  const floor = floorAtLatLon(transform, geography.lon, geography.lat);
  const metres = ground?.metresAt(geography.lon, geography.lat) ?? 0;
  return { x: floor.x, y: floor.y - liftFor(transform, metres) };
}

export function screenPositionOf(view: MapView, id: RegionId): Point {
  const place = placeOf(transformFor(view), id);
  return { x: place.x * PIXEL, y: place.y * PIXEL };
}

export function zonePosition(view: MapView, id: SeaZoneId): Point {
  const zone = getSeaZone(id);
  const floor = floorAtLatLon(transformFor(view), zone.lon, zone.lat);
  return { x: floor.x * PIXEL, y: floor.y * PIXEL };
}

/**
 * The province under a point of the screen.
 *
 * Read off the floor, ignoring how high the ground is there: on a mountain
 * the answer is a little south of where the eye says it should be. Every
 * isometric game has this and the honest fix — tracing the ray down through
 * the heights — costs more than the error is worth on a map at this scale.
 */
export function provinceAt(
  view: MapView,
  state: CampaignState,
  x: number,
  y: number,
): RegionId | undefined {
  const transform = transformFor(view);
  const floor = floorFrom(transform, x / PIXEL, y / PIXEL);
  let best: RegionId | undefined;
  let bestDistance = Infinity;
  for (const shape of provinceShapes()) {
    if (!state.regions.has(shape.id)) continue;
    const dx = shape.site[0] - floor.lon;
    const dy = shape.site[1] - floor.merc;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = shape.id;
    }
  }
  return best;
}

function zoneRadius(transform: IsoTransform): number {
  return Math.max(6, Math.min(26, transform.zoom * 0.5));
}

export function zoneAt(view: MapView, x: number, y: number): SeaZoneId | undefined {
  const transform = transformFor(view);
  const radius = zoneRadius(transform);
  let best: SeaZoneId | undefined;
  let bestDistance = Infinity;
  for (const zone of SEA_ZONES) {
    const at = floorAtLatLon(transform, zone.lon, zone.lat);
    const distance = Math.hypot(at.x - x / PIXEL, at.y - y / PIXEL);
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

/** What is standing on a tile, gathered before the sweep that paints them. */
interface Standing {
  readonly sprite: SpriteName;
  readonly size: number;
  readonly colour: string | undefined;
  /** Nudged off the middle of the tile so several do not pile up. */
  readonly offsetX: number;
  readonly offsetY: number;
}

export function drawMap(
  ctx: CanvasRenderingContext2D,
  state: CampaignState,
  view: MapView,
): void {
  const { width, height } = view.viewport;
  if (!groundAsked) {
    groundAsked = true;
    void loadGround().then((loaded) => {
      ground = loaded;
    });
  }
  if (!spritesAsked) {
    spritesAsked = true;
    void loadSprites().catch(() => undefined);
  }

  const smallWidth = Math.max(1, Math.floor(width / PIXEL));
  const smallHeight = Math.max(1, Math.floor(height / PIXEL));
  const paint = picture(smallWidth, smallHeight);
  const transform = transformFor(view);

  paint.fillStyle = SKY;
  paint.fillRect(0, 0, smallWidth, smallHeight);

  if (ground) {
    const watched = watchedProvinces(state, state.player);
    const zones = watchedZones(state, state.player);
    const standing = gather(state, view, transform, watched, zones);

    drawGround(
      paint,
      { state, ground, transform, width: smallWidth, height: smallHeight },
      (tile) => {
        veil(paint, tile, transform, watched);
        const here = standing.get(key(tile.tx, tile.ty));
        if (!here) return;
        for (const item of here) {
          stamp(paint, item.sprite, tile.x + item.offsetX, tile.y + item.offsetY, item.size, item.colour);
        }
      },
    );

    drawFrontiers(paint, state, transform, watched);
    drawRoutes(paint, state, view, transform);
    drawHighlights(paint, view, transform);
  }

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(small!, 0, 0, smallWidth, smallHeight, 0, 0, smallWidth * PIXEL, smallHeight * PIXEL);

  drawNames(ctx, state, view, transform);
}

/** A thin wash over ground nobody of ours has eyes on. */
function veil(
  ctx: CanvasRenderingContext2D,
  tile: TilePaint,
  transform: IsoTransform,
  watched: ReadonlySet<RegionId>,
): void {
  if (!tile.province || watched.has(tile.province)) return;
  const halfWidth = transform.halfWidth;
  const halfHeight = transform.halfHeight;
  ctx.fillStyle = 'rgba(10, 14, 22, 0.34)';
  ctx.beginPath();
  ctx.moveTo(tile.x, tile.y - halfHeight);
  ctx.lineTo(tile.x + halfWidth, tile.y);
  ctx.lineTo(tile.x, tile.y + halfHeight);
  ctx.lineTo(tile.x - halfWidth, tile.y);
  ctx.closePath();
  ctx.fill();
}

const key = (tx: number, ty: number): string => `${tx},${ty}`;

/**
 * Everything that stands on the ground, filed by the tile it stands on.
 *
 * Gathered before the sweep so that the sweep can stamp each one the moment
 * it paints the tile under it, which is what puts them in the right order
 * without anything having to sort.
 */
function gather(
  state: CampaignState,
  view: MapView,
  transform: IsoTransform,
  watched: ReadonlySet<RegionId>,
  zones: ReadonlySet<string>,
): Map<string, Standing[]> {
  const out = new Map<string, Standing[]>();
  const add = (lon: number, merc: number, item: Standing): void => {
    const tile = tileOf(transform, lon, merc);
    const at = key(tile.tx, tile.ty);
    const list = out.get(at);
    if (list) list.push(item);
    else out.set(at, [item]);
  };

  // Sized from the zoom rather than from the tile. A tile is kept to about
  // eight pixels at every zoom by design, so sizing anything off it makes
  // everything the same size however far in you are.
  const close = transform.zoom;
  const townSize = Math.max(9, Math.min(60, close * 2.4));
  const unitSize = Math.max(8, Math.min(40, close * 1.5));

  for (const geography of REGIONS) {
    const region = state.regions.get(geography.id);
    if (!region) continue;
    const rank = SETTLEMENT_ORDER.indexOf(region.tier);
    const colour = region.owner === INDEPENDENT_ID
      ? '#8d8578'
      : tryGetFaction(region.owner)?.colour ?? '#8d8578';
    add(geography.lon, mercatorY(geography.lat), {
      sprite: `town${Math.max(0, Math.min(5, rank))}` as SpriteName,
      size: townSize,
      colour,
      offsetX: 0,
      offsetY: 0,
    });
    void wallTier(region);
  }

  let nudge = 0;
  for (const army of state.armies.values()) {
    if (!canSeeArmy(state, state.player, army.id, watched)) continue;
    const geography = getRegion(army.location);
    const faction = tryGetFaction(army.faction);
    const mounted = strengthOf(army.regiments) > 900;
    nudge += 1;
    add(geography.lon, mercatorY(geography.lat), {
      sprite: mounted ? 'horsemen' : 'footmen',
      size: unitSize,
      colour: faction?.colour ?? '#8d8578',
      offsetX: Math.round(transform.halfWidth * 0.8),
      offsetY: Math.round(transform.halfHeight * 0.9) + (nudge % 2) * 2,
    });
  }

  for (const fleet of state.fleets.values()) {
    if (!canSeeFleet(state, state.player, fleet.id, watched, zones)) continue;
    const where = fleet.location.kind === 'port'
      ? { lon: getRegion(fleet.location.region).lon, lat: getRegion(fleet.location.region).lat }
      : { lon: getSeaZone(fleet.location.zone).lon, lat: getSeaZone(fleet.location.zone).lat };
    add(where.lon, mercatorY(where.lat), {
      sprite: fleet.cargo.length > 0 ? 'roundship' : 'galley',
      size: unitSize,
      colour: tryGetFaction(fleet.faction)?.colour ?? '#8d8578',
      offsetX: -Math.round(transform.halfWidth * 0.7),
      offsetY: Math.round(transform.halfHeight * 0.6),
    });
  }

  for (const agent of state.agents.values()) {
    if (!canSeeAgent(state, state.player, agent.id, watched)) continue;
    const geography = getRegion(agent.location);
    add(geography.lon, mercatorY(geography.lat), {
      sprite: 'scrub',
      size: Math.max(6, unitSize * 0.5),
      colour: undefined,
      offsetX: -Math.round(transform.halfWidth * 0.9),
      offsetY: -Math.round(transform.halfHeight * 0.4),
    });
  }

  for (const caravan of state.caravans.values()) {
    if (!canSeeCaravan(state, state.player, caravan.id, watched)) continue;
    const where = caravanLocation(caravan);
    if (!where) continue;
    const geography = getRegion(where);
    add(geography.lon, mercatorY(geography.lat), {
      sprite: 'scrub',
      size: Math.max(6, unitSize * 0.45),
      colour: undefined,
      offsetX: Math.round(transform.halfWidth * 0.3),
      offsetY: -Math.round(transform.halfHeight * 0.8),
    });
  }

  void view;
  return out;
}

/**
 * The lines between realms.
 *
 * Drawn from the province shapes rather than by comparing tiles, which would
 * mean asking which province every neighbour of every tile belongs to. The
 * shapes already know which of their edges face another province, and that
 * is a few hundred lines instead of tens of thousands of lookups.
 */
function drawFrontiers(
  ctx: CanvasRenderingContext2D,
  state: CampaignState,
  transform: IsoTransform,
  watched: ReadonlySet<RegionId>,
): void {
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  for (const shape of provinceShapes()) {
    const region = state.regions.get(shape.id);
    if (!region || shape.cell.length < 3) continue;
    const faction = region.owner === INDEPENDENT_ID ? undefined : tryGetFaction(region.owner);
    const colour = faction?.colour ?? '#9a9286';
    let drew = false;
    ctx.beginPath();
    for (let i = 0; i < shape.cell.length; i++) {
      const across = shape.edgeNeighbours[i];
      const other = across ? state.regions.get(across) : undefined;
      if (other && other.owner === region.owner) continue;
      const a = shape.cell[i]!;
      const b = shape.cell[(i + 1) % shape.cell.length]!;
      const from = lifted(transform, a[0], a[1]);
      const to = lifted(transform, b[0], b[1]);
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      drew = true;
    }
    if (!drew) continue;
    ctx.strokeStyle = watched.has(shape.id) ? colour : 'rgba(150,150,150,0.35)';
    ctx.stroke();
  }
}

/** A world point, raised onto the ground it sits on. */
function lifted(transform: IsoTransform, lon: number, merc: number): Point {
  const floor = floorAt(transform, lon, merc);
  if (!ground) return floor;
  const metres = ground.metresAt(lon, inverseLat(merc));
  return { x: floor.x, y: floor.y - liftFor(transform, metres) };
}

function inverseLat(merc: number): number {
  return (2 * Math.atan(Math.exp((merc * Math.PI) / 180)) - Math.PI / 2) * (180 / Math.PI);
}

function drawRoutes(
  ctx: CanvasRenderingContext2D,
  state: CampaignState,
  view: MapView,
  transform: IsoTransform,
): void {
  const highlighted = new Set(view.selected ? routesThrough(view.selected) : []);
  ctx.lineWidth = 1;
  for (const route of TRADE_ROUTES) {
    if (state.year < (route.fromYear ?? -Infinity)) continue;
    if (state.year > (route.untilYear ?? Infinity)) continue;
    const strong = highlighted.has(route.id);
    if (!strong && !view.showRoutes) continue;
    ctx.beginPath();
    route.path.forEach((id, index) => {
      const at = placeOf(transform, id);
      if (index === 0) ctx.moveTo(at.x, at.y);
      else ctx.lineTo(at.x, at.y);
    });
    ctx.strokeStyle = strong ? 'rgba(226, 196, 112, 0.9)' : 'rgba(226, 196, 112, 0.3)';
    ctx.stroke();
  }
}

function drawHighlights(
  ctx: CanvasRenderingContext2D,
  view: MapView,
  transform: IsoTransform,
): void {
  const outline = (id: RegionId, colour: string, weight: number): void => {
    const shape = provinceShapes().find((candidate) => candidate.id === id);
    if (!shape) return;
    ctx.beginPath();
    shape.cell.forEach(([lon, merc], index) => {
      const at = lifted(transform, lon, merc);
      if (index === 0) ctx.moveTo(at.x, at.y);
      else ctx.lineTo(at.x, at.y);
    });
    ctx.closePath();
    ctx.strokeStyle = colour;
    ctx.lineWidth = weight;
    ctx.stroke();
  };
  for (const id of view.reachable) outline(id, 'rgba(255, 226, 138, 0.75)', 1);
  if (view.hovered) outline(view.hovered, 'rgba(255,255,255,0.55)', 1);
  if (view.selected) outline(view.selected, '#ffe28a', 1);
}

/**
 * Names, drawn last and at the screen's own resolution.
 *
 * Everything else is pixels on purpose; a place name in six-pixel type is
 * not a style, it is unreadable.
 */
function drawNames(
  ctx: CanvasRenderingContext2D,
  state: CampaignState,
  view: MapView,
  transform: IsoTransform,
): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const zoom = view.camera.zoom;

  for (const geography of REGIONS) {
    const region = state.regions.get(geography.id);
    if (!region) continue;
    const rank = SETTLEMENT_ORDER.indexOf(region.tier);
    const threshold = zoom < 14 ? 3 : zoom < 22 ? 2 : zoom < 34 ? 1 : 0;
    if (!view.alwaysLabel && rank < threshold) continue;
    const at = placeOf(transform, geography.id);
    const x = at.x * PIXEL;
    const y = at.y * PIXEL + 4;
    if (x < 0 || x > view.viewport.width || y < 0 || y > view.viewport.height) continue;
    const size = Math.max(10, Math.min(15, 9 + rank));
    ctx.font = `${rank >= 4 ? '600' : '500'} ${size}px ui-serif, Georgia, serif`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(10, 14, 10, 0.9)';
    ctx.strokeText(geography.settlement, x, y);
    ctx.fillStyle = rank >= 4 ? '#f3ecd8' : '#e2dcc6';
    ctx.fillText(geography.settlement, x, y);
  }

  const zones = watchedZones(state, state.player);
  for (const zone of SEA_ZONES) {
    if (zoom < 13 && view.selectedZone !== zone.id && view.hoveredZone !== zone.id) continue;
    const at = floorAtLatLon(transform, zone.lon, zone.lat);
    const x = at.x * PIXEL;
    const y = at.y * PIXEL;
    if (x < 0 || x > view.viewport.width || y < 0 || y > view.viewport.height) continue;
    const selected = view.selectedZone === zone.id || view.reachableZones.has(zone.id);
    ctx.font = 'italic 500 11px ui-serif, Georgia, serif';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(8, 14, 20, 0.85)';
    ctx.strokeText(zone.name, x, y);
    ctx.fillStyle = selected ? '#ffe28a' : zones.has(zone.id as string)
      ? 'rgba(168, 202, 228, 0.85)'
      : 'rgba(140, 164, 184, 0.5)';
    ctx.fillText(zone.name, x, y);
    ctx.textBaseline = 'top';
  }
}
