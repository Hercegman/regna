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
import { getSeaZone } from '../core/data/seas';
import type { BattlePlan } from '../core/campaign';
import type { BattleState } from '../core/battle/sim';
import { createBattle, stepBattle } from '../core/battle/sim';
import type { BattleResult, BattleUnit, Side } from '../core/battle/types';
import { BATTLE_TIME_LIMIT, TICK } from '../core/battle/types';
import type { BattleView } from '../render/battle';
import {
  clampBattleCamera,
  drawBattle,
  fitBattleCamera,
  frameBattleCamera,
  panBattleCamera,
  screenToField,
  unitAt,
  zoomBattleCamera,
} from '../render/battle';
import { drawBattleRadar, radarToField } from '../render/battleRadar';
import { whenSpritesReady } from '../render/iso/sprites';
import { bar, clear, count, el, pretty, row } from './dom';
import { battleCard, crest, plaque, type BattleCardHandle } from './hud';

const SPEEDS = [1, 2, 4, 8] as const;

export class BattleScreen {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly header: HTMLElement;
  /** The band along the bottom: the men, the orders, and the radar. */
  private readonly cardStrip: HTMLElement;
  private readonly commandBlock: HTMLElement;
  private readonly radarBlock: HTMLElement;
  private readonly radar: HTMLCanvasElement;
  /** One card per regiment, built once and updated in place. */
  private readonly cards = new Map<string, BattleCardHandle>();
  /** The order of battle, on a parchment over the field. */
  private readonly scrollPanel: HTMLElement;
  private readonly scrollInner: HTMLElement;
  private scrollOpen = false;
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

    this.header = el('header', { class: 'hud-top battle-top' });
    this.canvas = el('canvas', { class: 'battle-canvas' });
    this.cardStrip = el('div', { class: 'hud-cards' });
    this.commandBlock = el('div', { class: 'hud-command' });
    this.radar = el('canvas', { class: 'radar-canvas battle-radar' });
    this.radarBlock = el('div', { class: 'hud-radar' });
    this.scrollInner = el('div', { class: 'scroll-inner' });
    this.scrollPanel = el('aside', { class: 'scroll-panel hidden' }, this.scrollInner);

    host.appendChild(
      el('div', { class: 'battle-screen' },
        this.header,
        el('div', { class: 'battle-field' }, this.canvas, this.scrollPanel),
        el('footer', { class: 'hud-bottom' },
          this.cardStrip,
          this.commandBlock,
          this.radarBlock,
        ),
      ),
    );

    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('This browser has no 2D canvas context.');
    this.ctx = context;

    this.view = {
      width: 100,
      height: 100,
      selected: undefined,
      hovered: undefined,
      zoom: 1,
      centre: { x: 0, y: 0 },
      touched: false,
    };
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

    this.buildRadar();
    this.buildCards();
    this.renderHeader();
    this.renderPanels();
    this.draw();
    // A battle that opens paused draws once and then waits, so if the sheet
    // of sprites is still in the air at that moment the field stays empty.
    whenSpritesReady(() => this.draw());
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
    // A camera the player has not touched keeps the whole field in view; one
    // they have is left where they put it.
    if (this.view.touched) clampBattleCamera(this.view);
    else frameBattleCamera(this.view, this.battle.units, this.battle.setup.settlement);
  }

  private attachInput(): void {
    // Dragging with the right button moves the camera, which leaves the left
    // button free to mean "orders" and nothing else.
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());

    this.canvas.addEventListener('mousedown', (event) => {
      if (event.button !== 2 && event.button !== 1) return;
      event.preventDefault();
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      this.canvas.style.cursor = 'grabbing';
    });

    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      this.canvas.style.cursor = 'default';
    });

    this.canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        zoomBattleCamera(
          this.view,
          Math.pow(0.9988, event.deltaY),
          event.clientX - rect.left,
          event.clientY - rect.top,
        );
        this.draw();
      },
      { passive: false },
    );

    this.canvas.addEventListener('mousemove', (event) => {
      if (dragging) {
        panBattleCamera(this.view, event.clientX - lastX, event.clientY - lastY);
        lastX = event.clientX;
        lastY = event.clientY;
        this.draw();
        return;
      }
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
            this.renderPanels();
            this.draw();
            return;
          }
          if (target && target.side === selected.side) {
            this.view.selected = target.id;
            this.renderPanels();
            this.draw();
            return;
          }
        }
        selected.order = { kind: 'move', target: screenToField(this.view, x, y) };
        this.renderPanels();
        this.draw();
        return;
      }

      this.view.selected = clicked;
      this.renderPanels();
      this.draw();
    });

    window.addEventListener('keydown', (event) => {
      if (this.finished) return;
      if (event.key === ' ') {
        event.preventDefault();
        this.toggle();
        return;
      }
      const rect = this.canvas.getBoundingClientRect();
      if (event.key === '+' || event.key === '=') {
        zoomBattleCamera(this.view, 1.25, rect.width / 2, rect.height / 2);
        this.draw();
      } else if (event.key === '-' || event.key === '_') {
        zoomBattleCamera(this.view, 0.8, rect.width / 2, rect.height / 2);
        this.draw();
      } else if (event.key === 'Home') {
        fitBattleCamera(this.view);
        this.view.touched = false;
        this.draw();
      }
    });
  }

  /** Development aid: look at the field at a given number of pixels per metre. */
  setZoom(zoom: number): void {
    this.view.zoom = zoom;
    this.view.touched = true;
    clampBattleCamera(this.view);
    this.draw();
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
        this.renderPanels();
      }
      if (this.battle.finished) {
        this.renderHeader();
        this.renderPanels();
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

  /**
   * Advances the battle by a number of seconds and redraws, without running
   * the clock. Used to open a battle at a chosen moment rather than at its
   * first tick, which is how the screenshots in the README are taken.
   */
  advanceTo(seconds: number): void {
    const ticks = Math.max(0, Math.floor(seconds / TICK));
    for (let i = 0; i < ticks && !this.battle.finished; i++) stepBattle(this.battle);
    this.draw();
    this.renderHeader();
    this.renderPanels();
    if (this.battle.finished) this.conclude();
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
    this.renderPanels();
    this.renderResult(result);
  }

  // -------------------------------------------------------------------------
  // Panels
  // -------------------------------------------------------------------------

  /**
   * The plaque along the top.
   *
   * The two armies and how much of each is still standing, the clock, and
   * the ground being fought over. What is being done about any of it belongs
   * at the other end of the screen, next to the radar.
   */
  private renderHeader(): void {
    const setup = this.plan.setup;
    const minutes = Math.floor(this.battle.time / 60);
    const seconds = Math.floor(this.battle.time % 60);
    clear(this.header);
    this.header.appendChild(
      el('div', { class: 'battle-sides' },
        this.sideSummary('attacker'),
        el('span', { class: 'versus' },
          this.plan.naval ? 'engages at sea' : this.plan.isAssault ? 'assaults' : 'meets',
        ),
        this.sideSummary('defender'),
      ),
    );
    this.header.appendChild(
      el('div', { class: 'hud-calendar' },
        plaque('Time', `${minutes}:${seconds.toString().padStart(2, '0')}`),
        plaque(
          this.plan.naval ? 'Water' : 'Ground',
          this.plan.zone ? getSeaZone(this.plan.zone).name : pretty(setup.terrain),
        ),
        setup.isWinter && plaque('Season', 'Winter'),
      ),
    );
    this.header.appendChild(el('div', { class: 'hud-purse' }));
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
      crest(colour, factionName(faction), faction),
      el('span', { class: 'side-name' },
        factionName(faction) + (this.playerSide === side ? ' (you)' : ''),
      ),
      el('span', { class: 'side-strength' }, count(standing)),
      bar(start === 0 ? 0 : standing / start, colour),
    );
  }

  // -------------------------------------------------------------------------
  // The band along the bottom
  // -------------------------------------------------------------------------

  /**
   * One card per regiment, built once.
   *
   * The regiments in a battle are fixed at the moment it starts — nobody
   * arrives and nobody is raised — so the cards can be made once and only
   * their bars moved afterwards. That is what makes it affordable to refresh
   * them four times a second while the battle runs.
   */
  private buildCards(): void {
    clear(this.cardStrip);
    this.cards.clear();
    const mine = this.battle.units.filter(
      (unit) => this.playerSide === undefined || unit.side === this.playerSide,
    );

    const faction = this.playerSide === 'defender'
      ? this.plan.setup.defender
      : this.plan.setup.attacker;
    this.cardStrip.appendChild(el('div', { class: 'cards-banner' },
      crest(tryGetFaction(faction)?.colour ?? '#8d8578', factionName(faction), faction),
      el('span', { class: 'cards-place' },
        this.playerSide ? 'Our regiments' : 'The field'),
      el('span', { class: 'cards-meta', id: 'battle-standing' }, ''),
    ));

    const row = el('div', { class: 'card-row' });
    for (const unit of mine) {
      const type = getUnitType(unit.type);
      const card = battleCard(
        type.name,
        tryGetFaction(unit.faction)?.colour ?? '#8d8578',
        type.mounted,
        this.plan.naval,
        unit.experience,
        `${type.name}\n${factionName(unit.faction)} · ${pretty(UNIT_ROLE[type.unitClass])}` +
          `\n\n${type.description}`,
        () => {
          this.view.selected = unit.id;
          this.renderPanels();
          this.draw();
        },
      );
      this.cards.set(unit.id, card);
      row.appendChild(card.root);
    }
    this.cardStrip.appendChild(row);
  }

  /** The whole bottom band, from the state as it now stands. */
  private renderPanels(): void {
    let standing = 0;
    for (const unit of this.battle.units) {
      const type = getUnitType(unit.type);
      const gone = unit.stance === 'destroyed' || unit.fled;
      // Counted the way the plaque at the top counts it: a regiment running
      // for the treeline is not standing, whatever its card still says.
      if (!gone && unit.stance !== 'routing' && unit.side === this.playerSide) {
        standing += unit.soldiers;
      }
      const card = this.cards.get(unit.id);
      if (!card) continue;
      card.update({
        strength: unit.soldiers / Math.max(1, unit.startingSoldiers),
        morale: Math.max(0, 1 - unit.shock / Math.max(1, type.morale)),
        routing: unit.stance === 'routing',
        gone,
        selected: unit.id === this.view.selected,
      });
    }
    const tally = this.cardStrip.querySelector('#battle-standing');
    if (tally) tally.textContent = this.playerSide ? `${count(standing)} still standing` : '';

    this.renderCommand();
    this.renderRadarBlock();
    this.renderOrderOfBattle();
  }

  /** What the chosen regiment is, and what it can be told to do. */
  private renderCommand(): void {
    clear(this.commandBlock);
    const selected = this.selectedUnit();
    if (!selected) {
      this.commandBlock.appendChild(el('div', { class: 'command-head' },
        el('strong', {}, 'No regiment chosen'),
        el('span', { class: 'muted' }, 'Click a card, or a regiment on the field.'),
      ));
      return;
    }

    const type = getUnitType(selected.type);
    const threshold = Math.max(1, type.morale);
    this.commandBlock.appendChild(el('div', { class: 'command-head' },
      el('strong', {}, type.name),
      el('span', { class: 'muted' },
        `${count(selected.soldiers)}/${selected.startingSoldiers} \u00b7 ${pretty(selected.stance)}`),
    ));

    this.commandBlock.appendChild(el('div', { class: 'command-gauges' },
      el('span', { class: 'gauge' },
        el('span', { class: 'gauge-label' }, 'Heart'),
        bar(Math.max(0, 1 - selected.shock / threshold), '#8fb8d8')),
      el('span', { class: 'gauge' },
        el('span', { class: 'gauge-label' }, 'Wind'),
        bar(1 - selected.fatigue, '#e5a33a')),
      type.range > 0 && el('span', { class: 'gauge' },
        el('span', { class: 'gauge-label' }, 'Shot'),
        bar(selected.ammunition / Math.max(1, type.ammunition), '#b9d8a0')),
    ));

    if (!this.playerSide || selected.side !== this.playerSide || this.finished) return;

    const orders = el('div', { class: 'command-row' });
    orders.appendChild(this.orderButton('Hold', '\u26ca', true,
      selected.order?.kind === 'hold', () => this.setOrder(selected, { kind: 'hold' })));
    if (type.range > 0) {
      orders.appendChild(this.orderButton('Skirmish', '\u27b3', true,
        selected.order?.kind === 'skirmish', () => {
          const target = this.nearestEnemy(selected);
          if (target) this.setOrder(selected, { kind: 'skirmish', targetUnit: target.id });
        }));
    }
    orders.appendChild(this.orderButton('Charge', '\u2694', true,
      selected.order?.kind === 'attack', () => {
        const target = this.nearestEnemy(selected);
        if (target) this.setOrder(selected, { kind: 'attack', targetUnit: target.id });
      }));
    orders.appendChild(this.orderButton('Withdraw', '\u21a9', true,
      selected.order?.kind === 'withdraw',
      () => this.setOrder(selected, { kind: 'withdraw' }), true));
    this.commandBlock.appendChild(orders);
  }

  /** One of the carved buttons in the middle of the band. */
  private orderButton(
    label: string,
    glyph: string,
    enabled: boolean,
    active: boolean,
    act: () => void,
    danger = false,
  ): HTMLElement {
    return el('button', {
      class: `order${active ? ' active' : ''}${danger ? ' danger' : ''}`,
      disabled: !enabled,
      title: label,
      onClick: act,
    },
      el('span', { class: 'order-glyph' }, glyph),
      el('span', { class: 'order-label' }, label),
    );
  }

  // -------------------------------------------------------------------------
  // The radar and the clock
  // -------------------------------------------------------------------------

  /** A click on the radar takes the camera there, and dragging keeps it there. */
  private buildRadar(): void {
    let dragging = false;
    const goThere = (event: MouseEvent): void => {
      const rect = this.radar.getBoundingClientRect();
      const at = radarToField(
        rect.width,
        rect.height,
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
      this.view.centre = at;
      this.view.touched = true;
      clampBattleCamera(this.view);
      this.draw();
    };
    this.radar.addEventListener('mousedown', (event) => {
      dragging = true;
      goThere(event);
      event.preventDefault();
    });
    this.radar.addEventListener('mousemove', (event) => {
      if (dragging) goThere(event);
    });
    window.addEventListener('mouseup', () => {
      dragging = false;
    });
  }

  private renderRadarBlock(): void {
    clear(this.radarBlock);
    this.radarBlock.appendChild(el('div', { class: 'radar-frame' }, this.radar));

    const side = el('div', { class: 'radar-side' });
    side.appendChild(el('div', { class: 'radar-scrolls' },
      this.orderButton('Order of battle', '\u2630', true, this.scrollOpen, () => {
        this.scrollOpen = !this.scrollOpen;
        this.renderPanels();
      }),
      !this.finished && this.orderButton('Resolve', '\u23ed', true, false, () => this.finishNow()),
    ));

    if (!this.finished) {
      const speeds = el('div', { class: 'speed-row' });
      for (const speed of SPEEDS) {
        speeds.appendChild(el('button', {
          class: `speed${this.speed === speed ? ' active' : ''}`,
          onClick: () => {
            this.speed = speed;
            this.renderPanels();
          },
        }, `${speed}\u00d7`));
      }
      side.appendChild(speeds);
      side.appendChild(el('button', {
        class: 'end-turn',
        title: 'Space',
        onClick: () => this.toggle(),
      }, this.running ? 'Pause' : 'Advance'));
    } else {
      side.appendChild(el('p', { class: 'hud-hint' }, 'The fighting is over.'));
    }
    this.radarBlock.appendChild(side);
    this.drawRadar();
  }

  private drawRadar(): void {
    const width = this.radar.clientWidth || 190;
    const height = this.radar.clientHeight || 136;
    const ratio = window.devicePixelRatio || 1;
    if (this.radar.width !== Math.floor(width * ratio)) {
      this.radar.width = Math.max(1, Math.floor(width * ratio));
      this.radar.height = Math.max(1, Math.floor(height * ratio));
    }
    const ctx = this.radar.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawBattleRadar(ctx, width, height, {
      state: this.battle,
      selected: this.view.selected,
      playerSide: this.playerSide,
      corners: [
        screenToField(this.view, 0, 0),
        screenToField(this.view, this.view.width, 0),
        screenToField(this.view, this.view.width, this.view.height),
        screenToField(this.view, 0, this.view.height),
      ],
    });
  }

  /**
   * The order of battle, on a parchment over the field.
   *
   * Both sides, because knowing what is across from you is most of what a
   * general was doing. It is a thing to read rather than a thing to act on,
   * so it belongs on the scroll and not in the band.
   */
  private renderOrderOfBattle(): void {
    this.scrollPanel.className = `scroll-panel${this.scrollOpen ? '' : ' hidden'}`;
    clear(this.scrollInner);
    if (!this.scrollOpen) return;

    this.scrollInner.appendChild(el('div', { class: 'scroll-head' },
      el('span', { class: 'scroll-rings' }, '\u2740'),
      el('button', {
        class: 'scroll-close',
        title: 'Close',
        onClick: () => {
          this.scrollOpen = false;
          this.renderPanels();
        },
      }, '\u00d7'),
    ));
    this.scrollInner.appendChild(el('div', { class: 'panel-header' },
      el('h2', {}, 'Order of battle'),
      el('p', { class: 'panel-sub' },
        this.plan.naval ? 'At sea' : pretty(this.plan.setup.terrain),
      ),
    ));

    const body = el('div', { class: 'panel-body' });
    for (const side of ['attacker', 'defender'] as Side[]) {
      const faction = side === 'attacker' ? this.plan.setup.attacker : this.plan.setup.defender;
      body.appendChild(el('h3', {},
        `${factionName(faction)} \u00b7 ${side === 'attacker' ? 'attacking' : 'defending'}`,
      ));
      for (const unit of this.battle.units.filter((candidate) => candidate.side === side)) {
        const type = getUnitType(unit.type);
        const dead = unit.stance === 'destroyed' || unit.fled;
        body.appendChild(el('div', {
          class: `unit-row clickable${dead ? ' gone' : ''}${unit.stance === 'routing' ? ' routing' : ''}`,
          title: type.description,
          onClick: () => {
            this.view.selected = unit.id;
            this.renderPanels();
            this.draw();
          },
        },
          el('span', { class: 'unit-name' }, type.name),
          el('span', { class: 'unit-strength' },
            dead ? '\u2014' : `${count(unit.soldiers)}/${unit.startingSoldiers}`),
          el('span', { class: 'unit-exp' }, '\u2605'.repeat(Math.round(unit.experience / 3))),
        ));
      }
    }
    this.scrollInner.appendChild(body);
  }

  private setOrder(unit: BattleUnit, order: BattleUnit['order']): void {
    unit.order = order;
    this.renderPanels();
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
          row(
            this.plan.naval ? 'Our crews lost' : 'Our losses',
            count(this.playerSide === 'defender' ? result.defenderLosses : result.attackerLosses),
          ),
          row(
            this.plan.naval ? 'Their crews lost' : 'Their losses',
            count(this.playerSide === 'defender' ? result.attackerLosses : result.defenderLosses),
          ),
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
