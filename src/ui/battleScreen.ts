/**
 * The battle screen.
 *
 * It drives the same simulation the campaign auto-resolves with, one fixed tick
 * at a time, and lets the player give orders to their own regiments between
 * ticks. Nothing here changes the outcome rules: pausing, speeding up or
 * leaving the battle to its own devices all run identical physics.
 */
import { UNIT_ROLE } from '../core/types';
import { getUnitType } from '../core/data/units';
import { factionName, tryGetFaction } from '../core/data/factions';
import type { BattlePlan } from '../core/campaign';
import type { BattleState } from '../core/battle/sim';
import { createBattle, stepBattle } from '../core/battle/sim';
import type { BattleResult, BattleUnit, Side } from '../core/battle/types';
import { BATTLE_TIME_LIMIT, TICK } from '../core/battle/types';
import type { BattleView } from '../render/battle';
import { drawBattle, screenToField, unitAt } from '../render/battle';
import { bar, clear, count, el, pretty, row } from './dom';

const SPEEDS = [1, 2, 4, 8] as const;

export class BattleScreen {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sidebar: HTMLElement;
  private readonly header: HTMLElement;
  private readonly view: BattleView;
  private readonly battle: BattleState;
  private readonly playerSide: Side | undefined;
  private speed: (typeof SPEEDS)[number] = 2;
  private running = false;
  private frame = 0;
  private accumulator = 0;
  private lastFrameTime = 0;
  private lastPanelRefresh = 0;
  private finished = false;

  constructor(
    host: HTMLElement,
    private readonly plan: BattlePlan,
    playerFaction: string,
    private readonly onDone: (result: BattleResult) => void,
  ) {
    clear(host);
    this.battle = createBattle(plan.setup);
    this.playerSide =
      plan.setup.attacker === playerFaction
        ? 'attacker'
        : plan.setup.defender === playerFaction
          ? 'defender'
          : undefined;

    this.header = el('header', { class: 'battle-header' });
    this.canvas = el('canvas', { class: 'battle-canvas' });
    this.sidebar = el('aside', { class: 'battle-sidebar' });

    host.appendChild(
      el('div', { class: 'battle-screen' },
        this.header,
        el('div', { class: 'battle-body' },
          el('div', { class: 'battle-field' }, this.canvas),
          this.sidebar,
        ),
      ),
    );

    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('This browser has no 2D canvas context.');
    this.ctx = context;

    this.view = { width: 100, height: 100, selected: undefined, hovered: undefined };
    this.attachInput();
    this.resize();
    // The header changes height when the battle ends and its controls go away,
    // so the canvas has to follow its container rather than only the window.
    const observer = new ResizeObserver(() => {
      this.resize();
      this.draw();
    });
    const holder = this.canvas.parentElement;
    if (holder) observer.observe(holder);
    window.addEventListener('resize', () => {
      this.resize();
      this.draw();
    });

    this.renderHeader();
    this.renderSidebar();
    this.draw();
  }

  private resize(): void {
    const holder = this.canvas.parentElement;
    if (!holder) return;
    const ratio = window.devicePixelRatio || 1;
    const width = holder.clientWidth;
    const height = holder.clientHeight;
    this.canvas.width = Math.max(1, Math.floor(width * ratio));
    this.canvas.height = Math.max(1, Math.floor(height * ratio));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.view.width = width;
    this.view.height = height;
  }

  private attachInput(): void {
    this.canvas.addEventListener('mousemove', (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const hovered = unitAt(this.battle, this.view, event.clientX - rect.left, event.clientY - rect.top);
      if (hovered !== this.view.hovered) {
        this.view.hovered = hovered;
        this.canvas.style.cursor = hovered ? 'pointer' : 'default';
        this.draw();
      }
    });

    this.canvas.addEventListener('click', (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const clicked = unitAt(this.battle, this.view, x, y);
      const selected = this.selectedUnit();

      // With one of our own regiments selected, a click is an order.
      if (selected && this.playerSide && selected.side === this.playerSide) {
        if (clicked) {
          const target = this.battle.units.find((unit) => unit.id === clicked);
          if (target && target.side !== selected.side) {
            selected.order = { kind: 'attack', targetUnit: target.id };
            this.renderSidebar();
            this.draw();
            return;
          }
          if (target && target.side === selected.side) {
            this.view.selected = target.id;
            this.renderSidebar();
            this.draw();
            return;
          }
        }
        selected.order = { kind: 'move', target: screenToField(this.view, x, y) };
        this.renderSidebar();
        this.draw();
        return;
      }

      this.view.selected = clicked;
      this.renderSidebar();
      this.draw();
    });

    window.addEventListener('keydown', (event) => {
      if (this.finished) return;
      if (event.key === ' ') {
        event.preventDefault();
        this.toggle();
      }
    });
  }

  private selectedUnit(): BattleUnit | undefined {
    return this.battle.units.find((unit) => unit.id === this.view.selected);
  }

  // -------------------------------------------------------------------------
  // The clock
  // -------------------------------------------------------------------------

  private toggle(): void {
    this.running ? this.pause() : this.play();
  }

  /** Starts the clock. Exposed so a caller can open a battle already running. */
  start(): void {
    this.play();
  }

  private play(): void {
    if (this.running || this.finished) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    this.accumulator = 0;
    const loop = (now: number): void => {
      if (!this.running) return;
      const elapsed = Math.min(0.25, (now - this.lastFrameTime) / 1000);
      this.lastFrameTime = now;
      this.accumulator += elapsed * this.speed;
      let steps = 0;
      while (this.accumulator >= TICK && steps < 240) {
        stepBattle(this.battle);
        this.accumulator -= TICK;
        steps += 1;
        if (this.battle.finished) break;
      }
      this.draw();
      // The panels are rebuilt a few times a second rather than every frame:
      // the field has to be smooth, but reconstructing two dozen rows of DOM
      // sixty times a second costs more than it shows.
      if (now - this.lastPanelRefresh > 250) {
        this.lastPanelRefresh = now;
        this.renderHeader();
        this.renderSidebar();
      }
      if (this.battle.finished) {
        this.renderHeader();
        this.renderSidebar();
        this.conclude();
        return;
      }
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
    this.renderHeader();
  }

  private pause(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.renderHeader();
  }

  /** Runs the rest of the battle instantly, without watching it. */
  resolveNow(): void {
    this.finishNow();
  }

  private finishNow(): void {
    this.pause();
    let guard = 0;
    const limit = Math.ceil(BATTLE_TIME_LIMIT / TICK) + 10;
    while (!this.battle.finished && guard < limit) {
      stepBattle(this.battle);
      guard += 1;
    }
    this.draw();
    this.conclude();
  }

  private conclude(): void {
    if (this.finished) return;
    this.finished = true;
    this.running = false;
    cancelAnimationFrame(this.frame);
    const result = this.battle.result;
    if (!result) return;
    this.renderHeader();
    this.renderSidebar();
    this.renderResult(result);
  }

  // -------------------------------------------------------------------------
  // Panels
  // -------------------------------------------------------------------------

  private renderHeader(): void {
    const setup = this.plan.setup;
    const minutes = Math.floor(this.battle.time / 60);
    const seconds = Math.floor(this.battle.time % 60);
    clear(this.header);
    this.header.appendChild(
      el('div', { class: 'battle-sides' },
        this.sideSummary('attacker'),
        el('span', { class: 'versus' }, this.plan.isAssault ? 'assaults' : 'meets'),
        this.sideSummary('defender'),
      ),
    );
    this.header.appendChild(
      el('div', { class: 'battle-clock' },
        el('span', {}, `${minutes}:${seconds.toString().padStart(2, '0')}`),
        el('span', { class: 'muted' }, pretty(setup.terrain)),
        setup.isWinter && el('span', { class: 'muted' }, 'winter'),
      ),
    );
    const controls = el('div', { class: 'battle-controls' });
    if (!this.finished) {
      controls.appendChild(el('button', {
        class: 'primary',
        onClick: () => this.toggle(),
      }, this.running ? 'Pause' : 'Advance'));
      for (const speed of SPEEDS) {
        controls.appendChild(el('button', {
          class: `tiny${this.speed === speed ? ' active' : ''}`,
          onClick: () => {
            this.speed = speed;
            this.renderHeader();
          },
        }, `${speed}×`));
      }
      controls.appendChild(el('button', {
        class: 'small',
        title: 'Run the rest of the battle without watching it',
        onClick: () => this.finishNow(),
      }, 'Resolve'));
    }
    this.header.appendChild(controls);
  }

  private sideSummary(side: Side): HTMLElement {
    const faction = side === 'attacker' ? this.plan.setup.attacker : this.plan.setup.defender;
    const colour = tryGetFaction(faction)?.colour ?? '#8d8578';
    let standing = 0;
    let start = 0;
    for (const unit of this.battle.units) {
      if (unit.side !== side) continue;
      start += unit.startingSoldiers;
      if (unit.stance !== 'destroyed' && unit.stance !== 'routing' && !unit.fled) {
        standing += unit.soldiers;
      }
    }
    return el('div', { class: `side-summary ${side}` },
      el('span', { class: 'swatch', style: `background:${colour}` }),
      el('span', { class: 'side-name' },
        factionName(faction) + (this.playerSide === side ? ' (you)' : ''),
      ),
      el('span', { class: 'side-strength' }, count(standing)),
      bar(start === 0 ? 0 : standing / start, colour),
    );
  }

  private renderSidebar(): void {
    clear(this.sidebar);
    const selected = this.selectedUnit();

    if (selected) {
      const type = getUnitType(selected.type);
      const threshold = Math.max(1, type.morale);
      this.sidebar.appendChild(el('h2', {}, type.name));
      this.sidebar.appendChild(el('p', { class: 'panel-sub' },
        `${factionName(selected.faction)} · ${pretty(UNIT_ROLE[type.unitClass])}`,
      ));
      this.sidebar.appendChild(el('section', {},
        row('Strength', `${count(selected.soldiers)} / ${selected.startingSoldiers}`),
        row('State', pretty(selected.stance)),
        row('Morale', bar(Math.max(0, 1 - selected.shock / threshold), '#d8d2a8')),
        row('Fatigue', bar(selected.fatigue, '#e5a33a')),
        type.range > 0 && row('Ammunition', bar(selected.ammunition / Math.max(1, type.ammunition), '#8fb8d8')),
        row('Experience', '★'.repeat(Math.round(selected.experience / 3)) || 'none'),
      ));
      this.sidebar.appendChild(el('p', { class: 'offer-text' }, type.description));

      if (this.playerSide && selected.side === this.playerSide && !this.finished) {
        this.sidebar.appendChild(el('h3', {}, 'Orders'));
        this.sidebar.appendChild(el('div', { class: 'army-controls' },
          el('button', { class: 'small', onClick: () => this.setOrder(selected, { kind: 'hold' }) }, 'Hold'),
          type.range > 0 && el('button', {
            class: 'small',
            onClick: () => {
              const target = this.nearestEnemy(selected);
              if (target) this.setOrder(selected, { kind: 'skirmish', targetUnit: target.id });
            },
          }, 'Skirmish'),
          el('button', {
            class: 'small',
            onClick: () => {
              const target = this.nearestEnemy(selected);
              if (target) this.setOrder(selected, { kind: 'attack', targetUnit: target.id });
            },
          }, 'Charge nearest'),
          el('button', { class: 'danger small', onClick: () => this.setOrder(selected, { kind: 'withdraw' }) }, 'Withdraw'),
        ));
        this.sidebar.appendChild(el('p', { class: 'muted' },
          'Click the field to march there, or an enemy regiment to attack it.',
        ));
      }
      this.sidebar.appendChild(el('hr', {}));
    }

    this.sidebar.appendChild(el('h3', {}, 'Order of battle'));
    for (const side of ['attacker', 'defender'] as Side[]) {
      this.sidebar.appendChild(el('h4', { class: 'muted' },
        side === 'attacker' ? 'Attacking' : 'Defending',
      ));
      for (const unit of this.battle.units.filter((candidate) => candidate.side === side)) {
        const type = getUnitType(unit.type);
        const dead = unit.stance === 'destroyed' || unit.fled;
        this.sidebar.appendChild(el('div', {
          class: `unit-row clickable${dead ? ' gone' : ''}${unit.stance === 'routing' ? ' routing' : ''}`,
          onClick: () => {
            this.view.selected = unit.id;
            this.renderSidebar();
            this.draw();
          },
        },
          el('span', { class: 'unit-name' }, type.name),
          el('span', { class: 'unit-strength' }, dead ? '—' : count(unit.soldiers)),
        ));
      }
    }
  }

  private setOrder(unit: BattleUnit, order: BattleUnit['order']): void {
    unit.order = order;
    this.renderSidebar();
    this.draw();
  }

  private nearestEnemy(unit: BattleUnit): BattleUnit | undefined {
    let best: BattleUnit | undefined;
    let bestGap = Infinity;
    for (const candidate of this.battle.units) {
      if (candidate.side === unit.side) continue;
      if (candidate.stance === 'destroyed' || candidate.fled) continue;
      const gap = Math.hypot(
        candidate.position.x - unit.position.x,
        candidate.position.y - unit.position.y,
      );
      if (gap < bestGap) {
        bestGap = gap;
        best = candidate;
      }
    }
    return best;
  }

  private renderResult(result: BattleResult): void {
    const won =
      this.playerSide === undefined
        ? undefined
        : (this.playerSide === 'attacker' && result.outcome === 'attacker') ||
          (this.playerSide === 'defender' && result.outcome === 'defender');
    const title =
      result.outcome === 'draw'
        ? 'The field is left undecided'
        : won === undefined
          ? `${factionName(result.outcome === 'attacker' ? this.plan.setup.attacker : this.plan.setup.defender)} holds the field`
          : won
            ? 'The field is ours'
            : 'The day is lost';

    const overlay = el('div', { class: 'battle-result' },
      el('div', { class: 'result-card' },
        el('h2', {}, title),
        el('section', {},
          row('Our losses', count(this.playerSide === 'defender' ? result.defenderLosses : result.attackerLosses)),
          row('Their losses', count(this.playerSide === 'defender' ? result.attackerLosses : result.defenderLosses)),
          row('Duration', `${Math.round(result.duration / 60)} minutes`),
        ),
        el('button', {
          class: 'primary',
          onClick: () => this.onDone(result),
        }, 'Return to the map'),
      ),
    );
    this.canvas.parentElement?.appendChild(overlay);
  }

  private draw(): void {
    drawBattle(this.ctx, this.battle, this.view);
  }
}
