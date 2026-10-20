/**
 * Where each sprite sits on the sheet.
 *
 * The sheet is modelled and rendered rather than drawn: see
 * tools/build-sprites.py, which puts every piece in front of the one camera
 * angle the tiles allow and shrinks the result onto a short palette. Do not
 * edit by hand.
 *
 * Anything belonging to whoever owns a thing is rendered in pure magenta and
 * swapped for the owner's colour when the sprite is first asked for. That is
 * how these games coloured a hundred companies from one drawing, and it is
 * why a settlement here can be any of seventy-three.
 *
 * `anchorX` and `anchorY` are where the model's own origin — the middle of
 * the ground it stands on — fell in its frame. The map stamps a sprite by
 * that point rather than by the middle of the frame, which is what puts a
 * town on its own coordinates instead of up and to the left of them.
 */

export const SPRITE_MARKER = { r: 255, g: 0, b: 255 } as const;

/** Where the sheet is served from. */
export const SPRITE_SHEET = 'sprites.png';

export const SPRITES = {
  town0: { x: 0, y: 0, width: 96, height: 96, anchorX: 41.4, anchorY: 71.2 },
  town1: { x: 96, y: 0, width: 96, height: 96, anchorX: 48.0, anchorY: 53.1 },
  town2: { x: 192, y: 0, width: 96, height: 96, anchorX: 49.8, anchorY: 55.8 },
  town3: { x: 288, y: 0, width: 96, height: 96, anchorX: 49.5, anchorY: 57.8 },
  town4: { x: 0, y: 96, width: 96, height: 96, anchorX: 48.0, anchorY: 56.6 },
  town5: { x: 96, y: 96, width: 96, height: 96, anchorX: 48.0, anchorY: 56.2 },
  footmen: { x: 192, y: 96, width: 96, height: 96, anchorX: 58.5, anchorY: 61.0 },
  horsemen: { x: 288, y: 96, width: 96, height: 96, anchorX: 53.0, anchorY: 63.6 },
  soldier: { x: 0, y: 192, width: 96, height: 96, anchorX: 51.0, anchorY: 86.6 },
  rider: { x: 96, y: 192, width: 96, height: 96, anchorX: 45.6, anchorY: 84.0 },
  captain: { x: 192, y: 192, width: 96, height: 96, anchorX: 54.9, anchorY: 88.9 },
  general: { x: 288, y: 192, width: 96, height: 96, anchorX: 47.3, anchorY: 86.1 },
  spearman: { x: 0, y: 288, width: 96, height: 96, anchorX: 51.0, anchorY: 86.6 },
  swordsman: { x: 96, y: 288, width: 96, height: 96, anchorX: 50.3, anchorY: 87.4 },
  pikeman: { x: 192, y: 288, width: 96, height: 96, anchorX: 49.9, anchorY: 89.0 },
  archer: { x: 288, y: 288, width: 96, height: 96, anchorX: 51.7, anchorY: 86.8 },
  crossbowman: { x: 0, y: 384, width: 96, height: 96, anchorX: 54.2, anchorY: 86.6 },
  gunner: { x: 96, y: 384, width: 96, height: 96, anchorX: 45.0, anchorY: 79.0 },
  knight: { x: 192, y: 384, width: 96, height: 96, anchorX: 34.5, anchorY: 84.0 },
  lighthorse: { x: 288, y: 384, width: 96, height: 96, anchorX: 45.8, anchorY: 84.7 },
  galley: { x: 0, y: 480, width: 96, height: 96, anchorX: 48.0, anchorY: 69.8 },
  roundship: { x: 96, y: 480, width: 96, height: 96, anchorX: 48.0, anchorY: 74.7 },
  agent: { x: 192, y: 480, width: 96, height: 96, anchorX: 48.0, anchorY: 83.8 },
  caravan: { x: 288, y: 480, width: 96, height: 96, anchorX: 42.7, anchorY: 79.8 },
  tree: { x: 0, y: 576, width: 96, height: 96, anchorX: 48.0, anchorY: 87.8 },
  scrub: { x: 96, y: 576, width: 96, height: 96, anchorX: 48.0, anchorY: 88.3 },
} as const;

export type SpriteName = keyof typeof SPRITES;
