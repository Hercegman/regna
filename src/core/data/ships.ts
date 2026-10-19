/**
 * Ships.
 *
 * A ship is a fighting unit like any other, so a sea battle runs the same
 * simulation a land battle does: closing, shooting and then boarding, which is
 * what a medieval sea fight actually was. What ships have that regiments do
 * not is `capacity`, the number of land regiments they can carry, which is how
 * an invasion crosses water.
 *
 * Stat conventions for hulls:
 *   soldiers     crew and marines together; a hull is "destroyed" when they are gone
 *   attack       boarding and ramming
 *   defence      handiness and freeboard
 *   armour       scantlings: how much punishment the hull absorbs
 *   speed        m/s on the battle plane; oared ships are faster in a flat calm
 *   range        archery, engines or guns carried aboard
 */
import type { UnitType } from '../types';
import { defineUnit } from './unitSpec';

const s = defineUnit;

export const SHIP_TYPES: readonly UnitType[] = [
  // ---------------- The north ----------------
  s({
    id: 'longship', name: 'Longship', unitClass: 'warship', tier: 2,
    soldiers: 60, attack: 11, defence: 6, armour: 2, morale: 14, discipline: 11,
    speed: 3.4, capacity: 1, abilities: ['oared', 'seaworthy'],
    cost: 480, pools: ['norse', 'gaelic'], untilYear: 1270,
    waters: 'sea',
    description:
      'A clinker-built hull that rows when the wind fails and beaches where there is no ' +
      'harbour. It carries its own crew as its boarding party and can appear on a coast ' +
      'before word of its sailing does.',
  }),
  s({
    id: 'cog', name: 'Cog', unitClass: 'warship', tier: 3,
    soldiers: 70, attack: 8, defence: 11, armour: 4, morale: 12, discipline: 12,
    speed: 2.2, range: 120, missileAttack: 11, ammunition: 20, capacity: 3,
    abilities: ['tall_sided', 'seaworthy'],
    cost: 760, requires: 'shipyard', fromYear: 1180,
    pools: ['latin_west', 'norse', 'german', 'maritime', 'west_slavic'],
    waters: 'sea',
    description:
      'A high-sided merchantman with fighting castles fore and aft. It cannot manoeuvre ' +
      'like a galley and does not need to: boarding a cog means climbing up into archery ' +
      'at close range.',
  }),
  s({
    id: 'hulk', name: 'Hulk', unitClass: 'transport', tier: 2,
    soldiers: 40, attack: 3, defence: 7, armour: 3, morale: 9, discipline: 10,
    speed: 2.0, capacity: 4, abilities: ['tall_sided', 'seaworthy'],
    cost: 520, requires: 'harbour',
    pools: ['universal_settled', 'maritime'],
    waters: 'sea',
    description:
      'A round-bellied carrier built to move cargo, horses and men rather than to fight. ' +
      'An army crosses the sea in these, escorted by anything that can.',
  }),

  // ---------------- The Mediterranean ----------------
  s({
    id: 'war_galley', name: 'War Galley', unitClass: 'warship', tier: 2,
    soldiers: 80, attack: 10, defence: 8, armour: 2, morale: 11, discipline: 12,
    speed: 3.2, range: 110, missileAttack: 10, ammunition: 18, capacity: 1,
    abilities: ['oared', 'ram'],
    cost: 560, requires: 'harbour',
    // The oared galley is a Mediterranean and Black Sea weapon. Northern states
    // crossed water in sailing transports and did not keep galley fleets.
    pools: ['italian', 'maritime', 'mediterranean', 'hellenic', 'byzantine', 'greek',
            'levantine', 'maghrebi', 'berber', 'balkan', 'iberian', 'andalusian',
            'crusader', 'caucasian'],
    waters: 'sea',
    description:
      'The standard fighting ship of the inland sea from antiquity onwards: oars for ' +
      'manoeuvre, a beak at the waterline, and enough marines to take an enemy deck.',
  }),
  s({
    id: 'great_galley', name: 'Great Galley', unitClass: 'warship', tier: 4,
    soldiers: 110, attack: 13, defence: 11, armour: 4, morale: 14, discipline: 15,
    speed: 3.0, range: 130, missileAttack: 14, ammunition: 24, capacity: 2,
    abilities: ['oared', 'ram'], cost: 1050, requires: 'shipyard', fromYear: 1200,
    pools: ['italian', 'maritime'],
    waters: 'sea',
    description:
      'The Venetian and Genoese answer to everything: three men to an oar, crossbowmen on ' +
      'raised platforms, and a hull big enough to carry its own siege train.',
  }),
  s({
    id: 'dromon', name: 'Dromon', unitClass: 'warship', tier: 4,
    soldiers: 100, attack: 12, defence: 10, armour: 4, morale: 14, discipline: 16,
    speed: 3.1, range: 55, missileAttack: 34, ammunition: 10, capacity: 1,
    abilities: ['oared', 'ram', 'greek_fire'], cost: 980, requires: 'shipyard',
    pools: [], factions: ['byzantium', 'trebizond'], untilYear: 1350,
    waters: 'sea',
    description:
      'The imperial galley, with a siphon in the bow that throws burning naphtha. The ' +
      'formula is a state secret and the effect on a wooden fleet is not easily described ' +
      'by anyone who has seen it.',
  }),
  s({
    id: 'qarib', name: 'Qarib', unitClass: 'warship', tier: 2,
    soldiers: 70, attack: 11, defence: 7, armour: 1, morale: 12, discipline: 10,
    speed: 3.6, range: 100, missileAttack: 9, ammunition: 16, capacity: 1,
    abilities: ['oared'], cost: 500,
    pools: ['levantine', 'maghrebi', 'berber', 'african_muslim', 'andalusian'],
    waters: 'sea',
    description:
      'A light raiding galley of the Muslim Mediterranean, fast enough to take a merchantman ' +
      'and to be gone before the convoy escort arrives.',
  }),
  s({
    id: 'nef', name: 'Nef', unitClass: 'transport', tier: 3,
    soldiers: 55, attack: 5, defence: 9, armour: 3, morale: 10, discipline: 11,
    speed: 2.3, range: 110, missileAttack: 8, ammunition: 12, capacity: 3,
    abilities: ['tall_sided', 'seaworthy'], cost: 700, requires: 'harbour', fromYear: 1150,
    pools: ['latin_west', 'crusader', 'iberian', 'italian', 'maritime'],
    waters: 'sea',
    description:
      'The pilgrim and crusader carrier, a sailing ship with castles that took armies to ' +
      'Outremer by the thousand and charged them handsomely for the passage.',
  }),

  // ---------------- The age of the gun ----------------
  s({
    id: 'carrack', name: 'Carrack', unitClass: 'warship', tier: 5,
    soldiers: 120, attack: 11, defence: 14, armour: 6, morale: 15, discipline: 15,
    speed: 2.4, range: 180, missileAttack: 26, ammunition: 18, capacity: 4,
    abilities: ['tall_sided', 'seaworthy', 'armour_piercing'],
    cost: 1500, requires: 'arsenal', fromYear: 1400,
    pools: ['latin_west', 'maritime', 'iberian', 'italian'],
    waters: 'sea',
    description:
      'Three masts, a hull that can cross an ocean, and guns firing through ports cut in ' +
      'her side. The carrack ends the age in which a sea fight meant boarding.',
  }),
  s({
    id: 'galleass', name: 'Galleass', unitClass: 'warship', tier: 5,
    soldiers: 130, attack: 13, defence: 13, armour: 5, morale: 15, discipline: 16,
    speed: 2.8, range: 170, missileAttack: 28, ammunition: 20, capacity: 2,
    abilities: ['oared', 'ram', 'armour_piercing'],
    cost: 1650, requires: 'arsenal', fromYear: 1450,
    pools: ['italian', 'maritime'], factions: ['venice', 'genoa', 'ottomans', 'hospitallers'],
    waters: 'sea',
    description:
      'A great galley rebuilt around a gun deck: the oars of the old sea and the broadside ' +
      'of the new, in a hull too heavy for either to handle comfortably.',
  }),

  // ---------------- Rivers and closed waters ----------------
  s({
    id: 'river_galley', name: 'River Galley', unitClass: 'warship', tier: 1,
    soldiers: 40, attack: 8, defence: 5, armour: 1, morale: 10, discipline: 10,
    speed: 3.3, range: 100, missileAttack: 8, ammunition: 14, capacity: 1,
    abilities: ['oared'], cost: 300,
    pools: ['universal_settled'],
    waters: 'river',
    description:
      'A shallow-draught oared boat for the great rivers, which carried more medieval ' +
      'traffic than most coastlines. It cannot keep the sea and does not try.',
  }),
  s({
    id: 'lodya', name: 'Lodya', unitClass: 'transport', tier: 1,
    soldiers: 35, attack: 6, defence: 5, armour: 1, morale: 11, discipline: 10,
    speed: 2.8, capacity: 2, abilities: ['oared'], cost: 280,
    pools: ['east_slavic', 'norse'],
    waters: 'any',
    description:
      'The Rus river boat of the road from the Varangians to the Greeks, light enough to ' +
      'be dragged between one river system and the next.',
  }),
  s({
    id: 'dhow', name: 'Dhow', unitClass: 'transport', tier: 2,
    soldiers: 40, attack: 6, defence: 7, armour: 1, morale: 11, discipline: 11,
    speed: 2.9, range: 90, missileAttack: 7, ammunition: 12, capacity: 2,
    abilities: ['seaworthy'], cost: 420,
    pools: ['levantine', 'sahelian', 'nubian', 'african_muslim'],
    waters: 'sea',
    description:
      'A lateen-rigged trader of the Red Sea and the Indian Ocean, sewn rather than nailed, ' +
      'and the carrier of the richest trade route on earth.',
  }),
];
