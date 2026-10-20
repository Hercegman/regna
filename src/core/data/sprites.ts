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
 */

export const SPRITE_MARKER = { r: 255, g: 0, b: 255 } as const;

/** Where the sheet is served from. */
export const SPRITE_SHEET = 'sprites.png';

export const SPRITES = {
  town0: { x: 0, y: 0, width: 64, height: 64 },
  town1: { x: 64, y: 0, width: 64, height: 64 },
  town2: { x: 128, y: 0, width: 64, height: 64 },
  town3: { x: 192, y: 0, width: 64, height: 64 },
  town4: { x: 0, y: 64, width: 64, height: 64 },
  town5: { x: 64, y: 64, width: 64, height: 64 },
  footmen: { x: 128, y: 64, width: 64, height: 64 },
  horsemen: { x: 192, y: 64, width: 64, height: 64 },
  soldier: { x: 0, y: 128, width: 64, height: 64 },
  rider: { x: 64, y: 128, width: 64, height: 64 },
  galley: { x: 128, y: 128, width: 64, height: 64 },
  roundship: { x: 192, y: 128, width: 64, height: 64 },
  agent: { x: 0, y: 192, width: 64, height: 64 },
  caravan: { x: 64, y: 192, width: 64, height: 64 },
  tree: { x: 128, y: 192, width: 64, height: 64 },
  scrub: { x: 192, y: 192, width: 64, height: 64 },
} as const;

export type SpriteName = keyof typeof SPRITES;
