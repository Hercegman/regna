/**
 * Which provinces border which.
 *
 * Each border is written once and symmetrised at load. `L` is a land border an
 * army can march across. `S` is a sea crossing: it needs ships, and a fleet can
 * be intercepted on it, which is what makes naval power matter.
 *
 * The data is authored geographically, walking the map from Britain eastwards,
 * so that a missing or wrong border is easy to spot by reading the block for
 * the area it belongs to.
 */
import type { RegionId } from '../types';
import { regionId } from '../types';

export type BorderKind = 'land' | 'sea';

export interface Border {
  readonly a: RegionId;
  readonly b: RegionId;
  readonly kind: BorderKind;
}

const L = (a: string, b: string): Border => ({ a: regionId(a), b: regionId(b), kind: 'land' });
const S = (a: string, b: string): Border => ({ a: regionId(a), b: regionId(b), kind: 'sea' });

export const BORDERS: readonly Border[] = [
  // ---------------- Britain and Ireland ----------------
  L('london', 'norwich'), L('london', 'york'), L('london', 'bristol'),
  L('york', 'chester'), L('york', 'edinburgh'), L('york', 'norwich'),
  L('bristol', 'chester'), L('bristol', 'cardiff'),
  L('chester', 'caernarfon'), L('chester', 'cardiff'),
  L('caernarfon', 'cardiff'),
  L('edinburgh', 'stirling'), L('stirling', 'inverness'),
  L('dublin', 'armagh'), L('dublin', 'galway'), L('dublin', 'cork'),
  L('galway', 'cork'), L('galway', 'armagh'),
  S('london', 'rouen'), S('london', 'bruges'),
  S('chester', 'dublin'), S('caernarfon', 'dublin'),
  S('bristol', 'cork'), S('cork', 'nantes'),
  S('armagh', 'edinburgh'), S('armagh', 'stirling'),
  S('inverness', 'bergen'), S('norwich', 'bremen'),

  // ---------------- Scandinavia ----------------
  L('aarhus', 'hamburg'), L('aarhus', 'oldenburg'),
  L('lund', 'skara'), L('lund', 'kalmar'),
  L('skara', 'sigtuna'), L('skara', 'oslo'), L('skara', 'kalmar'),
  L('sigtuna', 'kalmar'), L('sigtuna', 'oslo'),
  L('oslo', 'bergen'), L('oslo', 'trondheim'), L('bergen', 'trondheim'),
  L('turku', 'novgorod'), L('reval', 'pskov'), L('reval', 'novgorod'),
  S('roskilde', 'lund'), S('roskilde', 'aarhus'), S('roskilde', 'oldenburg'),
  S('roskilde', 'stettin'),
  S('sigtuna', 'turku'), S('sigtuna', 'visby'), S('kalmar', 'visby'),
  S('kalmar', 'gdansk'), S('visby', 'reval'), S('visby', 'semigallia'),
  S('turku', 'reval'),

  // ---------------- Low Countries and the Empire ----------------
  L('bruges', 'utrecht'), L('bruges', 'reims'), L('bruges', 'rouen'),
  L('utrecht', 'cologne'), L('utrecht', 'bremen'),
  L('cologne', 'mainz'), L('cologne', 'trier'), L('cologne', 'bremen'),
  L('mainz', 'trier'), L('mainz', 'strasbourg'), L('mainz', 'nuremberg'),
  L('mainz', 'erfurt'),
  L('trier', 'reims'), L('trier', 'strasbourg'),
  L('strasbourg', 'zurich'), L('strasbourg', 'augsburg'), L('strasbourg', 'besancon'),
  L('nuremberg', 'regensburg'), L('nuremberg', 'erfurt'), L('nuremberg', 'augsburg'),
  L('nuremberg', 'prague'),
  L('regensburg', 'augsburg'), L('regensburg', 'salzburg'), L('regensburg', 'prague'),
  L('regensburg', 'vienna'),
  L('augsburg', 'zurich'), L('augsburg', 'brixen'), L('augsburg', 'salzburg'),
  L('salzburg', 'brixen'), L('salzburg', 'vienna'),
  L('brixen', 'verona'), L('brixen', 'zurich'), L('brixen', 'milan'),
  L('zurich', 'schwyz'), L('zurich', 'besancon'),
  L('schwyz', 'brixen'), L('schwyz', 'milan'), L('schwyz', 'turin'),
  L('vienna', 'pozsony'), L('vienna', 'olomouc'),
  L('hamburg', 'bremen'), L('hamburg', 'magdeburg'), L('hamburg', 'oldenburg'),
  L('bremen', 'magdeburg'),
  L('magdeburg', 'erfurt'), L('magdeburg', 'brandenburg'), L('magdeburg', 'meissen'),
  L('meissen', 'prague'), L('meissen', 'erfurt'), L('meissen', 'brandenburg'),
  L('meissen', 'wroclaw'),
  L('oldenburg', 'brandenburg'), L('oldenburg', 'stettin'),
  L('brandenburg', 'stettin'), L('brandenburg', 'gniezno'),
  L('stettin', 'gdansk'), L('stettin', 'gniezno'),

  // ---------------- France ----------------
  L('paris', 'reims'), L('paris', 'orleans'), L('paris', 'rouen'), L('paris', 'dijon'),
  L('orleans', 'angers'), L('orleans', 'poitiers'), L('orleans', 'clermont'),
  L('orleans', 'dijon'),
  L('reims', 'dijon'),
  L('rouen', 'rennes'), L('rouen', 'angers'),
  L('rennes', 'nantes'), L('rennes', 'angers'),
  L('nantes', 'poitiers'), L('nantes', 'bordeaux'),
  L('angers', 'poitiers'),
  L('poitiers', 'bordeaux'), L('poitiers', 'clermont'),
  L('bordeaux', 'toulouse'), L('bordeaux', 'pamplona'),
  L('toulouse', 'clermont'), L('toulouse', 'marseille'), L('toulouse', 'barcelona'),
  L('toulouse', 'pamplona'), L('toulouse', 'jaca'),
  L('clermont', 'lyon'), L('clermont', 'dijon'),
  L('dijon', 'besancon'), L('dijon', 'lyon'),
  L('besancon', 'lyon'),
  L('lyon', 'marseille'), L('lyon', 'turin'),
  L('marseille', 'genoa'), L('marseille', 'turin'),
  S('marseille', 'barcelona'), S('marseille', 'ajaccio'), S('marseille', 'palma'),

  // ---------------- Iberia ----------------
  L('leon', 'burgos'), L('leon', 'santiago'), L('leon', 'porto'), L('leon', 'toledo'),
  L('burgos', 'pamplona'), L('burgos', 'toledo'), L('burgos', 'zaragoza'),
  L('santiago', 'porto'),
  L('porto', 'lisbon'), L('porto', 'badajoz'),
  L('lisbon', 'badajoz'), L('lisbon', 'seville'),
  L('badajoz', 'seville'), L('badajoz', 'toledo'), L('badajoz', 'cordoba'),
  L('toledo', 'cordoba'), L('toledo', 'valencia'), L('toledo', 'zaragoza'),
  L('seville', 'cordoba'), L('seville', 'malaga'),
  L('cordoba', 'granada'), L('cordoba', 'malaga'),
  L('granada', 'malaga'), L('granada', 'valencia'),
  L('valencia', 'zaragoza'), L('valencia', 'barcelona'),
  L('zaragoza', 'jaca'), L('zaragoza', 'barcelona'), L('zaragoza', 'pamplona'),
  L('jaca', 'pamplona'),
  S('malaga', 'ceuta'), S('malaga', 'tangier'),
  S('valencia', 'palma'), S('barcelona', 'palma'),
  S('palma', 'cagliari'), S('palma', 'algiers'),

  // ---------------- Italy ----------------
  L('milan', 'turin'), L('milan', 'genoa'), L('milan', 'verona'),
  L('turin', 'genoa'),
  L('genoa', 'pisa'),
  L('venice', 'verona'), L('venice', 'ravenna'),
  L('verona', 'bologna'), L('verona', 'ravenna'),
  L('bologna', 'ravenna'), L('bologna', 'florence'),
  L('ravenna', 'rome'),
  L('florence', 'pisa'), L('florence', 'siena'),
  L('pisa', 'siena'),
  L('siena', 'rome'),
  L('rome', 'naples'),
  L('naples', 'salerno'),
  L('salerno', 'bari'), L('salerno', 'taranto'),
  L('bari', 'taranto'),
  L('palermo', 'messina'), L('messina', 'syracuse'),
  S('genoa', 'ajaccio'), S('pisa', 'ajaccio'), S('pisa', 'cagliari'),
  S('venice', 'zadar'), S('venice', 'split'),
  S('bari', 'durres'), S('bari', 'dubrovnik'), S('bari', 'split'),
  S('taranto', 'messina'), S('taranto', 'corinth'),
  S('palermo', 'tunis'), S('palermo', 'cagliari'), S('palermo', 'mdina'),
  S('syracuse', 'mdina'), S('cagliari', 'ajaccio'), S('cagliari', 'tunis'),
  S('mdina', 'tripoli_libya'), S('mdina', 'mahdia'),

  // ---------------- Poland, Bohemia, the Baltic ----------------
  L('krakow', 'wroclaw'), L('krakow', 'olomouc'), L('krakow', 'plock'),
  L('krakow', 'galich'), L('krakow', 'pozsony'),
  L('gniezno', 'wroclaw'), L('gniezno', 'plock'), L('gniezno', 'gdansk'),
  L('wroclaw', 'olomouc'), L('wroclaw', 'prague'),
  L('plock', 'gdansk'), L('plock', 'prussia'), L('plock', 'vilnius'),
  L('gdansk', 'prussia'),
  L('prague', 'olomouc'),
  L('olomouc', 'pozsony'),
  L('prussia', 'vilnius'), L('prussia', 'semigallia'),
  L('semigallia', 'vilnius'), L('semigallia', 'reval'), L('semigallia', 'polotsk'),
  L('semigallia', 'pskov'),
  L('vilnius', 'polotsk'),

  // ---------------- Rus ----------------
  L('novgorod', 'pskov'), L('novgorod', 'smolensk'), L('novgorod', 'suzdal'),
  L('pskov', 'polotsk'),
  L('polotsk', 'smolensk'),
  L('smolensk', 'chernigov'), L('smolensk', 'moscow'),
  L('kiev', 'chernigov'), L('kiev', 'galich'), L('kiev', 'podolia'), L('kiev', 'donets'),
  L('chernigov', 'ryazan'), L('chernigov', 'donets'),
  L('galich', 'podolia'), L('galich', 'suceava'), L('galich', 'cluj'),
  L('suzdal', 'moscow'), L('suzdal', 'ryazan'), L('suzdal', 'bolghar'),
  L('ryazan', 'moscow'), L('ryazan', 'bolghar'),

  // ---------------- The steppe and the Black Sea ----------------
  L('podolia', 'suceava'), L('podolia', 'targoviste'), L('podolia', 'donets'),
  L('donets', 'azov'), L('donets', 'soldaia'),
  L('azov', 'soldaia'), L('azov', 'saksin'),
  L('soldaia', 'cherson'),
  L('saksin', 'bolghar'), L('saksin', 'derbent'),
  S('azov', 'cherson'), S('azov', 'trebizond'), S('azov', 'sinope'),
  S('soldaia', 'sinope'), S('soldaia', 'constantinople'), S('soldaia', 'varna'),
  S('cherson', 'constantinople'), S('cherson', 'varna'),

  // ---------------- Hungary and the Carpathians ----------------
  L('esztergom', 'pozsony'), L('esztergom', 'szekesfehervar'), L('esztergom', 'szeged'),
  L('esztergom', 'bihar'),
  L('szekesfehervar', 'pecs'), L('szekesfehervar', 'zagreb'), L('szekesfehervar', 'szeged'),
  L('pecs', 'zagreb'), L('pecs', 'szeged'), L('pecs', 'belgrade'),
  L('szeged', 'bihar'), L('szeged', 'belgrade'),
  L('bihar', 'cluj'),
  L('cluj', 'suceava'), L('cluj', 'targoviste'),

  // ---------------- Croatia, Bosnia, the Adriatic ----------------
  L('knin', 'zadar'), L('knin', 'split'), L('knin', 'zagreb'), L('knin', 'hum'),
  L('knin', 'vrhbosna'),
  L('zagreb', 'zadar'), L('zagreb', 'vrhbosna'), L('zagreb', 'belgrade'),
  L('split', 'hum'), L('split', 'zadar'), L('split', 'dubrovnik'),
  L('dubrovnik', 'hum'), L('dubrovnik', 'kotor'), L('dubrovnik', 'vrhbosna'),
  L('vrhbosna', 'hum'), L('vrhbosna', 'ras'), L('vrhbosna', 'belgrade'),
  L('hum', 'kotor'),
  L('kotor', 'ras'), L('kotor', 'kruje'), L('kotor', 'durres'),
  S('durres', 'dubrovnik'),

  // ---------------- Serbia, Bulgaria, the southern Balkans ----------------
  L('ras', 'nis'), L('ras', 'skopje'), L('ras', 'belgrade'),
  L('belgrade', 'nis'), L('belgrade', 'vidin'),
  L('nis', 'sredets'), L('nis', 'skopje'), L('nis', 'vidin'),
  L('skopje', 'ohrid'), L('skopje', 'sredets'), L('skopje', 'thessaloniki'),
  L('ohrid', 'kruje'), L('ohrid', 'ioannina'), L('ohrid', 'thessaloniki'),
  L('ohrid', 'durres'),
  L('sredets', 'tarnovo'), L('sredets', 'vidin'), L('sredets', 'adrianople'),
  L('sredets', 'thessaloniki'),
  L('tarnovo', 'varna'), L('tarnovo', 'vidin'), L('tarnovo', 'targoviste'),
  L('tarnovo', 'adrianople'),
  L('vidin', 'targoviste'),
  L('varna', 'adrianople'), L('varna', 'constantinople'),
  L('durres', 'kruje'), L('durres', 'ioannina'),
  L('kruje', 'ioannina'),
  L('targoviste', 'suceava'),

  // ---------------- Greece and the Aegean ----------------
  L('thessaloniki', 'larissa'), L('thessaloniki', 'adrianople'),
  L('larissa', 'ioannina'), L('larissa', 'athens'), L('larissa', 'corinth'),
  L('ioannina', 'corinth'),
  L('athens', 'corinth'),
  S('athens', 'smyrna'), S('athens', 'rhodes'), S('athens', 'candia'),
  S('corinth', 'candia'),
  S('candia', 'rhodes'), S('candia', 'alexandria'),
  S('rhodes', 'smyrna'), S('rhodes', 'attaleia'), S('rhodes', 'nicosia'),

  // ---------------- Anatolia ----------------
  L('constantinople', 'adrianople'),
  L('nicaea', 'ankyra'), L('nicaea', 'smyrna'), L('nicaea', 'sinope'),
  L('smyrna', 'attaleia'), L('smyrna', 'konya'),
  L('attaleia', 'konya'), L('attaleia', 'tarsus'),
  L('konya', 'ankyra'), L('konya', 'kayseri'), L('konya', 'tarsus'),
  L('ankyra', 'kayseri'), L('ankyra', 'sinope'), L('ankyra', 'sebasteia'),
  L('kayseri', 'sebasteia'), L('kayseri', 'sis'), L('kayseri', 'melitene'),
  L('sebasteia', 'trebizond'), L('sebasteia', 'melitene'), L('sebasteia', 'erzurum'),
  L('sinope', 'trebizond'),
  L('trebizond', 'erzurum'), L('trebizond', 'kutaisi'),
  L('tarsus', 'sis'), L('tarsus', 'antioch'),
  L('sis', 'melitene'), L('sis', 'antioch'),
  L('melitene', 'edessa'), L('melitene', 'erzurum'),
  L('erzurum', 'ani'), L('erzurum', 'tbilisi'),
  S('constantinople', 'nicaea'),
  S('tarsus', 'nicosia'), S('antioch', 'nicosia'),

  // ---------------- Caucasus ----------------
  L('kutaisi', 'tbilisi'), L('kutaisi', 'ani'),
  L('tbilisi', 'ani'), L('tbilisi', 'derbent'),

  // ---------------- Levant and Mesopotamia ----------------
  L('antioch', 'aleppo'),
  L('aleppo', 'edessa'), L('aleppo', 'homs'), L('aleppo', 'mosul'),
  L('edessa', 'mosul'),
  L('mosul', 'baghdad'),
  L('homs', 'damascus'), L('homs', 'tripoli_syria'),
  L('damascus', 'jerusalem'), L('damascus', 'tyre'), L('damascus', 'baghdad'),
  L('tripoli_syria', 'tyre'),
  L('tyre', 'acre'),
  L('acre', 'jerusalem'), L('acre', 'ascalon'),
  L('jerusalem', 'ascalon'),
  L('ascalon', 'damietta'), L('ascalon', 'cairo'),
  L('baghdad', 'basra'),
  S('tripoli_syria', 'nicosia'), S('acre', 'nicosia'),

  // ---------------- Egypt, Nubia, the Horn ----------------
  L('cairo', 'alexandria'), L('cairo', 'damietta'), L('cairo', 'aswan'),
  L('alexandria', 'damietta'), L('alexandria', 'tripoli_libya'),
  L('aswan', 'dongola'),
  L('dongola', 'soba'),
  L('soba', 'adefa'), L('soba', 'njimi'),
  L('adefa', 'zeila'),

  // ---------------- Maghreb ----------------
  L('tripoli_libya', 'mahdia'), L('tripoli_libya', 'njimi'),
  L('mahdia', 'tunis'),
  L('tunis', 'bejaia'),
  L('bejaia', 'algiers'),
  L('algiers', 'tlemcen'),
  L('tlemcen', 'fez'), L('tlemcen', 'sijilmasa'),
  L('fez', 'tangier'), L('fez', 'ceuta'), L('fez', 'marrakesh'), L('fez', 'sijilmasa'),
  L('tangier', 'ceuta'),
  L('marrakesh', 'sijilmasa'), L('marrakesh', 'taghaza'),
  L('sijilmasa', 'taghaza'),

  // ---------------- Sahel ----------------
  L('taghaza', 'walata'), L('taghaza', 'timbuktu'),
  L('walata', 'koumbi'), L('walata', 'timbuktu'),
  L('koumbi', 'niani'), L('koumbi', 'timbuktu'),
  L('niani', 'timbuktu'),
  L('timbuktu', 'gao'),
  L('gao', 'njimi'),
];

/** region -> its neighbours, symmetrised and deduplicated. */
export type AdjacencyMap = ReadonlyMap<RegionId, readonly Border[]>;

function buildAdjacency(): AdjacencyMap {
  const map = new Map<RegionId, Border[]>();
  const seen = new Set<string>();
  const add = (from: RegionId, border: Border): void => {
    const list = map.get(from);
    if (list) list.push(border);
    else map.set(from, [border]);
  };
  for (const border of BORDERS) {
    if (border.a === border.b) throw new Error(`Self border on ${border.a}`);
    const key = border.a < border.b ? `${border.a}|${border.b}` : `${border.b}|${border.a}`;
    if (seen.has(key)) throw new Error(`Duplicate border ${key}`);
    seen.add(key);
    add(border.a, border);
    add(border.b, { a: border.b, b: border.a, kind: border.kind });
  }
  return map;
}

export const ADJACENCY: AdjacencyMap = buildAdjacency();

/** Neighbours of a region, of either kind. */
export function neighbours(id: RegionId): readonly Border[] {
  return ADJACENCY.get(id) ?? [];
}

/** Neighbours reachable without ships. */
export function landNeighbours(id: RegionId): readonly RegionId[] {
  return neighbours(id)
    .filter((border) => border.kind === 'land')
    .map((border) => border.b);
}

/** Neighbours reachable only by sea. */
export function seaNeighbours(id: RegionId): readonly RegionId[] {
  return neighbours(id)
    .filter((border) => border.kind === 'sea')
    .map((border) => border.b);
}

/** The border between two regions, if they are adjacent at all. */
export function borderBetween(a: RegionId, b: RegionId): Border | undefined {
  return neighbours(a).find((border) => border.b === b);
}
