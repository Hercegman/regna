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
import type { FactionId, Point, RegionId } from '../core/types';
import { SETTLEMENT_ORDER } from '../core/types';
import type { CampaignState } from '../core/campaign';
import { caravanLocation, wallTier } from '../core/campaign';
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
import { deviceOf } from '../core/data/heraldry';
import { TRADE_ROUTES, routesThrough } from '../core/data/trade';
import type { SeaZoneId } from '../core/data/seas';
import { SEA_ZONES, getSeaZone } from '../core/data/seas';
import type { Camera, Viewport } from './projection';
import { mercatorY } from './projection';
import { provinceShapes, type ProvinceShape } from './provinces';
import { LAKE_RINGS, LAND_RINGS, RIVER_LINES } from '../core/data/geography';
import { DECOR } from './iso/palette';
import { armsCanvas } from './arms';
import { drawGrade } from './grade';
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
 * Two rather than three. Three made a tile unmistakably made of pixels, and
 * also threw away more than half the detail the screen could have carried: a
 * town was twenty pixels of actual information blown up to sixty. At two the
 * picture is still visibly pixels — the sprites are the same pixels, only
 * more of them — and there is room for texture in the ground, for a shadow
 * under what stands on it, and for a man to have a shield.
 */
export const PIXEL = 2;

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

/**
 * Draws again once the ground is in.
 *
 * The same trap the sprite sheet sets, and worse. The elevation grid is
 * fetched on the first frame and the map cannot draw a thing without it, so
 * a screen that draws once and then waits — which is exactly what the
 * campaign does when it is opened from the menu rather than straight off the
 * page load — sits there as an empty sky until something else happens to
 * make it redraw. It used to come up right only because a resize happened to
 * fire after the fetch landed.
 */
export function whenMapReady(redraw: () => void): void {
  if (ground) {
    redraw();
    return;
  }
  groundAsked = true;
  void loadGround()
    .then((loaded) => {
      ground = loaded;
      redraw();
    })
    .catch(() => undefined);
}

export function screenPositionOf(view: MapView, id: RegionId): Point {
  const place = placeOf(transformFor(view), id);
  return { x: place.x * PIXEL, y: place.y * PIXEL };
}

/**
 * The four corners of the ground on screen, in world coordinates.
 *
 * The radar needs to draw a box around what the player is looking at, and
 * because the map is isometric that box is a slanted one out here. Taken off
 * the floor, so on hilly ground it is approximate in the same direction and
 * by the same amount as picking is.
 */
export function viewCorners(view: MapView): { lon: number; merc: number }[] {
  const transform = transformFor(view);
  const width = view.viewport.width / PIXEL;
  const height = view.viewport.height / PIXEL;
  return [
    floorFrom(transform, 0, 0),
    floorFrom(transform, width, 0),
    floorFrom(transform, width, height),
    floorFrom(transform, 0, height),
  ];
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

/**
 * What is standing on a tile, gathered before the sweep that paints them.
 *
 * It carries its own place in the picture rather than relying on the tile's.
 * A tile at the zoom a continent is read at covers several kilometres, so
 * stamping a town at the middle of the tile it falls in put it up to a tile
 * away from the place it belongs to — and that far from its own name, which
 * is drawn at the real coordinates. The tile decides only when the thing is
 * painted, which is what gets it in front of whatever is behind it.
 */
interface Standing {
  readonly sprite: SpriteName;
  readonly size: number;
  readonly colour: string | undefined;
  /** What is painted on the shield, when the thing has one. */
  readonly device?: string | undefined;
  /** Where it stands, in the picture's own pixels, already lifted. */
  readonly x: number;
  readonly y: number;
  /** Nudged off its own place so several in one province do not pile up. */
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
          stamp(
            paint,
            item.sprite,
            item.x + item.offsetX,
            item.y + item.offsetY,
            item.size,
            item.colour,
            true,
            item.device,
          );
        }
      },
    );

    drawCoast(paint, transform);
    drawRivers(paint, transform);
    drawFrontiers(paint, state, transform, watched, smallWidth, smallHeight);
    drawRoutes(paint, state, view, transform);
    drawHighlights(paint, view, transform);
  }

  // The corners down, and the whole afternoon pulled together. Laid on the
  // small canvas and not the screen, so the shade in a corner is picture
  // pixels like everything else — a smooth gradient over a picture made of
  // steps is the one thing that gives away that the steps are a choice.
  drawGrade(paint, smallWidth, smallHeight);

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
  ctx.fillStyle = 'rgba(12, 16, 26, 0.26)';
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
  const add = (lon: number, lat: number, item: Omit<Standing, 'x' | 'y'>): void => {
    const merc = mercatorY(lat);
    const floor = floorAt(transform, lon, merc);
    const metres = ground?.metresAt(lon, lat) ?? 0;
    const placed: Standing = {
      ...item,
      x: floor.x,
      y: floor.y - liftFor(transform, metres),
    };
    const tile = tileOf(transform, lon, merc);
    const at = key(tile.tx, tile.ty);
    const list = out.get(at);
    if (list) list.push(placed);
    else out.set(at, [placed]);
  };

  // Sized from the zoom and not from the tile.
  //
  // This is the whole of what was wrong with the map before. A tile is kept
  // to about eight pixels at every zoom by design, so anything measured
  // against one is the same size on screen whether you are looking at one
  // duchy or at Europe — and a Verona drawn the same size at both is a model
  // of Verona sitting on top of Italy rather than a town standing in it.
  // Measured against the zoom instead, a settlement covers a fixed piece of
  // ground: about a fifth of the way to its neighbour for a village and
  // rather more for Constantinople, which is what a town is.
  const close = transform.zoom;
  // A man, not a token. Every sprite now fills its own frame, so what is
  // asked for here is what is drawn rather than a square with the thing
  // somewhere inside it, and the numbers are small accordingly.
  const unitSize = Math.max(7, Math.min(26, close * 0.34));

  for (const geography of REGIONS) {
    const region = state.regions.get(geography.id);
    if (!region) continue;
    const rank = SETTLEMENT_ORDER.indexOf(region.tier);
    const colour = region.owner === INDEPENDENT_ID
      ? '#8d8578'
      : tryGetFaction(region.owner)?.colour ?? '#8d8578';
    add(geography.lon, geography.lat, {
      sprite: `town${Math.max(0, Math.min(5, rank))}` as SpriteName,
      size: Math.max(8, Math.min(42, close * (0.44 + rank * 0.125))),
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
    nudge += 1;
    add(geography.lon, geography.lat, {
      // The man in command, because that is what is standing there. An army
      // on this map used to be a block of eight identical figures, which
      // reads as a token however well it is drawn; one man with his standard
      // beside him reads as somebody, and the game already knows whether
      // there is somebody — an army with a general is led by a horseman and
      // one without by a captain on foot.
      sprite: army.general ? 'general' : 'captain',
      device: deviceOf(army.faction),
      size: army.general ? unitSize : unitSize * 0.88,
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
    add(where.lon, where.lat, {
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
    add(geography.lon, geography.lat, {
      sprite: 'agent',
      size: Math.max(6, unitSize * 0.7),
      colour: tryGetFaction(agent.faction)?.colour ?? '#8d8578',
      offsetX: -Math.round(transform.halfWidth * 0.9),
      offsetY: -Math.round(transform.halfHeight * 0.4),
    });
  }

  for (const caravan of state.caravans.values()) {
    if (!canSeeCaravan(state, state.player, caravan.id, watched)) continue;
    const where = caravanLocation(caravan);
    if (!where) continue;
    const geography = getRegion(where);
    add(geography.lon, geography.lat, {
      sprite: 'caravan',
      size: Math.max(6, unitSize * 0.7),
      colour: tryGetFaction(caravan.faction)?.colour ?? '#8d8578',
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
 * Three things on top of each other, in this order: a band of the owner's
 * colour laid inside his own ground, a dark line along the edge itself, and
 * the colour again over that. The band is what makes a realm readable as one
 * shape from across the room; the dark line is what stops the colour
 * disappearing into whatever ground it crosses; and because each side lays
 * its own band, a contested frontier comes out as two colours meeting, which
 * is the thing you actually want to see.
 *
 * Two things make it a frontier rather than a set of lines. The edges are
 * chained into continuous runs before they are stroked, so a corner is a
 * corner and not two segments with a notch between them; and the whole lot
 * is drawn on its own plate and then cut to the coastline, because a
 * province is the ground nearest its own town and that reaches well out to
 * sea. A border running across open water is the single thing that most
 * gives away a map drawn from a diagram.
 */
function drawFrontiers(
  ctx: CanvasRenderingContext2D,
  state: CampaignState,
  transform: IsoTransform,
  watched: ReadonlySet<RegionId>,
  width: number,
  height: number,
): void {
  const layer = plate(width, height);
  layer.clearRect(0, 0, width, height);
  layer.lineJoin = 'round';
  layer.lineCap = 'round';

  const shapes = provinceShapes();
  // How deep the band reaches inside the border and how heavy the line on it
  // is. Both grow as the map is closed in on, because a frontier three
  // pixels wide on a continent should not still be three pixels wide on one
  // duchy.
  const depth = Math.max(3, Math.min(11, transform.halfWidth * 0.9));
  const weight = transform.halfWidth > 9 ? 2 : 1.4;

  // The quiet lines between two provinces of one realm, first, so that a
  // national border is always drawn over them.
  if (transform.zoom > 16) {
    layer.lineWidth = 1;
    layer.strokeStyle = 'rgba(26, 32, 28, 0.3)';
    layer.beginPath();
    for (const shape of shapes) {
      const region = state.regions.get(shape.id);
      if (!region || shape.cell.length < 3) continue;
      for (let i = 0; i < shape.cell.length; i++) {
        const across = shape.edgeNeighbours[i];
        if (!across) continue;
        const other = state.regions.get(across);
        if (!other || other.owner !== region.owner) continue;
        // Each shared edge belongs to two provinces; draw it once.
        if (across < shape.id) continue;
        const a = shape.cell[i]!;
        const b = shape.cell[(i + 1) % shape.cell.length]!;
        const from = lifted(transform, a[0], a[1]);
        const to = lifted(transform, b[0], b[1]);
        layer.moveTo(from.x, from.y);
        layer.lineTo(to.x, to.y);
      }
    }
    layer.stroke();
  }

  // Everybody's ground and everybody's edges, gathered by owner so that a
  // realm can be drawn as one shape rather than as a heap of provinces.
  const realms = new Map<FactionId, { cells: ProvinceShape[]; edges: Edge[] }>();
  for (const shape of shapes) {
    const region = state.regions.get(shape.id);
    if (!region || shape.cell.length < 3) continue;
    let realm = realms.get(region.owner);
    if (!realm) {
      realm = { cells: [], edges: [] };
      realms.set(region.owner, realm);
    }
    realm.cells.push(shape);
    for (let i = 0; i < shape.cell.length; i++) {
      const across = shape.edgeNeighbours[i];
      const other = across ? state.regions.get(across) : undefined;
      if (other && other.owner === region.owner) continue;
      const a = shape.cell[i]!;
      const b = shape.cell[(i + 1) % shape.cell.length]!;
      realm.edges.push([a[0], a[1], b[0], b[1]]);
    }
  }

  for (const [owner, realm] of realms) {
    if (realm.edges.length === 0) continue;
    const faction = owner === INDEPENDENT_ID ? undefined : tryGetFaction(owner);
    const colour = faction?.colour ?? '#9a9286';
    const seen = realm.cells.some((shape) => watched.has(shape.id));

    const ground = new Path2D();
    for (const shape of realm.cells) {
      shape.cell.forEach(([lon, merc], index) => {
        const at = lifted(transform, lon, merc);
        if (index === 0) ground.moveTo(at.x, at.y);
        else ground.lineTo(at.x, at.y);
      });
      ground.closePath();
    }

    const border = new Path2D();
    for (const run of chain(realm.edges)) {
      run.forEach(([lon, merc], index) => {
        const at = lifted(transform, lon, merc);
        if (index === 0) border.moveTo(at.x, at.y);
        else border.lineTo(at.x, at.y);
      });
    }

    // The band: the frontier stroked twice its own width and clipped to the
    // realm's own ground, which leaves exactly the inside half of it. That
    // is what gives a clean band round a corner, which stamping a quad per
    // edge never does.
    layer.save();
    layer.clip(ground);
    layer.globalAlpha = seen ? 0.26 : 0.17;
    layer.strokeStyle = colour;
    layer.lineWidth = depth * 2;
    layer.stroke(border);
    layer.globalAlpha = seen ? 0.34 : 0.22;
    layer.lineWidth = depth * 0.8;
    layer.stroke(border);
    layer.restore();

    layer.globalAlpha = 1;
    layer.strokeStyle = 'rgba(14, 18, 16, 0.8)';
    layer.lineWidth = weight + 1.6;
    layer.stroke(border);
    layer.globalAlpha = seen ? 1 : 0.72;
    layer.strokeStyle = colour;
    layer.lineWidth = weight;
    layer.stroke(border);
    layer.globalAlpha = 1;
  }

  // Cut the lot to the coast, then put it on the picture.
  layer.globalCompositeOperation = 'destination-in';
  layer.fillStyle = '#fff';
  layer.fill(landSilhouette(transform));
  layer.globalCompositeOperation = 'destination-out';
  layer.fill(lakeSilhouette(transform));
  layer.globalCompositeOperation = 'source-over';
  ctx.drawImage(plateCanvas!, 0, 0);
}

/** A frontier edge, as the two ends of it in world coordinates. */
type Edge = readonly [number, number, number, number];

/**
 * Strings loose edges into continuous runs.
 *
 * The cells hand over a frontier as a heap of segments in no order. Stroked
 * like that, every corner is two line ends meeting, which at any real width
 * shows as a notch; and the band, which is the frontier stroked wide and
 * clipped, comes out scalloped. Chained, the whole border of a realm is a
 * handful of paths with proper joins.
 */
function chain(edges: readonly Edge[]): (readonly (readonly [number, number])[])[] {
  const key = (x: number, y: number): string => `${Math.round(x * 4096)},${Math.round(y * 4096)}`;
  const outgoing = new Map<string, number[]>();
  const used = new Array(edges.length).fill(false);
  edges.forEach((edge, index) => {
    for (const end of [key(edge[0], edge[1]), key(edge[2], edge[3])]) {
      const list = outgoing.get(end);
      if (list) list.push(index);
      else outgoing.set(end, [index]);
    }
  });

  const runs: (readonly [number, number])[][] = [];
  for (let start = 0; start < edges.length; start++) {
    if (used[start]) continue;
    used[start] = true;
    const edge = edges[start]!;
    const run: [number, number][] = [[edge[0], edge[1]], [edge[2], edge[3]]];

    // Grow from both ends until nothing joins on.
    for (const forwards of [true, false]) {
      for (;;) {
        const tip = forwards ? run[run.length - 1]! : run[0]!;
        const candidates = outgoing.get(key(tip[0], tip[1]));
        if (!candidates) break;
        let next = -1;
        for (const index of candidates) {
          if (!used[index]) {
            next = index;
            break;
          }
        }
        if (next < 0) break;
        used[next] = true;
        const other = edges[next]!;
        const joined = key(other[0], other[1]) === key(tip[0], tip[1])
          ? ([other[2], other[3]] as [number, number])
          : ([other[0], other[1]] as [number, number]);
        if (forwards) run.push(joined);
        else run.unshift(joined);
      }
    }
    runs.push(run);
  }
  return runs;
}

/** Somewhere to draw the frontiers before they are cut to the coast. */
let plateCanvas: HTMLCanvasElement | undefined;

function plate(width: number, height: number): CanvasRenderingContext2D {
  if (!plateCanvas) plateCanvas = document.createElement('canvas');
  if (plateCanvas.width !== width || plateCanvas.height !== height) {
    plateCanvas.width = width;
    plateCanvas.height = height;
  }
  const ctx = plateCanvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

function silhouette(
  transform: IsoTransform,
  rings: readonly (readonly (readonly [number, number])[])[],
): Path2D {
  const path = new Path2D();
  for (const ring of rings) {
    if (ring.length < 3) continue;
    ring.forEach(([lon, lat], index) => {
      const at = floorAtLatLon(transform, lon, lat);
      if (index === 0) path.moveTo(at.x, at.y);
      else path.lineTo(at.x, at.y);
    });
    path.closePath();
  }
  return path;
}

const landSilhouette = (transform: IsoTransform): Path2D => silhouette(transform, LAND_RINGS);
const lakeSilhouette = (transform: IsoTransform): Path2D => silhouette(transform, LAKE_RINGS);

/**
 * The coastline.
 *
 * The ground already stops where the land does, but a continent drawn only
 * in ground colours has a soft edge, and a map wants a hard one. This is the
 * real Natural Earth outline, the same one the land mask is painted from, so
 * the line lands exactly where the tiles change.
 */
function drawCoast(ctx: CanvasRenderingContext2D, transform: IsoTransform): void {
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(10, 22, 34, 0.75)';
  ctx.beginPath();
  for (const ring of LAND_RINGS) {
    if (ring.length < 3) continue;
    ring.forEach(([lon, lat], index) => {
      const at = floorAtLatLon(transform, lon, lat);
      if (index === 0) ctx.moveTo(at.x, at.y);
      else ctx.lineTo(at.x, at.y);
    });
    ctx.closePath();
  }
  ctx.stroke();
}

/**
 * The great rivers.
 *
 * They are already in the game twice over — as sea zones a fleet can sail
 * and as the reason half these cities are where they are — and until now the
 * one place they did not appear was the map. A river is the strongest line
 * in a landscape and the eye uses it to find everything else.
 */
function drawRivers(ctx: CanvasRenderingContext2D, transform: IsoTransform): void {
  const wide = transform.halfWidth > 10;
  for (const line of RIVER_LINES) {
    if (line.length < 2) continue;
    ctx.beginPath();
    line.forEach(([lon, lat], index) => {
      const at = floorAtLatLon(transform, lon, lat);
      const metres = ground?.metresAt(lon, lat) ?? 0;
      const y = at.y - liftFor(transform, metres);
      if (index === 0) ctx.moveTo(at.x, y);
      else ctx.lineTo(at.x, y);
    });
    ctx.lineWidth = wide ? 3 : 2;
    ctx.strokeStyle = DECOR.river;
    ctx.stroke();
    if (!wide) continue;
    ctx.lineWidth = 1;
    ctx.strokeStyle = DECOR.riverLight;
    ctx.stroke();
  }
  ctx.lineWidth = 1;
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
 * A pole with the realm's banner on it, over an army.
 *
 * The thing a medieval army was recognised by at a distance was its banner,
 * and the thing a player needs at a distance is the same: whose those men
 * are, without reading anything.
 */
function banner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  owner: FactionId | undefined,
  colour: string,
): void {
  const height = 15;
  const flagWidth = 11;
  const flagHeight = 9;
  ctx.fillStyle = 'rgba(8, 10, 8, 0.85)';
  ctx.fillRect(Math.round(x) - 1, Math.round(y) - height, 2, height);
  if (owner) {
    ctx.drawImage(
      armsCanvas(owner, flagWidth, flagHeight, 'banner'),
      Math.round(x) + 1,
      Math.round(y) - height,
    );
    return;
  }
  ctx.fillStyle = colour;
  ctx.fillRect(Math.round(x) + 1, Math.round(y) - height, flagWidth, flagHeight);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(8, 10, 8, 0.85)';
  ctx.strokeRect(Math.round(x) + 1.5, Math.round(y) - height + 0.5, flagWidth - 1, flagHeight - 1);
}

/**
 * The owner's arms beside a name, at the screen's own resolution.
 *
 * A realm used to be a square of its colour here, which tells two borders
 * apart and nothing else. These are the arms the realm actually bore, drawn
 * from a blazon and kept once painted, so two hundred of them cost two
 * hundred blits.
 */
function shield(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  owner: FactionId | undefined,
  colour: string,
): void {
  if (!owner) {
    ctx.beginPath();
    ctx.moveTo(x - radius, y - radius);
    ctx.lineTo(x + radius, y - radius);
    ctx.lineTo(x + radius, y + radius * 0.2);
    ctx.lineTo(x, y + radius * 1.25);
    ctx.lineTo(x - radius, y + radius * 0.2);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(8, 10, 8, 0.85)';
    ctx.stroke();
    return;
  }
  const width = Math.max(6, Math.round(radius * 2));
  const height = Math.max(7, Math.round(radius * 2.3));
  ctx.drawImage(
    armsCanvas(owner, width, height),
    Math.round(x - width / 2),
    Math.round(y - height * 0.44),
  );
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
    // A settlement with no name on it is a smudge. Only the most pulled-back
    // view holds any of them back, and then only the villages.
    const threshold = zoom < 13 ? 2 : zoom < 26 ? 1 : 0;
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

    // A shield in the owner's colours, beside the name. Whose a town is is
    // the one thing a player looks for on a map of this kind, and reading it
    // off the wash on the fields is guesswork at anything but close range.
    const owner = region.owner === INDEPENDENT_ID ? undefined : region.owner;
    shield(
      ctx,
      x - ctx.measureText(geography.settlement).width / 2 - size * 0.68,
      y + size * 0.5,
      size * 0.44,
      owner,
      '#8d8578',
    );
  }

  // A banner over every army somebody of ours can see. The sprite on the
  // ground says there are men there; the banner says whose, which at this
  // scale is the thing being looked for, and it is drawn up here at the
  // screen's own resolution for the same reason the names are.
  const watched = watchedProvinces(state, state.player);
  for (const army of state.armies.values()) {
    if (!canSeeArmy(state, state.player, army.id, watched)) continue;
    const at = placeOf(transform, army.location);
    const x = (at.x + transform.halfWidth * 0.8) * PIXEL;
    const y = (at.y + transform.halfHeight * 0.9) * PIXEL;
    if (x < -20 || x > view.viewport.width + 20) continue;
    if (y < -20 || y > view.viewport.height + 20) continue;
    banner(
      ctx,
      x,
      y,
      army.faction === INDEPENDENT_ID ? undefined : army.faction,
      tryGetFaction(army.faction)?.colour ?? '#8d8578',
    );
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
