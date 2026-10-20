/**
 * Choosing a realm.
 *
 * All 73 factions are offered, grouped by region, with the year each enters
 * play. Factions that do not exist in 1080 are shown but cannot be chosen for
 * a campaign that starts there, which is the honest way to present a roster
 * that spans four and a half centuries.
 *
 * It is laid out as a sheet of parchment rather than as a settings dialogue,
 * which is the same argument as everywhere else in this interface: the game
 * is about a map and a chronicle, and a page of one is a better place to
 * pick a realm out of than a form.
 */
import type { Faction } from '../core/data/factions';
import { FACTIONS } from '../core/data/factions';
import type { Culture, FactionId } from '../core/types';
import { clear, el } from './dom';
import { crest } from './hud';

const GROUPS: readonly { readonly title: string; readonly cultures: readonly Culture[] }[] = [
  { title: 'Latin West', cultures: ['latin_west'] },
  { title: 'The North', cultures: ['nordic'] },
  { title: 'The Celtic Fringe', cultures: ['celtic'] },
  { title: 'Central Europe', cultures: ['slavic_west'] },
  { title: 'The Rus', cultures: ['slavic_east'] },
  { title: 'The Balkans', cultures: ['balkan'] },
  { title: 'The Greek World', cultures: ['hellenic'] },
  { title: 'The Near East', cultures: ['levantine'] },
  { title: 'The Maghreb and al-Andalus', cultures: ['maghrebi'] },
  { title: 'The Steppe', cultures: ['steppe'] },
  { title: 'Africa', cultures: ['sahelian'] },
];

export interface SelectOptions {
  /** Shown as a "continue" button when a stored campaign exists. */
  readonly resume?: { readonly label: string; readonly onResume: () => void };
  /** Loads a campaign from a file the player chooses. */
  readonly onImport?: () => void;
  /** Back to the front of the game. */
  readonly onBack?: () => void;
  /** The shield wall the sheet is laid on, shared with the menu. */
  readonly backdrop?: () => HTMLElement;
}

export function renderFactionSelect(
  host: HTMLElement,
  startYear: number,
  onChoose: (id: FactionId) => void,
  options: SelectOptions = {},
): void {
  clear(host);
  let selected: Faction | undefined;

  const detail = el('div', { class: 'faction-detail' });
  const startButton = el(
    'button',
    { class: 'primary', disabled: true, onClick: () => selected && onChoose(selected.id) },
    'Begin the campaign',
  );

  const showDetail = (faction: Faction): void => {
    selected = faction;
    startButton.disabled = faction.appearsIn > startYear;
    clear(detail);
    const traits = Object.entries(faction.traits).map(([key, value]) => {
      const label = key.replace(/([A-Z])/g, ' $1').toLowerCase();
      const shown =
        key === 'stipend'
          ? `+${value} florins per turn`
          : key === 'diplomacy' || key === 'order'
            ? `${value > 0 ? '+' : ''}${value}`
            : `${value > 0 ? '+' : ''}${Math.round((value as number) * 100)}%`;
      return el('li', {}, `${label}: ${shown}`);
    });
    detail.appendChild(
      el('div', { class: 'faction-detail-inner' },
        el('h2', {}, crest(faction.colour, faction.name, faction.id), ' ', faction.name),
        el('p', { class: 'faction-meta' },
          `${faction.culture.replace(/_/g, ' ')} · ${faction.religion}` +
            (faction.appearsIn > startYear ? ` · enters play in ${faction.appearsIn}` : ''),
        ),
        el('p', { class: 'faction-text' }, faction.description),
        traits.length > 0 && el('h3', {}, 'National character'),
        traits.length > 0 && el('ul', { class: 'traits' }, ...traits),
        faction.appearsIn > startYear &&
          el('p', { class: 'warning' },
            `${faction.name} did not exist in ${startYear}. It can be fought, but not played, ` +
              `in a campaign beginning then.`,
          ),
      ),
    );
  };

  const list = el('div', { class: 'faction-list' });
  for (const group of GROUPS) {
    const members = FACTIONS.filter((faction) => group.cultures.includes(faction.culture));
    if (members.length === 0) continue;
    list.appendChild(el('h3', { class: 'group-title' }, group.title));
    const grid = el('div', { class: 'faction-grid' });
    for (const faction of [...members].sort((a, b) => a.appearsIn - b.appearsIn || a.name.localeCompare(b.name))) {
      const available = faction.appearsIn <= startYear;
      const button = el(
        'button',
        {
          class: `faction-chip${available ? '' : ' unavailable'}`,
          title: available ? faction.name : `${faction.name} — from ${faction.appearsIn}`,
          onClick: () => {
            grid.querySelectorAll('.faction-chip').forEach((other) => other.classList.remove('chosen'));
            button.classList.add('chosen');
            showDetail(faction);
          },
        },
        crest(faction.colour, faction.name, faction.id),
        el('span', { class: 'chip-name' }, faction.name),
        !available && el('span', { class: 'chip-year' }, String(faction.appearsIn)),
      );
      grid.appendChild(button);
    }
    list.appendChild(grid);
  }

  host.appendChild(
    el('div', { class: 'menu-screen' },
      options.backdrop ? options.backdrop() : el('div', { class: 'menu-heraldry' }),
      el('div', { class: 'setup-sheet wide' },
        el('div', { class: 'sheet-inner' },
          el('header', { class: 'select-header' },
            el('h1', {}, 'Choose a realm'),
            el('p', { class: 'sheet-sub' },
              `${FACTIONS.length} historical powers, ${startYear} to 1530. ` +
              'Every one of them held the ground it starts on.',
            ),
          ),
          el('div', { class: 'select-body' }, list, detail),
          el('footer', { class: 'sheet-foot' },
            options.onBack && el('button', { onClick: options.onBack }, 'Back'),
            options.onImport && el('button', { onClick: options.onImport }, 'Load a file'),
            options.resume && el('button', { onClick: options.resume.onResume },
              options.resume.label,
            ),
            startButton,
          ),
        ),
      ),
    ),
  );

  const first = FACTIONS.find((faction) => faction.id === ('croatia' as FactionId)) ?? FACTIONS[0]!;
  showDetail(first);
}
