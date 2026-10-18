/**
 * Faction roster.
 *
 * Setting: Europe, the Mediterranean and the Near East, campaign start 1080.
 * Every polity listed here is a real historical state. Those that did not yet
 * exist in 1080 carry an `appearsIn` year and enter play through the emergence
 * system rather than starting on the map, so the campaign timeline stays
 * honest: the Teutonic Order cannot be fought in 1080.
 *
 * `traits` are small, readable modifiers rather than hard-coded special cases,
 * so balance work means editing numbers in this file and nothing else.
 */
import type { Culture, FactionId, Religion } from '../types';
import { factionId } from '../types';

/** National modifiers. All are fractions unless the name says otherwise. */
export interface FactionTraits {
  /** Multiplier on farm and tax income. */
  readonly economy?: number;
  /** Multiplier on trade income; maritime republics live on this. */
  readonly trade?: number;
  /** Discount on unit recruitment cost. */
  readonly recruitCost?: number;
  /** Discount on unit upkeep; nomads and orders field cheap armies. */
  readonly upkeep?: number;
  /** Bonus to army movement range on the campaign map. */
  readonly movement?: number;
  /** Public order bonus in owned regions. */
  readonly order?: number;
  /** Religious conversion pressure bonus. */
  readonly conversion?: number;
  /** Bonus to starting attitude in diplomacy. */
  readonly diplomacy?: number;
  /** Bonus to siege assault strength. */
  readonly siege?: number;
  /** Bonus to defence when fighting inside own territory. */
  readonly homeDefence?: number;
  /** Population growth bonus. */
  readonly growth?: number;
  /** Extra florins per turn from tribute, tolls or plunder. */
  readonly stipend?: number;
}

export interface Faction {
  readonly id: FactionId;
  /** Formal name shown in menus. */
  readonly name: string;
  /** Adjective for unit and army names: "Croatian levy". */
  readonly adjective: string;
  readonly culture: Culture;
  readonly religion: Religion;
  /** Map and banner colours as hex. */
  readonly colour: string;
  readonly colourDark: string;
  /** Year the faction enters play; 1080 means it starts on the map. */
  readonly appearsIn: number;
  /** Year after which the faction can no longer emerge or survive unchanged. */
  readonly fadesIn?: number;
  /** Can the player choose it. Short-lived spawns are AI-only. */
  readonly playable: boolean;
  /** Extra unit pools this faction draws on besides its culture pool. */
  readonly rosterTags: readonly string[];
  readonly traits: FactionTraits;
  readonly description: string;
}

/** The rebel/independent "faction" that owns unclaimed settlements. */
export const INDEPENDENT_ID = factionId('independent');

const f = (faction: Omit<Faction, 'id'> & { id: string }): Faction => ({
  ...faction,
  id: factionId(faction.id),
});

export const FACTIONS: readonly Faction[] = [
  // -------------------------------------------------------------------------
  // Latin West
  // -------------------------------------------------------------------------
  f({
    id: 'england', name: 'Kingdom of England', adjective: 'English',
    culture: 'latin_west', religion: 'catholic',
    colour: '#b4302a', colourDark: '#7a1d19', appearsIn: 1080, playable: true,
    rosterTags: ['anglo_norman', 'longbow'],
    traits: { economy: 0.1, order: 1, homeDefence: 0.1 },
    description:
      'Norman conquerors ruling an Anglo-Saxon kingdom. Strong royal administration, ' +
      'a feudal levy that matures into the finest longbowmen in Christendom, and a ' +
      'permanent quarrel with France over Continental lands.',
  }),
  f({
    id: 'france', name: 'Kingdom of France', adjective: 'French',
    culture: 'latin_west', religion: 'catholic',
    colour: '#2f5fb4', colourDark: '#1d3b73', appearsIn: 1080, playable: true,
    rosterTags: ['feudal_french', 'chivalry'],
    traits: { recruitCost: 0.05, growth: 0.1, diplomacy: 5 },
    description:
      'The Capetian realm: a small royal domain surrounded by over-mighty vassals. ' +
      'Its wealth of knights makes French heavy cavalry the benchmark of the age, ' +
      'if the crown can first master its own dukes.',
  }),
  f({
    id: 'hre', name: 'Holy Roman Empire', adjective: 'Imperial',
    culture: 'latin_west', religion: 'catholic',
    colour: '#d8c25a', colourDark: '#8f7c22', appearsIn: 1080, playable: true,
    rosterTags: ['german', 'imperial'],
    traits: { economy: 0.1, order: -1, siege: 0.1 },
    description:
      'An elective empire of princes, bishops and free cities stretching from the ' +
      'North Sea to Tuscany. Enormous resources, chronic internal division, and an ' +
      'unresolved war with the Papacy over who appoints bishops.',
  }),
  f({
    id: 'sicily', name: 'Kingdom of Sicily', adjective: 'Sicilian',
    culture: 'latin_west', religion: 'catholic',
    colour: '#4d9e68', colourDark: '#2d6240', appearsIn: 1080, playable: true,
    rosterTags: ['norman', 'mediterranean'],
    traits: { trade: 0.15, movement: 0.1, recruitCost: 0.05 },
    description:
      'The Hauteville Normans, mercenaries who made themselves kings over Greeks, ' +
      'Lombards and Arabs. A trilingual court, a powerful fleet, and ambitions on ' +
      'both the Byzantine and African shores.',
  }),
  f({
    id: 'papal_states', name: 'Papal States', adjective: 'Papal',
    culture: 'latin_west', religion: 'catholic',
    colour: '#e8e4d8', colourDark: '#9c968a', appearsIn: 1080, playable: true,
    rosterTags: ['italian', 'papal'],
    traits: { conversion: 0.5, diplomacy: 15, economy: 0.1, upkeep: -0.1 },
    description:
      'Temporal lands of the Roman pontiff, and the only power that can call a ' +
      'crusade or excommunicate a king. Militarily weak, diplomatically unmatched: ' +
      'the Pope wins wars by making other men fight them.',
  }),
  f({
    id: 'venice', name: 'Republic of Venice', adjective: 'Venetian',
    culture: 'latin_west', religion: 'catholic',
    colour: '#8f2f6b', colourDark: '#5c1c44', appearsIn: 1080, playable: true,
    rosterTags: ['italian', 'maritime'],
    traits: { trade: 0.35, economy: 0.05, upkeep: 0.05, movement: 0.15 },
    description:
      'The Most Serene Republic, a city of merchants with no land and no peasantry. ' +
      'Venice buys armies and builds fleets, trades with Christian and Muslim alike, ' +
      'and treats the eastern Mediterranean as its own lagoon.',
  }),
  f({
    id: 'genoa', name: 'Republic of Genoa', adjective: 'Genoese',
    culture: 'latin_west', religion: 'catholic',
    colour: '#c7442f', colourDark: '#80291b', appearsIn: 1080, playable: true,
    rosterTags: ['italian', 'maritime', 'crossbow'],
    traits: { trade: 0.3, movement: 0.15, recruitCost: 0.05 },
    description:
      'La Superba: Venice\'s bitter rival for the sea lanes. Genoese crossbowmen are ' +
      'hired by every crown in Europe, and Genoese colonies run from Corsica to the ' +
      'Black Sea grain ports.',
  }),
  f({
    id: 'pisa', name: 'Republic of Pisa', adjective: 'Pisan',
    culture: 'latin_west', religion: 'catholic',
    colour: '#d8d2c0', colourDark: '#8a8470', appearsIn: 1080, fadesIn: 1406, playable: true,
    rosterTags: ['italian', 'maritime'],
    traits: { trade: 0.25, siege: 0.05 },
    description:
      'At its height in 1080: a maritime republic that cleared Muslim fleets from the ' +
      'Tyrrhenian Sea and took Sardinia and the Balearics. Its decline is not yet ' +
      'written, but Genoa is already building rival galleys.',
  }),
  f({
    id: 'milan', name: 'Duchy of Milan', adjective: 'Milanese',
    culture: 'latin_west', religion: 'catholic',
    colour: '#4f7f4a', colourDark: '#31512e', appearsIn: 1080, playable: true,
    rosterTags: ['italian', 'lombard'],
    traits: { economy: 0.15, recruitCost: 0.1, order: 1 },
    description:
      'The richest city of Lombardy and the natural leader of the communes against ' +
      'imperial authority. Milanese armourers equip half the knights of Europe, and ' +
      'Milanese militia defend walls few armies can crack.',
  }),
  f({
    id: 'florence', name: 'Republic of Florence', adjective: 'Florentine',
    culture: 'latin_west', religion: 'catholic',
    colour: '#9c3f7a', colourDark: '#64264d', appearsIn: 1115, playable: true,
    rosterTags: ['italian', 'lombard'],
    traits: { economy: 0.2, trade: 0.2, upkeep: 0.1 },
    description:
      'A banking republic that turns wool into cloth and cloth into gold, then lends ' +
      'the gold to kings. Florence prefers to pay condottieri rather than bleed its ' +
      'own citizens, which works until the bill arrives.',
  }),
  f({
    id: 'castile', name: 'Kingdom of Castile and Leon', adjective: 'Castilian',
    culture: 'latin_west', religion: 'catholic',
    colour: '#c9a227', colourDark: '#836718', appearsIn: 1080, playable: true,
    rosterTags: ['iberian', 'reconquista'],
    traits: { siege: 0.1, movement: 0.1, conversion: 0.3 },
    description:
      'The spearhead of the Reconquista under Alfonso VI, taking tribute from the ' +
      'taifa emirs and Toledo itself. Castilian warfare mixes heavy knights with ' +
      'light jinete raiders learned from the enemy.',
  }),
  f({
    id: 'aragon', name: 'Kingdom of Aragon', adjective: 'Aragonese',
    culture: 'latin_west', religion: 'catholic',
    colour: '#d4762a', colourDark: '#8a4a19', appearsIn: 1080, playable: true,
    rosterTags: ['iberian', 'maritime', 'reconquista'],
    traits: { trade: 0.15, movement: 0.1, homeDefence: 0.1 },
    description:
      'A Pyrenean kingdom that will become a Mediterranean empire. Aragon pushes down ' +
      'the Ebro against the taifas while its Catalan subjects look seaward towards ' +
      'Sardinia, Sicily and Athens.',
  }),
  f({
    id: 'portugal', name: 'Kingdom of Portugal', adjective: 'Portuguese',
    culture: 'latin_west', religion: 'catholic',
    colour: '#2f7f5f', colourDark: '#1c5039', appearsIn: 1139, playable: true,
    rosterTags: ['iberian', 'maritime', 'reconquista'],
    traits: { trade: 0.2, movement: 0.15, recruitCost: 0.05 },
    description:
      'Born as a rebellious county on the Atlantic edge of Christendom. Portugal ' +
      'fights the Moors at home and then keeps sailing south, trading the Reconquista ' +
      'for the ocean.',
  }),
  f({
    id: 'navarre', name: 'Kingdom of Navarre', adjective: 'Navarrese',
    culture: 'latin_west', religion: 'catholic',
    colour: '#a6243c', colourDark: '#6b1726', appearsIn: 1080, playable: true,
    rosterTags: ['iberian', 'mountain'],
    traits: { homeDefence: 0.2, diplomacy: 5, upkeep: -0.05 },
    description:
      'A small Basque kingdom wedged between Castile, Aragon and France, surviving by ' +
      'playing its neighbours against one another. Its mountain infantry hold passes ' +
      'that larger armies cannot force.',
  }),
  f({
    id: 'burgundy', name: 'Duchy of Burgundy', adjective: 'Burgundian',
    culture: 'latin_west', religion: 'catholic',
    colour: '#5a3f8f', colourDark: '#3a2860', appearsIn: 1363, playable: true,
    rosterTags: ['feudal_french', 'german', 'chivalry'],
    traits: { economy: 0.2, recruitCost: 0.1, diplomacy: -5 },
    description:
      'The Valois dukes who assembled Flanders, Brabant and the Burgundies into the ' +
      'wealthiest state in Europe without ever acquiring a crown. Gorgeous courts, ' +
      'modern artillery, and a fatal appetite for Swiss pikemen.',
  }),
  f({
    id: 'austria', name: 'Duchy of Austria', adjective: 'Austrian',
    culture: 'latin_west', religion: 'catholic',
    colour: '#c0392b', colourDark: '#7b2419', appearsIn: 1156, playable: true,
    rosterTags: ['german', 'imperial', 'mountain'],
    traits: { diplomacy: 10, growth: 0.1, homeDefence: 0.1 },
    description:
      'A march on the Danube raised to a duchy, and under the Habsburgs the quiet ' +
      'winner of the Middle Ages. Austria expands by marriage contract more ' +
      'effectively than by siege.',
  }),
  f({
    id: 'switzerland', name: 'Swiss Confederacy', adjective: 'Swiss',
    culture: 'latin_west', religion: 'catholic',
    colour: '#e0e0e0', colourDark: '#8c8c8c', appearsIn: 1291, playable: true,
    rosterTags: ['mountain', 'pike'],
    traits: { upkeep: -0.2, homeDefence: 0.3, economy: -0.1, stipend: 150 },
    description:
      'Alpine valley communes sworn to defend their liberties against any lord. ' +
      'Swiss pike squares break the knightly charge outright, and Swiss mercenaries ' +
      'are soon the most sought-after infantry in Europe.',
  }),

  // -------------------------------------------------------------------------
  // Nordic
  // -------------------------------------------------------------------------
  f({
    id: 'denmark', name: 'Kingdom of Denmark', adjective: 'Danish',
    culture: 'nordic', religion: 'catholic',
    colour: '#c0392b', colourDark: '#7a241b', appearsIn: 1080, playable: true,
    rosterTags: ['norse', 'maritime'],
    traits: { movement: 0.2, trade: 0.1, siege: 0.05 },
    description:
      'The strongest of the northern kingdoms, heir to a North Sea empire and still ' +
      'able to put a huge-axe housecarl line in the field. Danish ambition points ' +
      'south into Germany and east along the Baltic.',
  }),
  f({
    id: 'norway', name: 'Kingdom of Norway', adjective: 'Norwegian',
    culture: 'nordic', religion: 'catholic',
    colour: '#34495e', colourDark: '#212f3c', appearsIn: 1080, playable: true,
    rosterTags: ['norse', 'maritime'],
    traits: { movement: 0.25, upkeep: -0.1, economy: -0.05 },
    description:
      'A poor, rugged kingdom whose wealth is its ships and its men. Norway rules the ' +
      'Atlantic islands from Orkney to Greenland and can appear on any coast in ' +
      'Europe before news of its sailing arrives.',
  }),
  f({
    id: 'sweden', name: 'Kingdom of Sweden', adjective: 'Swedish',
    culture: 'nordic', religion: 'catholic',
    colour: '#2980b9', colourDark: '#1b5478', appearsIn: 1080, playable: true,
    rosterTags: ['norse'],
    traits: { growth: 0.15, conversion: 0.3, homeDefence: 0.15 },
    description:
      'The youngest Christian monarchy in the North, still half pagan in Uppland and ' +
      'expanding across the Gulf of Finland. Swedish crusades into Finland and ' +
      'Karelia drag it towards Novgorod.',
  }),

  // -------------------------------------------------------------------------
  // Celtic
  // -------------------------------------------------------------------------
  f({
    id: 'scotland', name: 'Kingdom of Scotland', adjective: 'Scottish',
    culture: 'celtic', religion: 'catholic',
    colour: '#34558f', colourDark: '#21365c', appearsIn: 1080, playable: true,
    rosterTags: ['gaelic', 'pike', 'mountain'],
    traits: { homeDefence: 0.25, upkeep: -0.1, economy: -0.1 },
    description:
      'A kingdom of Gaelic highlands and Anglicised lowlands, permanently measuring ' +
      'itself against England. Scottish schiltrons of long spears can stop armoured ' +
      'knights on open ground.',
  }),
  f({
    id: 'ireland', name: 'High Kingship of Ireland', adjective: 'Irish',
    culture: 'celtic', religion: 'catholic',
    colour: '#27ae60', colourDark: '#196b3c', appearsIn: 1080, playable: true,
    rosterTags: ['gaelic'],
    traits: { upkeep: -0.2, homeDefence: 0.2, order: -1, economy: -0.1 },
    description:
      'A contested high kingship over provincial dynasties, rich in monasteries and ' +
      'poor in central authority. Irish kerns fight as fast-moving javelin skirmishers ' +
      'who refuse to stand and be charged.',
  }),
  f({
    id: 'wales', name: 'Principality of Gwynedd', adjective: 'Welsh',
    culture: 'celtic', religion: 'catholic',
    colour: '#16a085', colourDark: '#0e6a57', appearsIn: 1080, playable: true,
    rosterTags: ['gaelic', 'longbow', 'mountain'],
    traits: { homeDefence: 0.3, upkeep: -0.15, economy: -0.15, movement: 0.1 },
    description:
      'Mountain principalities holding out against Norman marcher lords. Welsh ' +
      'longbowmen and spearmen use terrain as a weapon, trading pitched battles for ' +
      'ambush and retreat into Snowdonia.',
  }),

  // -------------------------------------------------------------------------
  // West Slavs and Hungary
  // -------------------------------------------------------------------------
  f({
    id: 'poland', name: 'Kingdom of Poland', adjective: 'Polish',
    culture: 'slavic_west', religion: 'catholic',
    colour: '#e74c3c', colourDark: '#962f24', appearsIn: 1080, playable: true,
    rosterTags: ['west_slavic', 'lance'],
    traits: { recruitCost: 0.1, growth: 0.1, homeDefence: 0.1 },
    description:
      'A Piast kingdom of plains and forests with no natural frontier in any ' +
      'direction. Poland must fight Germans, Bohemians, pagan Prussians and steppe ' +
      'raiders at once, and fields excellent heavy lancers to do it.',
  }),
  f({
    id: 'bohemia', name: 'Kingdom of Bohemia', adjective: 'Bohemian',
    culture: 'slavic_west', religion: 'catholic',
    colour: '#ecf0f1', colourDark: '#95a5a6', appearsIn: 1080, playable: true,
    rosterTags: ['west_slavic', 'german', 'crossbow'],
    traits: { economy: 0.2, homeDefence: 0.2, siege: 0.05 },
    description:
      'A mountain-ringed realm inside the Empire, with silver mines at Kutna Hora ' +
      'that make its kings electors and bankers. Later the home of the Hussite war ' +
      'wagon, the first firearm infantry to beat crusading knights.',
  }),
  f({
    id: 'hungary', name: 'Kingdom of Hungary', adjective: 'Hungarian',
    culture: 'slavic_west', religion: 'catholic',
    colour: '#8e44ad', colourDark: '#5b2c70', appearsIn: 1080, playable: true,
    rosterTags: ['magyar', 'steppe_light'],
    traits: { movement: 0.2, recruitCost: 0.1, economy: 0.05 },
    description:
      'Steppe conquerors turned Apostolic Kingdom, keeping their horse-archer ' +
      'tradition inside a Latin Christian state. Hungary dominates the Carpathian ' +
      'basin and presses south into Croatia and the Balkans.',
  }),
  f({
    id: 'croatia', name: 'Kingdom of Croatia', adjective: 'Croatian',
    culture: 'slavic_west', religion: 'catholic',
    colour: '#d94f4f', colourDark: '#8c2f2f', appearsIn: 1080, playable: true,
    rosterTags: ['south_slavic', 'mountain', 'maritime'],
    traits: { homeDefence: 0.25, movement: 0.1, trade: 0.1, upkeep: -0.05 },
    description:
      'Under Zvonimir a crowned kingdom of Dalmatian cities and Pannonian plains, ' +
      'balanced between Rome, Byzantium and Venice. Croatian light horse and mountain ' +
      'infantry fight a war of raid and ambush along the Dinaric ranges.',
  }),
  f({
    id: 'lithuania', name: 'Grand Duchy of Lithuania', adjective: 'Lithuanian',
    culture: 'slavic_west', religion: 'pagan',
    colour: '#c0a16b', colourDark: '#7d6843', appearsIn: 1236, playable: true,
    rosterTags: ['baltic', 'west_slavic', 'forest'],
    traits: { homeDefence: 0.25, movement: 0.15, upkeep: -0.1, conversion: -0.3 },
    description:
      'The last pagan state in Europe, forged in the forests to resist the crusading ' +
      'orders, and soon the largest realm on the continent. Lithuanian raiders strike ' +
      'deep and vanish into the marshes.',
  }),
  f({
    id: 'teutonic_order', name: 'Teutonic Order', adjective: 'Teutonic',
    culture: 'latin_west', religion: 'catholic',
    colour: '#2c3e50', colourDark: '#1a252f', appearsIn: 1226, playable: true,
    rosterTags: ['german', 'crusader', 'order'],
    traits: { upkeep: -0.25, siege: 0.15, conversion: 0.5, growth: -0.1, stipend: 200 },
    description:
      'A monastic order granted a crusading licence over Prussia, which it turns into ' +
      'a state of brick castles and permanent holy war. Few in number, superbly ' +
      'equipped, funded by donations from all Germany.',
  }),

  // -------------------------------------------------------------------------
  // East Slavs
  // -------------------------------------------------------------------------
  f({
    id: 'kievan_rus', name: 'Kievan Rus', adjective: 'Rus',
    culture: 'slavic_east', religion: 'orthodox',
    colour: '#16806e', colourDark: '#0e5349', appearsIn: 1080, fadesIn: 1240, playable: true,
    rosterTags: ['east_slavic', 'norse', 'steppe_light'],
    traits: { economy: 0.1, trade: 0.15, order: -1, movement: 0.1 },
    description:
      'A federation of princely cities along the river road from the Baltic to the ' +
      'Black Sea, ruled by quarrelling Rurikids. Rich on the Byzantine trade, fatally ' +
      'exposed to the steppe.',
  }),
  f({
    id: 'novgorod', name: 'Novgorod Republic', adjective: 'Novgorodian',
    culture: 'slavic_east', religion: 'orthodox',
    colour: '#27a3c4', colourDark: '#196a80', appearsIn: 1136, playable: true,
    rosterTags: ['east_slavic', 'forest'],
    traits: { trade: 0.3, homeDefence: 0.2, growth: -0.05, upkeep: 0.05 },
    description:
      'A merchant republic that hires and dismisses its own princes by popular ' +
      'assembly. Novgorod runs the fur and wax trade of the north and fights the ' +
      'Swedes and the Order on frozen rivers.',
  }),
  f({
    id: 'muscovy', name: 'Grand Duchy of Moscow', adjective: 'Muscovite',
    culture: 'slavic_east', religion: 'orthodox',
    colour: '#a93226', colourDark: '#6e2019', appearsIn: 1283, playable: true,
    rosterTags: ['east_slavic', 'steppe_light', 'gunpowder'],
    traits: { economy: 0.15, order: 1, conversion: 0.3, growth: 0.1 },
    description:
      'An obscure forest principality that collects the Horde\'s tribute, then keeps ' +
      'both the money and the authority. Moscow gathers the Rus lands and declares ' +
      'itself the Third Rome.',
  }),

  // -------------------------------------------------------------------------
  // Balkans
  // -------------------------------------------------------------------------
  f({
    id: 'serbia', name: 'Grand Principality of Serbia', adjective: 'Serbian',
    culture: 'balkan', religion: 'orthodox',
    colour: '#7d3c98', colourDark: '#512663', appearsIn: 1080, playable: true,
    rosterTags: ['south_slavic', 'mountain', 'lance'],
    traits: { homeDefence: 0.2, recruitCost: 0.05, movement: 0.1 },
    description:
      'Raska and Duklja, mountain principalities shaking off Byzantine overlordship. ' +
      'Under the Nemanjic dynasty Serbia becomes the dominant Balkan power, with ' +
      'armoured lancers and rich Saxon-worked silver mines.',
  }),
  f({
    id: 'bulgaria', name: 'Bulgarian Empire', adjective: 'Bulgarian',
    culture: 'balkan', religion: 'orthodox',
    colour: '#145a32', colourDark: '#0c3a21', appearsIn: 1185, playable: true,
    rosterTags: ['south_slavic', 'steppe_light'],
    traits: { recruitCost: 0.1, homeDefence: 0.15, movement: 0.15 },
    description:
      'Restored by the Asen brothers against Constantinople, combining Slavic ' +
      'infantry with Cuman horse archers hired from across the Danube. For a ' +
      'generation the strongest state in the Balkans.',
  }),
  f({
    id: 'bosnia', name: 'Banate of Bosnia', adjective: 'Bosnian',
    culture: 'balkan', religion: 'catholic',
    colour: '#d4ac0d', colourDark: '#8a7008', appearsIn: 1154, playable: true,
    rosterTags: ['south_slavic', 'mountain'],
    traits: { homeDefence: 0.3, upkeep: -0.1, economy: 0.1, diplomacy: -5 },
    description:
      'A mountain banate between Hungary, Serbia and Venice, notorious in Rome for ' +
      'sheltering the dualist Bosnian Church. Silver from Srebrenica pays for ' +
      'stubborn infantry in country no cavalry can use.',
  }),
  f({
    id: 'wallachia', name: 'Principality of Wallachia', adjective: 'Wallachian',
    culture: 'balkan', religion: 'orthodox',
    colour: '#935116', colourDark: '#5f340e', appearsIn: 1330, playable: true,
    rosterTags: ['south_slavic', 'steppe_light', 'forest'],
    traits: { homeDefence: 0.3, movement: 0.15, upkeep: -0.15, economy: -0.05 },
    description:
      'A Danubian principality squeezed between Hungary and the Ottomans, surviving ' +
      'by tribute, terrain and terror. Wallachian warfare means night attacks, burned ' +
      'crops and poisoned wells.',
  }),
  f({
    id: 'ragusa', name: 'Republic of Ragusa', adjective: 'Ragusan',
    culture: 'balkan', religion: 'catholic',
    colour: '#2e86c1', colourDark: '#1d5680', appearsIn: 1080, playable: true,
    rosterTags: ['south_slavic', 'maritime', 'italian'],
    traits: { trade: 0.35, diplomacy: 20, homeDefence: 0.25, economy: -0.05, upkeep: 0.1 },
    description:
      'A tiny Dalmatian city-republic that outlives every empire around it by paying ' +
      'tribute to all of them at once. Ragusa has the finest walls on the Adriatic, ' +
      'the best informed senate, and almost no army.',
  }),
  f({
    id: 'albania', name: 'League of Lezhe', adjective: 'Albanian',
    culture: 'balkan', religion: 'catholic',
    colour: '#922b21', colourDark: '#5e1b15', appearsIn: 1443, playable: true,
    rosterTags: ['south_slavic', 'mountain', 'steppe_light'],
    traits: { homeDefence: 0.35, movement: 0.2, upkeep: -0.2, economy: -0.15 },
    description:
      'Highland clans united by Skanderbeg to hold the Albanian mountains against the ' +
      'Ottoman advance for twenty-five years. Light, fast, expert in the ambush, and ' +
      'hopelessly outnumbered.',
  }),

  // -------------------------------------------------------------------------
  // Eastern Christendom
  // -------------------------------------------------------------------------
  f({
    id: 'byzantium', name: 'Byzantine Empire', adjective: 'Byzantine',
    culture: 'hellenic', religion: 'orthodox',
    colour: '#8e6cc0', colourDark: '#5c457c', appearsIn: 1080, playable: true,
    rosterTags: ['byzantine', 'greek', 'steppe_light'],
    traits: { economy: 0.15, diplomacy: 10, trade: 0.15, order: -1 },
    description:
      'The Roman Empire of the East under Alexios Komnenos: Anatolia newly lost to ' +
      'the Turks, the treasury empty, the army rebuilt from mercenaries and ' +
      'guardsmen. Still the most sophisticated state in Europe.',
  }),
  f({
    id: 'georgia', name: 'Kingdom of Georgia', adjective: 'Georgian',
    culture: 'hellenic', religion: 'orthodox',
    colour: '#c0392b', colourDark: '#7b2419', appearsIn: 1080, playable: true,
    rosterTags: ['caucasian', 'byzantine', 'mountain'],
    traits: { homeDefence: 0.25, recruitCost: 0.05, siege: 0.05 },
    description:
      'A Caucasian kingdom fighting back from Seljuk invasion towards the golden age ' +
      'of David the Builder and Queen Tamar. Georgian armoured cavalry are a match ' +
      'for anything east of Constantinople.',
  }),
  f({
    id: 'armenia', name: 'Armenian Kingdom of Cilicia', adjective: 'Armenian',
    culture: 'hellenic', religion: 'miaphysite',
    colour: '#d68910', colourDark: '#8b580a', appearsIn: 1080, playable: true,
    rosterTags: ['caucasian', 'byzantine', 'mountain', 'crusader'],
    traits: { homeDefence: 0.2, trade: 0.15, diplomacy: 5 },
    description:
      'Armenians driven from their highlands who rebuilt a kingdom in the Taurus ' +
      'passes. Cilicia becomes the crusaders\' indispensable ally and the gateway ' +
      'between Latin, Greek and Muslim worlds.',
  }),
  f({
    id: 'trebizond', name: 'Empire of Trebizond', adjective: 'Trapezuntine',
    culture: 'hellenic', religion: 'orthodox',
    colour: '#6c3483', colourDark: '#452153', appearsIn: 1204, playable: true,
    rosterTags: ['byzantine', 'greek', 'caucasian'],
    traits: { trade: 0.3, homeDefence: 0.25, diplomacy: 15, economy: -0.05 },
    description:
      'A Komnenos splinter empire on the Black Sea coast, living off the silk road ' +
      'terminus at its harbour and the mountains at its back. It survives ' +
      'Constantinople itself by eight years.',
  }),
  f({
    id: 'jerusalem', name: 'Kingdom of Jerusalem', adjective: 'Latin',
    culture: 'latin_west', religion: 'catholic',
    colour: '#f1c40f', colourDark: '#9c7f09', appearsIn: 1099, playable: true,
    rosterTags: ['crusader', 'levantine_latin', 'order'],
    traits: { siege: 0.1, homeDefence: 0.15, upkeep: -0.1, growth: -0.15, stipend: 150 },
    description:
      'The crusader kingdom in the Holy Land: a thin Frankish aristocracy over a ' +
      'Syrian population, dependent on pilgrim money, Italian fleets and the military ' +
      'orders. Brilliant heavy cavalry, no reserves.',
  }),
  f({
    id: 'antioch', name: 'Principality of Antioch', adjective: 'Antiochene',
    culture: 'latin_west', religion: 'catholic',
    colour: '#cb4335', colourDark: '#832b22', appearsIn: 1098, playable: true,
    rosterTags: ['crusader', 'levantine_latin', 'norman'],
    traits: { siege: 0.1, homeDefence: 0.2, movement: 0.1, growth: -0.1 },
    description:
      'Bohemond\'s Norman principality on the Orontes, the northern bastion of ' +
      'Outremer. Caught permanently between Byzantine claims, Armenian allies and ' +
      'Aleppo\'s armies.',
  }),
  f({
    id: 'hospitallers', name: 'Knights Hospitaller', adjective: 'Hospitaller',
    culture: 'latin_west', religion: 'catholic',
    colour: '#f5f5f5', colourDark: '#8c8c8c', appearsIn: 1113, playable: true,
    rosterTags: ['crusader', 'order', 'maritime', 'levantine_latin'],
    traits: { upkeep: -0.25, homeDefence: 0.3, siege: 0.1, growth: -0.2, stipend: 250 },
    description:
      'Hospital brothers turned heavy cavalry, holding castles no secular lord can ' +
      'afford to garrison. Driven from Palestine, they take Rhodes and become a naval ' +
      'power that outlasts the crusades entirely.',
  }),
  f({
    id: 'cyprus', name: 'Kingdom of Cyprus', adjective: 'Cypriot',
    culture: 'latin_west', religion: 'catholic',
    colour: '#48c9b0', colourDark: '#2e8171', appearsIn: 1192, playable: true,
    rosterTags: ['crusader', 'levantine_latin', 'maritime', 'greek'],
    traits: { trade: 0.3, homeDefence: 0.3, economy: 0.1, growth: -0.05 },
    description:
      'A Lusignan island kingdom, the last secure Latin base in the East and the ' +
      'richest sugar producer in the Mediterranean. Safe behind the sea, as long as ' +
      'someone else owns the fleet.',
  }),

  // -------------------------------------------------------------------------
  // Islamic Near East
  // -------------------------------------------------------------------------
  f({
    id: 'seljuks', name: 'Great Seljuk Empire', adjective: 'Seljuk',
    culture: 'levantine', religion: 'sunni',
    colour: '#1e8449', colourDark: '#13562f', appearsIn: 1080, fadesIn: 1194, playable: true,
    rosterTags: ['turkic', 'levantine_muslim', 'steppe_light'],
    traits: { movement: 0.25, recruitCost: 0.1, upkeep: -0.1, order: -1 },
    description:
      'The Turkish empire that broke Byzantine Anatolia at Manzikert and rules from ' +
      'the Aegean to Khorasan. Immense armies of horse archers and ghulam guards, ' +
      'held together only by the sultan\'s person.',
  }),
  f({
    id: 'rum', name: 'Sultanate of Rum', adjective: 'Rumi',
    culture: 'levantine', religion: 'sunni',
    colour: '#52be80', colourDark: '#357a52', appearsIn: 1080, playable: true,
    rosterTags: ['turkic', 'steppe_light', 'levantine_muslim'],
    traits: { movement: 0.25, homeDefence: 0.15, trade: 0.1, upkeep: -0.1 },
    description:
      'Turkish settlers colonising the Anatolian plateau in the wake of Manzikert, ' +
      'ruling Greeks and Armenians from Konya. Caravanserais, horse archers, and a ' +
      'frontier that eats crusades.',
  }),
  f({
    id: 'fatimids', name: 'Fatimid Caliphate', adjective: 'Fatimid',
    culture: 'levantine', religion: 'shia',
    colour: '#f7f7f7', colourDark: '#85929e', appearsIn: 1080, fadesIn: 1171, playable: true,
    rosterTags: ['levantine_muslim', 'african_muslim'],
    traits: { economy: 0.2, trade: 0.25, order: -1, recruitCost: 0.05 },
    description:
      'A Shia caliphate ruling Egypt from Cairo on Nile grain and Red Sea trade, with ' +
      'an army of Armenian, Sudanese and Berber contingents that distrust one ' +
      'another as much as the enemy.',
  }),
  f({
    id: 'abbasids', name: 'Abbasid Caliphate', adjective: 'Abbasid',
    culture: 'levantine', religion: 'sunni',
    colour: '#212f3d', colourDark: '#141c24', appearsIn: 1080, fadesIn: 1258, playable: true,
    rosterTags: ['levantine_muslim', 'turkic'],
    traits: { diplomacy: 15, conversion: 0.4, economy: 0.1, homeDefence: 0.1 },
    description:
      'The caliphs of Baghdad, spiritual sovereigns of Sunni Islam and political ' +
      'prisoners of whichever Turkish sultan holds the city. Legitimacy without ' +
      'legions, until the Mongols end both.',
  }),
  f({
    id: 'ayyubids', name: 'Ayyubid Sultanate', adjective: 'Ayyubid',
    culture: 'levantine', religion: 'sunni',
    colour: '#f1c40f', colourDark: '#9a7d09', appearsIn: 1171, fadesIn: 1260, playable: true,
    rosterTags: ['levantine_muslim', 'turkic', 'kurdish'],
    traits: { siege: 0.15, movement: 0.15, diplomacy: 5, recruitCost: 0.05 },
    description:
      'Saladin\'s Kurdish dynasty, uniting Egypt and Syria and retaking Jerusalem. ' +
      'Disciplined mamluk cavalry, competent siege trains, and a reputation for ' +
      'keeping terms that makes its diplomacy work.',
  }),
  f({
    id: 'mamluks', name: 'Mamluk Sultanate', adjective: 'Mamluk',
    culture: 'levantine', religion: 'sunni',
    colour: '#d4af37', colourDark: '#897023', appearsIn: 1250, playable: true,
    rosterTags: ['levantine_muslim', 'turkic', 'elite_cavalry'],
    traits: { recruitCost: -0.1, upkeep: 0.1, siege: 0.2, order: 1, homeDefence: 0.15 },
    description:
      'Slave soldiers who overthrew their masters and built the most formidable army ' +
      'of the age, stopping the Mongols at Ain Jalut and extinguishing Outremer. ' +
      'Expensive, superbly trained, politically murderous.',
  }),
  f({
    id: 'ottomans', name: 'Ottoman Sultanate', adjective: 'Ottoman',
    culture: 'levantine', religion: 'sunni',
    colour: '#117a65', colourDark: '#0b4d40', appearsIn: 1299, playable: true,
    rosterTags: ['turkic', 'steppe_light', 'gunpowder', 'elite_infantry'],
    traits: { siege: 0.2, recruitCost: 0.05, growth: 0.1, movement: 0.1, order: 1 },
    description:
      'A frontier emirate in Bithynia that grows into the empire which takes ' +
      'Constantinople. Standing janissary infantry, the heaviest siege artillery in ' +
      'the world, and an administration that absorbs what it conquers.',
  }),
  f({
    id: 'khwarazm', name: 'Khwarazmian Empire', adjective: 'Khwarazmian',
    culture: 'levantine', religion: 'sunni',
    colour: '#5d6d7e', colourDark: '#3c4752', appearsIn: 1153, fadesIn: 1231, playable: true,
    rosterTags: ['turkic', 'steppe_light', 'persian'],
    traits: { movement: 0.2, recruitCost: 0.1, economy: 0.1, order: -2 },
    description:
      'A Turkic dynasty that inherits Persia and Transoxiana and briefly rules the ' +
      'largest Muslim state on earth. Rich caravan cities, a huge unreliable army, ' +
      'and a fatal diplomatic insult to Genghis Khan.',
  }),

  // -------------------------------------------------------------------------
  // Maghreb and al-Andalus
  // -------------------------------------------------------------------------
  f({
    id: 'almoravids', name: 'Almoravid Emirate', adjective: 'Almoravid',
    culture: 'maghrebi', religion: 'sunni',
    colour: '#6e2c00', colourDark: '#471c00', appearsIn: 1080, fadesIn: 1147, playable: true,
    rosterTags: ['berber', 'african_muslim', 'andalusian'],
    traits: { movement: 0.2, upkeep: -0.15, conversion: 0.4, siege: 0.1 },
    description:
      'Veiled Sanhaja Berbers from the Sahara who unify Morocco and cross into Spain ' +
      'to halt the Reconquista at Sagrajas. Camel and light horse mobility, austere ' +
      'religious discipline, gold from the Niger.',
  }),
  f({
    id: 'almohads', name: 'Almohad Caliphate', adjective: 'Almohad',
    culture: 'maghrebi', religion: 'sunni',
    colour: '#424949', colourDark: '#2b2f2f', appearsIn: 1147, fadesIn: 1269, playable: true,
    rosterTags: ['berber', 'african_muslim', 'andalusian'],
    traits: { recruitCost: 0.1, siege: 0.15, conversion: 0.5, movement: 0.15 },
    description:
      'Masmuda Berber reformers who denounce the Almoravids as lax and replace them ' +
      'from Marrakesh to Seville. Huge drilled armies with massed drums and archers, ' +
      'broken in a single afternoon at Las Navas de Tolosa.',
  }),
  f({
    id: 'granada', name: 'Emirate of Granada', adjective: 'Granadan',
    culture: 'maghrebi', religion: 'sunni',
    colour: '#c0392b', colourDark: '#7b2419', appearsIn: 1238, playable: true,
    rosterTags: ['andalusian', 'berber', 'maritime'],
    traits: { homeDefence: 0.35, trade: 0.2, economy: 0.1, diplomacy: 10, growth: -0.05 },
    description:
      'The last Muslim state in Iberia, surviving two and a half centuries as a ' +
      'tribute-paying client with the Sierra Nevada at its back. Jinete light horse, ' +
      'impregnable fortresses, and very skilful diplomacy.',
  }),
  f({
    id: 'zirids', name: 'Zirid Ifriqiya', adjective: 'Zirid',
    culture: 'maghrebi', religion: 'sunni',
    colour: '#b9770e', colourDark: '#784c09', appearsIn: 1080, fadesIn: 1148, playable: true,
    rosterTags: ['berber', 'african_muslim', 'maritime'],
    traits: { trade: 0.2, movement: 0.15, order: -1, upkeep: -0.1 },
    description:
      'Berber emirs of Tunisia who renounced Fatimid overlordship and paid for it with ' +
      'Bedouin invasion. A coastal state of ports and corsairs with a hinterland it no ' +
      'longer controls.',
  }),
  f({
    id: 'hafsids', name: 'Hafsid Caliphate', adjective: 'Hafsid',
    culture: 'maghrebi', religion: 'sunni',
    colour: '#d35400', colourDark: '#883600', appearsIn: 1229, playable: true,
    rosterTags: ['berber', 'african_muslim', 'maritime'],
    traits: { trade: 0.25, diplomacy: 10, economy: 0.1, homeDefence: 0.1 },
    description:
      'Almohad governors of Tunis who declare their own caliphate and make it stick ' +
      'for three centuries. Wheat, olive oil, Saharan gold and a working relationship ' +
      'with every Christian trading republic.',
  }),
  f({
    id: 'marinids', name: 'Marinid Sultanate', adjective: 'Marinid',
    culture: 'maghrebi', religion: 'sunni',
    colour: '#935116', colourDark: '#5f340e', appearsIn: 1244, playable: true,
    rosterTags: ['berber', 'african_muslim', 'andalusian'],
    traits: { movement: 0.2, recruitCost: 0.1, upkeep: -0.1, siege: 0.05 },
    description:
      'Zenata Berbers who take Morocco from the collapsing Almohads and make the last ' +
      'serious African attempt to intervene in Spain. Masters of the light cavalry ' +
      'raid across the Strait.',
  }),
  f({
    id: 'taifa_zaragoza', name: 'Taifa of Zaragoza', adjective: 'Zaragozan',
    culture: 'maghrebi', religion: 'sunni',
    colour: '#7d6608', colourDark: '#514205', appearsIn: 1080, fadesIn: 1110, playable: true,
    rosterTags: ['andalusian', 'berber'],
    traits: { economy: 0.15, diplomacy: 10, homeDefence: 0.2, upkeep: 0.05 },
    description:
      'The strongest of the Ebro taifas, a Hudid emirate of poets, astronomers and ' +
      'engineers that hires Christian mercenaries, El Cid among them, to hold off ' +
      'Castile and Aragon alike.',
  }),
  f({
    id: 'taifa_seville', name: 'Taifa of Seville', adjective: 'Sevillian',
    culture: 'maghrebi', religion: 'sunni',
    colour: '#a04000', colourDark: '#682900', appearsIn: 1080, fadesIn: 1091, playable: true,
    rosterTags: ['andalusian', 'berber'],
    traits: { economy: 0.2, trade: 0.15, diplomacy: 5, homeDefence: 0.1 },
    description:
      'The richest Andalusi successor state, swallowing its smaller neighbours while ' +
      'paying Alfonso VI of Castile to leave it alone. Its emir al-Mutamid invites the ' +
      'Almoravids in, and loses his throne to them.',
  }),

  // -------------------------------------------------------------------------
  // Steppe
  // -------------------------------------------------------------------------
  f({
    id: 'cumans', name: 'Cuman-Kipchak Confederation', adjective: 'Cuman',
    culture: 'steppe', religion: 'tengri',
    colour: '#af7ac5', colourDark: '#714f7f', appearsIn: 1080, fadesIn: 1241, playable: true,
    rosterTags: ['steppe_light', 'turkic'],
    traits: { movement: 0.4, upkeep: -0.3, economy: -0.2, order: -2, stipend: 100 },
    description:
      'Turkic nomads holding the steppe from the Danube to the Volga, raiding and ' +
      'hiring themselves out to Rus, Byzantine and Hungarian paymasters. Nothing in ' +
      'Europe can catch their horse archers.',
  }),
  f({
    id: 'volga_bulgaria', name: 'Volga Bulgaria', adjective: 'Volga Bulgar',
    culture: 'steppe', religion: 'sunni',
    colour: '#117864', colourDark: '#0b4d41', appearsIn: 1080, fadesIn: 1240, playable: true,
    rosterTags: ['steppe_light', 'turkic', 'forest', 'settled'],
    traits: { trade: 0.3, homeDefence: 0.2, economy: 0.1, movement: 0.15 },
    description:
      'A Muslim Turkic state at the confluence of the Volga and Kama, the fur and ' +
      'slave market where the north meets the caliphate. Fortified towns, river ' +
      'tolls, and dangerous forests.',
  }),
  f({
    id: 'mongols', name: 'Mongol Empire', adjective: 'Mongol',
    culture: 'steppe', religion: 'tengri',
    colour: '#1c2833', colourDark: '#0e141a', appearsIn: 1236, fadesIn: 1294, playable: true,
    rosterTags: ['steppe_light', 'mongol', 'siege_expert'],
    traits: { movement: 0.45, upkeep: -0.3, siege: 0.25, recruitCost: 0.15, order: -2 },
    description:
      'The largest land empire in history, arriving in Europe with decimal ' +
      'organisation, Chinese siege engineers and operational planning centuries ahead ' +
      'of its enemies. Its armies do not lose.',
  }),
  f({
    id: 'golden_horde', name: 'Golden Horde', adjective: 'Tatar',
    culture: 'steppe', religion: 'sunni',
    colour: '#f4d03f', colourDark: '#9e8726', appearsIn: 1242, playable: true,
    rosterTags: ['steppe_light', 'mongol', 'turkic', 'siege_expert'],
    traits: { movement: 0.35, upkeep: -0.25, stipend: 300, order: -1, economy: -0.1 },
    description:
      'The western ulus of the Mongol empire, ruling the Rus principalities through ' +
      'tribute rather than occupation and growing rich on the Volga caravan trade. ' +
      'Converts to Islam, keeps the steppe way of war.',
  }),
  f({
    id: 'timurids', name: 'Timurid Empire', adjective: 'Timurid',
    culture: 'steppe', religion: 'sunni',
    colour: '#5b2c6f', colourDark: '#3b1c48', appearsIn: 1370, playable: true,
    rosterTags: ['steppe_light', 'mongol', 'persian', 'siege_expert', 'gunpowder'],
    traits: { movement: 0.3, siege: 0.3, recruitCost: 0.1, order: -2, upkeep: -0.15 },
    description:
      'Timur\'s empire out of Samarkand, which shatters the Golden Horde, the ' +
      'Mamluks and the Ottomans in turn. Steppe mobility married to Persian ' +
      'administration, siege artillery and war elephants.',
  }),
  f({
    id: 'crimean_khanate', name: 'Crimean Khanate', adjective: 'Crimean',
    culture: 'steppe', religion: 'sunni',
    colour: '#48c9b0', colourDark: '#2e8171', appearsIn: 1441, playable: true,
    rosterTags: ['steppe_light', 'turkic', 'settled'],
    traits: { movement: 0.35, upkeep: -0.2, stipend: 200, trade: 0.15, homeDefence: 0.2 },
    description:
      'A Girayid successor to the Horde, secure behind the Perekop isthmus and ' +
      'financed by the slave raid. Its cavalry ranges from Poland to Muscovy, and its ' +
      'ports feed the Ottoman market.',
  }),

  // -------------------------------------------------------------------------
  // Africa beyond the Maghreb
  // -------------------------------------------------------------------------
  f({
    id: 'ghana', name: 'Ghana Empire', adjective: 'Ghanaian',
    culture: 'sahelian', religion: 'animist',
    colour: '#b7950b', colourDark: '#776107', appearsIn: 1080, fadesIn: 1235, playable: true,
    rosterTags: ['sahelian', 'african_muslim'],
    traits: { economy: 0.2, trade: 0.25, homeDefence: 0.15, movement: -0.05 },
    description:
      'The Soninke empire of Wagadou, controlling the southern end of the Saharan ' +
      'gold trade from Koumbi Saleh. Its wealth is legendary in Cairo and Baghdad, ' +
      'and the Almoravids know exactly where it is.',
  }),
  f({
    id: 'mali', name: 'Mali Empire', adjective: 'Malian',
    culture: 'sahelian', religion: 'sunni',
    colour: '#f39c12', colourDark: '#9d640b', appearsIn: 1235, playable: true,
    rosterTags: ['sahelian', 'african_muslim'],
    traits: { economy: 0.25, trade: 0.3, growth: 0.1, diplomacy: 5, movement: -0.05 },
    description:
      'Sundiata\'s empire on the upper Niger, richest state in the world by the ' +
      'fourteenth century. Timbuktu\'s scholars, Mansa Musa\'s pilgrimage, cavalry ' +
      'bought with gold dust, and an army of levied bowmen.',
  }),
  f({
    id: 'kanem', name: 'Kanem Empire', adjective: 'Kanembu',
    culture: 'sahelian', religion: 'sunni',
    colour: '#7e5109', colourDark: '#523405', appearsIn: 1080, playable: true,
    rosterTags: ['sahelian', 'african_muslim'],
    traits: { movement: 0.15, trade: 0.2, upkeep: -0.15, homeDefence: 0.1 },
    description:
      'A Kanuri sultanate around Lake Chad astride the central Saharan road to ' +
      'Tripoli. Its heavy mailed cavalry, bought with horses and slaves, dominate the ' +
      'Sahel for six centuries.',
  }),
  f({
    id: 'makuria', name: 'Kingdom of Makuria', adjective: 'Nubian',
    culture: 'sahelian', religion: 'miaphysite',
    colour: '#cd6155', colourDark: '#853e36', appearsIn: 1080, fadesIn: 1317, playable: true,
    rosterTags: ['nubian', 'african_muslim'],
    traits: { homeDefence: 0.25, trade: 0.15, diplomacy: 10, economy: -0.05 },
    description:
      'Christian Nubia on the middle Nile, which fought Arab armies to a standstill ' +
      'and then kept the peace by treaty for six hundred years. Its archers shoot for ' +
      'the eye, and the desert does the rest.',
  }),
  f({
    id: 'ethiopia', name: 'Ethiopian Empire', adjective: 'Ethiopian',
    culture: 'sahelian', religion: 'miaphysite',
    colour: '#1e8449', colourDark: '#13562f', appearsIn: 1137, playable: true,
    rosterTags: ['nubian', 'mountain'],
    traits: { homeDefence: 0.35, upkeep: -0.15, conversion: 0.3, economy: -0.05, movement: -0.1 },
    description:
      'The Zagwe and then Solomonic negusa nagast, a Christian highland empire cut off ' +
      'from the rest of Christendom by Islam and perfectly able to defend itself. ' +
      'Rock-hewn churches and inaccessible mountains.',
  }),
];

/** Index for O(1) lookup. Built once at module load. */
const BY_ID = new Map<FactionId, Faction>(FACTIONS.map((faction) => [faction.id, faction]));

export function getFaction(id: FactionId): Faction {
  const faction = BY_ID.get(id);
  if (!faction) throw new Error(`Unknown faction: ${id}`);
  return faction;
}

export function tryGetFaction(id: FactionId): Faction | undefined {
  return BY_ID.get(id);
}

/** Factions on the map at campaign start. */
export function startingFactions(startYear: number): readonly Faction[] {
  return FACTIONS.filter((faction) => faction.appearsIn <= startYear);
}

/** Factions the player may choose at the given start year. */
export function playableFactions(startYear: number): readonly Faction[] {
  return startingFactions(startYear).filter((faction) => faction.playable);
}

/** Factions that enter play later, in chronological order. */
export function emergentFactions(startYear: number): readonly Faction[] {
  return [...FACTIONS]
    .filter((faction) => faction.appearsIn > startYear)
    .sort((a, b) => a.appearsIn - b.appearsIn);
}
