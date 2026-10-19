/**
 * Unit roster.
 *
 * Rather than writing a bespoke army list for every one of the 70+ factions,
 * units declare the `pools` they belong to. A faction recruits a unit when one
 * of its pools matches the faction's culture or one of its roster tags, which
 * are set in `factions.ts`. Faction-unique troops name their owners directly.
 *
 * Stat scale, so that balance edits stay coherent:
 *   attack / defence   1-20   (skill; 20 is household elite)
 *   armour             0-10   (0 unarmoured, 6 mail hauberk, 9 full plate)
 *   shield             0-8    (frontal and left side only)
 *   morale             1-20   (routs when accumulated shock exceeds it)
 *   discipline         1-20   (resists panic, rallies faster)
 *   speed              m/s    (1.2 foot, 1.45 light foot, 3.5-5.5 mounted)
 *   range              m      (javelin 30, bow 150, longbow 190, handgun 90)
 */
import type { UnitType } from '../types';
import { defineUnit } from './unitSpec';
import { SHIP_TYPES } from './ships';

const u = defineUnit;

const LAND_UNITS: readonly UnitType[] = [
  // =========================================================================
  // Universal levies - every settled culture can raise these
  // =========================================================================
  u({
    id: 'peasant_levy', name: 'Peasant Levy', unitClass: 'light_infantry', tier: 1,
    soldiers: 160, attack: 3, defence: 1, armour: 0, shield: 1, morale: 4, discipline: 5,
    cost: 170, pools: ['universal_settled'],
    description:
      'Farmers called up with whatever they own: a spear, a billhook, a knife. ' +
      'Useful to fill a wall or weigh down a flank, and to die slowly enough that ' +
      'real troops can arrive.',
  }),
  u({
    id: 'town_militia', name: 'Town Militia', unitClass: 'spearmen', tier: 1,
    attack: 5, defence: 5, armour: 1, shield: 3, morale: 8, discipline: 9,
    abilities: ['shield_wall'], cost: 300, minSettlement: 'town',
    pools: ['universal_settled'],
    description:
      'Burghers who drill on feast days and defend their own gates in earnest. ' +
      'Indifferent in the open field, surprisingly stubborn on their own walls.',
  }),
  u({
    id: 'levy_archers', name: 'Levy Archers', unitClass: 'archers', tier: 1,
    soldiers: 140, attack: 3, defence: 3, armour: 0, shield: 1, morale: 7, discipline: 8,
    range: 140, missileAttack: 9, ammunition: 24, cost: 240,
    pools: ['universal_settled'],
    description:
      'Hunters and poachers handed a quiver and told where to stand. A short ' +
      'self bow will not pierce mail, but it will blind a formation and kill the ' +
      'horses of anyone who comes close.',
  }),
  u({
    id: 'hired_crossbowmen', name: 'Hired Crossbowmen', unitClass: 'crossbowmen', tier: 2,
    attack: 4, defence: 4, armour: 2, shield: 0, morale: 8, discipline: 9,
    range: 120, missileAttack: 11, ammunition: 24, cost: 390, minSettlement: 'town',
    pools: ['universal_settled'], fromYear: 1120,
    description:
      'Professional bolt-shooters who sell their skill by the campaign season. The ' +
      'crossbow needs no lifetime of practice, only money, which is why it spreads ' +
      'across Europe so fast.',
  }),

  // =========================================================================
  // Latin West - feudal Europe
  // =========================================================================
  u({
    id: 'armoured_sergeants', name: 'Armoured Sergeants', unitClass: 'heavy_infantry', tier: 3,
    attack: 9, defence: 9, armour: 5, shield: 4, morale: 11, discipline: 12,
    abilities: ['shield_wall'], cost: 560, minSettlement: 'large_town',
    pools: ['latin_west', 'slavic_west', 'crusader'],
    description:
      'Mailed footmen of the household, paid in coin rather than land. The backbone ' +
      'of any western army that intends to hold ground rather than charge across it.',
  }),
  u({
    id: 'feudal_knights', name: 'Feudal Knights', unitClass: 'heavy_cavalry', tier: 3,
    attack: 11, charge: 12, defence: 9, armour: 6, shield: 4, morale: 13, discipline: 8,
    speed: 4.4, abilities: ['charge_bonus'], cost: 800, minSettlement: 'large_town',
    pools: ['latin_west', 'chivalry', 'slavic_west', 'crusader'],
    description:
      'Landholders who owe mounted service for their fiefs. The couched lance ' +
      'delivered at the gallop is the decisive weapon of the age, provided someone ' +
      'can persuade them to stop and reform afterwards.',
  }),
  u({
    id: 'mailed_knights', name: 'Mailed Knights', unitClass: 'heavy_cavalry', tier: 2,
    attack: 9, charge: 10, defence: 7, armour: 5, shield: 4, morale: 12, discipline: 7,
    speed: 4.5, abilities: ['charge_bonus'], cost: 640,
    pools: ['latin_west', 'norman', 'chivalry', 'slavic_west'], untilYear: 1250,
    description:
      'Early knights in mail and conical helm, lance under the arm and a long shield ' +
      'at the knee. Less armour than their grandsons will wear, and considerably ' +
      'better tempered horses.',
  }),
  u({
    id: 'gothic_knights', name: 'Gothic Knights', unitClass: 'heavy_cavalry', tier: 5,
    attack: 14, charge: 15, defence: 12, armour: 9, shield: 3, morale: 16, discipline: 11,
    speed: 4.0, abilities: ['charge_bonus'], cost: 1320, minSettlement: 'city',
    pools: ['latin_west', 'chivalry', 'german', 'imperial'], fromYear: 1340,
    description:
      'Knights in articulated full plate, proof against arrows at any sane range. ' +
      'The high point of mounted shock action, arriving precisely as pike and powder ' +
      'begin to make it obsolete.',
  }),
  u({
    id: 'dismounted_knights', name: 'Dismounted Knights', unitClass: 'heavy_infantry', tier: 4,
    soldiers: 100, attack: 12, defence: 11, armour: 8, shield: 3, morale: 15, discipline: 13,
    cost: 860, minSettlement: 'city', pools: ['latin_west', 'chivalry', 'crusader'],
    fromYear: 1280,
    description:
      'Knights who leave the horses behind and fight on foot with poleaxe and sword. ' +
      'Expensive, nearly unkillable from the front, and the English answer to the ' +
      'French cavalry charge.',
  }),
  u({
    id: 'crossbow_militia', name: 'Crossbow Militia', unitClass: 'crossbowmen', tier: 2,
    attack: 4, defence: 5, armour: 2, shield: 2, morale: 8, discipline: 10,
    range: 120, missileAttack: 11, ammunition: 24, cost: 350, minSettlement: 'town',
    pools: ['latin_west', 'italian', 'german', 'crossbow', 'slavic_west'], fromYear: 1140,
    description:
      'City levy with the windlass crossbow, trained at the municipal butts. Slow to ' +
      'reload and devastating at the moment of release.',
  }),
  u({
    id: 'pavise_crossbowmen', name: 'Pavise Crossbowmen', unitClass: 'crossbowmen', tier: 3,
    attack: 5, defence: 6, armour: 3, shield: 5, morale: 10, discipline: 12,
    range: 130, missileAttack: 13, ammunition: 28, cost: 520, minSettlement: 'large_town',
    pools: ['italian', 'crossbow', 'latin_west'], fromYear: 1200,
    description:
      'Crossbowmen behind a planted pavise, a body-length shield that lets them ' +
      'reload in safety. The combination dominates siege warfare for two centuries.',
  }),
  u({
    id: 'genoese_crossbowmen', name: 'Genoese Crossbowmen', unitClass: 'crossbowmen', tier: 4,
    attack: 6, defence: 8, armour: 4, shield: 5, morale: 12, discipline: 14,
    range: 140, missileAttack: 15, ammunition: 30, cost: 700, minSettlement: 'large_town',
    pools: [], factions: ['genoa'], fromYear: 1150,
    description:
      'The most sought-after missile troops in Christendom, hired by France, Hungary ' +
      'and the Byzantines alike. Steel bows, pavises, and a guild that enforces its ' +
      'own standards of marksmanship.',
  }),
  u({
    id: 'italian_militia_pikes', name: 'Italian Pike Militia', unitClass: 'pikemen', tier: 2,
    soldiers: 140, attack: 5, defence: 7, armour: 2, shield: 2, morale: 9, discipline: 11,
    abilities: ['anti_cavalry', 'schiltron'], cost: 400, minSettlement: 'town',
    pools: ['italian', 'lombard'], fromYear: 1150,
    description:
      'Communal infantry with long spears, raised by quarter and guild to keep the ' +
      'Emperor\'s knights out of Lombardy. They fight for their own city and nothing ' +
      'else, which is both their strength and their limit.',
  }),
  u({
    id: 'condottieri', name: 'Condottieri', unitClass: 'heavy_cavalry', tier: 4,
    attack: 12, charge: 12, defence: 11, armour: 8, shield: 3, morale: 12, discipline: 13,
    speed: 4.2, abilities: ['charge_bonus', 'highly_trained'], cost: 980, minSettlement: 'city',
    pools: ['italian', 'lombard'], fromYear: 1300,
    description:
      'Mercenary companies under contract, the professional soldiers of the Italian ' +
      'wars. Superbly equipped, tactically careful, and disinclined to take losses ' +
      'that a renegotiated contract could avoid.',
  }),
  u({
    id: 'swiss_pikemen', name: 'Swiss Pikemen', unitClass: 'pikemen', tier: 5,
    soldiers: 150, attack: 10, defence: 11, armour: 4, shield: 0, morale: 17, discipline: 17,
    speed: 1.4, abilities: ['anti_cavalry', 'schiltron', 'hardy', 'highly_trained'],
    cost: 1050, minSettlement: 'large_town',
    pools: ['pike'], factions: ['switzerland', 'burgundy', 'france'], fromYear: 1300,
    description:
      'Valley militia in deep squares of eighteen-foot pikes who advance instead of ' +
      'standing. They destroyed Burgundian chivalry three times in three years and ' +
      'took no ransoms.',
  }),
  u({
    id: 'halberdiers', name: 'Halberdiers', unitClass: 'heavy_infantry', tier: 3,
    attack: 11, defence: 7, armour: 4, shield: 0, morale: 12, discipline: 13,
    abilities: ['armour_piercing', 'anti_cavalry'], cost: 580, minSettlement: 'large_town',
    pools: ['german', 'pike', 'mountain', 'latin_west'], fromYear: 1280,
    description:
      'A spear, an axe and a hook on one eight-foot shaft: it stops a horse, opens ' +
      'plate and drags a rider off the saddle. The weapon that makes armoured ' +
      'cavalry stop charging infantry.',
  }),

  // --- England and Wales: the longbow
  u({
    id: 'longbowmen', name: 'Longbowmen', unitClass: 'archers', tier: 3,
    attack: 5, defence: 5, armour: 2, shield: 0, morale: 10, discipline: 12,
    range: 190, missileAttack: 14, ammunition: 32, abilities: ['stakes'],
    cost: 560, minSettlement: 'large_town', pools: ['longbow'], fromYear: 1180,
    description:
      'Yeomen archers with a six-foot yew bow drawn to the ear, the product of a law ' +
      'that makes practice compulsory and a society that can afford it. Volleys ' +
      'arrive faster than knights can close.',
  }),
  u({
    id: 'welsh_spearmen', name: 'Welsh Spearmen', unitClass: 'spearmen', tier: 2,
    attack: 6, defence: 6, armour: 1, shield: 3, morale: 10, discipline: 9, speed: 1.45,
    abilities: ['anti_cavalry', 'mountaineer', 'forest_fighter'], cost: 340,
    pools: [], factions: ['wales', 'england'],
    description:
      'Hillmen with long spears who fight in broken ground by choice, close, and ' +
      'disappear uphill before the counter-charge. Edward I needed castles, not ' +
      'battles, to beat them.',
  }),
  u({
    id: 'billmen', name: 'Billmen', unitClass: 'heavy_infantry', tier: 3,
    attack: 10, defence: 7, armour: 4, shield: 1, morale: 11, discipline: 12,
    abilities: ['armour_piercing', 'anti_cavalry'], cost: 540,
    pools: [], factions: ['england', 'scotland'], fromYear: 1250,
    description:
      'English infantry with the bill, a hedging tool grown into a polearm. Cheap, ' +
      'vicious in a press, and the natural partner of the longbow line it protects.',
  }),
  u({
    id: 'huscarls', name: 'Huscarls', unitClass: 'heavy_infantry', tier: 4,
    attack: 13, defence: 8, armour: 5, shield: 4, morale: 15, discipline: 14,
    abilities: ['armour_piercing', 'shield_wall'], cost: 740, minSettlement: 'large_town',
    pools: ['norse'], factions: ['denmark', 'norway', 'england', 'kievan_rus'], untilYear: 1250,
    description:
      'Sworn household warriors with the two-handed Danish axe, able to split a helm ' +
      'and the skull beneath it. The last and best of the North Sea infantry ' +
      'tradition.',
  }),

  // --- Iberia
  u({
    id: 'jinetes', name: 'Jinetes', unitClass: 'light_cavalry', tier: 2,
    attack: 7, charge: 7, defence: 5, armour: 2, shield: 3, morale: 10, discipline: 10,
    speed: 5.2, range: 30, missileAttack: 8, ammunition: 6, abilities: ['skirmish'],
    cost: 450, pools: ['iberian', 'andalusian'],
    description:
      'Light horse riding a la jineta with short stirrups, javelins and a round ' +
      'shield. Christians and Muslims in Spain both use them, because the ground and ' +
      'the war demand speed over weight.',
  }),
  u({
    id: 'almughavars', name: 'Almughavars', unitClass: 'light_infantry', tier: 3,
    attack: 11, defence: 6, armour: 1, shield: 2, morale: 13, discipline: 11, speed: 1.5,
    range: 25, missileAttack: 10, ammunition: 4,
    abilities: ['mountaineer', 'hardy', 'armour_piercing'], cost: 520,
    pools: [], factions: ['aragon', 'castile', 'navarre'], fromYear: 1180,
    description:
      'Frontier irregulars from the Pyrenean marches who live off the land and open ' +
      'battle by throwing heavy javelins into the enemy\'s horses. Aragon exports ' +
      'them to Sicily and Greece with devastating results.',
  }),
  u({
    id: 'order_knights_iberia', name: 'Knights of Santiago', unitClass: 'heavy_cavalry', tier: 4,
    attack: 13, charge: 13, defence: 11, armour: 7, shield: 4, morale: 17, discipline: 15,
    speed: 4.3, abilities: ['charge_bonus', 'highly_trained'], cost: 1020, minSettlement: 'city',
    pools: [], factions: ['castile', 'portugal', 'aragon'], fromYear: 1170,
    description:
      'Military-order brethren of the Reconquista, monks under vows who hold the ' +
      'frontier castles. Discipline that secular knights cannot match and a refusal ' +
      'to break that borders on the suicidal.',
  }),

  // --- France, Germany, the Empire
  u({
    id: 'french_men_at_arms', name: 'French Men-at-Arms', unitClass: 'heavy_infantry', tier: 3,
    attack: 10, defence: 9, armour: 6, shield: 4, morale: 12, discipline: 12,
    cost: 610, minSettlement: 'large_town',
    pools: ['feudal_french'], fromYear: 1200,
    description:
      'Professional soldiers of the royal ordinance, mail and plate over a padded ' +
      'coat. The crown\'s answer to the problem of vassals who go home at harvest.',
  }),
  u({
    id: 'imperial_spearmen', name: 'Imperial Spearmen', unitClass: 'spearmen', tier: 2,
    attack: 6, defence: 8, armour: 3, shield: 4, morale: 10, discipline: 12,
    abilities: ['shield_wall', 'anti_cavalry'], cost: 390,
    pools: ['german', 'imperial'],
    description:
      'Levies of the imperial cities and bishoprics, drilled to hold a line with ' +
      'spear and shield. Unremarkable, numerous, and present at every battle in ' +
      'Germany for four hundred years.',
  }),
  u({
    id: 'zweihander', name: 'Zweihander', unitClass: 'heavy_infantry', tier: 4,
    soldiers: 100, attack: 15, defence: 7, armour: 5, shield: 0, morale: 14, discipline: 13,
    abilities: ['armour_piercing'], cost: 820, minSettlement: 'city',
    pools: ['german'], fromYear: 1400,
    description:
      'Doppelsoldner paid double wages to walk into a pike hedge with a five-foot ' +
      'sword and break it open. The job description explains the pay.',
  }),

  // =========================================================================
  // Nordic
  // =========================================================================
  u({
    id: 'norse_raiders', name: 'Norse Raiders', unitClass: 'light_infantry', tier: 2,
    attack: 8, defence: 4, armour: 2, shield: 3, morale: 12, discipline: 8, speed: 1.45,
    abilities: ['hardy'], cost: 330, pools: ['norse'],
    description:
      'Shipborne freemen with axe, spear and round shield, raiding for a season and ' +
      'farming the rest. Fast, aggressive, and uninterested in any order that ' +
      'involves standing still.',
  }),
  u({
    id: 'noble_horsemen', name: 'Noble Horsemen', unitClass: 'light_cavalry', tier: 2,
    attack: 8, charge: 9, defence: 5, armour: 3, shield: 3, morale: 11, discipline: 9,
    speed: 4.8, cost: 440, pools: ['norse', 'gaelic'],
    description:
      'The mounted retinue of a northern or Gaelic lord. Neither tradition builds ' +
      'its armies around the horse, but every chieftain who can afford one rides to ' +
      'the field and fights beside it.',
  }),
  u({
    id: 'scandinavian_knights', name: 'Scandinavian Knights', unitClass: 'heavy_cavalry', tier: 3,
    attack: 11, charge: 11, defence: 8, armour: 6, shield: 4, morale: 13, discipline: 11,
    speed: 4.4, abilities: ['charge_bonus'], cost: 740, minSettlement: 'large_town',
    pools: ['norse'], fromYear: 1150,
    description:
      'Northern nobility that adopted continental mail, saddle and couched lance ' +
      'within two generations of conversion. Denmark fields them against the Wends ' +
      'and the Estonians with enthusiasm.',
  }),
  u({
    id: 'hobelars', name: 'Hobelars', unitClass: 'light_cavalry', tier: 2,
    attack: 7, charge: 7, defence: 5, armour: 2, shield: 3, morale: 10, discipline: 10,
    speed: 5.4, abilities: ['skirmish', 'forest_fighter'], cost: 420,
    pools: ['gaelic'], fromYear: 1200,
    description:
      'Light horse on the small tough Irish hobby, used for raiding, scouting and ' +
      'riding down fugitives. England borrows both the troops and the word for its ' +
      'Scottish wars.',
  }),
  u({
    id: 'norse_archers', name: 'Norse Archers', unitClass: 'archers', tier: 2,
    attack: 4, defence: 4, armour: 1, shield: 1, morale: 9, discipline: 9,
    range: 150, missileAttack: 10, ammunition: 26, cost: 320, pools: ['norse', 'forest'],
    description:
      'Hunters from the fjords and forests who shoot for the pot all winter and for ' +
      'the king in summer. The bow is a tool here, not a knightly disgrace.',
  }),
  u({
    id: 'norse_swordsmen', name: 'Norse Swordsmen', unitClass: 'heavy_infantry', tier: 3,
    attack: 11, defence: 7, armour: 4, shield: 4, morale: 13, discipline: 11,
    abilities: ['shield_wall'], cost: 560, minSettlement: 'large_town', pools: ['norse'],
    description:
      'Retainers in mail with sword and shield, the professional core of a northern ' +
      'host. They form a wall of linden boards and advance behind it, singing.',
  }),

  // =========================================================================
  // Celtic
  // =========================================================================
  u({
    id: 'kerns', name: 'Kerns', unitClass: 'javelinmen', tier: 1,
    soldiers: 140, attack: 6, defence: 3, armour: 0, shield: 2, morale: 8, discipline: 7,
    speed: 1.6, range: 30, missileAttack: 9, ammunition: 7,
    abilities: ['skirmish', 'forest_fighter', 'hardy'], cost: 260, pools: ['gaelic'],
    description:
      'Irish and Highland light foot in linen, carrying darts and a long knife. They ' +
      'will not stand against cavalry and do not need to: the bog and the wood are ' +
      'their formation.',
  }),
  u({
    id: 'galloglaich', name: 'Gallowglass', unitClass: 'heavy_infantry', tier: 4,
    attack: 14, defence: 7, armour: 4, shield: 1, morale: 15, discipline: 13,
    abilities: ['armour_piercing', 'hardy'], cost: 720, minSettlement: 'town',
    pools: ['gaelic'], fromYear: 1250,
    description:
      'Hebridean mercenary axemen of mixed Norse and Gaelic blood, hired by Irish ' +
      'kings for a fixed term and fed by the countryside. A charge of gallowglass ' +
      'decides most Irish battles in the first minute.',
  }),
  u({
    id: 'highland_pikes', name: 'Highland Spearmen', unitClass: 'pikemen', tier: 3,
    soldiers: 150, attack: 7, defence: 9, armour: 2, shield: 2, morale: 13, discipline: 13,
    abilities: ['schiltron', 'anti_cavalry', 'mountaineer'], cost: 480,
    pools: [], factions: ['scotland'], fromYear: 1180,
    description:
      'Scots in a schiltron, a hedgehog of twelve-foot spears that no horse will ' +
      'enter. It wins at Stirling Bridge and Bannockburn, and loses at Falkirk to ' +
      'archery it cannot answer.',
  }),

  // =========================================================================
  // West Slavs, Hungary, the Baltic
  // =========================================================================
  u({
    id: 'slavic_levy', name: 'Slavic Levy', unitClass: 'spearmen', tier: 1,
    soldiers: 150, attack: 5, defence: 4, armour: 1, shield: 3, morale: 8, discipline: 8,
    abilities: ['shield_wall'], cost: 280, pools: ['west_slavic', 'east_slavic', 'south_slavic'],
    description:
      'Village militia of the Slavic lands, mustered by the local castellan with ' +
      'spear and painted shield. Numerous, willing and thinly armoured.',
  }),
  u({
    id: 'slavic_axemen', name: 'Slavic Axemen', unitClass: 'heavy_infantry', tier: 2,
    attack: 9, defence: 5, armour: 3, shield: 3, morale: 11, discipline: 10,
    abilities: ['armour_piercing'], cost: 420,
    pools: ['west_slavic', 'east_slavic', 'south_slavic'],
    description:
      'Druzhina retainers with the bearded axe, the standard close-quarters weapon ' +
      'from the Elbe to the Dnieper. It goes through a shield and the arm behind it.',
  }),
  u({
    id: 'polish_lancers', name: 'Polish Lancers', unitClass: 'heavy_cavalry', tier: 4,
    attack: 12, charge: 14, defence: 9, armour: 6, shield: 3, morale: 14, discipline: 11,
    speed: 4.6, abilities: ['charge_bonus'], cost: 920, minSettlement: 'city',
    pools: ['lance'], factions: ['poland', 'lithuania'], fromYear: 1200,
    description:
      'Polish and Lithuanian nobles with the long lance, drilled to deliver a single ' +
      'overwhelming charge in close order. The ancestor of the winged hussar.',
  }),
  u({
    id: 'magyar_horse_archers', name: 'Magyar Horse Archers', unitClass: 'horse_archers', tier: 3,
    attack: 6, charge: 5, defence: 5, armour: 2, shield: 2, morale: 11, discipline: 11,
    speed: 5.6, range: 160, missileAttack: 12, ammunition: 30,
    abilities: ['skirmish', 'feigned_retreat'], cost: 620,
    pools: [], factions: ['hungary', 'croatia'],
    description:
      'Hungary keeps the steppe way of war inside a Latin kingdom: composite bow, ' +
      'spare horses, and the feigned flight that turns a pursuit into a massacre.',
  }),
  u({
    id: 'croatian_light_horse', name: 'Croatian Light Horse', unitClass: 'light_cavalry', tier: 3,
    attack: 9, charge: 9, defence: 6, armour: 3, shield: 3, morale: 12, discipline: 11,
    speed: 5.4, abilities: ['skirmish', 'mountaineer'], cost: 560,
    pools: [], factions: ['croatia', 'hungary', 'bosnia'],
    description:
      'Raiders of the Dinaric frontier, riding small hardy horses through country ' +
      'that stops heavy cavalry. Europe borrows their name for light horse entirely: ' +
      'the hussar.',
  }),
  u({
    id: 'baltic_tribesmen', name: 'Baltic Tribesmen', unitClass: 'light_infantry', tier: 2,
    soldiers: 140, attack: 8, defence: 4, armour: 1, shield: 2, morale: 12, discipline: 8,
    speed: 1.5, abilities: ['forest_fighter', 'hardy', 'skirmish'], cost: 320,
    pools: ['baltic', 'forest'],
    description:
      'Prussian, Lithuanian and Samogitian warriors fighting in forest and marsh ' +
      'that no crusader column can hold. Sacred groves behind them and nowhere to ' +
      'retreat.',
  }),
  u({
    id: 'hussite_handgunners', name: 'Hussite Handgunners', unitClass: 'gunpowder_infantry', tier: 4,
    attack: 5, defence: 6, armour: 3, shield: 0, morale: 14, discipline: 15,
    range: 95, missileAttack: 26, ammunition: 14, abilities: ['armour_piercing', 'stakes'],
    cost: 780, minSettlement: 'city', pools: [], factions: ['bohemia'], fromYear: 1415,
    description:
      'Bohemian peasants and artisans with the handgonne, shooting from behind a ring ' +
      'of chained war wagons. Five crusades are preached against them, and five ' +
      'crusades are destroyed.',
  }),
  u({
    id: 'teutonic_sergeants', name: 'Teutonic Sergeants', unitClass: 'heavy_infantry', tier: 3,
    attack: 10, defence: 10, armour: 6, shield: 4, morale: 14, discipline: 15,
    abilities: ['shield_wall'], cost: 640, pools: ['order'], fromYear: 1200,
    description:
      'Half-brothers of the military orders, serving for life without taking the full ' +
      'vows. Unglamorous, superbly equipped from the order\'s own armouries, and ' +
      'never short of ammunition.',
  }),
  u({
    id: 'teutonic_knights', name: 'Teutonic Knights', unitClass: 'heavy_cavalry', tier: 5,
    attack: 14, charge: 14, defence: 12, armour: 8, shield: 4, morale: 18, discipline: 17,
    speed: 4.2, abilities: ['charge_bonus', 'highly_trained'], cost: 1250, minSettlement: 'city',
    pools: [], factions: ['teutonic_order'], fromYear: 1200,
    description:
      'Brother knights of the Order of Saint Mary, under vows of poverty, chastity ' +
      'and obedience, in the finest harness money can buy. They do not retreat ' +
      'without permission, which is occasionally a problem.',
  }),

  // =========================================================================
  // East Slavs
  // =========================================================================
  u({
    id: 'druzhina', name: 'Druzhina', unitClass: 'heavy_cavalry', tier: 3,
    attack: 11, charge: 10, defence: 8, armour: 5, shield: 3, morale: 13, discipline: 12,
    speed: 4.6, abilities: ['charge_bonus'], cost: 760, minSettlement: 'large_town',
    pools: ['east_slavic'],
    description:
      'The prince\'s sworn companions, mounted in lamellar and mail with bow, lance ' +
      'and sabre. Steppe equipment, Byzantine taste, and a Scandinavian sense of ' +
      'personal loyalty.',
  }),
  u({
    id: 'rus_spearmen', name: 'Rus Spearmen', unitClass: 'spearmen', tier: 2,
    attack: 6, defence: 7, armour: 3, shield: 4, morale: 10, discipline: 11,
    abilities: ['shield_wall', 'anti_cavalry'], cost: 380, pools: ['east_slavic'],
    description:
      'Town regiments of the Rus cities, the thousand-men of Novgorod and Kiev, ' +
      'armed by their own guilds. They hold the centre while the druzhina manoeuvre.',
  }),
  u({
    id: 'boyar_sons', name: 'Boyar Sons', unitClass: 'heavy_cavalry', tier: 4,
    attack: 12, charge: 12, defence: 10, armour: 7, shield: 3, morale: 15, discipline: 13,
    speed: 4.4, range: 120, missileAttack: 10, ammunition: 16,
    abilities: ['charge_bonus'], cost: 1000, minSettlement: 'city',
    pools: [], factions: ['muscovy', 'novgorod'], fromYear: 1300,
    description:
      'Muscovite service nobility holding land in exchange for mounted service, ' +
      'armoured in mirror plate and lamellar and carrying both bow and lance. ' +
      'Half knight, half horse archer.',
  }),

  // =========================================================================
  // Balkans
  // =========================================================================
  u({
    id: 'balkan_mountain_infantry', name: 'Mountain Infantry', unitClass: 'light_infantry', tier: 2,
    attack: 8, defence: 6, armour: 2, shield: 3, morale: 12, discipline: 10, speed: 1.5,
    abilities: ['mountaineer', 'hardy', 'forest_fighter'], cost: 360,
    pools: ['mountain', 'south_slavic'],
    description:
      'Highlanders of the Dinarides, Rhodopes and Albanian ranges who fight in ' +
      'ground where formations dissolve. Ambush, close with the knife, and withdraw ' +
      'uphill.',
  }),
  u({
    id: 'serbian_hussars', name: 'Serbian Armoured Lancers', unitClass: 'heavy_cavalry', tier: 4,
    attack: 13, charge: 14, defence: 10, armour: 7, shield: 3, morale: 15, discipline: 12,
    speed: 4.5, abilities: ['charge_bonus'], cost: 980, minSettlement: 'city',
    pools: [], factions: ['serbia', 'bosnia'], fromYear: 1280,
    description:
      'Nemanjic nobility in western plate over eastern lamellar, the heaviest cavalry ' +
      'in the Balkans. At Kosovo they break the Ottoman line and cannot exploit it.',
  }),
  u({
    id: 'vlach_raiders', name: 'Vlach Raiders', unitClass: 'light_cavalry', tier: 2,
    attack: 8, charge: 8, defence: 5, armour: 2, shield: 2, morale: 11, discipline: 9,
    speed: 5.4, range: 140, missileAttack: 9, ammunition: 18,
    abilities: ['skirmish', 'forest_fighter'], cost: 460,
    pools: [], factions: ['wallachia', 'bulgaria', 'serbia'],
    description:
      'Danubian horsemen who burn the country ahead of an invader and shoot his ' +
      'foragers at dusk. Wallachia fights no battles it can win by starvation ' +
      'instead.',
  }),
  u({
    id: 'stratioti', name: 'Stratioti', unitClass: 'light_cavalry', tier: 3,
    attack: 10, charge: 10, defence: 7, armour: 3, shield: 3, morale: 13, discipline: 12,
    speed: 5.3, range: 30, missileAttack: 9, ammunition: 5, abilities: ['skirmish', 'mountaineer'],
    cost: 580, pools: [], factions: ['albania', 'venice', 'ragusa'], fromYear: 1400,
    description:
      'Albanian and Greek light horse in Venetian pay, armed with lance, javelins and ' +
      'sabre. The Republic\'s answer to Ottoman akinci, and just as hard to pin down.',
  }),

  // =========================================================================
  // Byzantium, Caucasus, Greek world
  // =========================================================================
  u({
    id: 'skutatoi', name: 'Skutatoi', unitClass: 'spearmen', tier: 3,
    attack: 7, defence: 10, armour: 5, shield: 5, morale: 12, discipline: 14,
    abilities: ['shield_wall', 'anti_cavalry'], cost: 490, minSettlement: 'town',
    pools: ['byzantine'],
    description:
      'Byzantine line infantry with the large oval shield and the long spear, drilled ' +
      'from the manuals of emperors. The formation matters more than the man, which ' +
      'is exactly the Roman idea.',
  }),
  u({
    id: 'toxotai', name: 'Toxotai', unitClass: 'archers', tier: 2,
    attack: 4, defence: 5, armour: 2, shield: 1, morale: 9, discipline: 12,
    range: 160, missileAttack: 11, ammunition: 30, cost: 360, pools: ['byzantine', 'greek'],
    description:
      'Imperial foot archers shooting in massed volleys from behind the spear line, ' +
      'as the tactical treatises prescribe. Unspectacular and relentlessly ' +
      'effective.',
  }),
  u({
    id: 'kataphraktoi', name: 'Kataphraktoi', unitClass: 'heavy_cavalry', tier: 5,
    attack: 13, charge: 13, defence: 12, armour: 9, shield: 2, morale: 16, discipline: 16,
    speed: 3.9, abilities: ['charge_bonus', 'highly_trained'], cost: 1280, minSettlement: 'city',
    pools: [], factions: ['byzantium', 'trebizond'],
    description:
      'Man and horse both armoured in lamellar, advancing at the trot in a blunt ' +
      'wedge to grind through a line rather than shatter it. The most expensive ' +
      'cavalry in the world to maintain.',
  }),
  u({
    id: 'varangian_guard', name: 'Varangian Guard', unitClass: 'heavy_infantry', tier: 5,
    attack: 15, defence: 9, armour: 6, shield: 3, morale: 19, discipline: 16,
    abilities: ['armour_piercing', 'berserk'], cost: 1150, minSettlement: 'large_city',
    pools: [], factions: ['byzantium'],
    description:
      'Northmen and, after Hastings, exiled Englishmen sworn to the emperor\'s person ' +
      'and paid in gold. Two-handed axes, no interest in Byzantine politics, and a ' +
      'reputation for dying where they stand.',
  }),
  u({
    id: 'trapezitoi', name: 'Trapezitoi', unitClass: 'light_cavalry', tier: 2,
    attack: 7, charge: 7, defence: 5, armour: 2, shield: 3, morale: 10, discipline: 12,
    speed: 5.3, range: 30, missileAttack: 8, ammunition: 6, abilities: ['skirmish'],
    cost: 430, pools: ['byzantine', 'greek'],
    description:
      'Light Byzantine horse for scouting, screening and harassment, the eyes of the ' +
      'imperial field army. They are told not to charge, and mostly obey.',
  }),
  u({
    id: 'georgian_monaspa', name: 'Monaspa', unitClass: 'heavy_cavalry', tier: 4,
    attack: 13, charge: 13, defence: 10, armour: 7, shield: 3, morale: 16, discipline: 14,
    speed: 4.4, abilities: ['charge_bonus', 'mountaineer'], cost: 1010, minSettlement: 'city',
    pools: [], factions: ['georgia'], fromYear: 1100,
    description:
      'The royal guard cavalry of Georgia, raised by David the Builder as a standing ' +
      'force loyal to the crown rather than to the clans. At Didgori they break a ' +
      'Seljuk army several times their size.',
  }),
  u({
    id: 'armenian_archers', name: 'Armenian Archers', unitClass: 'archers', tier: 3,
    attack: 5, defence: 6, armour: 3, shield: 2, morale: 11, discipline: 12,
    range: 165, missileAttack: 12, ammunition: 30, abilities: ['mountaineer'], cost: 440,
    pools: ['caucasian'],
    description:
      'Highland bowmen from the Taurus and the Armenian plateau, valued by crusader ' +
      'and Byzantine paymasters alike. They shoot downhill at targets that cannot ' +
      'reach them.',
  }),

  // =========================================================================
  // Islamic Near East
  // =========================================================================
  u({
    id: 'ghazi_infantry', name: 'Ghazi Infantry', unitClass: 'light_infantry', tier: 1,
    soldiers: 150, attack: 7, defence: 3, armour: 0, shield: 2, morale: 13, discipline: 6,
    speed: 1.5, abilities: ['berserk'], cost: 280, pools: ['levantine_muslim', 'turkic'],
    description:
      'Volunteers for the frontier war, fighting for faith and plunder with little ' +
      'equipment and less training. They do not break, which is not the same as being ' +
      'useful.',
  }),
  u({
    id: 'arab_spearmen', name: 'Arab Spearmen', unitClass: 'spearmen', tier: 2,
    attack: 6, defence: 7, armour: 2, shield: 4, morale: 10, discipline: 11,
    abilities: ['shield_wall', 'anti_cavalry'], cost: 360, pools: ['levantine_muslim'],
    description:
      'City levies of Syria and Egypt with spear and leather-faced shield, holding ' +
      'the line while the horse archers do the work. Cheap and perfectly adequate at ' +
      'it.',
  }),
  u({
    id: 'turkish_horse_archers', name: 'Turcoman Horse Archers', unitClass: 'horse_archers', tier: 3,
    attack: 6, charge: 5, defence: 5, armour: 2, shield: 1, morale: 11, discipline: 11,
    speed: 5.7, range: 165, missileAttack: 12, ammunition: 32,
    abilities: ['skirmish', 'feigned_retreat', 'desert_hardy'], cost: 600,
    pools: ['turkic', 'steppe_light'],
    description:
      'Nomad Turks from the Anatolian and Iranian pastures, shooting at the gallop in ' +
      'loose swarms. They killed a Byzantine army at Manzikert without ever closing ' +
      'to contact.',
  }),
  u({
    id: 'ghulam_cavalry', name: 'Ghulam Cavalry', unitClass: 'heavy_cavalry', tier: 4,
    attack: 12, charge: 12, defence: 10, armour: 7, shield: 3, morale: 15, discipline: 15,
    speed: 4.5, range: 130, missileAttack: 10, ammunition: 18,
    abilities: ['charge_bonus', 'highly_trained'], cost: 1000, minSettlement: 'city',
    pools: ['levantine_muslim', 'turkic', 'persian'],
    description:
      'Slave soldiers bought as boys, raised in the barracks and trained to use bow, ' +
      'lance and mace from the saddle. Loyal to the household that made them and to ' +
      'nothing else.',
  }),
  u({
    id: 'mamluk_royal', name: 'Royal Mamluks', unitClass: 'heavy_cavalry', tier: 5,
    attack: 15, charge: 14, defence: 12, armour: 8, shield: 3, morale: 17, discipline: 17,
    speed: 4.5, range: 140, missileAttack: 13, ammunition: 24,
    abilities: ['charge_bonus', 'highly_trained', 'desert_hardy'], cost: 1350,
    minSettlement: 'large_city', pools: ['elite_cavalry'], factions: ['mamluks', 'ayyubids'],
    fromYear: 1200,
    description:
      'The sultan\'s own regiments, the finest cavalry of the medieval world: ' +
      'horse-archery to Mongol standard and shock action to knightly standard, in the ' +
      'same squadron. They stopped both.',
  }),
  u({
    id: 'naffatun', name: 'Naffatun', unitClass: 'javelinmen', tier: 3,
    soldiers: 80, attack: 4, defence: 4, armour: 2, shield: 1, morale: 10, discipline: 11,
    range: 45, missileAttack: 22, ammunition: 8, abilities: ['armour_piercing'], cost: 520,
    pools: ['levantine_muslim'],
    description:
      'Naphtha troops throwing clay grenades of burning petroleum, used to break ' +
      'formations and set siege engines alight. Terrifying, short-ranged, and ' +
      'dangerous to stand near.',
  }),
  u({
    id: 'janissaries', name: 'Janissaries', unitClass: 'gunpowder_infantry', tier: 5,
    attack: 8, defence: 9, armour: 4, shield: 0, morale: 17, discipline: 18,
    range: 100, missileAttack: 28, ammunition: 16,
    abilities: ['armour_piercing', 'highly_trained'], cost: 1200, minSettlement: 'large_city',
    pools: ['elite_infantry'], factions: ['ottomans'], fromYear: 1380,
    description:
      'Christian boys levied, converted and raised as the sultan\'s standing ' +
      'infantry: barracked, salaried, drilled with the arquebus. The first permanent ' +
      'professional army in Europe since Rome.',
  }),
  u({
    id: 'janissary_archers', name: 'Janissary Archers', unitClass: 'archers', tier: 4,
    attack: 7, defence: 8, armour: 3, shield: 1, morale: 16, discipline: 17,
    range: 170, missileAttack: 14, ammunition: 32, abilities: ['highly_trained'], cost: 880,
    minSettlement: 'city', pools: [], factions: ['ottomans'], fromYear: 1330,
    description:
      'The original janissary corps before the handgun, composite bows in the hands ' +
      'of lifelong professionals. Rate of fire and discipline that no levy archer can ' +
      'approach.',
  }),
  u({
    id: 'sipahi', name: 'Sipahi', unitClass: 'heavy_cavalry', tier: 4,
    attack: 12, charge: 13, defence: 9, armour: 6, shield: 3, morale: 14, discipline: 13,
    speed: 4.8, range: 140, missileAttack: 10, ammunition: 20,
    abilities: ['charge_bonus'], cost: 940, minSettlement: 'city',
    pools: [], factions: ['ottomans'], fromYear: 1330,
    description:
      'Timariot cavalry holding land grants in return for mounted service, the ' +
      'Ottoman equivalent of the feudal knight and rather better at archery.',
  }),
  u({
    id: 'akinci', name: 'Akinci', unitClass: 'light_cavalry', tier: 2,
    attack: 8, charge: 8, defence: 4, armour: 1, shield: 2, morale: 11, discipline: 9,
    speed: 5.8, range: 150, missileAttack: 9, ammunition: 20,
    abilities: ['skirmish', 'feigned_retreat'], cost: 430,
    pools: [], factions: ['ottomans'], fromYear: 1330,
    description:
      'Unpaid raiders who ride ahead of the Ottoman army living entirely off plunder, ' +
      'emptying the countryside weeks before the main force arrives.',
  }),
  u({
    id: 'kurdish_javelinmen', name: 'Kurdish Javelinmen', unitClass: 'javelinmen', tier: 2,
    attack: 7, defence: 5, armour: 1, shield: 3, morale: 11, discipline: 10, speed: 1.5,
    range: 32, missileAttack: 10, ammunition: 7, abilities: ['skirmish', 'mountaineer'],
    cost: 340, pools: ['kurdish'],
    description:
      'Mountain tribesmen of the Zagros, the recruiting pool that gave Saladin his ' +
      'family and his first troops. Deadly in broken ground and bored by sieges.',
  }),

  // =========================================================================
  // Maghreb and al-Andalus
  // =========================================================================
  u({
    id: 'berber_spearmen', name: 'Berber Spearmen', unitClass: 'spearmen', tier: 2,
    attack: 6, defence: 6, armour: 1, shield: 4, morale: 11, discipline: 11, speed: 1.4,
    abilities: ['shield_wall', 'anti_cavalry', 'desert_hardy'], cost: 340, pools: ['berber'],
    description:
      'Sanhaja and Masmuda tribesmen with long spears and leather shields, fighting ' +
      'in dense ranks to drums. The Almoravid and Almohad battle line, and far ' +
      'steadier than its Christian opponents expect.',
  }),
  u({
    id: 'tuareg_camel_riders', name: 'Saharan Camel Riders', unitClass: 'camel_cavalry', tier: 3,
    attack: 9, charge: 9, defence: 6, armour: 2, shield: 3, morale: 12, discipline: 10,
    speed: 4.4, range: 30, missileAttack: 9, ammunition: 6,
    abilities: ['desert_hardy', 'skirmish'], cost: 540, pools: ['berber', 'sahelian'],
    description:
      'Camel-mounted Saharan warriors whose mounts terrify horses that have never ' +
      'smelled them. They cross ground no cavalry army can follow them across.',
  }),
  u({
    id: 'andalusian_archers', name: 'Andalusian Archers', unitClass: 'archers', tier: 2,
    attack: 4, defence: 5, armour: 2, shield: 2, morale: 10, discipline: 12,
    range: 155, missileAttack: 11, ammunition: 28, cost: 370, pools: ['andalusian'],
    description:
      'Bowmen of the Iberian taifas, often Christian or Berber mercenaries in Muslim ' +
      'pay. Al-Andalus buys its soldiers and spends its talent on poetry and ' +
      'astronomy.',
  }),
  u({
    id: 'black_guard', name: 'Black Guard', unitClass: 'heavy_infantry', tier: 4,
    attack: 12, defence: 9, armour: 5, shield: 4, morale: 17, discipline: 16,
    abilities: ['shield_wall', 'highly_trained', 'desert_hardy'], cost: 850,
    minSettlement: 'city', pools: ['african_muslim'],
    factions: ['almoravids', 'almohads', 'marinids', 'hafsids'],
    description:
      'Sudanese slave infantry forming the household guard of the Moroccan dynasties: ' +
      'drilled, salaried, and politically reliable precisely because they have no ' +
      'tribal interest.',
  }),
  u({
    id: 'granadine_jinetes', name: 'Granadine Jinetes', unitClass: 'light_cavalry', tier: 3,
    attack: 10, charge: 10, defence: 7, armour: 3, shield: 4, morale: 13, discipline: 12,
    speed: 5.5, range: 32, missileAttack: 10, ammunition: 7,
    abilities: ['skirmish', 'mountaineer'], cost: 590,
    pools: [], factions: ['granada', 'marinids'], fromYear: 1240,
    description:
      'The best light horse in Iberia, raiding out of the Sierra Nevada and back ' +
      'before a Castilian column can form. Granada survives two and a half centuries ' +
      'on their speed.',
  }),

  // =========================================================================
  // Steppe
  // =========================================================================
  u({
    id: 'steppe_nomads', name: 'Steppe Nomads', unitClass: 'horse_archers', tier: 2,
    attack: 5, charge: 5, defence: 4, armour: 1, shield: 1, morale: 10, discipline: 9,
    speed: 5.8, range: 155, missileAttack: 11, ammunition: 30,
    abilities: ['skirmish', 'feigned_retreat', 'hardy'], cost: 450, pools: ['steppe_light'],
    description:
      'Herdsmen who learn to ride and shoot before they can read, because none of ' +
      'them can read. Every adult male is already a cavalryman; the horde needs only ' +
      'to assemble them.',
  }),
  u({
    id: 'subject_levies', name: 'Subject Levies', unitClass: 'light_infantry', tier: 1,
    soldiers: 160, attack: 6, defence: 4, armour: 1, shield: 2, morale: 7, discipline: 9,
    speed: 1.4, cost: 230, pools: ['steppe_light', 'mongol'],
    description:
      'Foot soldiers conscripted from conquered towns and driven ahead of the horde ' +
      'to fill ditches and carry ladders. The steppe supplies no infantry of its ' +
      'own, so it takes other people\'s.',
  }),
  u({
    id: 'nomad_foot_archers', name: 'Nomad Foot Archers', unitClass: 'archers', tier: 2,
    soldiers: 130, attack: 4, defence: 4, armour: 1, shield: 1, morale: 9, discipline: 9,
    range: 155, missileAttack: 11, ammunition: 30, abilities: ['hardy'], cost: 310,
    pools: ['steppe_light'],
    description:
      'Horsemen who have lost their mounts, or poorer clansmen who never had one, ' +
      'shooting the same composite bow on foot. A siege line needs archers who can ' +
      'stand still.',
  }),
  u({
    id: 'steppe_lancers', name: 'Steppe Lancers', unitClass: 'light_cavalry', tier: 3,
    attack: 10, charge: 11, defence: 6, armour: 3, shield: 2, morale: 12, discipline: 11,
    speed: 5.4, abilities: ['charge_bonus'], cost: 580, pools: ['steppe_light'],
    description:
      'Nomad nobility in lamellar with lance and mace, the shock element that ' +
      'finishes what the arrows started. Rich enough to armour both themselves and ' +
      'the front of the horse.',
  }),
  u({
    id: 'mongol_heavy_lancers', name: 'Mongol Heavy Lancers', unitClass: 'heavy_cavalry', tier: 5,
    attack: 14, charge: 14, defence: 10, armour: 6, shield: 2, morale: 17, discipline: 18,
    speed: 5.0, range: 150, missileAttack: 12, ammunition: 24,
    abilities: ['charge_bonus', 'highly_trained', 'hardy', 'feigned_retreat'], cost: 1200,
    pools: ['mongol'], fromYear: 1200,
    description:
      'The heavy wing of the Mongol tumen: lamellar, lance, bow and three remounts ' +
      'each, manoeuvring by signal flag and drum across a thirty-mile frontage. ' +
      'Nothing in Europe can match the coordination.',
  }),
  u({
    id: 'keshik', name: 'Keshik', unitClass: 'heavy_cavalry', tier: 5,
    attack: 15, charge: 14, defence: 12, armour: 7, shield: 2, morale: 19, discipline: 19,
    speed: 4.9, range: 155, missileAttack: 13, ammunition: 26,
    abilities: ['charge_bonus', 'highly_trained', 'hardy'], cost: 1400, minSettlement: 'city',
    pools: [], factions: ['mongols', 'golden_horde', 'timurids'], fromYear: 1206,
    description:
      'The khan\'s own guard, ten thousand strong, from which every Mongol general is ' +
      'drawn. Service in the keshik is both an honour and a hostage arrangement for ' +
      'the loyalty of its members\' fathers.',
  }),

  // =========================================================================
  // Sahel and Nubia
  // =========================================================================
  u({
    id: 'sahel_bowmen', name: 'Sahel Bowmen', unitClass: 'archers', tier: 2,
    soldiers: 140, attack: 4, defence: 4, armour: 0, shield: 2, morale: 10, discipline: 10,
    range: 145, missileAttack: 11, ammunition: 28, abilities: ['desert_hardy'], cost: 320,
    pools: ['sahelian'],
    description:
      'Levied archers of the Niger and Chad basins, shooting poisoned arrows in ' +
      'enormous numbers. Mali musters them by the ten thousand from its vassal ' +
      'provinces.',
  }),
  u({
    id: 'sahel_heavy_cavalry', name: 'Sahelian Heavy Cavalry', unitClass: 'heavy_cavalry', tier: 4,
    attack: 12, charge: 13, defence: 9, armour: 6, shield: 3, morale: 14, discipline: 13,
    speed: 4.4, abilities: ['charge_bonus', 'desert_hardy'], cost: 950, minSettlement: 'city',
    pools: ['sahelian'], fromYear: 1200,
    description:
      'Quilted-armoured lancers on imported North African horses, the decisive arm ' +
      'and the prestige good of the Sahelian empires. Each horse is bought with gold ' +
      'or slaves across the desert.',
  }),
  u({
    id: 'nubian_archers', name: 'Nubian Archers', unitClass: 'archers', tier: 3,
    attack: 5, defence: 5, armour: 1, shield: 2, morale: 12, discipline: 13,
    range: 170, missileAttack: 13, ammunition: 30, abilities: ['desert_hardy'], cost: 430,
    pools: ['nubian'],
    description:
      'The archers of Makuria, who shot the invading Arab armies in the face so ' +
      'reliably that the chroniclers called them the pupil-smiters. Nubia kept its ' +
      'independence by treaty afterwards.',
  }),

  // =========================================================================
  // Siege engines
  // =========================================================================
  u({
    id: 'mercenary_cavalry', name: 'Mercenary Cavalry', unitClass: 'light_cavalry', tier: 2,
    attack: 8, charge: 9, defence: 6, armour: 4, shield: 3, morale: 10, discipline: 11,
    speed: 4.7, abilities: ['charge_bonus'], cost: 560, upkeep: 90, minSettlement: 'town',
    pools: ['universal_settled'],
    description:
      'Horsemen hired by contract rather than raised by obligation, available to any ' +
      'state with a treasury. They serve well while paid and leave the moment the ' +
      'money or the campaign season stops.',
  }),
  u({
    id: 'ballista', name: 'Ballista', unitClass: 'siege_engine', tier: 2,
    soldiers: 24, attack: 4, defence: 3, armour: 1, morale: 8, discipline: 11, speed: 0.8,
    range: 200, missileAttack: 40, ammunition: 30, abilities: ['siege_crew', 'armour_piercing'],
    cost: 420, minSettlement: 'town', pools: ['universal_settled'],
    description:
      'A great torsion crossbow on a frame, shooting a bolt that passes through ' +
      'several men. Accurate against formations and useless against walls.',
  }),
  u({
    id: 'catapult', name: 'Catapult', unitClass: 'siege_engine', tier: 2,
    soldiers: 24, attack: 3, defence: 2, armour: 1, morale: 8, discipline: 11, speed: 0.7,
    range: 260, missileAttack: 70, ammunition: 20, abilities: ['siege_crew'],
    cost: 520, minSettlement: 'town', pools: ['universal_settled', 'siege_expert'],
    description:
      'A torsion engine throwing stones in a flat arc, inherited from Rome by way of ' +
      'Byzantium. It will eventually knock down a wooden palisade.',
  }),
  u({
    id: 'trebuchet', name: 'Trebuchet', unitClass: 'siege_engine', tier: 3,
    soldiers: 30, attack: 3, defence: 2, armour: 1, morale: 9, discipline: 12, speed: 0.6,
    range: 300, missileAttack: 130, ammunition: 18, abilities: ['siege_crew'],
    cost: 720, minSettlement: 'large_town', pools: ['universal_settled', 'siege_expert'], fromYear: 1180,
    description:
      'The counterweight trebuchet: tons of ballast dropping to hurl a hundred-pound ' +
      'stone into masonry. It ends the age of the unbreachable castle wall.',
  }),
  u({
    id: 'bombard', name: 'Bombard', unitClass: 'siege_engine', tier: 4,
    soldiers: 24, attack: 3, defence: 2, armour: 2, morale: 10, discipline: 13, speed: 0.5,
    range: 320, missileAttack: 180, ammunition: 14,
    abilities: ['siege_crew', 'armour_piercing'], cost: 1000, minSettlement: 'city',
    pools: ['gunpowder', 'universal_settled'], fromYear: 1370,
    description:
      'A wrought-iron gun firing a stone ball, slow to load and catastrophic when it ' +
      'lands. Mehmed\'s bombards bring down the Theodosian walls that stood a ' +
      'thousand years.',
  }),
  u({
    id: 'culverin', name: 'Culverin', unitClass: 'siege_engine', tier: 5,
    soldiers: 24, attack: 3, defence: 3, armour: 2, morale: 11, discipline: 14, speed: 0.9,
    range: 360, missileAttack: 150, ammunition: 24,
    abilities: ['siege_crew', 'armour_piercing'], cost: 1150, minSettlement: 'city',
    pools: ['gunpowder'], fromYear: 1430,
    description:
      'A long bronze gun cast as one piece, mounted on a wheeled carriage and able to ' +
      'keep up with an army. Artillery stops being a siege curiosity and becomes a ' +
      'battlefield arm.',
  }),

  // =========================================================================
  // Generals
  // =========================================================================
  u({
    id: 'general_bodyguard_west', name: 'General\'s Bodyguard', unitClass: 'general', tier: 5,
    soldiers: 24, attack: 14, charge: 14, defence: 12, armour: 8, shield: 4, morale: 18,
    discipline: 15, speed: 4.3, abilities: ['charge_bonus'], cost: 0, upkeep: 0,
    pools: ['latin_west', 'slavic_west', 'nordic', 'celtic'],
    description:
      'The commander and his sworn retinue. While the banner stands the army takes ' +
      'heart from it; when it falls, courage goes with it.',
  }),
  u({
    id: 'general_bodyguard_east', name: 'General\'s Retinue', unitClass: 'general', tier: 5,
    soldiers: 24, attack: 13, charge: 13, defence: 12, armour: 7, shield: 3, morale: 18,
    discipline: 16, speed: 4.5, range: 140, missileAttack: 11, ammunition: 20,
    abilities: ['charge_bonus'], cost: 0, upkeep: 0,
    pools: ['hellenic', 'levantine', 'steppe', 'balkan', 'slavic_east', 'maghrebi', 'sahelian'],
    description:
      'The commander with his household cavalry, bow at the saddle as well as lance. ' +
      'Eastern generals are expected to shoot as well as lead.',
  }),
];

/** Everything that can fight, afloat or ashore. */
export const UNIT_TYPES: readonly UnitType[] = [...LAND_UNITS, ...SHIP_TYPES];

const BY_ID = new Map(UNIT_TYPES.map((unit) => [unit.id, unit]));

export function getUnitType(id: UnitType['id']): UnitType {
  const unit = BY_ID.get(id);
  if (!unit) throw new Error(`Unknown unit type: ${id}`);
  return unit;
}

export function tryGetUnitType(id: UnitType['id']): UnitType | undefined {
  return BY_ID.get(id);
}
