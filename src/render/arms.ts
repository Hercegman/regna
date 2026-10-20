/**
 * Drawing arms.
 *
 * A blazon in, a shield or a banner out. Nothing here is an image file: the
 * seventy-three realms' arms are three dozen bytes each in
 * `core/data/heraldry.ts`, and this paints them at whatever size is asked
 * for — sixteen pixels beside a town's name, a hundred on a menu, a flag
 * over a regiment in a battle.
 *
 * The charges are chunky on purpose. A lion drawn with the detail a real
 * herald would give it is a grey smear at the size a map uses, and the thing
 * a player needs from a device is to tell it from the one next to it in a
 * glance. So: a silhouette with its outline, no interior line work, and
 * tinctures that never put a colour on a colour.
 */
import type { Arms, Charge, Tincture } from '../core/data/heraldry';
import { TINCTURES, armsOf } from '../core/data/heraldry';
import type { FactionId } from '../core/types';

export type ArmsShape = 'shield' | 'banner';

const OUTLINE = 'rgba(16, 13, 10, 0.85)';

function paint(tincture: Tincture | undefined, fallback: Tincture): string {
  return TINCTURES[tincture ?? fallback];
}

/** The outline of a shield or a flag, in a box of the given size. */
function outline(x: number, y: number, w: number, h: number, shape: ArmsShape): Path2D {
  const path = new Path2D();
  if (shape === 'banner') {
    path.rect(x, y, w, h);
    return path;
  }
  // A heater shield: straight sides to about two thirds, then a point.
  path.moveTo(x, y);
  path.lineTo(x + w, y);
  path.lineTo(x + w, y + h * 0.58);
  path.quadraticCurveTo(x + w, y + h * 0.9, x + w / 2, y + h);
  path.quadraticCurveTo(x, y + h * 0.9, x, y + h * 0.58);
  path.closePath();
  return path;
}

/** Paints the whole thing into the box given. */
export function drawArms(
  ctx: CanvasRenderingContext2D,
  arms: Arms,
  x: number,
  y: number,
  w: number,
  h: number,
  shape: ArmsShape = 'shield',
): void {
  const shell = outline(x, y, w, h, shape);
  ctx.save();
  ctx.clip(shell);

  // --- the field, divided or not
  ctx.fillStyle = paint(arms.field, 'argent');
  ctx.fillRect(x, y, w, h);
  const second = paint(arms.second, 'or');
  switch (arms.division) {
    case 'pale':
      ctx.fillStyle = second;
      ctx.fillRect(x + w / 2, y, w / 2, h);
      break;
    case 'fess':
      ctx.fillStyle = second;
      ctx.fillRect(x, y + h / 2, w, h / 2);
      break;
    case 'chief':
      ctx.fillStyle = second;
      ctx.fillRect(x, y, w, h * 0.34);
      break;
    case 'bend':
      ctx.fillStyle = second;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      ctx.fill();
      break;
    case 'quarterly':
      ctx.fillStyle = second;
      ctx.fillRect(x + w / 2, y, w / 2, h / 2);
      ctx.fillRect(x, y + h / 2, w / 2, h / 2);
      break;
    case 'barry': {
      ctx.fillStyle = second;
      const bars = 8;
      for (let i = 0; i < bars; i += 2) ctx.fillRect(x, y + (h / bars) * i, w, h / bars);
      break;
    }
    case 'paly': {
      ctx.fillStyle = second;
      const pales = 5;
      for (let i = 1; i < pales; i += 2) ctx.fillRect(x + (w / pales) * i, y, w / pales, h);
      break;
    }
    case 'chequy': {
      ctx.fillStyle = second;
      const squares = 5;
      const sw = w / squares;
      const sh = h / squares;
      for (let row = 0; row < squares; row++) {
        for (let column = 0; column < squares; column++) {
          if ((row + column) % 2 === 1) continue;
          ctx.fillRect(x + column * sw, y + row * sh, Math.ceil(sw), Math.ceil(sh));
        }
      }
      break;
    }
    default:
      break;
  }

  // --- the ordinary laid over it
  if (arms.ordinary) {
    ctx.fillStyle = paint(arms.on, 'argent');
    const band = Math.max(2, w * 0.22);
    switch (arms.ordinary) {
      case 'cross':
        ctx.fillRect(x + w / 2 - band / 2, y, band, h);
        ctx.fillRect(x, y + h * 0.4 - band / 2, w, band);
        break;
      case 'pale':
        ctx.fillRect(x + w / 2 - band / 2, y, band, h);
        break;
      case 'fess':
        ctx.fillRect(x, y + h * 0.38, w, band);
        break;
      case 'bend':
      case 'saltire': {
        ctx.save();
        ctx.lineWidth = band;
        ctx.strokeStyle = paint(arms.on, 'argent');
        ctx.beginPath();
        ctx.moveTo(x - w * 0.2, y - h * 0.2);
        ctx.lineTo(x + w * 1.2, y + h * 1.2);
        if (arms.ordinary === 'saltire') {
          ctx.moveTo(x + w * 1.2, y - h * 0.2);
          ctx.lineTo(x - w * 0.2, y + h * 1.2);
        }
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'chevron':
        ctx.save();
        ctx.lineWidth = band;
        ctx.strokeStyle = paint(arms.on, 'argent');
        ctx.beginPath();
        ctx.moveTo(x, y + h * 0.8);
        ctx.lineTo(x + w / 2, y + h * 0.35);
        ctx.lineTo(x + w, y + h * 0.8);
        ctx.stroke();
        ctx.restore();
        break;
      case 'bordure':
        ctx.save();
        ctx.lineWidth = Math.max(2, w * 0.14);
        ctx.strokeStyle = paint(arms.on, 'argent');
        ctx.stroke(shell);
        ctx.restore();
        break;
      default:
        break;
    }
  }

  // --- and the charge on top
  if (arms.charge) {
    ctx.fillStyle = paint(arms.charged, 'or');
    if (arms.seme && (arms.charge === 'lion' || arms.charge === 'eagle')) {
      // A beast strewn seven times over is seven smudges. Three in pale is
      // what England actually bore and what reads at any size.
      const size = Math.min(w, h) * 0.38;
      for (let row = 0; row < 3; row++) {
        glyph(ctx, arms.charge, x + w / 2, y + h * (0.2 + row * 0.26), size);
      }
    } else if (arms.seme) {
      // Strewn: two rows of two and one of three, the way a semé field sits.
      const size = Math.min(w, h) * 0.3;
      for (let row = 0; row < 3; row++) {
        const count = row % 2 === 0 ? 2 : 3;
        for (let i = 0; i < count; i++) {
          const cx = x + (w / (count + 1)) * (i + 1);
          const cy = y + h * (0.22 + row * 0.26);
          if (cy > y + h * 0.84) continue;
          glyph(ctx, arms.charge, cx, cy, size);
        }
      }
    } else {
      glyph(ctx, arms.charge, x + w / 2, y + h * 0.46, Math.min(w, h) * 0.62);
    }
  }

  ctx.restore();
  ctx.lineWidth = Math.max(1, w * 0.05);
  ctx.strokeStyle = OUTLINE;
  ctx.stroke(shell);
}

/**
 * One device, drawn centred on a point and filling a box of `size`.
 *
 * Every one is a filled silhouette with no interior line work, because at
 * map size there is nothing else there is room for.
 */
function glyph(
  ctx: CanvasRenderingContext2D,
  charge: Charge,
  cx: number,
  cy: number,
  size: number,
): void {
  const s = size;
  const poly = (points: readonly (readonly [number, number])[]): void => {
    ctx.beginPath();
    points.forEach(([px, py], index) => {
      const at = [cx + px * s, cy + py * s] as const;
      if (index === 0) ctx.moveTo(at[0], at[1]);
      else ctx.lineTo(at[0], at[1]);
    });
    ctx.closePath();
    ctx.fill();
  };

  switch (charge) {
    case 'lion':
      // Rampant, facing the dexter side, which is the viewer's left: reared
      // on the hind legs, forepaws forward, tail swept up behind. Traced
      // round the outside in one run, head first.
      poly([
        [-0.46, -0.2], [-0.37, -0.33], [-0.27, -0.42], [-0.17, -0.3],
        [-0.19, -0.16], [-0.38, -0.06], [-0.3, 0.02], [-0.15, -0.02],
        [-0.12, 0.16], [-0.23, 0.42], [-0.09, 0.46], [-0.02, 0.28],
        [0.06, 0.44], [0.2, 0.42], [0.17, 0.22], [0.25, 0.06],
        [0.37, -0.08], [0.45, -0.26], [0.36, -0.33], [0.3, -0.16],
        [0.19, -0.06], [0.04, -0.09], [-0.07, -0.21],
      ]);
      break;
    case 'eagle':
      // Displayed: head and beak at the top, both wings out, two legs and a
      // tail under. Symmetrical, because every eagle on a shield is.
      poly([
        [0, -0.44], [0.1, -0.37], [0.21, -0.41], [0.12, -0.26],
        [0.27, -0.22], [0.49, -0.31], [0.43, -0.04], [0.21, 0.03],
        [0.2, 0.19], [0.32, 0.35], [0.14, 0.29], [0.12, 0.46],
        [-0.12, 0.46], [-0.14, 0.29], [-0.32, 0.35], [-0.2, 0.19],
        [-0.21, 0.03], [-0.43, -0.04], [-0.49, -0.31], [-0.27, -0.22],
        [-0.12, -0.26], [-0.21, -0.41], [-0.1, -0.37],
      ]);
      break;
    case 'fleur':
      poly([
        [0, -0.46], [0.1, -0.2], [0.34, -0.3], [0.22, -0.02], [0.1, 0.06],
        [0.26, 0.14], [0.26, 0.22], [-0.26, 0.22], [-0.26, 0.14], [-0.1, 0.06],
        [-0.22, -0.02], [-0.34, -0.3], [-0.1, -0.2],
      ]);
      break;
    case 'crescent': {
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2);
      ctx.arc(cx + s * 0.18, cy - s * 0.05, s * 0.34, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      break;
    }
    case 'star': {
      const points: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const reach = i % 2 === 0 ? 0.46 : 0.19;
        const angle = -Math.PI / 2 + (Math.PI * i) / 5;
        points.push([Math.cos(angle) * reach, Math.sin(angle) * reach]);
      }
      poly(points);
      break;
    }
    case 'sun': {
      for (let i = 0; i < 8; i++) {
        const angle = (Math.PI * i) / 4;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * s * 0.2, cy + Math.sin(angle) * s * 0.2);
        ctx.lineTo(cx + Math.cos(angle + 0.2) * s * 0.46, cy + Math.sin(angle + 0.2) * s * 0.46);
        ctx.lineTo(cx + Math.cos(angle - 0.2) * s * 0.46, cy + Math.sin(angle - 0.2) * s * 0.46);
        ctx.closePath();
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.26, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'tower':
      poly([
        [-0.3, 0.44], [-0.3, -0.16], [-0.3, -0.34], [-0.18, -0.34], [-0.18, -0.22],
        [-0.06, -0.22], [-0.06, -0.34], [0.06, -0.34], [0.06, -0.22], [0.18, -0.22],
        [0.18, -0.34], [0.3, -0.34], [0.3, 0.44],
      ]);
      break;
    case 'crosspatty':
      poly([
        [-0.14, -0.46], [0.14, -0.46], [0.1, -0.14], [0.44, -0.18], [0.44, 0.1],
        [0.1, 0.06], [0.14, 0.46], [-0.14, 0.46], [-0.1, 0.06], [-0.44, 0.1],
        [-0.44, -0.18], [-0.1, -0.14],
      ]);
      break;
    case 'crown':
      poly([
        [-0.4, 0.3], [-0.4, -0.1], [-0.24, 0.06], [-0.12, -0.3], [0, 0.06],
        [0.12, -0.3], [0.24, 0.06], [0.4, -0.1], [0.4, 0.3],
      ]);
      break;
    case 'sword':
      // Point upward, a long blade and a short cross: anything squarer than
      // this is a cross, and there are enough crosses on this map already.
      poly([
        [0, -0.48], [0.07, -0.34], [0.07, 0.1], [0.24, 0.1], [0.24, 0.2],
        [0.07, 0.2], [0.07, 0.3], [0.12, 0.46], [-0.12, 0.46], [-0.07, 0.3],
        [-0.07, 0.2], [-0.24, 0.2], [-0.24, 0.1], [-0.07, 0.1], [-0.07, -0.34],
      ]);
      break;
    case 'horse':
      // Courant, facing the dexter side: head low and forward, four legs
      // under it, tail streaming behind.
      poly([
        [-0.47, -0.12], [-0.33, -0.24], [-0.2, -0.22], [-0.08, -0.06],
        [0.12, -0.08], [0.28, -0.2], [0.42, -0.14], [0.46, 0.02],
        [0.34, 0.1], [0.3, 0.42], [0.18, 0.42], [0.18, 0.14],
        [0.0, 0.16], [-0.02, 0.42], [-0.14, 0.42], [-0.14, 0.12],
        [-0.3, 0.02], [-0.44, 0.04],
      ]);
      break;
    case 'key':
      poly([
        [-0.06, -0.46], [0.06, -0.46], [0.06, 0.2], [0.24, 0.2], [0.24, 0.32],
        [0.06, 0.32], [0.06, 0.46], [-0.06, 0.46], [-0.06, 0.32], [-0.2, 0.32],
        [-0.2, 0.2], [-0.06, 0.2],
      ]);
      ctx.beginPath();
      ctx.arc(cx, cy - s * 0.38, s * 0.16, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'serpent':
      ctx.save();
      ctx.lineWidth = s * 0.16;
      ctx.lineCap = 'round';
      ctx.strokeStyle = ctx.fillStyle;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.26, cy + s * 0.4);
      ctx.bezierCurveTo(cx + s * 0.4, cy + s * 0.2, cx - s * 0.4, cy - s * 0.1, cx + s * 0.2, cy - s * 0.34);
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(cx + s * 0.24, cy - s * 0.38, s * 0.13, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'harp': {
      // Drawn rather than cut out: a harp is a frame with air in it, and a
      // filled triangle is a filled triangle whatever it is called.
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = ctx.fillStyle as string;
      ctx.lineWidth = s * 0.13;
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.2, cy - s * 0.4);
      ctx.lineTo(cx + s * 0.22, cy + s * 0.32);
      ctx.lineTo(cx - s * 0.26, cy + s * 0.44);
      ctx.quadraticCurveTo(cx - s * 0.36, cy - s * 0.12, cx + s * 0.2, cy - s * 0.4);
      ctx.stroke();
      ctx.lineWidth = Math.max(1, s * 0.055);
      for (let i = 1; i <= 3; i++) {
        const along = i / 4;
        ctx.beginPath();
        ctx.moveTo(cx + s * 0.21, cy - s * 0.4 + along * s * 0.72);
        ctx.lineTo(cx - s * 0.28 + along * s * 0.12, cy - s * 0.08 + along * s * 0.5);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case 'trident':
      poly([
        [-0.36, -0.42], [-0.24, -0.42], [-0.24, -0.1], [-0.06, -0.1], [-0.06, -0.46],
        [0.06, -0.46], [0.06, -0.1], [0.24, -0.1], [0.24, -0.42], [0.36, -0.42],
        [0.36, 0.02], [0.06, 0.1], [0.06, 0.46], [-0.06, 0.46], [-0.06, 0.1],
        [-0.36, 0.02],
      ]);
      break;
    case 'bull':
      // A head, caboshed: horns out to the sides and the muzzle below.
      poly([
        [-0.46, -0.3], [-0.3, -0.44], [-0.18, -0.24], [0.18, -0.24],
        [0.3, -0.44], [0.46, -0.3], [0.3, -0.14], [0.26, 0.1],
        [0.12, 0.34], [-0.12, 0.34], [-0.26, 0.1], [-0.3, -0.14],
      ]);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Kept copies
// ---------------------------------------------------------------------------

const drawn = new Map<string, HTMLCanvasElement>();

/**
 * A realm's arms, painted once at a size and kept.
 *
 * The map asks for a shield beside every town's name on every frame, which
 * is two hundred of them; painting a lion two hundred times a frame is not
 * something to do when the answer never changes.
 */
export function armsCanvas(
  id: FactionId,
  width: number,
  height: number,
  shape: ArmsShape = 'shield',
): HTMLCanvasElement {
  const key = `${id}|${width}x${height}|${shape}`;
  const known = drawn.get(key);
  if (known) return known;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(width));
  canvas.height = Math.max(2, Math.round(height));
  const ctx = canvas.getContext('2d')!;
  drawArms(ctx, armsOf(id), 0.5, 0.5, canvas.width - 1, canvas.height - 1, shape);
  drawn.set(key, canvas);
  return canvas;
}

const urls = new Map<string, string>();

/** The same, as something a stylesheet can use as a background. */
export function armsDataUrl(id: FactionId, width: number, height: number, shape: ArmsShape = 'shield'): string {
  const key = `${id}|${width}x${height}|${shape}`;
  const known = urls.get(key);
  if (known) return known;
  const url = armsCanvas(id, width, height, shape).toDataURL('image/png');
  urls.set(key, url);
  return url;
}
