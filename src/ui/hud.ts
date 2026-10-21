/**
 * The chrome.
 *
 * Everything here exists to make the interface look like the thing it is
 * about rather than like a settings dialogue: plaques, banners, a unit card
 * with the regiment's own colours on it. None of it knows any rules. It is
 * handed what to show and gives back an element.
 *
 * The unit card is the piece that matters. A list of regiment names is a
 * spreadsheet; a row of cards, each with the men on it, its strength under
 * it and its experience marked in the corner, is an army — and the player
 * reads the state of a whole army off it in one glance, which is the thing a
 * list cannot do however neatly it is laid out.
 */
import { getUnitType } from '../core/data/units';
import type { Regiment } from '../core/campaign';
import { loadSprites, sprite } from '../render/iso/sprites';
import { armsDataUrl } from '../render/arms';
import { figureFor, figureSprite } from '../render/figures';
import type { FactionId } from '../core/types';
import type { SpriteName } from '../render/iso/sprites';
import { el } from './dom';

/** How big a card's picture is drawn, before the page scales it. */
const PORTRAIT = 48;

/**
 * One regiment, as a card.
 *
 * The picture is the same rendered soldier the map stands in a province,
 * recoloured to whoever owns it — which is the point of having rendered it
 * in a marker colour in the first place, and keeps the card and the map
 * showing the same army.
 */
export function unitCard(
  regiment: Regiment,
  colour: string,
  options: {
    readonly onClick?: () => void;
    readonly selected?: boolean;
    /** What is painted on the shield; see `deviceOf`. */
    readonly device?: string;
  } = {},
): HTMLElement {
  const type = getUnitType(regiment.type);
  const full = Math.max(1, type.soldiers);
  const fraction = Math.max(0, Math.min(1, regiment.soldiers / full));
  const chevrons = Math.min(3, Math.round(regiment.experience / 3));

  const canvas = el('canvas', { class: 'card-portrait' });
  canvas.width = PORTRAIT;
  canvas.height = PORTRAIT;
  paintPortrait(
    canvas,
    figureSprite(figureFor(type.unitClass, type.id), 0, 0, 'idle'),
    colour,
    options.device,
  );

  const card = el('div', {
    class: `unit-card${options.selected ? ' selected' : ''}${regiment.mercenary ? ' hired' : ''}`,
    title:
      `${type.name}\n${regiment.soldiers} of ${full} men` +
      `\nAttack ${type.attack} · Defence ${type.defence}` +
      (type.missileAttack > 0 ? ` · Missiles ${type.missileAttack}` : '') +
      `\nExperience ${regiment.experience}` +
      (regiment.mercenary ? '\nA hired company' : '') +
      `\n\n${type.description}`,
    style: `--banner:${colour}`,
  },
    el('div', { class: 'card-banner' }),
    canvas,
    chevrons > 0 && el('div', { class: 'card-chevrons' }, '▲'.repeat(chevrons)),
    el('div', { class: 'card-strength' },
      el('div', {
        class: `card-strength-fill${fraction < 0.34 ? ' spent' : fraction < 0.7 ? ' worn' : ''}`,
        style: `width:${(fraction * 100).toFixed(0)}%`,
      }),
    ),
  );
  if (options.onClick) card.addEventListener('click', options.onClick);
  return card;
}

/** A ship, which is the same card with a hull on it. */
export function shipCard(
  name: string,
  strength: number,
  full: number,
  colour: string,
  heavy: boolean,
  title: string,
): HTMLElement {
  const fraction = Math.max(0, Math.min(1, strength / Math.max(1, full)));
  const canvas = el('canvas', { class: 'card-portrait' });
  canvas.width = PORTRAIT;
  canvas.height = PORTRAIT;
  paintPortrait(canvas, heavy ? 'roundship' : 'galley', colour);
  return el('div', { class: 'unit-card', title: `${name}\n${title}`, style: `--banner:${colour}` },
    el('div', { class: 'card-banner' }),
    canvas,
    el('div', { class: 'card-strength' },
      el('div', {
        class: `card-strength-fill${fraction < 0.34 ? ' spent' : fraction < 0.7 ? ' worn' : ''}`,
        style: `width:${(fraction * 100).toFixed(0)}%`,
      }),
    ),
  );
}

/**
 * Puts the sprite on a card.
 *
 * The sheet may not have arrived yet — the first cards are built in the same
 * breath as the first frame of the map — so this paints whatever it has and
 * paints again when the sheet turns up.
 */
function paintPortrait(
  canvas: HTMLCanvasElement,
  name: SpriteName,
  colour: string,
  device?: string,
): void {
  const paint = (): void => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // A sprite is cut down to what is in it, so it has to be put back where
    // it was: centred across the card and standing on the bottom of it.
    const image = sprite(name, PORTRAIT, colour, device);
    if (!image) return;
    ctx.drawImage(
      image,
      Math.round((PORTRAIT - image.width) / 2),
      Math.max(0, PORTRAIT - image.height),
    );
  };
  paint();
  void loadSprites().then(paint).catch(() => undefined);
}

/** A small stone plaque with a label over a value, for the top bar. */
export function plaque(label: string, value: Node | string, extra = ''): HTMLElement {
  return el('div', { class: `plaque ${extra}`.trim() },
    el('span', { class: 'plaque-label' }, label),
    el('span', { class: 'plaque-value' }, value),
  );
}

/**
 * The realm's shield.
 *
 * Its actual arms where it has them, which is everywhere: the device a
 * medieval realm was recognised by, drawn from a blazon at the size the page
 * wants it. The colour is kept behind as a fallback, and is still what the
 * map paints the realm's ground and borders in.
 */
export function crest(colour: string, title: string, faction?: FactionId): HTMLElement {
  const style = faction
    ? `--banner:${colour};background-image:url(${armsDataUrl(faction, 44, 52, 'banner')})`
    : `--banner:${colour}`;
  return el('span', { class: `crest${faction ? ' blazoned' : ''}`, title, style });
}

/**
 * A regiment on the battlefield, as a card.
 *
 * The same card as the campaign's, with two differences that matter when the
 * men are actually fighting: the bar under it is doubled, strength over
 * morale, because a regiment at full strength and no heart is about to run;
 * and the card is built once and then updated in place. A battle rebuilds its
 * panels four times a second, and throwing away two dozen canvases that often
 * to redraw the same soldier is work for nothing.
 */
export interface BattleCardHandle {
  readonly root: HTMLElement;
  /** Updates the bars and the state from the regiment as it now stands. */
  update(reading: BattleCardReading): void;
}

export interface BattleCardReading {
  /** Nought to one. */
  readonly strength: number;
  readonly morale: number;
  readonly routing: boolean;
  readonly gone: boolean;
  readonly selected: boolean;
}

export function battleCard(
  name: string,
  colour: string,
  mounted: boolean,
  afloat: boolean,
  experience: number,
  title: string,
  onClick: () => void,
  device?: string,
): BattleCardHandle {
  const canvas = el('canvas', { class: 'card-portrait' });
  canvas.width = PORTRAIT;
  canvas.height = PORTRAIT;
  paintPortrait(
    canvas,
    afloat ? 'galley' : figureSprite(mounted ? 'lighthorse' : 'swordsman', 0, 0, 'idle'),
    colour,
    device,
  );
  const chevrons = Math.min(3, Math.round(experience / 3));

  const strength = el('div', { class: 'card-strength-fill' });
  const morale = el('div', { class: 'card-morale-fill' });
  const root = el('div', { class: 'unit-card', title, style: `--banner:${colour}` },
    el('div', { class: 'card-banner' }),
    canvas,
    chevrons > 0 && el('div', { class: 'card-chevrons' }, '▲'.repeat(chevrons)),
    el('div', { class: 'card-name' }, name),
    el('div', { class: 'card-strength' }, strength),
    el('div', { class: 'card-morale' }, morale),
  );
  root.addEventListener('click', onClick);

  return {
    root,
    update(reading: BattleCardReading): void {
      strength.style.width = `${Math.round(Math.max(0, Math.min(1, reading.strength)) * 100)}%`;
      strength.className =
        `card-strength-fill${reading.strength < 0.34 ? ' spent' : reading.strength < 0.7 ? ' worn' : ''}`;
      morale.style.width = `${Math.round(Math.max(0, Math.min(1, reading.morale)) * 100)}%`;
      morale.className =
        `card-morale-fill${reading.morale < 0.3 ? ' breaking' : reading.morale < 0.6 ? ' shaken' : ''}`;
      root.className =
        `unit-card battle${reading.gone ? ' gone' : ''}${reading.routing ? ' routing' : ''}` +
        `${reading.selected ? ' selected' : ''}`;
    },
  };
}
