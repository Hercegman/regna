/**
 * The campaign screen: the map, the panels, and the end-turn loop.
 *
 * It owns no rules. Every button calls an order function in `core/campaign` and
 * then re-renders from the returned state, so the interface cannot drift out of
 * step with the simulation or quietly do something the AI could not.
 */
import type { ArmyId, BuildingId, FactionId, RegionId, UnitTypeId } from '../core/types';
import { SETTLEMENT_ORDER } from '../core/types';
import type { Army, CampaignState, RegionState } from '../core/campaign';
import {
  armiesOf,
  availableBuildings,
  cancelConstruction,
  disbandRegiment,
  endTurn,
  factionFinances,
  factionState,
  garrisonArmy,
  mergeArmies,
  moveArmy,
  provinceIncome,
  provincesOf,
  publicOrder,
  recruitCost,
  recruitTurns,
  recruitableUnits,
  reachableNeighbours,
  regionState,
  setGovernor,
  sortieFromGarrison,
  startConstruction,
  startRecruitment,
  strengthOf,
  wallTier,
  planBattle,
  applyBattleResult,
  autoResolve,
  transferProvince,
  beginSiege,
  relation,
  declareWar,
  makePeace,
  proposeTrade,
  proposeAlliance,
  canDeclareWar,
  canMakePeace,
  assaultOdds,
  type BattlePlan,
} from '../core/campaign';
import { getBuildingType } from '../core/data/buildings';
import { getUnitType } from '../core/data/units';
import { getRegion } from '../core/data/regions';
import { FACTIONS, factionName, tryGetFaction, INDEPENDENT_ID } from '../core/data/factions';
import type { MapView } from '../render/map';
import { drawMap, provinceAt } from '../render/map';
import { createCamera, panCamera, zoomCamera } from '../render/projection';
import { bar, clear, count, el, money, pretty, row, swatch } from './dom';

export interface CampaignScreenHooks {
  /** Hand a battle to the battle screen; resolve when the player is done. */
  readonly onBattle: (plan: BattlePlan) => void;
}

type PanelTab = 'province' | 'build' | 'recruit' | 'diplomacy' | 'realm';

export class CampaignScreen {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly panel: HTMLElement;
  private readonly topBar: HTMLElement;
  private readonly logBox: HTMLElement;
  private readonly view: MapView;
  private tab: PanelTab = 'province';
  private selectedArmy: ArmyId | undefined;
  private moveMode = false;
  private busy = false;

  constructor(
    host: HTMLElement,
    private state: CampaignState,
    private readonly hooks: CampaignScreenHooks,
  ) {
    clear(host);
    this.topBar = el('header', { class: 'top-bar' });
    this.canvas = el('canvas', { class: 'map-canvas' });
    this.panel = el('aside', { class: 'side-panel' });
    this.logBox = el('div', { class: 'log-box' });

    host.appendChild(
      el('div', { class: 'campaign-screen' },
        this.topBar,
        el('div', { class: 'campaign-body' },
          el('div', { class: 'map-holder' }, this.canvas, this.logBox),
          this.panel,
        ),
      ),
    );

    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('This browser has no 2D canvas context.');
    this.ctx = context;

    this.view = {
      camera: createCamera(),
      viewport: { width: 100, height: 100 },
      selected: undefined,
      hovered: undefined,
      reachable: new Set(),
      alwaysLabel: false,
    };

    this.attachInput();
    this.resize();
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

    // Start looking at the player's own capital.
    const capital = factionState(state, state.player).capital;
    if (capital) this.focusOn(capital);
    this.selectProvince(capital);
    this.renderAll();
  }

  /** Replaces the state, after a battle has been resolved elsewhere. */
  setState(state: CampaignState): void {
    this.state = state;
    this.renderAll();
  }

  getState(): CampaignState {
    return this.state;
  }

  // -------------------------------------------------------------------------
  // Layout and input
  // -------------------------------------------------------------------------

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
    this.view.viewport = { width, height };
  }

  private attachInput(): void {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let moved = 0;

    this.canvas.addEventListener('mousedown', (event) => {
      dragging = true;
      moved = 0;
      lastX = event.clientX;
      lastY = event.clientY;
    });

    window.addEventListener('mouseup', (event) => {
      if (!dragging) return;
      dragging = false;
      // A drag pans; a click selects.
      if (moved < 5) this.handleClick(event);
    });

    this.canvas.addEventListener('mousemove', (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (dragging) {
        const dx = event.clientX - lastX;
        const dy = event.clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        lastX = event.clientX;
        lastY = event.clientY;
        panCamera(this.view.camera, dx, dy);
        this.draw();
        return;
      }
      const hovered = provinceAt(this.view, this.state, x, y);
      if (hovered !== this.view.hovered) {
        this.view.hovered = hovered;
        this.canvas.style.cursor = hovered ? 'pointer' : 'grab';
        this.draw();
      }
    });

    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoomCamera(
        this.view.camera,
        this.view.viewport,
        factor,
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
      this.draw();
    }, { passive: false });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.repeat) {
        void this.doEndTurn();
      } else if (event.key === 'Escape') {
        this.moveMode = false;
        this.view.reachable.clear();
        this.renderAll();
      } else if (event.key === 'l' || event.key === 'L') {
        this.view.alwaysLabel = !this.view.alwaysLabel;
        this.draw();
      }
    });
  }

  private handleClick(event: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const id = provinceAt(this.view, this.state, event.clientX - rect.left, event.clientY - rect.top);
    if (!id) return;

    if (this.moveMode && this.selectedArmy && this.view.reachable.has(id)) {
      this.orderMove(this.selectedArmy, id);
      return;
    }

    this.selectProvince(id);
    this.renderAll();
  }

  private selectProvince(id: RegionId | undefined): void {
    this.view.selected = id;
    this.moveMode = false;
    this.view.reachable.clear();
    this.selectedArmy = undefined;
    if (id) {
      // Selecting a province also picks up our own army standing in it.
      const own = [...this.state.armies.values()].find(
        (army) => army.location === id && army.faction === this.state.player,
      );
      this.selectedArmy = own?.id;
    }
    if (this.tab === 'build' || this.tab === 'recruit') {
      const region = id ? this.state.regions.get(id) : undefined;
      if (!region || region.owner !== this.state.player) this.tab = 'province';
    }
  }

  private focusOn(id: RegionId): void {
    const geography = getRegion(id);
    this.view.camera.centreLon = geography.lon;
    this.view.camera.centreLat = geography.lat;
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private renderAll(): void {
    this.renderTopBar();
    this.renderPanel();
    this.renderLog();
    this.draw();
  }

  private draw(): void {
    drawMap(this.ctx, this.state, this.view);
  }

  private renderTopBar(): void {
    const state = this.state;
    const faction = tryGetFaction(state.player);
    const finances = factionFinances(state, state.player);
    const treasury = factionState(state, state.player).treasury;
    const provinces = provincesOf(state, state.player).length;

    clear(this.topBar);
    this.topBar.appendChild(
      el('div', { class: 'top-left' },
        swatch(faction?.colour ?? '#888'),
        el('strong', {}, faction?.name ?? 'Unknown'),
        el('span', { class: 'muted' }, `${provinces} provinces`),
      ),
    );
    this.topBar.appendChild(
      el('div', { class: 'top-centre' },
        el('strong', {}, `${state.year}`),
        el('span', { class: 'muted' }, pretty(state.season)),
        el('span', { class: 'muted' }, `turn ${state.turn}`),
      ),
    );
    this.topBar.appendChild(
      el('div', { class: 'top-right' },
        el('span', { class: 'coin' }, count(treasury)),
        el('span', { class: finances.net >= 0 ? 'income good' : 'income bad' }, money(finances.net)),
        el('button', {
          class: 'primary',
          disabled: this.busy,
          onClick: () => void this.doEndTurn(),
        }, this.busy ? 'Resolving…' : 'End turn'),
      ),
    );
  }

  private renderLog(): void {
    clear(this.logBox);
    const entries = this.state.log.slice(-7).reverse();
    for (const entry of entries) {
      this.logBox.appendChild(
        el('div', { class: 'log-line' },
          el('span', { class: 'log-year' }, String(entry.year)),
          el('span', {}, entry.text),
        ),
      );
    }
  }

  private renderPanel(): void {
    clear(this.panel);
    const id = this.view.selected;
    if (!id) {
      this.panel.appendChild(el('div', { class: 'panel-empty' }, 'Select a province.'));
      this.panel.appendChild(this.tabBar(false));
      return;
    }
    const region = regionState(this.state, id);
    const mine = region.owner === this.state.player;

    this.panel.appendChild(this.panelHeader(region));
    this.panel.appendChild(this.tabBar(mine));

    const body = el('div', { class: 'panel-body' });
    switch (this.tab) {
      case 'build':
        this.renderBuildTab(body, region);
        break;
      case 'recruit':
        this.renderRecruitTab(body, region);
        break;
      case 'diplomacy':
        this.renderDiplomacyTab(body);
        break;
      case 'realm':
        this.renderRealmTab(body);
        break;
      default:
        this.renderProvinceTab(body, region);
    }
    this.panel.appendChild(body);
  }

  private panelHeader(region: RegionState): HTMLElement {
    const geography = getRegion(region.id);
    const owner = tryGetFaction(region.owner);
    return el('div', { class: 'panel-header' },
      el('h2', {}, geography.settlement),
      el('p', { class: 'panel-sub' },
        swatch(owner?.colour ?? '#8d8578'),
        `${geography.province} · ${factionName(region.owner)}`,
      ),
    );
  }

  private tabBar(mine: boolean): HTMLElement {
    const make = (tab: PanelTab, label: string, enabled = true): HTMLElement =>
      el('button', {
        class: `tab${this.tab === tab ? ' active' : ''}`,
        disabled: !enabled,
        onClick: () => {
          this.tab = tab;
          this.renderPanel();
        },
      }, label);
    return el('nav', { class: 'tab-bar' },
      make('province', 'Province'),
      make('build', 'Build', mine),
      make('recruit', 'Recruit', mine),
      make('diplomacy', 'Diplomacy'),
      make('realm', 'Realm'),
    );
  }

  // --- province tab

  private renderProvinceTab(body: HTMLElement, region: RegionState): void {
    const geography = getRegion(region.id);
    const income = provinceIncome(this.state, region);
    const order = publicOrder(this.state, region);
    const mine = region.owner === this.state.player;
    const faith = tryGetFaction(region.owner)?.religion;

    body.appendChild(el('section', {},
      row('Settlement', pretty(region.tier)),
      row('Population', `${count(region.population * 1000)}`),
      row('Terrain', pretty(geography.terrain)),
      row('Resource', pretty(geography.resource)),
      row('Walls', pretty(wallTier(region))),
      row('Faith', `${pretty(region.religion)}${faith && faith !== region.religion ? ' (ruled by another)' : ''}`),
      row('Unrest', el('span', {},
        bar(region.unrest / 100, region.unrest > 60 ? '#e2574c' : '#e5a33a'),
        ` ${Math.round(region.unrest)}`,
      )),
      row('Public order', order.toFixed(1)),
    ));

    if (mine) {
      body.appendChild(el('h3', {}, 'Income'));
      body.appendChild(el('section', {},
        row('Farming', count(income.farming)),
        row('Taxes', count(income.tax)),
        row('Trade', count(income.trade)),
        income.mining > 0 && row('Mining', count(income.mining)),
        row('Upkeep', `-${count(income.buildingUpkeep)}`),
        row('Net', money(income.net), 'emphasis'),
      ));

      if (region.construction) {
        const type = getBuildingType(region.construction.building);
        body.appendChild(el('h3', {}, 'Under construction'));
        body.appendChild(el('section', {},
          row(type.name, `${region.construction.turnsLeft} turns left`),
          el('button', {
            class: 'danger small',
            onClick: () => {
              cancelConstruction(this.state, region.id);
              this.renderAll();
            },
          }, 'Cancel (half refund)'),
        ));
      }

      if (region.recruitQueue.length > 0) {
        body.appendChild(el('h3', {}, 'Mustering'));
        const list = el('section', {});
        region.recruitQueue.forEach((entry, index) => {
          list.appendChild(row(
            `${index + 1}. ${getUnitType(entry.unit).name}`,
            `${entry.turnsLeft} turns`,
          ));
        });
        body.appendChild(list);
      }
    }

    body.appendChild(el('h3', {}, `Garrison (${count(strengthOf(region.garrison))} men)`));
    const garrison = el('section', { class: 'unit-list' });
    if (region.garrison.length === 0) {
      garrison.appendChild(el('p', { class: 'muted' }, 'The settlement is undefended.'));
    }
    region.garrison.forEach((regiment, index) => {
      const type = getUnitType(regiment.type);
      garrison.appendChild(el('div', { class: 'unit-row', title: type.description },
        el('span', { class: 'unit-name' }, type.name),
        el('span', { class: 'unit-strength' }, `${count(regiment.soldiers)}/${type.soldiers}`),
        mine && el('button', {
          class: 'tiny',
          title: 'Disband this regiment',
          onClick: () => {
            disbandRegiment(this.state, region.id, index);
            this.renderAll();
          },
        }, '×'),
      ));
    });
    body.appendChild(garrison);

    if (mine && region.garrison.length > 0) {
      body.appendChild(el('button', {
        class: 'small',
        onClick: () => {
          sortieFromGarrison(
            this.state,
            region.id,
            region.garrison.map((_, index) => index),
          );
          this.selectProvince(region.id);
          this.renderAll();
        },
      }, 'Take the garrison into the field'));
    }

    if (region.siege) {
      body.appendChild(el('p', { class: 'warning' },
        `Under siege by ${factionName(region.siege.besieger)} for ${region.siege.turns} seasons.`,
      ));
    }

    this.renderArmySection(body, region);

    if (mine) {
      const faction = factionState(this.state, this.state.player);
      const free = faction.characters.filter((character) =>
        !(
          [...this.state.regions.values()].some(
            (other) => other.id !== region.id && other.governor?.id === character.id,
          )
        ),
      );
      body.appendChild(el('h3', {}, 'Governor'));
      const select = el('select', { class: 'select' });
      select.appendChild(el('option', { value: '' }, region.governor ? 'Recall' : 'None'));
      for (const character of free) {
        const option = el('option', { value: character.id as string },
          `${character.name} (admin ${character.governance}, command ${character.command})`,
        );
        if (region.governor?.id === character.id) option.selected = true;
        select.appendChild(option);
      }
      select.addEventListener('change', () => {
        if (select.value) setGovernor(this.state, region.id, select.value);
        else region.governor = undefined;
        this.renderAll();
      });
      body.appendChild(select);
    }
  }

  private renderArmySection(body: HTMLElement, region: RegionState): void {
    const armies = [...this.state.armies.values()].filter((army) => army.location === region.id);
    if (armies.length === 0) return;
    body.appendChild(el('h3', {}, 'Armies present'));
    for (const army of armies) {
      const mine = army.faction === this.state.player;
      const selected = this.selectedArmy === army.id;
      const header = el('div', { class: `army-header${selected ? ' selected' : ''}` },
        swatch(tryGetFaction(army.faction)?.colour ?? '#888'),
        el('span', {}, `${factionName(army.faction)} · ${count(strengthOf(army.regiments))} men`),
        mine && el('span', { class: 'muted' }, `move ${army.movement.toFixed(1)}`),
      );
      if (mine) {
        header.addEventListener('click', () => {
          this.selectedArmy = army.id;
          this.moveMode = false;
          this.view.reachable.clear();
          this.renderAll();
        });
      }
      body.appendChild(header);

      if (selected || !mine) {
        const list = el('section', { class: 'unit-list' });
        for (const regiment of army.regiments) {
          const type = getUnitType(regiment.type);
          list.appendChild(el('div', { class: 'unit-row', title: type.description },
            el('span', { class: 'unit-name' }, type.name),
            el('span', { class: 'unit-strength' }, `${count(regiment.soldiers)}/${type.soldiers}`),
            el('span', { class: 'unit-exp', title: 'Experience' }, '★'.repeat(Math.round(regiment.experience / 3))),
          ));
        }
        body.appendChild(list);
      }

      if (mine && selected) {
        body.appendChild(this.armyControls(army));
      }
    }
  }

  private armyControls(army: Army): HTMLElement {
    const region = regionState(this.state, army.location);
    const controls = el('div', { class: 'army-controls' });

    controls.appendChild(el('button', {
      class: this.moveMode ? 'small active' : 'small',
      disabled: army.movement <= 0,
      onClick: () => {
        this.moveMode = !this.moveMode;
        this.view.reachable = this.moveMode
          ? new Set(reachableNeighbours(this.state, army))
          : new Set();
        this.renderAll();
      },
    }, this.moveMode ? 'Choose a province…' : 'March'));

    if (region.owner === this.state.player) {
      controls.appendChild(el('button', {
        class: 'small',
        onClick: () => {
          garrisonArmy(this.state, army.id);
          this.selectProvince(region.id);
          this.renderAll();
        },
      }, 'Garrison here'));
    }

    const others = [...this.state.armies.values()].filter(
      (other) => other.id !== army.id && other.location === army.location && other.faction === army.faction,
    );
    if (others.length > 0) {
      controls.appendChild(el('button', {
        class: 'small',
        onClick: () => {
          for (const other of others) mergeArmies(this.state, army.id, other.id);
          this.renderAll();
        },
      }, 'Combine armies'));
    }

    if (region.siege && region.siege.besieger === army.faction) {
      const odds = assaultOdds(this.state, region.id, army.faction, army.regiments);
      controls.appendChild(el('button', {
        class: 'danger small',
        title: `Storming walls of this strength costs an extra ${Math.round(odds * 100)}% in effective odds.`,
        onClick: () => this.launchAssault(army, region),
      }, 'Storm the walls'));
    }

    return controls;
  }

  // --- build tab

  private renderBuildTab(body: HTMLElement, region: RegionState): void {
    if (region.construction) {
      const type = getBuildingType(region.construction.building);
      body.appendChild(el('p', {},
        `${type.name} is under construction, ${region.construction.turnsLeft} turns remaining.`,
      ));
      return;
    }
    const treasury = factionState(this.state, this.state.player).treasury;
    const options = availableBuildings(this.state, region.id);
    if (options.length === 0) {
      body.appendChild(el('p', { class: 'muted' },
        'Nothing further can be built until the settlement grows.',
      ));
    }
    const byChain = new Map<string, BuildingId[]>();
    for (const id of options) {
      const chain = getBuildingType(id).chain;
      byChain.set(chain, [...(byChain.get(chain) ?? []), id]);
    }
    for (const [chain, ids] of byChain) {
      body.appendChild(el('h3', {}, pretty(chain)));
      for (const id of ids) {
        const type = getBuildingType(id);
        const affordable = treasury >= type.cost;
        body.appendChild(el('div', { class: 'offer' },
          el('div', { class: 'offer-main' },
            el('strong', {}, type.name),
            el('p', { class: 'offer-text' }, type.description),
            el('p', { class: 'offer-meta' },
              `${count(type.cost)} florins · ${type.turnsToBuild} turns` +
                (type.upkeep > 0 ? ` · ${type.upkeep}/turn upkeep` : ''),
            ),
          ),
          el('button', {
            class: 'small',
            disabled: !affordable,
            onClick: () => {
              startConstruction(this.state, region.id, id);
              this.tab = 'province';
              this.renderAll();
            },
          }, affordable ? 'Build' : 'Too costly'),
        ));
      }
    }
  }

  // --- recruit tab

  private renderRecruitTab(body: HTMLElement, region: RegionState): void {
    const treasury = factionState(this.state, this.state.player).treasury;
    const options = recruitableUnits(this.state, region.id);
    if (options.length === 0) {
      body.appendChild(el('p', { class: 'muted' },
        'No troops can be raised here. Build barracks, ranges or stables first.',
      ));
      return;
    }
    const sorted = [...options].sort((a, b) => {
      const left = getUnitType(a);
      const right = getUnitType(b);
      return left.tier - right.tier || left.name.localeCompare(right.name);
    });
    for (const id of sorted) {
      const type = getUnitType(id);
      const cost = recruitCost(this.state.player, id);
      const affordable = treasury >= cost;
      body.appendChild(el('div', { class: 'offer' },
        el('div', { class: 'offer-main' },
          el('strong', {}, type.name),
          el('p', { class: 'offer-text' }, type.description),
          el('p', { class: 'offer-meta' },
            `${type.soldiers} men · ${count(cost)} florins · ${type.upkeep}/turn · ` +
              `${recruitTurns(id)} turns · att ${type.attack} def ${type.defence + type.armour} mor ${type.morale}`,
          ),
        ),
        el('button', {
          class: 'small',
          disabled: !affordable || region.recruitQueue.length >= 3,
          onClick: () => {
            startRecruitment(this.state, region.id, id);
            this.renderAll();
          },
        }, affordable ? 'Raise' : 'Too costly'),
      ));
    }
  }

  // --- diplomacy tab

  private renderDiplomacyTab(body: HTMLElement): void {
    const me = this.state.player;
    const others = FACTIONS.filter((faction) => {
      const live = this.state.factions.get(faction.id);
      return faction.id !== me && live?.alive;
    });
    body.appendChild(el('p', { class: 'muted' },
      'Attitude is what they think of us. Terms are refused when attitude is too low.',
    ));
    for (const faction of others) {
      const current = relation(this.state, me, faction.id);
      const theirs = relation(this.state, faction.id, me);
      const row = el('div', { class: 'diplo-row' },
        el('div', { class: 'diplo-name' }, swatch(faction.colour), faction.name),
        el('div', { class: 'diplo-state' },
          el('span', { class: `stance ${current.stance}` }, pretty(current.stance)),
          el('span', { class: 'muted' }, `attitude ${Math.round(theirs.attitude)}`),
        ),
        el('div', { class: 'diplo-actions' },
          canDeclareWar(this.state, me, faction.id) && el('button', {
            class: 'tiny danger',
            onClick: () => {
              declareWar(this.state, me, faction.id);
              this.renderAll();
            },
          }, 'War'),
          canMakePeace(this.state, me, faction.id) && el('button', {
            class: 'tiny',
            onClick: () => {
              makePeace(this.state, me, faction.id);
              this.renderAll();
            },
          }, 'Truce'),
          current.stance !== 'war' && current.stance !== 'trade' && current.stance !== 'alliance' &&
            el('button', {
              class: 'tiny',
              onClick: () => {
                const accepted = proposeTrade(this.state, me, faction.id);
                if (!accepted) this.flash(`${faction.name} declines a trade agreement.`);
                this.renderAll();
              },
            }, 'Trade'),
          current.stance === 'trade' && el('button', {
            class: 'tiny',
            onClick: () => {
              const accepted = proposeAlliance(this.state, me, faction.id);
              if (!accepted) this.flash(`${faction.name} declines an alliance.`);
              this.renderAll();
            },
          }, 'Alliance'),
        ),
      );
      body.appendChild(row);
    }
  }

  // --- realm tab

  private renderRealmTab(body: HTMLElement): void {
    const me = this.state.player;
    const finances = factionFinances(this.state, me);
    const faction = factionState(this.state, me);
    body.appendChild(el('section', {},
      row('Treasury', count(faction.treasury)),
      row('Provincial net', money(finances.provinceNet)),
      row('Army upkeep', `-${count(finances.armyUpkeep)}`),
      row('Garrison upkeep', `-${count(finances.garrisonUpkeep)}`),
      finances.stipend > 0 && row('Stipend', money(finances.stipend)),
      row('Balance', money(finances.net), 'emphasis'),
    ));

    body.appendChild(el('h3', {}, 'Provinces'));
    const provinces = provincesOf(this.state, me).sort(
      (a, b) => SETTLEMENT_ORDER.indexOf(b.tier) - SETTLEMENT_ORDER.indexOf(a.tier),
    );
    for (const province of provinces) {
      const income = provinceIncome(this.state, province);
      body.appendChild(el('div', {
        class: 'realm-row',
        onClick: () => {
          this.selectProvince(province.id);
          this.focusOn(province.id);
          this.tab = 'province';
          this.renderAll();
        },
      },
        el('span', { class: 'realm-name' }, getRegion(province.id).settlement),
        el('span', { class: 'muted' }, pretty(province.tier)),
        el('span', { class: income.net >= 0 ? 'good' : 'bad' }, money(income.net)),
        province.unrest > 50 && el('span', { class: 'bad' }, '!'),
        province.siege && el('span', { class: 'bad' }, 'siege'),
      ));
    }

    body.appendChild(el('h3', {}, 'Characters'));
    for (const character of faction.characters) {
      body.appendChild(row(
        `${character.name}${character.leader ? ' (ruler)' : ''}`,
        `age ${character.age} · command ${character.command} · admin ${character.governance}`,
      ));
    }
  }

  // -------------------------------------------------------------------------
  // Orders that can start a battle
  // -------------------------------------------------------------------------

  private orderMove(id: ArmyId, to: RegionId): void {
    const army = this.state.armies.get(id);
    if (!army) return;
    const result = moveArmy(this.state, id, to);
    this.moveMode = false;
    this.view.reachable.clear();

    switch (result.kind) {
      case 'moved':
        this.selectProvince(to);
        break;
      case 'blocked':
        this.flash(result.reason);
        break;
      case 'captured':
        transferProvince(this.state, to, army.faction);
        army.location = to;
        this.selectProvince(to);
        break;
      case 'siege': {
        beginSiege(this.state, id, to);
        this.selectProvince(to);
        break;
      }
      case 'battle': {
        const defenders = result.defendingArmies
          .map((armyId) => this.state.armies.get(armyId))
          .filter((candidate): candidate is Army => candidate !== undefined);
        const plan = planBattle(this.state, to, [army], defenders);
        this.hooks.onBattle(plan);
        return;
      }
    }
    this.renderAll();
  }

  private launchAssault(army: Army, region: RegionState): void {
    const defenders = [...this.state.armies.values()].filter(
      (other) => other.location === region.id && other.faction === region.owner,
    );
    const plan = planBattle(this.state, region.id, [army], defenders, { isAssault: true });
    this.hooks.onBattle(plan);
  }

  /** A short message in the log area, for refused orders. */
  flash(message: string): void {
    this.state.log.push({
      turn: this.state.turn,
      year: this.state.year,
      faction: this.state.player,
      text: message,
    });
    this.renderLog();
  }

  // -------------------------------------------------------------------------
  // The turn
  // -------------------------------------------------------------------------

  private async doEndTurn(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.renderTopBar();
    // Yield once so the button repaints before the AI runs.
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      endTurn(this.state);
    } finally {
      this.busy = false;
    }
    const selected = this.view.selected;
    this.selectProvince(selected);
    this.renderAll();
  }

  /** Resolves a battle the player chose not to fight in person. */
  resolveAutomatically(plan: BattlePlan): void {
    applyBattleResult(this.state, plan, autoResolve(plan));
    this.selectProvince(this.view.selected);
    this.renderAll();
  }

  /** Applies a battle the player fought, then returns to the map. */
  applyFoughtBattle(plan: BattlePlan, result: Parameters<typeof applyBattleResult>[2]): void {
    applyBattleResult(this.state, plan, result);
    this.selectProvince(this.view.selected);
    this.renderAll();
  }

  /** Reports whether the player still holds anything. */
  isDefeated(): boolean {
    const faction = factionState(this.state, this.state.player);
    return !faction.alive || (provincesOf(this.state, this.state.player).length === 0 &&
      armiesOf(this.state, this.state.player).length === 0);
  }

  /** True when the player holds more than half the map. */
  hasWon(): boolean {
    const total = this.state.regions.size;
    const mine = provincesOf(this.state, this.state.player).length;
    return mine > total * 0.5;
  }

  /** The strongest rivals, for the end screen. */
  rivals(): { readonly faction: FactionId; readonly provinces: number }[] {
    const counts = new Map<FactionId, number>();
    for (const region of this.state.regions.values()) {
      if (region.owner === INDEPENDENT_ID) continue;
      counts.set(region.owner, (counts.get(region.owner) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([faction, provinces]) => ({ faction, provinces }))
      .sort((a, b) => b.provinces - a.provinces);
  }
}

export type { UnitTypeId, BuildingId };
