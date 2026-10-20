/**
 * Arms.
 *
 * A realm on this map had a colour and nothing else, which is enough to tell
 * two borders apart and not nearly enough to tell two realms apart. Every one
 * of them had arms, and the arms are the thing a medieval army was actually
 * recognised by: the banner over the line, the shield on the arm, the device
 * on the gate.
 *
 * These are blazons, not pictures. A shield is a field, sometimes divided,
 * sometimes with an ordinary laid over it, and usually with a charge on it —
 * and that is all the information needed to draw one. Three dozen bytes a
 * realm, drawn by `src/render/arms.ts` at whatever size is asked for, which
 * is why there is no folder of seventy-three images anywhere in this repo.
 *
 * They are historical where history is clear — the Dannebrog, the Imperial
 * eagle, the lion of Saint Mark, the fleurs of France, the chequy of
 * Croatia — and plausible for a realm whose arms are not. Where two realms
 * really did bear almost the same thing, one of them is nudged, because a
 * player has to be able to tell them apart at sixteen pixels.
 */
import type { FactionId } from '../types';

export type Tincture = 'or' | 'argent' | 'gules' | 'azure' | 'vert' | 'sable' | 'purpure';

/** How the field is divided, when it is. */
export type Division = 'pale' | 'fess' | 'bend' | 'quarterly' | 'chief' | 'barry' | 'chequy' | 'paly';

/** A band laid across the field. */
export type Ordinary = 'cross' | 'saltire' | 'bend' | 'pale' | 'fess' | 'chevron' | 'bordure';

/** The beast or thing on it. */
export type Charge =
  | 'lion' | 'eagle' | 'fleur' | 'crescent' | 'star' | 'tower' | 'crosspatty'
  | 'crown' | 'sun' | 'sword' | 'horse' | 'key' | 'serpent' | 'harp' | 'trident' | 'bull';

export interface Arms {
  readonly field: Tincture;
  readonly division?: Division;
  readonly second?: Tincture;
  readonly ordinary?: Ordinary;
  readonly on?: Tincture;
  readonly charge?: Charge;
  readonly charged?: Tincture;
  /** Strewn over the field rather than one in the middle of it. */
  readonly seme?: boolean;
}

/** What each tincture is actually painted in. */
export const TINCTURES: Readonly<Record<Tincture, string>> = {
  or: '#d8a93a',
  argent: '#e7e3d7',
  gules: '#a52129',
  azure: '#26468f',
  vert: '#1d6b3c',
  sable: '#1e1b17',
  purpure: '#5e2a6e',
};

const ARMS: Readonly<Partial<Record<string, Arms>>> = {
  // ---------------- the Latin west ----------------
  england: { field: 'gules', charge: 'lion', charged: 'or', seme: true },
  france: { field: 'azure', charge: 'fleur', charged: 'or', seme: true },
  hre: { field: 'or', charge: 'eagle', charged: 'sable' },
  sicily: { field: 'azure', division: 'paly', second: 'or', charge: 'eagle', charged: 'sable' },
  papal_states: { field: 'gules', charge: 'key', charged: 'argent' },
  venice: { field: 'gules', charge: 'lion', charged: 'or' },
  genoa: { field: 'argent', ordinary: 'cross', on: 'gules' },
  pisa: { field: 'gules', ordinary: 'cross', on: 'argent' },
  milan: { field: 'argent', charge: 'serpent', charged: 'azure' },
  florence: { field: 'argent', charge: 'fleur', charged: 'gules' },
  castile: { field: 'gules', charge: 'tower', charged: 'or' },
  aragon: { field: 'or', division: 'paly', second: 'gules' },
  portugal: { field: 'argent', charge: 'crosspatty', charged: 'azure', seme: true },
  navarre: { field: 'gules', ordinary: 'saltire', on: 'or', charge: 'star', charged: 'vert' },
  burgundy: { field: 'or', division: 'bend', second: 'azure', ordinary: 'bordure', on: 'gules' },
  austria: { field: 'gules', ordinary: 'fess', on: 'argent' },
  switzerland: { field: 'gules', ordinary: 'cross', on: 'argent' },

  // ---------------- the north and the isles ----------------
  denmark: { field: 'gules', ordinary: 'cross', on: 'argent' },
  norway: { field: 'gules', charge: 'lion', charged: 'or' },
  sweden: { field: 'azure', ordinary: 'cross', on: 'or' },
  scotland: { field: 'or', charge: 'lion', charged: 'gules' },
  ireland: { field: 'azure', charge: 'harp', charged: 'or' },
  wales: { field: 'vert', division: 'fess', second: 'argent', charge: 'lion', charged: 'gules' },

  // ---------------- central europe ----------------
  poland: { field: 'gules', charge: 'eagle', charged: 'argent' },
  bohemia: { field: 'gules', charge: 'lion', charged: 'argent' },
  hungary: { field: 'argent', division: 'barry', second: 'gules' },
  croatia: { field: 'argent', division: 'chequy', second: 'gules' },
  lithuania: { field: 'gules', charge: 'horse', charged: 'argent' },
  teutonic_order: { field: 'argent', ordinary: 'cross', on: 'sable' },

  // ---------------- the Rus and the steppe ----------------
  kievan_rus: { field: 'azure', charge: 'trident', charged: 'or' },
  novgorod: { field: 'gules', charge: 'bull', charged: 'or' },
  muscovy: { field: 'gules', charge: 'sword', charged: 'or' },
  cumans: { field: 'sable', charge: 'horse', charged: 'or' },
  volga_bulgaria: { field: 'vert', charge: 'crescent', charged: 'or' },
  mongols: { field: 'sable', charge: 'sun', charged: 'or' },
  golden_horde: { field: 'azure', charge: 'sun', charged: 'argent' },
  timurids: { field: 'sable', charge: 'star', charged: 'or', seme: true },
  crimean_khanate: { field: 'vert', charge: 'star', charged: 'argent' },

  // ---------------- the Balkans and the Greek world ----------------
  serbia: { field: 'azure', charge: 'eagle', charged: 'argent' },
  bulgaria: { field: 'vert', charge: 'lion', charged: 'or' },
  bosnia: { field: 'azure', ordinary: 'bend', on: 'or' },
  wallachia: { field: 'azure', charge: 'eagle', charged: 'or' },
  ragusa: { field: 'azure', ordinary: 'fess', on: 'or' },
  albania: { field: 'gules', charge: 'eagle', charged: 'sable' },
  byzantium: { field: 'gules', ordinary: 'cross', on: 'or' },

  // ---------------- the Near East ----------------
  georgia: { field: 'or', ordinary: 'cross', on: 'gules' },
  armenia: { field: 'or', charge: 'lion', charged: 'gules' },
  trebizond: { field: 'or', charge: 'eagle', charged: 'gules' },
  jerusalem: { field: 'argent', ordinary: 'cross', on: 'or' },
  antioch: { field: 'gules', ordinary: 'pale', on: 'argent' },
  hospitallers: { field: 'gules', charge: 'crosspatty', charged: 'argent' },
  cyprus: { field: 'argent', charge: 'lion', charged: 'gules' },
  seljuks: { field: 'azure', charge: 'crescent', charged: 'or' },
  rum: { field: 'azure', charge: 'star', charged: 'or' },
  fatimids: { field: 'vert', charge: 'crescent', charged: 'argent' },
  abbasids: { field: 'sable', charge: 'crescent', charged: 'or' },
  ayyubids: { field: 'vert', charge: 'eagle', charged: 'or' },
  mamluks: { field: 'gules', charge: 'sword', charged: 'argent' },
  ottomans: { field: 'vert', charge: 'crescent', charged: 'or' },
  khwarazm: { field: 'azure', charge: 'sun', charged: 'or' },

  // ---------------- the Maghreb and al-Andalus ----------------
  almoravids: { field: 'or', charge: 'crescent', charged: 'sable' },
  almohads: { field: 'gules', charge: 'sun', charged: 'or' },
  granada: { field: 'argent', ordinary: 'bend', on: 'azure' },
  zirids: { field: 'azure', charge: 'crescent', charged: 'argent' },
  hafsids: { field: 'argent', charge: 'crescent', charged: 'sable' },
  marinids: { field: 'azure', division: 'chequy', second: 'or' },
  taifa_zaragoza: { field: 'argent', charge: 'crescent', charged: 'gules' },
  taifa_seville: { field: 'vert', charge: 'star', charged: 'argent' },

  // ---------------- Africa ----------------
  ghana: { field: 'or', charge: 'sun', charged: 'gules' },
  mali: { field: 'or', charge: 'lion', charged: 'sable' },
  kanem: { field: 'sable', charge: 'star', charged: 'or' },
  makuria: { field: 'argent', ordinary: 'cross', on: 'vert' },
  ethiopia: { field: 'vert', charge: 'lion', charged: 'or' },
};

const FIELDS: readonly Tincture[] = ['gules', 'azure', 'or', 'vert', 'sable', 'argent', 'purpure'];
const CHARGES: readonly Charge[] = [
  'lion', 'eagle', 'star', 'crescent', 'tower', 'crown', 'sun', 'fleur', 'crosspatty', 'bull',
];

/**
 * The arms of a realm.
 *
 * Everything on this map has a blazon above; the fallback is here because a
 * faction added later should get something of its own rather than a blank
 * shield, and because a fallback that is derived from the name is the same
 * every time rather than different on every reload.
 */
export function armsOf(id: FactionId): Arms {
  const known = ARMS[id as string];
  if (known) return known;
  let hash = 0;
  for (let i = 0; i < (id as string).length; i++) {
    hash = ((hash << 5) - hash + (id as string).charCodeAt(i)) | 0;
  }
  const pick = <T,>(list: readonly T[], salt: number): T =>
    list[Math.abs((hash >> salt) % list.length)]!;
  const field = pick(FIELDS, 0);
  const metal: Tincture = field === 'or' || field === 'argent' ? 'gules' : 'or';
  return { field, charge: pick(CHARGES, 5), charged: metal };
}
