/**
 * The sprite sheet.
 *
 * Everything on the map that is not ground is a picture rendered by
 * `tools/build-sprites.py`, which models it and photographs it from the one
 * camera angle the tiles allow. Nothing here draws anything by hand.
 *
 * Whatever belongs to an owner was rendered in pure magenta, and this swaps
 * that for the owner's colour the first time it is asked for. It is the trick
 * these games used to paint a hundred companies out of one drawing, and it is
 * why a settlement here can belong to any of seventy-three realms without
 * seventy-three sheets.
 */
import { SPRITES, SPRITE_CELL, SPRITE_MARKER, SPRITE_SHEET } from '../../core/data/sprites';
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
const CACHE_LIMIT = 4000;

/**
 * A sprite ready to be stamped on the map.
 *
 * Recoloured and resized once and kept, because the alternative is doing both
 * for every settlement on screen every frame. The resize is nearest-
 * neighbour: a smoothed pixel sprite is a smudge.
 */
export function sprite(
  name: SpriteName,
  size: number,
  colour: string | undefined,
): HTMLCanvasElement | undefined {
  if (!sheet) return undefined;
  // Quantised above a certain size, because the zoom is continuous and the
  // cache is not: without this every notch of the wheel asks for a hundred
  // and forty sprites at a size nothing has ever asked for before.
  const wanted = Math.max(4, Math.round(size));
  const pixels = wanted > 20 ? Math.round(wanted / 2) * 2 : wanted;
  const key = `${name}|${pixels}|${colour ?? '-'}`;
  const known = cache.get(key);
  if (known) return known;

  const box = SPRITES[name];
  const cut = document.createElement('canvas');
  cut.width = box.width;
  cut.height = box.height;
  const cutting = cut.getContext('2d', { willReadFrequently: true })!;
  cutting.imageSmoothingEnabled = false;
  cutting.drawImage(sheet, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);

  if (colour) recolour(cutting, box.width, box.height, colour);

  // A sprite is cut down to what is in it, so it is not square and the size
  // asked for is the square it was rendered in. Scaling by that keeps every
  // caller's numbers meaning what they always meant.
  const scale = pixels / SPRITE_CELL;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(box.width * scale));
  out.height = Math.max(1, Math.round(box.height * scale));
  const drawing = out.getContext('2d')!;
  drawing.imageSmoothingEnabled = false;
  drawing.drawImage(cut, 0, 0, box.width, box.height, 0, 0, out.width, out.height);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, out);
  return out;
}

/** Swaps the marker colour for the owner's, pixel by pixel. */
function recolour(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  colour: string,
): void {
  const value = parseInt(colour.replace('#', ''), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    // The marker survives the render and the shrink as a strong magenta;
    // anything close enough to it was part of the banner.
    const red = data[i]!;
    const green = data[i + 1]!;
    const blue = data[i + 2]!;
    if (red > 140 && blue > 140 && green < 110) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  }
  ctx.putImageData(image, 0, 0);
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
export function stamp(
  ctx: CanvasRenderingContext2D,
  name: SpriteName,
  x: number,
  y: number,
  size: number,
  colour?: string,
  shadow = true,
): void {
  const image = sprite(name, size, colour);
  if (!image) return;
  const box = SPRITES[name];
  const scale = image.width / box.width;
  // A thing with nothing under it is a sticker. One dark ellipse on the
  // ground it is standing on is the whole of what makes it stand there,
  // and because the sprite is anchored on that exact point the shadow
  // always lands where the feet are.
  if (shadow && size > 7) {
    const reach = size * 0.2;
    ctx.save();
    ctx.fillStyle = 'rgba(14, 18, 14, 0.22)';
    ctx.beginPath();
    ctx.ellipse(Math.round(x), Math.round(y), reach, Math.max(1, reach * 0.42), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.drawImage(
    image,
    Math.round(x - box.anchorX * scale),
    Math.round(y - box.anchorY * scale),
  );
}

void SPRITE_MARKER;
