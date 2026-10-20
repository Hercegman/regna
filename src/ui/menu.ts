/**
 * The front of the game.
 *
 * Until now there was none: the page opened on a list of seventy-three
 * factions and that was the whole of it, which told a player nothing about
 * what he had in front of him and gave him no way to do anything but start a
 * grand campaign. This is the room you walk into — the title, what there is
 * to do, and the way back to a campaign already in progress.
 *
 * The backdrop is made of the game's own data rather than of a painting:
 * every one of the seventy-three realms has a colour, and a wall of their
 * shields says what this game is about more honestly than a stock
 * illustration would.
 */
import { FACTIONS } from '../core/data/factions';
import { armsDataUrl } from '../render/arms';
import { clear, el } from './dom';

export type BattleKind = 'field' | 'siege' | 'sea';

export interface MenuHooks {
  readonly onCampaign: () => void;
  readonly onContinue?: { readonly label: string; readonly act: () => void };
  readonly onImport: () => void;
  readonly onCustomBattle: (kind: BattleKind) => void;
}

/** A wall of shields, one per realm, as the backdrop to everything here. */
export function heraldry(): HTMLElement {
  const wall = el('div', { class: 'menu-heraldry' });
  // Enough to fill a wide screen several times over, so the wall is a wall
  // rather than a few rows of bunting.
  for (let pass = 0; pass < 18; pass++) {
    for (const faction of FACTIONS) {
      wall.appendChild(el('span', {
        class: 'menu-shield',
        style: `background-image:url(${armsDataUrl(faction.id, 38, 46, 'banner')})`,
        title: faction.name,
      }));
    }
  }
  return wall;
}

export function renderMainMenu(host: HTMLElement, hooks: MenuHooks): void {
  clear(host);

  const option = (
    label: string,
    note: string,
    act: () => void,
    strong = false,
  ): HTMLElement =>
    el('button', { class: `menu-option${strong ? ' strong' : ''}`, onClick: act },
      el('span', { class: 'menu-option-label' }, label),
      el('span', { class: 'menu-option-note' }, note),
    );

  const options = el('div', { class: 'menu-options' },
    option('Grand campaign', 'Seventy-three realms, 1080 to 1530', hooks.onCampaign, true),
    hooks.onContinue && option('Continue', hooks.onContinue.label, hooks.onContinue.act),
    option('Custom battle', 'A field, a siege or a fight at sea',
      () => renderBattleSetup(host, hooks)),
    option('Load a saved file', 'A campaign exported earlier', hooks.onImport),
  );

  host.appendChild(
    el('div', { class: 'menu-screen' },
      heraldry(),
      el('div', { class: 'menu-plate' },
        el('h1', { class: 'menu-title' }, 'Regna'),
        el('p', { class: 'menu-sub' }, 'Age of Kingdoms'),
        el('p', { class: 'menu-blurb' },
          'Every realm on this map existed, at the place and in the year it really ' +
          'rose. Nothing here is invented.',
        ),
        options,
        el('p', { class: 'menu-foot' },
          `${FACTIONS.length} factions · 222 provinces · 35 seas · two turns to the year`,
        ),
      ),
    ),
  );
}

/**
 * Choosing a battle to fight on its own.
 *
 * The three kinds are not variations on one screen; they are the three
 * shapes a medieval fight took, and the game already simulates each of them
 * differently. A field battle is manoeuvre, an assault is a wall and the
 * price of going over it, and a fight at sea is closing and boarding.
 */
export function renderBattleSetup(host: HTMLElement, hooks: MenuHooks): void {
  clear(host);
  let chosen: BattleKind = 'field';

  const kinds: readonly { kind: BattleKind; title: string; text: string }[] = [
    {
      kind: 'field',
      title: 'A field battle',
      text:
        'France against the Empire on open farmland. Both sides in line, nothing ' +
        'between them, and the ground flat enough that the day turns on how the ' +
        'wings are handled.',
    },
    {
      kind: 'siege',
      title: 'An assault on a town',
      text:
        'An Imperial army storming a walled settlement. The garrison turns out ' +
        'behind its walls, and going over them costs what it historically cost.',
    },
    {
      kind: 'sea',
      title: 'A fight at sea',
      text:
        'A Venetian squadron and a Genoese one in the Adriatic. Galleys close, ' +
        'shoot, and board; what is in the hulls drowns with them.',
    },
  ];

  const cards = el('div', { class: 'setup-choices' });
  const begin = el('button', { class: 'primary', onClick: () => hooks.onCustomBattle(chosen) },
    'Fight it');

  for (const entry of kinds) {
    const card = el('button', {
      class: `setup-choice${entry.kind === chosen ? ' chosen' : ''}`,
      onClick: () => {
        chosen = entry.kind;
        cards.querySelectorAll('.setup-choice').forEach((other) => other.classList.remove('chosen'));
        card.classList.add('chosen');
      },
    },
      el('strong', {}, entry.title),
      el('span', { class: 'setup-choice-text' }, entry.text),
    );
    cards.appendChild(card);
  }

  host.appendChild(
    el('div', { class: 'menu-screen' },
      heraldry(),
      el('div', { class: 'setup-sheet' },
        el('div', { class: 'sheet-inner' },
          el('h1', {}, 'Custom battle'),
          el('p', { class: 'sheet-sub' },
            'The same simulation the campaign fights its battles with, on its own.',
          ),
          cards,
          el('div', { class: 'sheet-foot' },
            el('button', { onClick: () => renderMainMenu(host, hooks) }, 'Back'),
            begin,
          ),
        ),
      ),
    ),
  );
}
