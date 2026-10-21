/**
 * What a battle sounds like, from what the battle is doing.
 *
 * The same rule the renderer works under: nothing is invented for effect. A
 * volley is heard only where the simulation has a regiment shooting — the
 * identical `isShooting` the arrows are drawn from — the ring of steel is
 * proportional to the men actually in contact this tick, the thunder goes
 * with the lightning the storm is drawing, and a paused battle is silent
 * because a paused battle is a still picture.
 *
 * Nothing here can reach the model. It reads `BattleState` and writes
 * nothing, so a battle fought with the speakers off is the same battle.
 */
import { getUnitType } from '../core/data/units';
import { UNIT_ROLE } from '../core/types';
import type { BattleState } from '../core/battle/sim';
import { isShooting } from '../core/battle/sim';
import { lightning } from '../render/weather';
import {
  Bed,
  clash,
  drum,
  engineLoose,
  horn,
  thud,
  thunder,
  volleyArrows,
  volleyBolts,
  volleyGuns,
} from './sound';

/** Seconds of battle time between volleys, by what is doing the shooting. */
const RELOAD: Record<string, number> = {
  archers: 4.5,
  horse_archers: 5,
  javelinmen: 6,
  crossbowmen: 9.5,
  gunpowder_infantry: 15,
  siege_engine: 22,
};

export class BattleSound {
  // Rain is mostly high and busy; wind is all bottom and swells; the roar of
  // a few thousand men is in between and never quite steady.
  private readonly rain = new Bed({ type: 'bandpass', frequency: 1600, q: 0.5, sway: 0.23, swayDepth: 0.22 });
  private readonly wind = new Bed({ type: 'lowpass', frequency: 360, q: 0.6, sway: 0.09, swayDepth: 0.55 });
  private readonly roar = new Bed({ type: 'lowpass', frequency: 640, q: 0.4, sway: 0.37, swayDepth: 0.35 });

  private readonly stances = new Map<string, string>();
  private readonly nextVolley = new Map<string, number>();
  private nextClash = 0;
  private nextDrum = 0;
  private nextHorn = -Infinity;
  private lastStroke = -1;
  private lastTime = -1;
  private ended = false;

  /**
   * @param running false when the battle is paused, which takes everything
   * down rather than leaving a bed humming over a frozen field.
   */
  update(state: BattleState, running: boolean): void {
    const time = state.time;
    // A battle that has gone backwards is a different battle.
    if (time < this.lastTime) this.reset();
    this.lastTime = time;

    if (!running) {
      this.rain.level(0);
      this.wind.level(0);
      this.roar.level(0);
      return;
    }

    // Two clocks, and the difference matters. A volley belongs to the
    // battle's clock: run the battle at eight times speed and the arrows
    // should come eight times as often, because that is what you are
    // watching. The ring of steel and the drum belong to the room's clock —
    // they are a texture rather than an event, and eight times as many of
    // them a second is not a faster battle, it is a buzzing noise.
    const wall = performance.now() / 1000;
    this.weather(state, time);
    const contact = this.fighting(state);
    this.roar.level(Math.min(0.11, contact / 26000 + this.breaking(state) * 0.04));
    this.blows(contact, wall);
    this.volleys(state, time);
    this.calls(state, time);
    this.step(state, wall);

    if (state.finished && !this.ended) {
      this.ended = true;
      horn(false, 147);
    }
  }

  stop(): void {
    this.rain.stop();
    this.wind.stop();
    this.roar.stop();
  }

  private reset(): void {
    this.stances.clear();
    this.nextVolley.clear();
    this.nextClash = 0;
    this.nextDrum = 0;
    this.nextHorn = -Infinity;
    this.lastStroke = -1;
    this.ended = false;
  }

  /** Rain, wind, and the crack that goes with the flash. */
  private weather(state: BattleState, time: number): void {
    // The sky the battle is under now, not the one it started under. A bed
    // ramps towards its new level over a quarter of a second anyway, so a
    // change in the weather arrives in the ear about as gradually as it
    // arrives in the picture.
    const weather = state.sky.weather;
    this.rain.level(weather === 'storm' ? 0.15 : weather === 'rain' ? 0.085 : weather === 'snow' ? 0.02 : 0);
    this.wind.level(
      weather === 'storm' ? 0.13 : weather === 'snow' ? 0.055 : weather === 'fog' ? 0.02 : 0.012,
    );
    if (weather !== 'storm') return;
    // One crack a stroke. The stroke is numbered by the clock the flash is
    // drawn from, so the ear and the eye agree about how many there were.
    const stroke = Math.floor(time / 7.3);
    if (stroke !== this.lastStroke && lightning(state, time) > 0.4) {
      this.lastStroke = stroke;
      thunder(0.6 + (stroke % 3) * 0.7);
    }
  }

  /** Men in contact this tick, which is what the noise is made of. */
  private fighting(state: BattleState): number {
    let soldiers = 0;
    for (const unit of state.units) {
      if (unit.stance === 'melee' && !unit.fled) soldiers += unit.soldiers;
    }
    return soldiers;
  }

  /** The share of the field that has broken, which is a different noise. */
  private breaking(state: BattleState): number {
    let broken = 0;
    let total = 0;
    for (const unit of state.units) {
      if (unit.fled || unit.stance === 'destroyed') continue;
      total += 1;
      if (unit.stance === 'routing') broken += 1;
    }
    return total === 0 ? 0 : broken / total;
  }

  /**
   * Individual blows, at a rate the fighting sets.
   *
   * Spread across the frame rather than fired at once, because four hundred
   * men coming into contact in one tick is four hundred milliseconds of
   * fighting, not a single click.
   */
  private blows(contact: number, wall: number): void {
    if (contact <= 0) {
      this.nextClash = wall;
      return;
    }
    const rate = Math.min(16, contact / 45);
    // A frame that fell behind — a tab in the background, a slow machine —
    // catches up rather than paying out a hundred rings at once.
    if (this.nextClash < wall - 0.5) this.nextClash = wall;
    let played = 0;
    while (this.nextClash <= wall && played < 3) {
      clash(0.78 + ((played * 37) % 11) / 18);
      this.nextClash += 1 / rate;
      played += 1;
    }
  }

  private volleys(state: BattleState, time: number): void {
    for (const unit of state.units) {
      if (!isShooting(state, unit)) continue;
      const type = getUnitType(unit.type);
      const due = this.nextVolley.get(unit.id);
      if (due === undefined) {
        // Staggered on the regiment's own name, so a line of archers does not
        // loose as one man.
        this.nextVolley.set(unit.id, time + hash(unit.id) * 3);
        continue;
      }
      if (time < due) continue;
      const gap = RELOAD[type.unitClass] ?? 7;
      this.nextVolley.set(unit.id, time + gap * (0.8 + hash(unit.id) * 0.4));
      const weight = Math.min(1.4, 0.4 + unit.soldiers / 110);
      if (type.unitClass === 'siege_engine') {
        if (unit.type === 'bombard' || unit.type === 'culverin') volleyGuns(weight);
        else engineLoose();
      } else if (type.unitClass === 'gunpowder_infantry') {
        volleyGuns(weight * 0.7);
      } else if (type.unitClass === 'crossbowmen') {
        volleyBolts(weight);
      } else {
        volleyArrows(weight);
      }
    }
  }

  /**
   * Horns.
   *
   * Two calls and no more: something has gone in, or something has broken.
   * Throttled hard, because the thing that makes a horn mean anything is
   * that it is not sounding most of the time.
   */
  private calls(state: BattleState, time: number): void {
    let charged = false;
    let broke = false;
    let mounted = false;
    for (const unit of state.units) {
      const was = this.stances.get(unit.id);
      this.stances.set(unit.id, unit.stance);
      if (was === undefined || was === unit.stance) continue;
      if (unit.stance === 'charging') {
        charged = true;
        if (UNIT_ROLE[getUnitType(unit.type).unitClass] === 'cavalry') mounted = true;
      }
      if (unit.stance === 'routing') broke = true;
    }
    if (time - this.nextHorn < 7) return;
    if (broke) {
      this.nextHorn = time;
      horn(false);
    } else if (charged) {
      this.nextHorn = time;
      horn(true);
      if (mounted) for (let i = 0; i < 5; i++) thud(1.3 + i * 0.08);
    }
  }

  /** A drum, while anybody is still marching rather than fighting. */
  private step(state: BattleState, wall: number): void {
    const marching = state.units.some(
      (unit) => !unit.fled && (unit.stance === 'advancing' || unit.stance === 'charging'),
    );
    if (!marching) {
      this.nextDrum = wall;
      return;
    }
    if (wall < this.nextDrum) return;
    // A marching step, not a metronome tied to the simulation: men walk at
    // the pace men walk at whatever speed the battle is being watched at.
    this.nextDrum = Math.max(wall, this.nextDrum) + 0.62;
    drum();
  }
}

function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return (value % 1000) / 1000;
}
