/**
 * The last thing that happens to a frame.
 *
 * Everything under this is drawn honestly: a tile is the colour that kind of
 * ground is, a man is the colour his lord paints him, and neither of them
 * knows or cares where on the screen it ended up. That is right, and it is
 * also what makes a picture built out of flat shapes look like a sheet of
 * them — every part of it is equally bright and equally present, so the eye
 * has nothing to hold on to and no sense of a camera being anywhere.
 *
 * Two passes fix that, and neither is a filter in the modern sense. The
 * corners go down, which is what every lens that has ever been pointed at a
 * field does and what makes the middle of the screen the middle of the
 * screen. And the whole frame is pulled a little towards one colour, which
 * is what ties ground, men, timber and water into one afternoon instead of
 * four palettes sharing a window.
 *
 * Kept weak. A heavy vignette is a vignette; a weak one is a camera.
 */

/** How dark the corners go, and how far in the darkening reaches. */
const CORNER = 0.3;
const REACH = 0.62;

/** The colour the whole frame leans towards, and how far it leans. */
const UNIFY = '#ffe9c4';
const LEAN = 0.07;

/**
 * The gradient, kept between frames.
 *
 * It depends on nothing but the size of the picture, and the size of the
 * picture changes when the window does and at no other time — so building it
 * sixty times a second is sixty times more often than it can possibly have
 * changed.
 */
let held: { width: number; height: number; fill: CanvasGradient } | undefined;

function vignette(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): CanvasGradient {
  if (held && held.width === width && held.height === height) return held.fill;
  const half = Math.max(width, height) / 2;
  const reach = Math.hypot(width, height) / 2;
  const fill = ctx.createRadialGradient(
    width / 2, height / 2, half * REACH,
    width / 2, height / 2, reach,
  );
  fill.addColorStop(0, 'rgba(8, 10, 14, 0)');
  fill.addColorStop(1, `rgba(8, 10, 14, ${CORNER})`);
  held = { width, height, fill };
  return fill;
}

/**
 * Lays the corner shade and the unifying tint over a finished picture.
 *
 * Called with the picture's own width and height, which on the battlefield
 * is the small canvas and not the screen: the grade belongs to the pixels,
 * so that the corner shade is made of the same pixels as everything else
 * rather than being a smooth gradient laid over a picture that has none.
 */
export function drawGrade(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  lean = LEAN,
): void {
  ctx.save();
  if (lean > 0.001) {
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = lean;
    ctx.fillStyle = UNIFY;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.fillStyle = vignette(ctx, width, height);
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}
