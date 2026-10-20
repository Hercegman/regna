/**
 * Which figure a kind of soldier is drawn as.
 *
 * One place, because two screens ask the same question: the battlefield,
 * which draws a hundred of them in ranks, and the card under an army, which
 * draws one. A Genoese crossbowman should be a crossbowman on both.
 */
import type { UnitClass } from '../core/types';
import type { SpriteName } from './iso/sprites';

export function figureFor(unitClass: UnitClass): SpriteName {
  switch (unitClass) {
    case 'spearmen':
      return 'spearman';
    case 'pikemen':
      return 'pikeman';
    case 'heavy_infantry':
    case 'light_infantry':
      return 'swordsman';
    case 'archers':
    case 'javelinmen':
      return 'archer';
    case 'crossbowmen':
      return 'crossbowman';
    case 'gunpowder_infantry':
      return 'gunner';
    case 'heavy_cavalry':
    case 'general':
      return 'knight';
    case 'light_cavalry':
    case 'horse_archers':
    case 'camel_cavalry':
      return 'lighthorse';
    case 'warship':
      return 'galley';
    case 'transport':
      return 'roundship';
    default:
      return 'swordsman';
  }
}
