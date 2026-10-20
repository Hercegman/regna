/**
 * The battle camera.
 *
 * The field is a kilometre and a half across and a man is a metre wide, so
 * there is no single scale at which both the shape of the battle and the men
 * fighting it are visible. The camera is what reconciles them, and these are
 * the properties it has to keep: the ground under the cursor stays under the
 * cursor, the field cannot be left behind, and a camera nobody has touched
 * frames the armies.
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_BATTLE_ZOOM,
  fieldToScreen,
  fitBattleCamera,
  fitZoom,
  frameBattleCamera,
  panBattleCamera,
  screenToField,
  zoomBattleCamera,
} from '../src/render/battle';
import type { BattleView } from '../src/render/battle';
import { buildBattle } from '../src/core/battle/setup';
import type { SideComposition } from '../src/core/battle/setup';
import type { Army, Regiment } from '../src/core/campaign/state';
import { armyId, factionId, regionId, unitTypeId } from '../src/core/types';
import { getUnitType } from '../src/core/data/units';
import { FIELD_DEPTH, FIELD_WIDTH } from '../src/core/battle/types';

function view(): BattleView {
  return {
    width: 1200,
    height: 800,
    selected: undefined,
    hovered: undefined,
    zoom: 1,
    centre: { x: 0, y: 0 },
    touched: false,
  };
}

let serial = 0;
function side(faction: string, types: readonly string[]): SideComposition {
  serial += 1;
  const host: Army = {
    id: armyId(`camera-${serial}`),
    faction: factionId(faction),
    location: regionId('knin'),
    regiments: types.map((type): Regiment => {
      const unit = getUnitType(unitTypeId(type));
      return { type: unit.id, soldiers: unit.soldiers, experience: 0 };
    }),
    general: undefined,
    movement: 3,
    embarked: false,
  };
  return { faction: factionId(faction), armies: [host], fleets: [], garrison: [], command: 0 };
}

const ORDER = ['town_militia', 'armoured_sergeants', 'crossbow_militia', 'mailed_knights'];

describe('the battle camera', () => {
  it('fits the whole field when asked to', () => {
    const v = view();
    fitBattleCamera(v);
    expect(v.centre).toEqual({ x: FIELD_WIDTH / 2, y: FIELD_DEPTH / 2 });
    const corner = screenToField(v, 0, 0);
    expect(corner.x).toBeLessThanOrEqual(0.01);
  });

  it('keeps the ground under the cursor under the cursor while zooming', () => {
    const v = view();
    fitBattleCamera(v);
    const before = screenToField(v, 300, 220);
    zoomBattleCamera(v, 2.4, 300, 220);
    const after = screenToField(v, 300, 220);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('will not zoom past a man or out past the field', () => {
    const v = view();
    fitBattleCamera(v);
    for (let i = 0; i < 40; i++) zoomBattleCamera(v, 2, v.width / 2, v.height / 2);
    expect(v.zoom).toBeLessThanOrEqual(MAX_BATTLE_ZOOM);
    for (let i = 0; i < 40; i++) zoomBattleCamera(v, 0.5, v.width / 2, v.height / 2);
    expect(v.zoom).toBeGreaterThanOrEqual(fitZoom(v) * 0.9 - 1e-9);
  });

  it('cannot be panned off the field', () => {
    const v = view();
    fitBattleCamera(v);
    zoomBattleCamera(v, 3, v.width / 2, v.height / 2);
    for (let i = 0; i < 200; i++) panBattleCamera(v, -400, -400);
    expect(v.centre.x).toBeLessThanOrEqual(FIELD_WIDTH * 1.5);
    expect(v.centre.y).toBeLessThanOrEqual(FIELD_DEPTH * 1.5);
    for (let i = 0; i < 400; i++) panBattleCamera(v, 400, 400);
    expect(v.centre.x).toBeGreaterThanOrEqual(-FIELD_WIDTH * 0.5);
    expect(v.centre.y).toBeGreaterThanOrEqual(-FIELD_DEPTH * 0.5);
  });

  it('frames the armies at least as closely as the whole field', () => {
    const setup = buildBattle({
      seed: 'camera-test',
      terrain: 'plains',
      isWinter: false,
      attacker: side('france', ORDER),
      defender: side('hre', ORDER),
    });
    const v = view();
    frameBattleCamera(v, setup.units);
    expect(v.zoom).toBeGreaterThanOrEqual(fitZoom(v) * 0.9);
    // Every regiment is somewhere on screen, asked through the projection
    // itself rather than through a copy of it.
    for (const unit of setup.units) {
      const at = fieldToScreen(v, unit.position);
      expect(at.x).toBeGreaterThan(-40);
      expect(at.x).toBeLessThan(v.width + 40);
      expect(at.y).toBeGreaterThan(-40);
      expect(at.y).toBeLessThan(v.height + 40);
    }
  });

  it('falls back to the whole field when there is nobody left to frame', () => {
    const v = view();
    frameBattleCamera(v, []);
    expect(v.zoom).toBeCloseTo(fitZoom(v), 6);
  });
});
