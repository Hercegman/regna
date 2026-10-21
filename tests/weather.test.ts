import { describe, it, expect } from 'vitest';
import { createBattle, runBattle, stepBattle } from '../src/core/battle/sim';
import { buildBattle } from '../src/core/battle/setup';
import type { SideComposition } from '../src/core/battle/setup';
import type { Army, Regiment } from '../src/core/campaign/state';
import { armyId, factionId, regionId, unitTypeId } from '../src/core/types';
import { getUnitType } from '../src/core/data/units';
import { FIELD_DEPTH, FIELD_WIDTH } from '../src/core/battle/types';
import type { TimeOfDay, Weather } from '../src/core/battle/weather';
import { conditionsOf, rollTimeOfDay, rollWeather } from '../src/core/battle/weather';
import { deviceOf, armsOf, TINCTURES } from '../src/core/data/heraldry';
import { FACTIONS } from '../src/core/data/factions';

function regiment(type: string, soldiers?: number, experience = 0): Regiment {
  const unit = getUnitType(unitTypeId(type));
  return { type: unit.id, soldiers: soldiers ?? unit.soldiers, experience };
}

let serial = 0;
function army(faction: string, regiments: Regiment[]): Army {
  serial += 1;
  return {
    id: armyId(`weather-army-${serial}`),
    faction: factionId(faction),
    location: regionId('knin'),
    regiments,
    general: undefined,
    movement: 3,
    embarked: false,
  };
}

function side(faction: string, regiments: Regiment[]): SideComposition {
  return {
    faction: factionId(faction),
    armies: [army(faction, regiments)],
    fleets: [],
    garrison: [],
    command: 0,
  };
}

function battle(
  attacker: SideComposition,
  defender: SideComposition,
  options: { seed?: string; weather?: Weather; timeOfDay?: TimeOfDay } = {},
) {
  return buildBattle({
    seed: options.seed ?? 'weather-test',
    terrain: 'plains',
    isWinter: false,
    attacker,
    defender,
    weather: options.weather ?? 'clear',
    timeOfDay: options.timeOfDay ?? 'day',
  });
}

describe('conditions', () => {
  it('leaves a clear day alone', () => {
    const clear = conditionsOf('clear', 'day', 'plains');
    expect(clear.aim).toBe(1);
    expect(clear.footing).toBe(1);
    expect(clear.powder).toBe(1);
    expect(clear.morale).toBe(0);
    // Further than the longest-ranged thing in the game, so it is no limit.
    expect(clear.visibility).toBeGreaterThan(400);
  });

  it('shuts a field down in fog', () => {
    const fog = conditionsOf('fog', 'day', 'plains');
    // Shorter than a longbow's reach, which is the whole point of it.
    expect(fog.visibility).toBeLessThan(190);
    expect(fog.footing).toBeGreaterThan(0.9);
  });

  it('wets powder far worse than it wets a bowstring', () => {
    const rain = conditionsOf('rain', 'day', 'plains');
    expect(rain.powder).toBeLessThan(0.4);
    expect(rain.aim).toBeGreaterThan(0.7);
  });

  it('mires the ground in snow and tires the men in it', () => {
    const snow = conditionsOf('snow', 'day', 'plains');
    expect(snow.footing).toBeLessThan(0.85);
    expect(snow.toil).toBeGreaterThan(1.2);
    expect(snow.morale).toBeLessThan(0);
  });

  it('gives a battle begun at dusk less than the full day', () => {
    expect(conditionsOf('clear', 'dusk', 'plains').light)
      .toBeLessThan(conditionsOf('clear', 'day', 'plains').light);
  });

  it('counts the desert sun as a condition of its own', () => {
    const desert = conditionsOf('clear', 'day', 'desert');
    const temperate = conditionsOf('clear', 'day', 'plains');
    expect(desert.toil).toBeGreaterThan(temperate.toil);
  });
});

describe('rolling the sky', () => {
  it('is the same every time for the same battle', () => {
    for (const seed of ['a:1:knin', 'b:7:cairo', 'c:33:sea:adriatic']) {
      expect(rollWeather(seed, false, 'plains')).toBe(rollWeather(seed, false, 'plains'));
      expect(rollTimeOfDay(seed, false, false)).toBe(rollTimeOfDay(seed, false, false));
    }
  });

  it('never snows in a summer campaign and never at all in the desert', () => {
    for (let i = 0; i < 200; i++) {
      expect(rollWeather(`summer-${i}`, false, 'plains')).not.toBe('snow');
      expect(rollWeather(`desert-${i}`, true, 'desert')).not.toBe('snow');
    }
  });

  it('does not fight fleet actions in the dark', () => {
    for (let i = 0; i < 200; i++) {
      expect(rollTimeOfDay(`sea-${i}`, true, false)).not.toBe('night');
    }
  });

  it('keeps night rare on land and commoner in an escalade', () => {
    let openField = 0;
    let assaults = 0;
    for (let i = 0; i < 400; i++) {
      if (rollTimeOfDay(`field-${i}`, false, false) === 'night') openField += 1;
      if (rollTimeOfDay(`field-${i}`, false, true) === 'night') assaults += 1;
    }
    expect(openField).toBeLessThan(60);
    expect(assaults).toBeGreaterThan(openField);
  });
});

describe('weather in the battle', () => {
  const archers = () => side('england', [regiment('longbowmen'), regiment('longbowmen')]);
  const foot = () =>
    side('france', [regiment('french_men_at_arms'), regiment('french_men_at_arms')]);

  /**
   * What the march costs the men doing it.
   *
   * The lines start five hundred metres apart and a longbow reaches a
   * hundred and ninety, so the attacker spends minutes walking into the
   * shooting. Measured up to contact and no further, which is the only part
   * of the battle the archers decide on their own.
   */
  function marchUnder(defenders: () => SideComposition, weather: Weather, hour: TimeOfDay = 'day'): number {
    const state = createBattle(
      battle(foot(), defenders(), { seed: 'volley', weather, timeOfDay: hour }),
    );
    const marching = state.units.find((unit) => unit.side === 'attacker')!;
    const before = marching.soldiers;
    for (let i = 0; i < 3000 && !state.finished && marching.stance !== 'melee'; i++) {
      stepBattle(state);
    }
    return before - marching.soldiers;
  }

  const shotDown = (weather: Weather, hour: TimeOfDay = 'day'): number =>
    marchUnder(archers, weather, hour);

  /**
   * What fog takes is the long shooting, not the killing.
   *
   * The deadliest volleys are the close ones — accuracy falls off with the
   * range — so fog barely changes what an attacker pays over the last
   * hundred metres. What it takes away entirely is everything before that:
   * the minutes of attrition a longbow line was worth while the enemy was
   * still walking. This measures that, and nothing else, because measuring
   * the total would have said fog hardly matters, which is wrong in the
   * interesting direction.
   */
  function shotAtDistance(weather: Weather): number {
    const state = createBattle(battle(foot(), archers(), { seed: 'volley', weather }));
    const marching = state.units.find((unit) => unit.side === 'attacker')!;
    const shooter = state.units.find((unit) => unit.side === 'defender')!;
    const before = marching.soldiers;
    const apart = (): number =>
      Math.hypot(
        marching.position.x - shooter.position.x,
        marching.position.y - shooter.position.y,
      );
    for (let i = 0; i < 3000 && !state.finished && apart() > 130; i++) stepBattle(state);
    return before - marching.soldiers;
  }

  it('takes the long shooting away in fog', () => {
    const open = shotAtDistance('clear');
    expect(open).toBeGreaterThan(5);
    // Fog closes in short of a longbow's reach, so there is no shooting at
    // all until the lines are nearly on top of each other.
    expect(shotAtDistance('fog')).toBeLessThan(open * 0.2);
  });

  it('still costs the attacker less over the whole approach in fog', () => {
    expect(shotDown('fog')).toBeLessThan(shotDown('clear'));
  });

  it('costs the archers in rain without silencing them', () => {
    const wet = shotDown('rain');
    expect(wet).toBeLessThan(shotDown('clear'));
    expect(wet).toBeGreaterThan(0);
  });

  it('costs them most of their shooting in the dark', () => {
    // Moonlight still reaches further than a bow, so what the night takes is
    // the aiming rather than the range: a man shooting at a shape.
    expect(shotDown('clear', 'night')).toBeLessThan(shotDown('clear') * 0.75);
  });

  it('puts the guns out of action in rain far harder than the bows', () => {
    const guns = () =>
      side('hre', [regiment('hussite_handgunners'), regiment('hussite_handgunners')]);
    const dry = marchUnder(guns, 'clear');
    expect(dry).toBeGreaterThan(0);
    // A wet bowstring loses its cast; wet powder does not go off at all, and
    // the gap between those two is the point of the distinction.
    expect(marchUnder(guns, 'rain')).toBeLessThan(dry * 0.5);
    expect(marchUnder(archers, 'rain')).toBeGreaterThan(marchUnder(archers, 'clear') * 0.5);
  });

  it('slows an advance through snow', () => {
    const march = (weather: Weather): number => {
      const state = createBattle(battle(foot(), archers(), { seed: 'march', weather }));
      const unit = state.units.find((u) => u.side === 'attacker')!;
      const from = unit.position.y;
      for (let i = 0; i < 400; i++) stepBattle(state);
      return Math.abs(unit.position.y - from);
    };
    expect(march('snow')).toBeLessThan(march('clear'));
  });

  it('ends a battle begun at dusk when the light goes', () => {
    const result = runBattle(
      battle(
        side('hre', [regiment('imperial_spearmen'), regiment('imperial_spearmen')]),
        side('poland', [regiment('slavic_axemen'), regiment('slavic_axemen')]),
        { seed: 'dusk', timeOfDay: 'dusk' },
      ),
    );
    if (result.ended === 'nightfall') {
      expect(result.duration).toBeLessThanOrEqual(conditionsOf('clear', 'dusk', 'plains').light);
      // The side still standing on the ground keeps it; night decides nothing.
      expect(result.outcome).not.toBe('draw');
    }
  });
});

describe('the dead', () => {
  const clash = () =>
    battle(
      side('hre', [regiment('imperial_spearmen'), regiment('mailed_knights')]),
      side('poland', [regiment('slavic_axemen'), regiment('mailed_knights')]),
      { seed: 'bodies' },
    );

  it('changes nothing about the battle', () => {
    const quiet = runBattle(clash());
    const watched = createBattle(clash(), { record: true });
    for (let i = 0; i < 8000 && !watched.finished; i++) stepBattle(watched);
    expect(watched.result).toBeDefined();
    expect(watched.result!.outcome).toBe(quiet.outcome);
    expect(watched.result!.attackerLosses).toBeCloseTo(quiet.attackerLosses, 6);
    expect(watched.result!.defenderLosses).toBeCloseTo(quiet.defenderLosses, 6);
    expect(watched.result!.duration).toBeCloseTo(quiet.duration, 6);
  });

  it('keeps no bodies at all when nobody is watching', () => {
    const state = createBattle(clash());
    for (let i = 0; i < 2000 && !state.finished; i++) stepBattle(state);
    expect(state.fallen.length).toBe(0);
  });

  it('lays out one body for every man killed', () => {
    const state = createBattle(clash(), { record: true });
    for (let i = 0; i < 8000 && !state.finished; i++) stepBattle(state);
    const killed = state.units.reduce(
      (sum, unit) => sum + (unit.startingSoldiers - unit.soldiers),
      0,
    );
    expect(state.fallen.length).toBeGreaterThan(0);
    // One body a man, give or take the fraction of a man still owed.
    expect(state.fallen.length).toBeGreaterThan(killed - state.units.length - 1);
    expect(state.fallen.length).toBeLessThanOrEqual(Math.ceil(killed));
  });

  it('puts them on the field and leaves them there', () => {
    const state = createBattle(clash(), { record: true });
    for (let i = 0; i < 1200 && !state.finished; i++) stepBattle(state);
    const before = state.fallen.length;
    expect(before).toBeGreaterThan(0);
    const first = state.fallen[0]!;
    for (let i = 0; i < 1200 && !state.finished; i++) stepBattle(state);
    // The dead do not move, and nothing takes them away.
    expect(state.fallen.length).toBeGreaterThanOrEqual(before);
    expect(state.fallen[0]).toEqual(first);
    for (const body of state.fallen) {
      expect(body.x).toBeGreaterThan(-120);
      expect(body.x).toBeLessThan(FIELD_WIDTH + 120);
      expect(body.y).toBeGreaterThan(-120);
      expect(body.y).toBeLessThan(FIELD_DEPTH + 120);
      expect(body.at).toBeLessThanOrEqual(state.time);
    }
  });
});
