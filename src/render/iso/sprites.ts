/**
 * The sprite sheet.
 *
 * Everything on the map that is not ground is a picture rendered by
 * `tools/build-sprites.py`, which models it and photographs it from the one
 * camera angle the tiles allow. Nothing here draws anything by hand.
 *
 * Whatever belongs to an owner was rendered in magenta, and this swaps that
 * for the owner's colour the first time it is asked for. It is the trick
 * these games used to paint a hundred companies out of one drawing, and it is
 * why a settlement here can belong to any of seventy-three realms without
 * seventy-three sheets. The magenta is lit rather than flat, so what is
 * swapped in is the realm's colour standing in the same light the rest of
 * the model was standing in.
 *
 * Three other things happen between the sheet and the field, and all of them
 * are about a ninety-pixel model having to be a twenty-pixel man: the shrink
 * averages rather than samples, the edge is hardened and darkened into an
 * outline, and the shape is thrown on the ground behind him as a shadow.
 * Each is written up where it is done.
 */
import { SPRITES, SPRITE_CELL, SPRITE_MAN, SPRITE_SHEET } from '../../core/data/sprites';
import type { SpriteName } from '../../core/data/sprites';

export type { SpriteName };

let sheet: HTMLImageElement | undefined;
let loading: Promise<HTMLImageElement> | undefined;

/** Starts fetching the sheet. Until it arrives nothing is drawn. */
export function loadSprites(base = ''): Promise<HTMLImageElement> {
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        sheet = image;
        resolve(image);
      };
      image.onerror = () => reject(new Error('No sprite sheet'));
      image.src = `${base}${SPRITE_SHEET}`;
    });
  }
  return loading;
}

export function spritesReady(): boolean {
  return sheet !== undefined;
}

/**
 * Draws again once the sheet is in.
 *
 * Both screens ask for the sheet on their first frame and draw whatever they
 * have, which for the first frame or two is nothing. A screen that redraws
 * constantly never notices; a battle sitting paused before its first tick
 * does, and shows an empty field until the player happens to move the mouse.
 * So whoever draws says here what to do when the sheet arrives.
 */
export function whenSpritesReady(redraw: () => void): void {
  if (sheet) {
    redraw();
    return;
  }
  void loadSprites().then(redraw).catch(() => undefined);
}

/**
 * One sprite, in one owner's colours, at one size.
 *
 * Capped, because there are a hundred and forty of them, two sides to a
 * battle, and a new size every time the player touches the wheel: left to
 * itself this grows without end. Thrown away whole rather than evicted one
 * at a time, because what the next frame wants is almost always what the
 * last frame wanted, and rebuilding a few dozen small canvases once in a
 * while costs less than tracking which of them was used when.
 */
const cache = new Map<string, HTMLCanvasElement>();
/**
 * Raised, because the sheet grew.
 *
 * A battle asks for eight kinds of soldier in two kits, eight facings and
 * nine poses, in two realms' colours: two and a half thousand entries at one
 * zoom. At four thousand the first touch of the wheel threw the lot away and
 * rebuilt it in a single frame, which is the one moment the player is
 * guaranteed to be looking. Six thousand holds what is on screen and most of
 * what the next notch of zoom will ask for.
 */
const CACHE_LIMIT = 6000;

/**
 * The silhouettes, for the shadows they cast.
 *
 * Kept apart from the sprites because a shadow does not care whose man it
 * is: every realm in Europe throws the same shape, so one of these serves a
 * battle where the coloured sprites need one each per side.
 */
const shadows = new Map<string, Shadow>();

/**
 * A sprite ready to be stamped on the map.
 *
 * Recoloured and resized once and kept, because the alternative is doing both
 * for every settlement on screen every frame. The order matters: the realm's
 * colour goes on at the sheet's own resolution and the shrink happens after,
 * so a shield two pixels across on the field is an average of the shield
 * that was painted rather than a painted average.
 */
export function sprite(
  name: SpriteName,
  size: number,
  colour: string | undefined,
  device?: string | undefined,
): HTMLCanvasElement | undefined {
  if (!sheet) return undefined;
  // Quantised above a certain size, because the zoom is continuous and the
  // cache is not: without this every notch of the wheel asks for a hundred
  // and forty sprites at a size nothing has ever asked for before.
  const wanted = Math.max(4, Math.round(size));
  const pixels = wanted > 20 ? Math.round(wanted / 2) * 2 : wanted;
  const key = `${name}|${pixels}|${colour ?? '-'}|${device ?? '-'}`;
  const known = cache.get(key);
  if (known) return known;

  const box = SPRITES[name];
  const cut = document.createElement('canvas');
  cut.width = box.width;
  cut.height = box.height;
  const cutting = cut.getContext('2d', { willReadFrequently: true })!;
  cutting.imageSmoothingEnabled = false;
  cutting.drawImage(sheet, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);

  if (colour) recolour(cutting, box.width, box.height, colour, device);

  // A sprite is cut down to what is in it, so it is not square and the size
  // asked for is the square it was rendered in. Scaling by that keeps every
  // caller's numbers meaning what they always meant.
  const scale = pixels / SPRITE_CELL;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(box.width * scale));
  out.height = Math.max(1, Math.round(box.height * scale));
  const drawing = out.getContext('2d', { willReadFrequently: true })!;
  // How a ninety-pixel man becomes a twenty-pixel one.
  //
  // By throwing away four pixels in five and keeping the fifth, which is
  // what nearest-neighbour does, and which is why he used to arrive on the
  // field with one arm: whether a limb four pixels wide survived depended on
  // where the grid happened to fall, and the grid moves every time the
  // camera does. Averaging instead keeps every part of him in proportion to
  // how much of him it is, and a shoulder that is half a pixel wide comes
  // out as half a pixel of shoulder rather than as nothing or as a pixel.
  //
  // It is also the one place this picture is allowed to be soft, and only
  // on the way down: the alpha is hardened again below, so the result is a
  // sprite with a clean edge and a middle that still has a man in it.
  const shrinking = out.height < box.height * 0.92;
  drawing.imageSmoothingEnabled = shrinking;
  if (shrinking) drawing.imageSmoothingQuality = 'high';
  drawing.drawImage(cut, 0, 0, box.width, box.height, 0, 0, out.width, out.height);
  if (shrinking) edge(drawing, out.width, out.height);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, out);
  return out;
}

/**
 * How far into the sprite the outline reaches, and how dark it is.
 *
 * The thing a figure on a field needs most is a line between it and the
 * grass. Without one a regiment at this size is a crowd of coloured smudges
 * on a green smudge; with one every man has an edge, and a block of them
 * reads as men standing in ranks from much further out than it used to.
 *
 * Darkened rather than drawn, so it costs no pixels: the outermost ring of
 * the sprite is taken down towards black instead of a ring being added
 * outside it, which would change the size of everything and move every
 * anchor in the game by half a pixel.
 */
const RIM = 0.56;
/** The top of a thing catches the sky, so its edge is only half darkened. */
const RIM_TOP = 0.82;
/** Above this much alpha a pixel counts as part of the thing rather than its edge. */
const SOLID = 200;

/**
 * Hardens the edge and draws the outline, in one pass over the pixels.
 *
 * Alpha first: averaging the way down leaves a wide skirt of half-there
 * pixels around everything, which reads as a halo. It is pushed towards one
 * or the other, but not all the way to a hard cut — a spear shaft a quarter
 * of a pixel wide is still a spear, and a hard cut is what takes it away.
 */
function edge(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const alpha = new Uint8Array(width * height);
  for (let i = 0, p = 3; i < alpha.length; i++, p += 4) {
    const raised = data[p]! * 1.5;
    alpha[i] = raised < 26 ? 0 : raised > 255 ? 255 : raised;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const here = alpha[i]!;
      data[i * 4 + 3] = here;
      if (here === 0) continue;
      let factor = 1;
      if (here < SOLID) {
        // A pixel the shrink only half filled is, by definition, where the
        // sprite ends. Darkened in proportion to how little of it there is,
        // so the outline fades out with the shape rather than stopping at a
        // threshold and leaving a bright fringe outside it.
        factor = RIM + (1 - RIM) * ((here - 26) / (SOLID - 26));
      } else {
        const thin = (nx: number, ny: number): boolean =>
          nx < 0 || ny < 0 || nx >= width || ny >= height || alpha[ny * width + nx]! < SOLID;
        // The sides and the underside are against the ground or against the
        // next man; the top is against the sky, and the sky is not dark.
        if (thin(x - 1, y) || thin(x + 1, y) || thin(x, y + 1)) factor = RIM;
        else if (thin(x, y - 1)) factor = RIM_TOP;
      }
      if (factor === 1) continue;
      data[i * 4] = data[i * 4]! * factor;
      data[i * 4 + 1] = data[i * 4 + 1]! * factor;
      data[i * 4 + 2] = data[i * 4 + 2]! * factor;
    }
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * The light a marker pixel was standing in, as a factor on the realm's paint.
 *
 * The sheet renders everything that belongs to an owner in magenta, lit like
 * any other surface: the green channel stays at nought whatever the light
 * does, because green times nought is nought, while red and blue carry how
 * brightly that face was lit. So the marker is not one value, it is a short
 * ladder of them — the shoulder of a surcoat, its flank, and the fold under
 * the arm — and this is what turns that ladder back into light.
 *
 * Stretched, because the ladder the renderer hands over is narrow. A lit
 * face and a shaded one come out of a shrink to a short palette perhaps a
 * step and a half apart, which on a coloured surcoat reads as no difference
 * at all. The two ends here are the darkest and brightest a marker is ever
 * rendered at, and what lands between them is spread across a range wide
 * enough to see: a little over the realm's own colour where the sun is on
 * it, and well under it in the shade.
 */
const MARKER_DARK = 115;
const MARKER_LIT = 235;
const SHADE_LOW = 0.42;
const SHADE_HIGH = 1.1;

function shadeOf(lit: number): number {
  const t = (lit - MARKER_DARK) / (MARKER_LIT - MARKER_DARK);
  const held = t < 0 ? 0 : t > 1 ? 1 : t;
  return SHADE_LOW + (SHADE_HIGH - SHADE_LOW) * held;
}

/**
 * Swaps the two marker colours for the realm's, pixel by pixel.
 *
 * Magenta is whatever belongs to the owner — the surcoat, the banner, the
 * trapper, the face of the shield — and cyan is what is painted on the
 * shield. Two markers rather than one because a shield in a single flat
 * colour is the same shield for every realm in Europe, and the second costs
 * nothing: the division is in the model, not in a variant of it.
 *
 * Both are found by the same rule, which no longer asks how bright the
 * pixel is — it cannot, now that brightness is the thing being carried —
 * but how lopsided it is. A marker has one channel at the floor while the
 * other two match each other, and nothing else on this sheet does: the mail
 * is grey, the leather and the wood are warm, and all of them have as much
 * green in them as anything else.
 */
function recolour(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  colour: string,
  device: string | undefined,
): void {
  const owner = parse(colour);
  // Always something, never the marker itself. A caller that does not know
  // or care about a realm's device still must not be handed a shield with a
  // cyan cross on it, so the fallback is the owner's own colour — which is
  // exactly what the sheet looked like before there were two markers.
  const second = device ? parse(device) : owner;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const red = data[i]!;
    const green = data[i + 1]!;
    const blue = data[i + 2]!;
    let paint: readonly [number, number, number] | undefined;
    let lit = 0;
    if (green * 3 < red + blue && red + blue > 40 && Math.abs(red - blue) < 34) {
      paint = owner;
      lit = (red + blue) / 2;
    } else if (red * 3 < green + blue && green + blue > 40 && Math.abs(green - blue) < 34) {
      paint = second;
      lit = (green + blue) / 2;
    }
    if (!paint) continue;
    const shade = shadeOf(lit);
    const r = paint[0] * shade;
    const g = paint[1] * shade;
    const b = paint[2] * shade;
    data[i] = r > 255 ? 255 : r;
    data[i + 1] = g > 255 ? 255 : g;
    data[i + 2] = b > 255 ? 255 : b;
  }
  ctx.putImageData(image, 0, 0);
}

function parse(colour: string): [number, number, number] {
  const value = parseInt(colour.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * Stamps a sprite standing on a point of the ground.
 *
 * Anchored on the model's own origin — the middle of the ground it was
 * modelled standing on — which the sheet records for every sprite. The
 * bottom middle of the frame is not that point: a model is framed on what it
 * actually occupies, so a town anchored by its frame sits up and to the left
 * of the place it belongs to, and a spear or a standard leaning out of the
 * frame moves the whole settlement. Rounded to whole pixels so it never
 * lands between two of them.
 */
/**
 * The size to draw a sprite at so that the man in it stands a given height.
 *
 * Every sprite is framed to fit what is in it, which is the right way to
 * spend the pixels and costs one thing that went unnoticed for a long time:
 * the cell stops meaning a fixed amount of world. A swordsman's cell covers
 * about two thirds of a unit, a pikeman's covers one and a half because of
 * the pike, and a knight's nearly two because of the horse. Asked for at the
 * same number of pixels, all three come out the same height overall — which
 * means the pikeman is two thirds the man the swordsman is and the knight is
 * a third of him, riding past infantry that stood a head taller.
 *
 * So a caller drawing people says how tall the people should be and this
 * works out what to ask the sprite for. A regiment of pikes and a regiment
 * of spears now stand the same height as each other, and a man on a horse is
 * a man on a horse.
 */
export function atManHeight(name: SpriteName, height: number): number {
  return (height * SPRITES[name].world) / SPRITE_MAN;
}

/**
 * Where the sun is, as far as the ground is concerned.
 *
 * The models are lit from over the viewer's left shoulder, so everything on
 * this sheet has its light side towards the left of the screen. A shadow
 * therefore goes to the right, and it is laid down rather than standing up:
 * `LEAN` is how far right the top of a thing is thrown per pixel of its
 * height, `FLATTEN` is how much of that height is left once it is lying on
 * the ground.
 *
 * Long and low on purpose. It is the one thing a flat isometric picture has
 * to say that the ground is a surface and not a backdrop, and short shadows
 * say it much more quietly than these games ever did.
 */
const LEAN = 0.62;
const FLATTEN = 0.3;

/** Below this many pixels a shadow is a smudge, so it goes back to being one. */
const CAST_FROM = 9;

/** A shadow ready to be stamped: the picture, and where its corner goes. */
interface Shadow {
  readonly image: HTMLCanvasElement;
  /** From the sprite's own top-left corner to the shadow's. */
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * The shape a sprite throws, already lying on the ground.
 *
 * Taken off the finished sprite rather than modelled, so a man with his
 * shield up throws a shadow with the shield in it, and kept without regard
 * to whose man he is: two realms in the same battle are two sets of coloured
 * sprites but one set of shadows.
 *
 * The lean and the flattening are done here, once for each sprite at each
 * size, rather than by transforming the canvas at every stamp. A field is
 * two thousand men in a frame and a sheared blit is not a cheap one; with
 * the shear baked in, laying down a shadow costs exactly what drawing the
 * man costs, which is a plain copy at a whole pixel.
 *
 * The offsets come out of the same arithmetic: the shadow leaves the point
 * the model was standing on, so the corner of this picture is up and to the
 * left of where the sprite's own corner goes.
 */
function silhouette(
  name: SpriteName,
  image: HTMLCanvasElement,
  anchorY: number,
): Shadow {
  const key = `${name}|${image.width}x${image.height}`;
  const known = shadows.get(key);
  if (known) return known;
  const width = image.width;
  const height = image.height;
  // A pixel `anchorY - v` above the ground is thrown that far to the right
  // and keeps that fraction of its height. The top of the sprite goes
  // furthest; the lowest row goes least, and may go left of the sprite if
  // the model's feet are not at the bottom of its frame.
  const near = LEAN * (anchorY - height);
  const far = LEAN * anchorY;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.ceil(width + far - near));
  out.height = Math.max(1, Math.ceil(height * FLATTEN));
  const drawing = out.getContext('2d')!;
  drawing.setTransform(1, 0, -LEAN, FLATTEN, far - near, 0);
  drawing.drawImage(image, 0, 0);
  drawing.setTransform(1, 0, 0, 1, 0, 0);
  drawing.globalCompositeOperation = 'source-in';
  drawing.fillStyle = '#0b0f10';
  drawing.fillRect(0, 0, out.width, out.height);
  const shadow: Shadow = {
    image: out,
    offsetX: Math.round(near),
    offsetY: Math.round(anchorY * (1 - FLATTEN)),
  };
  if (shadows.size >= CACHE_LIMIT) shadows.clear();
  shadows.set(key, shadow);
  return shadow;
}

export function stamp(
  ctx: CanvasRenderingContext2D,
  name: SpriteName,
  x: number,
  y: number,
  size: number,
  colour?: string,
  shadow = true,
  device?: string,
): void {
  const image = sprite(name, size, colour, device);
  if (!image) return;
  const box = SPRITES[name];
  const scale = image.width / box.width;
  const left = Math.round(x - box.anchorX * scale);
  const top = Math.round(y - box.anchorY * scale);

  // A thing with nothing under it is a sticker.
  //
  // What it gets is its own shape, sheared over to the right and pressed
  // down into the ground: the same transform for a man, a tree and a walled
  // town, because the sun does not keep a different set of rules for each.
  // Anchored on the point the model was standing on, so the shadow leaves
  // the feet and nowhere else.
  //
  // Small things keep the ellipse. Below about nine pixels the sheared
  // shape is four grey pixels in a diagonal and the ellipse says the same
  // thing more clearly for a fraction of the work.
  if (shadow && size >= CAST_FROM) {
    const shape = silhouette(name, image, box.anchorY * scale);
    const was = ctx.globalAlpha;
    ctx.globalAlpha = was * 0.3;
    ctx.drawImage(shape.image, left + shape.offsetX, top + shape.offsetY);
    ctx.globalAlpha = was;
  } else if (shadow && size > 5) {
    const reach = size * 0.22;
    ctx.save();
    ctx.fillStyle = 'rgba(14, 18, 14, 0.24)';
    ctx.beginPath();
    ctx.ellipse(Math.round(x), Math.round(y), reach, Math.max(1, reach * 0.42), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.drawImage(image, left, top);
}
