/**
 * Holy war: what the great faiths considered worth fighting for, and who could
 * call for it.
 *
 * A crusade and a jihad are the same mechanism seen from two sides, so they
 * share one table. A sacred place is a province that one faith holds to be its
 * own; when somebody else holds it, the authority of that faith can call its
 * followers to take it back.
 */
import type { FactionId, RegionId, Religion } from '../types';
import { factionId, regionId } from '../types';

/** The faiths that can call a holy war, and in which order authority passes. */
export const HOLY_AUTHORITY: Readonly<Record<'christian' | 'muslim', readonly FactionId[]>> = {
  // The pope first; if Rome falls, the senior crowned defender of the faith.
  christian: ['papal_states', 'byzantium', 'hre', 'france'].map(factionId),
  // The caliph at Baghdad, and after him whoever claims the caliphate.
  muslim: ['abbasids', 'fatimids', 'mamluks', 'ottomans', 'almohads', 'seljuks'].map(factionId),
};

export interface SacredPlace {
  readonly region: RegionId;
  /** The faith that holds this place to be its own. */
  readonly faith: 'christian' | 'muslim';
  /** How badly that faith wants it. Jerusalem is the measure of everything. */
  readonly weight: number;
  /** The year before which nobody would have marched for it. */
  readonly fromYear?: number;
  readonly reason: string;
}

const p = (place: Omit<SacredPlace, 'region'> & { region: string }): SacredPlace => ({
  ...place,
  region: regionId(place.region),
});

/**
 * Places worth a holy war. Several appear twice, once for each faith, because
 * both of them meant it.
 */
export const SACRED_PLACES: readonly SacredPlace[] = [
  // ---------------- Christendom ----------------
  p({
    region: 'jerusalem', faith: 'christian', weight: 100, fromYear: 1095,
    reason: 'The Holy Sepulchre. Every crusade is measured against whether it reached it.',
  }),
  p({
    region: 'acre', faith: 'christian', weight: 62, fromYear: 1095,
    reason: 'The port the Holy Land is reached and supplied through; without it no army stays.',
  }),
  p({
    region: 'antioch', faith: 'christian', weight: 58, fromYear: 1095,
    reason: 'One of the five ancient patriarchates, and the gate from Anatolia into Syria.',
  }),
  p({
    region: 'edessa', faith: 'christian', weight: 48, fromYear: 1144,
    reason: 'Its loss in 1144 is what the Second Crusade was preached to undo.',
  }),
  p({
    region: 'tarsus', faith: 'christian', weight: 36, fromYear: 1095,
    reason: 'Cilicia, the road an army from the north must take to reach Syria at all.',
  }),
  p({
    region: 'constantinople', faith: 'christian', weight: 70,
    reason: 'The second Rome. Christendom does not agree on much, but not on losing this.',
  }),
  p({
    region: 'alexandria', faith: 'christian', weight: 44, fromYear: 1190,
    reason: 'The later crusades aimed at Egypt, on the reasoning that Jerusalem is held from Cairo.',
  }),
  p({
    region: 'cairo', faith: 'christian', weight: 40, fromYear: 1190,
    reason: 'Damietta and Mansurah were fought for twice on exactly this argument.',
  }),
  p({
    region: 'toledo', faith: 'christian', weight: 46,
    reason: 'The primatial see of Spain, and the first great prize of the Reconquista.',
  }),
  p({
    region: 'cordoba', faith: 'christian', weight: 42,
    reason: 'The caliphal capital of al-Andalus, taken in 1236 and never given back.',
  }),
  p({
    region: 'seville', faith: 'christian', weight: 40,
    reason: 'The richest city of Muslim Spain, and the one that made the Reconquista pay.',
  }),
  p({
    region: 'granada', faith: 'christian', weight: 52, fromYear: 1238,
    reason: 'The last emirate in Iberia. The war against it is a crusade in all but name.',
  }),
  p({
    region: 'valencia', faith: 'christian', weight: 34,
    reason: 'El Cid held it and lost it; Aragon took it back in 1238 with a crusade bull.',
  }),
  p({
    region: 'tunis', faith: 'christian', weight: 32, fromYear: 1270,
    reason: 'Louis IX died outside its walls on a crusade nobody has ever satisfactorily explained.',
  }),
  p({
    region: 'mahdia', faith: 'christian', weight: 26, fromYear: 1087,
    reason: 'The Pisan and Genoese raid of 1087 is the rehearsal for everything that follows.',
  }),
  p({
    region: 'vilnius', faith: 'christian', weight: 30, fromYear: 1200,
    reason: 'The northern crusade against the last pagans in Europe, preached for two centuries.',
  }),
  p({
    region: 'prussia', faith: 'christian', weight: 28, fromYear: 1200,
    reason: 'Preached as a crusade and conducted as a conquest, which is how the Order got a state.',
  }),

  // ---------------- Islam ----------------
  p({
    region: 'jerusalem', faith: 'muslim', weight: 96,
    reason: 'Al-Quds, the third holy place and the furthest mosque. Saladin took it back in 1187.',
  }),
  p({
    region: 'acre', faith: 'muslim', weight: 58,
    reason: 'The Frankish capital after Jerusalem fell, and the last of Outremer to go, in 1291.',
  }),
  p({
    region: 'antioch', faith: 'muslim', weight: 52,
    reason: 'Held by the Franks for a hundred and seventy years and recovered by Baybars.',
  }),
  p({
    region: 'damascus', faith: 'muslim', weight: 66,
    reason: 'The Umayyad capital and the first great city of Syria. A crusade besieged it once.',
  }),
  p({
    region: 'aleppo', faith: 'muslim', weight: 48,
    reason: 'The hinge between Anatolia and Syria, and the base every Muslim counterattack used.',
  }),
  p({
    region: 'cairo', faith: 'muslim', weight: 72,
    reason: 'The seat of the caliphate and then of the sultanate; the Nile pays for the war.',
  }),
  p({
    region: 'alexandria', faith: 'muslim', weight: 50,
    reason: 'Sacked by Peter of Cyprus in 1365, which Egypt neither forgot nor forgave.',
  }),
  p({
    region: 'baghdad', faith: 'muslim', weight: 78,
    reason: 'The house of the caliph. Its sack in 1258 is the end of an age.',
  }),
  p({
    region: 'cordoba', faith: 'muslim', weight: 58,
    reason: 'The caliphal capital of the west, and the loss that made al-Andalus unrecoverable.',
  }),
  p({
    region: 'seville', faith: 'muslim', weight: 52,
    reason: 'Taken in 1248 after a siege of sixteen months, and the end of Muslim Andalusia as a power.',
  }),
  p({
    region: 'granada', faith: 'muslim', weight: 60, fromYear: 1238,
    reason: 'The last refuge of Islam in Iberia, defended for two and a half centuries.',
  }),
  p({
    region: 'toledo', faith: 'muslim', weight: 46,
    reason: 'Lost in 1085, and the shock that brought the Almoravids across the Strait.',
  }),
  p({
    region: 'valencia', faith: 'muslim', weight: 36,
    reason: 'Taken by El Cid and recovered after his death, then lost for good in 1238.',
  }),
  p({
    region: 'nicaea', faith: 'muslim', weight: 34,
    reason: 'The first Seljuk capital in Anatolia, and the first city the First Crusade took.',
  }),
  p({
    region: 'constantinople', faith: 'muslim', weight: 74, fromYear: 1300,
    reason: 'A prophecy of the Prophet promised it, and seven sieges failed before the eighth.',
  }),
  p({
    region: 'tunis', faith: 'muslim', weight: 30,
    reason: 'Ifriqiya, raided from Sicily and Italy for two centuries and held against all of it.',
  }),
];

/** Which faiths claim a province, if any. */
export function claimsOn(region: RegionId): readonly SacredPlace[] {
  return SACRED_PLACES.filter((place) => place.region === region);
}

/** The places one faith claims, in the given year. */
export function sacredTo(
  faith: 'christian' | 'muslim',
  year: number,
): readonly SacredPlace[] {
  return SACRED_PLACES.filter(
    (place) => place.faith === faith && year >= (place.fromYear ?? -Infinity),
  );
}

/** The religions that count as belonging to a holy-war faith. */
export function belongsTo(religion: Religion, faith: 'christian' | 'muslim'): boolean {
  if (faith === 'christian') {
    return religion === 'catholic' || religion === 'orthodox' || religion === 'miaphysite';
  }
  return religion === 'sunni' || religion === 'shia';
}
