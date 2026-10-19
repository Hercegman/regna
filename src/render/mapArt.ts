/**
 * The furniture of the map.
 *
 * Everything here draws one small thing in the manner of a painted campaign
 * map rather than a diagram: a walled town, a range of hills, a banner on a
 * pole, a ship under sail. They are vector glyphs rather than images because
 * they have to stay sharp at every zoom and tint to any faction's colour, and
 * because a game that ships no art files is a game anybody can build.
 *
 * Every glyph is drawn around an origin at its own base, so a caller can place
 * it on a point and let it stand up from there.
 */
import type { Terrain } from '../core/types';

/** A deterministic value in [0,1) from two integers, for scattering symbols. */
export function jitter(a: number, b: number): number {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

/** The colour the bare ground of a province takes. */
export function terrainColour(terrain: Terrain): string {
  switch (terrain) {
    case 'mountains': return '#9b9183';
    case 'hills': return '#9ba06d';
    case 'forest': return '#5f7a52';
    case 'marsh': return '#79897c';
    case 'desert': return '#cdbd8e';
    case 'steppe': return '#b5b278';
    case 'farmland': return '#9ba86e';
    case 'coastal': return '#97a179';
    case 'plains': return '#97a368';
    default: return '#949f69';
  }
}
/** A translucent ink, for the shaded and lit faces of a relief symbol. */
function shade(alpha: number): string {
  return `rgba(28, 26, 18, ${alpha})`;
}
function lit(alpha: number): string {
  return `rgba(255, 248, 226, ${alpha})`;
}

/** One conifer, standing on (x, y). */
function conifer(ctx: CanvasRenderingContext2D, x: number, y: number, h: number): void {
  ctx.fillStyle = shade(0.2);
  ctx.fillRect(x - h * 0.06, y - h * 0.22, h * 0.12, h * 0.24);
  // Three tiers of branches, narrowing to the top.
  for (let tier = 0; tier < 3; tier++) {
    const top = y - h * (0.42 + tier * 0.22);
    const spread = h * (0.34 - tier * 0.08);
    ctx.beginPath();
    ctx.moveTo(x, top - h * 0.2);
    ctx.lineTo(x + spread, top);
    ctx.lineTo(x - spread, top);
    ctx.closePath();
    ctx.fillStyle = shade(0.5 - tier * 0.06);
    ctx.fill();
  }
}

/** A tuft of grass, three blades from a point. */
function tuft(ctx: CanvasRenderingContext2D, x: number, y: number, h: number): void {
  ctx.strokeStyle = shade(0.45);
  ctx.lineWidth = Math.max(0.5, h * 0.09);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x - h * 0.22, y - h * 0.4, x - h * 0.4, y - h * 0.55);
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - h * 0.72);
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + h * 0.22, y - h * 0.4, x + h * 0.4, y - h * 0.55);
  ctx.stroke();
}

/**
 * One terrain symbol, drawn with its base at (x, y) and about 2×size wide.
 *
 * These are small pictures rather than cartographic signs: a peak with a lit
 * face and a shaded one, a stand of firs, a dune with the sun on its crest.
 * Each is lit from the upper left, like everything else on the map, so that a
 * range of them reads as country seen from above rather than as a legend.
 */
export function drawTerrainMark(
  ctx: CanvasRenderingContext2D,
  terrain: Terrain,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (terrain) {
    case 'mountains': {
      // A lesser peak behind, so a range has depth.
      ctx.beginPath();
      ctx.moveTo(x + size * 0.15, y);
      ctx.lineTo(x + size * 0.78, y - size * 0.95);
      ctx.lineTo(x + size * 1.25, y);
      ctx.closePath();
      ctx.fillStyle = shade(0.34);
      ctx.fill();

      const peak = y - size * 1.5;
      // The shaded (right) face.
      ctx.beginPath();
      ctx.moveTo(x - size * 0.05, peak);
      ctx.lineTo(x + size * 0.85, y);
      ctx.lineTo(x - size * 0.05, y);
      ctx.closePath();
      ctx.fillStyle = shade(0.6);
      ctx.fill();
      // The lit (left) face.
      ctx.beginPath();
      ctx.moveTo(x - size * 0.05, peak);
      ctx.lineTo(x - size * 0.05, y);
      ctx.lineTo(x - size * 0.95, y);
      ctx.closePath();
      ctx.fillStyle = shade(0.38);
      ctx.fill();
      // Snow, once the symbol is big enough to carry it.
      if (size > 5) {
        ctx.beginPath();
        ctx.moveTo(x - size * 0.05, peak);
        ctx.lineTo(x + size * 0.28, y - size * 0.95);
        ctx.lineTo(x + size * 0.05, y - size * 1.02);
        ctx.lineTo(x - size * 0.16, y - size * 0.88);
        ctx.lineTo(x - size * 0.36, y - size * 0.98);
        ctx.closePath();
        ctx.fillStyle = lit(0.72);
        ctx.fill();
      }
      break;
    }

    case 'hills': {
      ctx.beginPath();
      ctx.moveTo(x + size * 0.1, y);
      ctx.quadraticCurveTo(x + size * 0.7, y - size * 0.95, x + size * 1.3, y);
      ctx.closePath();
      ctx.fillStyle = shade(0.3);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(x - size, y);
      ctx.quadraticCurveTo(x - size * 0.2, y - size * 1.15, x + size * 0.6, y);
      ctx.closePath();
      ctx.fillStyle = shade(0.48);
      ctx.fill();
      // A highlight along the sunward shoulder.
      ctx.beginPath();
      ctx.moveTo(x - size * 0.82, y - size * 0.22);
      ctx.quadraticCurveTo(x - size * 0.34, y - size * 0.95, x - size * 0.02, y - size * 0.72);
      ctx.strokeStyle = lit(0.26);
      ctx.lineWidth = Math.max(0.6, size * 0.16);
      ctx.stroke();
      break;
    }

    case 'forest': {
      conifer(ctx, x - size * 0.62, y, size * 1.45);
      conifer(ctx, x + size * 0.66, y - size * 0.1, size * 1.2);
      conifer(ctx, x + size * 0.02, y + size * 0.22, size * 1.75);
      break;
    }

    case 'marsh': {
      // Standing water, then the reeds growing out of it.
      ctx.strokeStyle = 'rgba(126, 168, 190, 0.62)';
      ctx.lineWidth = Math.max(0.6, size * 0.16);
      ctx.beginPath();
      ctx.moveTo(x - size * 0.95, y);
      ctx.lineTo(x - size * 0.15, y);
      ctx.moveTo(x + size * 0.3, y + size * 0.26);
      ctx.lineTo(x + size * 1.1, y + size * 0.26);
      ctx.stroke();
      ctx.strokeStyle = shade(0.5);
      ctx.lineWidth = Math.max(0.5, size * 0.12);
      for (let i = -1; i <= 1; i++) {
        const rx = x + i * size * 0.55;
        ctx.beginPath();
        ctx.moveTo(rx, y);
        ctx.quadraticCurveTo(rx + size * 0.1, y - size * 0.55, rx + size * 0.2, y - size * 0.95);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(rx + size * 0.2, y - size * 1.02, size * 0.1, size * 0.2, 0.3, 0, Math.PI * 2);
        ctx.fillStyle = shade(0.5);
        ctx.fill();
      }
      break;
    }

    case 'steppe': {
      tuft(ctx, x - size * 0.6, y, size * 1.1);
      tuft(ctx, x + size * 0.5, y + size * 0.18, size * 1.35);
      break;
    }

    case 'desert': {
      // A dune: a long windward slope and a short slip face.
      ctx.beginPath();
      ctx.moveTo(x - size * 1.15, y);
      ctx.quadraticCurveTo(x - size * 0.1, y - size * 0.82, x + size * 0.55, y - size * 0.6);
      ctx.quadraticCurveTo(x + size * 0.95, y - size * 0.45, x + size * 1.15, y);
      ctx.closePath();
      ctx.fillStyle = shade(0.26);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - size * 1.1, y - size * 0.06);
      ctx.quadraticCurveTo(x - size * 0.1, y - size * 0.86, x + size * 0.55, y - size * 0.62);
      ctx.strokeStyle = lit(0.34);
      ctx.lineWidth = Math.max(0.6, size * 0.14);
      ctx.stroke();
      break;
    }

    case 'farmland': {
      // Furrows running away from the eye, and a stook standing in them.
      ctx.strokeStyle = shade(0.3);
      ctx.lineWidth = Math.max(0.5, size * 0.1);
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const lift = i * size * 0.34;
        ctx.moveTo(x - size * 1.1 + lift * 0.45, y - lift);
        ctx.lineTo(x + size * 0.3 + lift * 0.45, y - lift);
      }
      ctx.stroke();
      if (size > 4) {
        ctx.strokeStyle = shade(0.55);
        ctx.lineWidth = Math.max(0.5, size * 0.11);
        ctx.beginPath();
        const bx = x + size * 0.95;
        ctx.moveTo(bx - size * 0.22, y);
        ctx.lineTo(bx + size * 0.08, y - size * 0.8);
        ctx.moveTo(bx + size * 0.22, y);
        ctx.lineTo(bx + size * 0.08, y - size * 0.8);
        ctx.moveTo(bx - size * 0.1, y - size * 0.44);
        ctx.lineTo(bx + size * 0.26, y - size * 0.44);
        ctx.stroke();
      }
      break;
    }

    case 'coastal': {
      ctx.strokeStyle = 'rgba(126, 168, 190, 0.5)';
      ctx.lineWidth = Math.max(0.5, size * 0.13);
      ctx.beginPath();
      ctx.moveTo(x - size * 0.9, y);
      ctx.quadraticCurveTo(x - size * 0.45, y - size * 0.3, x, y);
      ctx.quadraticCurveTo(x + size * 0.45, y + size * 0.3, x + size * 0.9, y);
      ctx.stroke();
      ctx.fillStyle = shade(0.34);
      ctx.beginPath();
      ctx.ellipse(x - size * 0.3, y + size * 0.42, size * 0.2, size * 0.13, 0, 0, Math.PI * 2);
      ctx.ellipse(x + size * 0.45, y + size * 0.5, size * 0.15, size * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    default: {
      // Plains: open ground with a little grass on it.
      tuft(ctx, x - size * 0.35, y, size * 0.8);
      ctx.strokeStyle = shade(0.26);
      ctx.lineWidth = Math.max(0.5, size * 0.11);
      ctx.beginPath();
      ctx.moveTo(x + size * 0.3, y + size * 0.1);
      ctx.lineTo(x + size * 1.05, y + size * 0.1);
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}

export interface SettlementArt {
  /** 0 village to 5 huge city. */
  readonly rank: number;
  /** 0 none to 5 epic. */
  readonly walls: number;
  readonly colour: string;
  readonly colourDark: string;
  readonly port: boolean;
}

/**
 * A settlement, drawn as the place it is: a hamlet of two roofs, a walled town
 * with towers, a city with a cathedral spire. Its size is the rank, its walls
 * are the ring around it, and its banner is its owner's.
 */
export function drawSettlement(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  art: SettlementArt,
): void {
  const s = scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const roof = '#8a5a3c';
  const roofDark = '#5f3c28';
  const stone = '#cfc6b2';
  const stoneDark = '#8d8571';

  // A shadow so the place sits on the ground rather than floating over it.
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(0, s * 0.35, s * (art.walls >= 2 ? 1.5 : 1), s * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // A palisade is a line of stakes, not masonry.
  if (art.walls === 1) {
    ctx.strokeStyle = '#6a5436';
    ctx.lineWidth = Math.max(0.4, s * 0.1);
    ctx.beginPath();
    for (let i = -3; i <= 3; i++) {
      const px = i * s * 0.26;
      ctx.moveTo(px, s * 0.26);
      ctx.lineTo(px, s * 0.26 - s * 0.3);
    }
    ctx.stroke();
  }

  // Walls, when it has any worth drawing.
  if (art.walls >= 2) {
    const r = s * (1.15 + art.walls * 0.07);
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI * 0.08, Math.PI * 0.92, true);
    ctx.lineTo(r * 0.92, s * 0.3);
    ctx.lineTo(-r * 0.92, s * 0.3);
    ctx.closePath();
    ctx.fillStyle = stone;
    ctx.fill();
    ctx.strokeStyle = stoneDark;
    ctx.lineWidth = Math.max(0.6, s * 0.13);
    ctx.stroke();
    // Towers along the wall.
    const towers = Math.min(5, 2 + art.walls);
    for (let i = 0; i < towers; i++) {
      const angle = Math.PI * (0.12 + (0.76 * i) / Math.max(1, towers - 1));
      const tx = Math.cos(angle) * r;
      const ty = -Math.sin(angle) * r * 0.9;
      ctx.beginPath();
      ctx.rect(tx - s * 0.17, ty - s * 0.3, s * 0.34, s * 0.62);
      ctx.fillStyle = stone;
      ctx.fill();
      ctx.strokeStyle = stoneDark;
      ctx.lineWidth = Math.max(0.5, s * 0.1);
      ctx.stroke();
    }
  }

  // Roofs, in two rows once there are enough of them to make a street: the
  // back row is smaller and set higher, which is all the perspective a mark
  // this size can carry.
  const roofs = Math.min(7, 2 + art.rank);
  const back = roofs > 3 ? Math.floor(roofs / 2) : 0;
  const house = (i: number, count: number, lift: number, shrink: number): void => {
    const w = s * 0.3 * shrink;
    const offset = (i - (count - 1) / 2) * s * 0.52 * shrink;
    const ground = s * 0.2 - lift;
    const height = s * (0.5 + jitter(i, art.rank) * 0.25) * shrink;
    ctx.beginPath();
    ctx.moveTo(offset - w, ground);
    ctx.lineTo(offset - w, ground - height * 0.55);
    ctx.lineTo(offset, ground - height);
    ctx.lineTo(offset + w, ground - height * 0.55);
    ctx.lineTo(offset + w, ground);
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? roof : roofDark;
    ctx.fill();
    ctx.strokeStyle = '#3b2518';
    ctx.lineWidth = Math.max(0.4, s * 0.08);
    ctx.stroke();
  };
  for (let i = 0; i < back; i++) house(i, back, s * 0.4, 0.78);
  for (let i = 0; i < roofs - back; i++) house(i, roofs - back, 0, 1);

  // A spire for a city, because a city is where the cathedral is.
  if (art.rank >= 3) {
    ctx.beginPath();
    ctx.moveTo(0, s * 0.2);
    ctx.lineTo(0, -s * 1.1);
    ctx.lineWidth = Math.max(0.6, s * 0.16);
    ctx.strokeStyle = stone;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.26, -s * 0.72);
    ctx.lineTo(0, -s * 1.45);
    ctx.lineTo(s * 0.26, -s * 0.72);
    ctx.closePath();
    ctx.fillStyle = stoneDark;
    ctx.fill();
  }

  // The owner's banner over the gate.
  drawBanner(ctx, s * 0.95, -s * 0.35, s * 0.85, art.colour, art.colourDark);

  // A quay, if it is a harbour.
  if (art.port) {
    ctx.beginPath();
    ctx.moveTo(-s * 1.5, s * 0.45);
    ctx.lineTo(-s * 0.55, s * 0.45);
    ctx.strokeStyle = '#6b6049';
    ctx.lineWidth = Math.max(0.6, s * 0.16);
    ctx.stroke();
  }
  ctx.restore();
}

/** A pennant on a pole, in a faction's colours. */
export function drawBanner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  colour: string,
  dark: string,
): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.9);
  ctx.lineTo(x, y - size * 1.1);
  ctx.strokeStyle = '#2e2a22';
  ctx.lineWidth = Math.max(0.6, size * 0.16);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x, y - size * 1.05);
  ctx.lineTo(x + size * 0.95, y - size * 0.78);
  ctx.lineTo(x, y - size * 0.4);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(0.4, size * 0.1);
  ctx.stroke();
  ctx.restore();
}

/**
 * A soldier seen from the front, as a silhouette about `h` tall standing on
 * (x, y): helmet, shoulders, a spear in the right hand. Four of these in a row
 * read as a body of men even at eight pixels.
 */
function soldier(ctx: CanvasRenderingContext2D, x: number, y: number, h: number): void {
  ctx.fillStyle = 'rgba(34, 30, 23, 0.92)';
  // Body and legs, one shape.
  ctx.beginPath();
  ctx.moveTo(x - h * 0.19, y);
  ctx.lineTo(x - h * 0.16, y - h * 0.44);
  ctx.lineTo(x - h * 0.2, y - h * 0.62);
  ctx.lineTo(x + h * 0.2, y - h * 0.62);
  ctx.lineTo(x + h * 0.16, y - h * 0.44);
  ctx.lineTo(x + h * 0.19, y);
  ctx.closePath();
  ctx.fill();
  // Helmet.
  ctx.beginPath();
  ctx.arc(x, y - h * 0.76, h * 0.17, Math.PI, Math.PI * 2);
  ctx.rect(x - h * 0.17, y - h * 0.76, h * 0.34, h * 0.12);
  ctx.fill();
  // Spear.
  ctx.strokeStyle = 'rgba(34, 30, 23, 0.92)';
  ctx.lineWidth = Math.max(0.5, h * 0.07);
  ctx.beginPath();
  ctx.moveTo(x + h * 0.26, y + h * 0.04);
  ctx.lineTo(x + h * 0.19, y - h * 1.12);
  ctx.stroke();
}

/**
 * An army in the field.
 *
 * A rank of men behind a shield bearing their lord's colours, with the
 * standard above them. More men means a wider rank and more spears, so that
 * the difference between a raiding party and a royal host is visible without
 * reading a number.
 */
export function drawArmy(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  colour: string,
  dark: string,
  strength: number,
): void {
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(x, y + size * 0.1, size * (0.6 + Math.min(7, 2 + strength / 450) * 0.13), size * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  const men = Math.max(3, Math.min(7, 2 + Math.round(strength / 450)));
  const frontage = size * (0.95 + men * 0.21);
  const step = frontage / men;
  for (let i = 0; i < men; i++) {
    const mx = x - frontage / 2 + step * (i + 0.5);
    // The back rank stands a little higher and smaller, for depth.
    const back = i % 2 === 1;
    soldier(ctx, mx, y - (back ? size * 0.22 : 0), size * (back ? 1.05 : 1.2));
  }

  // The shield in front, which is where the colour lives.
  const sw = size * 0.62;
  const sh = size * 0.78;
  ctx.beginPath();
  ctx.moveTo(x - sw * 0.5, y - sh * 0.95);
  ctx.lineTo(x + sw * 0.5, y - sh * 0.95);
  ctx.lineTo(x + sw * 0.5, y - sh * 0.38);
  ctx.quadraticCurveTo(x + sw * 0.46, y + sh * 0.12, x, y + sh * 0.28);
  ctx.quadraticCurveTo(x - sw * 0.46, y + sh * 0.12, x - sw * 0.5, y - sh * 0.38);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(0.6, size * 0.1);
  ctx.stroke();
  // A band across the shield, so two similar colours still read apart.
  ctx.beginPath();
  ctx.moveTo(x - sw * 0.48, y - sh * 0.5);
  ctx.lineTo(x + sw * 0.48, y - sh * 0.5);
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(0.5, size * 0.09);
  ctx.stroke();

  drawBanner(ctx, x + size * 0.82, y - size * 0.5, size * 0.85, colour, dark);
  ctx.restore();
}

/**
 * A fleet, drawn as the cog that carried the age's war and trade: a round
 * hull with a castle fore and aft, one mast, one square sail in the owner's
 * colours. A laden ship sits lower and shows its cargo on deck.
 */
export function drawShip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  colour: string,
  dark: string,
  laden: boolean,
): void {
  ctx.save();
  const deck = y + (laden ? size * 0.1 : 0);

  // Wake.
  ctx.strokeStyle = 'rgba(190, 220, 238, 0.4)';
  ctx.lineWidth = Math.max(0.5, size * 0.09);
  ctx.beginPath();
  ctx.moveTo(x - size * 1.5, deck + size * 0.34);
  ctx.quadraticCurveTo(x - size * 0.9, deck + size * 0.52, x - size * 0.2, deck + size * 0.34);
  ctx.stroke();

  // Mast and yard.
  ctx.strokeStyle = '#4a3b27';
  ctx.lineWidth = Math.max(0.7, size * 0.11);
  ctx.beginPath();
  ctx.moveTo(x, deck + size * 0.1);
  ctx.lineTo(x, deck - size * 1.6);
  ctx.moveTo(x - size * 0.52, deck - size * 1.2);
  ctx.lineTo(x + size * 0.52, deck - size * 1.2);
  ctx.stroke();

  // The sail, bellied by the wind.
  ctx.beginPath();
  ctx.moveTo(x - size * 0.5, deck - size * 1.18);
  ctx.quadraticCurveTo(x + size * 0.24, deck - size * 1.05, x + size * 0.5, deck - size * 1.18);
  ctx.lineTo(x + size * 0.56, deck - size * 0.28);
  ctx.quadraticCurveTo(x + size * 0.2, deck - size * 0.14, x - size * 0.46, deck - size * 0.28);
  ctx.closePath();
  ctx.fillStyle = '#efe7d2';
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(0.5, size * 0.07);
  ctx.stroke();
  // The owner's device on the sail.
  ctx.beginPath();
  ctx.moveTo(x - size * 0.48, deck - size * 0.82);
  ctx.quadraticCurveTo(x + size * 0.22, deck - size * 0.69, x + size * 0.54, deck - size * 0.82);
  ctx.lineTo(x + size * 0.55, deck - size * 0.52);
  ctx.quadraticCurveTo(x + size * 0.22, deck - size * 0.39, x - size * 0.47, deck - size * 0.52);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();

  // Hull, with its castles.
  ctx.beginPath();
  ctx.moveTo(x - size * 1.08, deck - size * 0.3);
  ctx.lineTo(x - size * 1.08, deck - size * 0.62);
  ctx.lineTo(x - size * 0.68, deck - size * 0.62);
  ctx.lineTo(x - size * 0.68, deck - size * 0.3);
  ctx.lineTo(x + size * 0.72, deck - size * 0.3);
  ctx.lineTo(x + size * 0.72, deck - size * 0.72);
  ctx.lineTo(x + size * 1.12, deck - size * 0.72);
  ctx.lineTo(x + size * 1.12, deck - size * 0.3);
  ctx.quadraticCurveTo(x + size * 0.95, deck + size * 0.4, x, deck + size * 0.42);
  ctx.quadraticCurveTo(x - size * 0.95, deck + size * 0.4, x - size * 1.08, deck - size * 0.3);
  ctx.closePath();
  ctx.fillStyle = '#6b4e32';
  ctx.fill();
  ctx.strokeStyle = '#3a2a1a';
  ctx.lineWidth = Math.max(0.6, size * 0.09);
  ctx.stroke();

  if (laden) {
    ctx.fillStyle = '#c99a4e';
    ctx.fillRect(x - size * 0.5, deck - size * 0.46, size * 0.3, size * 0.18);
    ctx.fillRect(x + size * 0.18, deck - size * 0.46, size * 0.3, size * 0.18);
  }

  // A pennant at the masthead.
  ctx.beginPath();
  ctx.moveTo(x, deck - size * 1.6);
  ctx.lineTo(x + size * 0.46, deck - size * 1.48);
  ctx.lineTo(x, deck - size * 1.36);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.restore();
}

/**
 * A caravan: a pack animal under its load, with a driver walking ahead. The
 * bundle takes the owner's colour, since that is the only part a player needs
 * to tell apart at this size.
 */
export function drawCaravan(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  colour: string,
): void {
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(x, y + size * 0.08, size * 1.1, size * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  const beast = 'rgba(58, 44, 30, 0.95)';
  ctx.fillStyle = beast;
  ctx.strokeStyle = beast;
  ctx.lineWidth = Math.max(0.5, size * 0.13);

  // Legs.
  ctx.beginPath();
  ctx.moveTo(x - size * 0.42, y - size * 0.5);
  ctx.lineTo(x - size * 0.46, y);
  ctx.moveTo(x - size * 0.12, y - size * 0.5);
  ctx.lineTo(x - size * 0.08, y);
  ctx.moveTo(x + size * 0.3, y - size * 0.5);
  ctx.lineTo(x + size * 0.34, y);
  ctx.stroke();

  // Body, neck and head.
  ctx.beginPath();
  ctx.ellipse(x, y - size * 0.68, size * 0.52, size * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + size * 0.4, y - size * 0.78);
  ctx.lineTo(x + size * 0.72, y - size * 1.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x + size * 0.8, y - size * 1.26, size * 0.17, size * 0.12, 0.5, 0, Math.PI * 2);
  ctx.fill();

  // The load.
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(x - size * 0.42, y - size * 0.86);
  ctx.lineTo(x + size * 0.26, y - size * 0.86);
  ctx.lineTo(x + size * 0.18, y - size * 1.26);
  ctx.lineTo(x - size * 0.32, y - size * 1.26);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(32, 26, 18, 0.8)';
  ctx.lineWidth = Math.max(0.5, size * 0.1);
  ctx.stroke();

  ctx.restore();
}

/**
 * An agent, standing where he is standing.
 *
 * A hooded figure in his employer's colours, carrying the one thing that says
 * what he is: a staff for a priest, a sealed letter for an envoy, a pack for a
 * factor, and nothing at all for the man whose business is not being
 * identifiable.
 */
export function drawAgent(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  colour: string,
  dark: string,
  kind: 'spy' | 'envoy' | 'priest' | 'merchant',
): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(x, y + size * 0.08, size * 0.55, size * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // A cloak, narrow at the shoulders and spread at the hem.
  ctx.beginPath();
  ctx.moveTo(x, y - size * 1.25);
  ctx.quadraticCurveTo(x + size * 0.55, y - size * 0.5, x + size * 0.46, y);
  ctx.lineTo(x - size * 0.46, y);
  ctx.quadraticCurveTo(x - size * 0.55, y - size * 0.5, x, y - size * 1.25);
  ctx.closePath();
  ctx.fillStyle = kind === 'spy' ? '#2b2822' : colour;
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(0.5, size * 0.11);
  ctx.stroke();

  // The hood, which is a head for these purposes.
  ctx.beginPath();
  ctx.arc(x, y - size * 1.3, size * 0.28, 0, Math.PI * 2);
  ctx.fillStyle = kind === 'spy' ? '#2b2822' : dark;
  ctx.fill();

  if (size < 4) {
    ctx.restore();
    return;
  }

  switch (kind) {
    case 'priest': {
      // A staff with a cross at the head of it.
      ctx.strokeStyle = '#4a3b27';
      ctx.lineWidth = Math.max(0.5, size * 0.12);
      ctx.beginPath();
      ctx.moveTo(x + size * 0.55, y + size * 0.1);
      ctx.lineTo(x + size * 0.55, y - size * 1.6);
      ctx.moveTo(x + size * 0.3, y - size * 1.35);
      ctx.lineTo(x + size * 0.8, y - size * 1.35);
      ctx.stroke();
      break;
    }
    case 'envoy': {
      // A letter under the arm, with a seal on it.
      ctx.fillStyle = '#efe7d2';
      ctx.fillRect(x + size * 0.28, y - size * 0.82, size * 0.5, size * 0.36);
      ctx.strokeStyle = dark;
      ctx.lineWidth = Math.max(0.4, size * 0.08);
      ctx.strokeRect(x + size * 0.28, y - size * 0.82, size * 0.5, size * 0.36);
      ctx.beginPath();
      ctx.arc(x + size * 0.53, y - size * 0.64, size * 0.1, 0, Math.PI * 2);
      ctx.fillStyle = '#b4423a';
      ctx.fill();
      break;
    }
    case 'merchant': {
      // A pack on the back.
      ctx.beginPath();
      ctx.moveTo(x - size * 0.34, y - size * 0.95);
      ctx.lineTo(x - size * 0.78, y - size * 0.86);
      ctx.lineTo(x - size * 0.7, y - size * 0.34);
      ctx.lineTo(x - size * 0.3, y - size * 0.44);
      ctx.closePath();
      ctx.fillStyle = '#c99a4e';
      ctx.fill();
      ctx.strokeStyle = '#6b4e32';
      ctx.lineWidth = Math.max(0.4, size * 0.09);
      ctx.stroke();
      break;
    }
    case 'spy': {
      // His employer's colour shows only as a thread at the collar, which is
      // as much as he would want showing.
      ctx.strokeStyle = colour;
      ctx.lineWidth = Math.max(0.5, size * 0.13);
      ctx.beginPath();
      ctx.moveTo(x - size * 0.26, y - size * 1.08);
      ctx.lineTo(x + size * 0.26, y - size * 1.08);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}
