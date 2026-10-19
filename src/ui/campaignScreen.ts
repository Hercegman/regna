/**
 * The campaign screen: the map, the panels, and the end-turn loop.
 *
 * It owns no rules. Every button calls an order function in `core/campaign` and
 * then re-renders from the returned state, so the interface cannot drift out of
 * step with the simulation or quietly do something the AI could not.
 */
import type { AgentId, ArmyId, BuildingId, FactionId, FleetId, RegionId, UnitTypeId } from '../core/types';
import { SETTLEMENT_ORDER } from '../core/types';
import type { Agent, Army, CampaignState, Fleet, FleetLocation, RegionState } from '../core/campaign';
import {
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
  blockaderOf,
  buildableShips,
  disembark,
  embark,
  fleetCapacity,
  fleetsInZone,
  fleetsOf,
  isAtWar,
  mergeFleets,
  moveFleet,
  planNavalBattle,
  reachableWaters,
  sameWater,
  scrapShip,
  activeRoutesThrough,
  canDispatch,
  caravanLocation,
  caravanOutlay,
  caravansIn,
  caravansOf,
  dispatchCaravan,
  expectedReturn,
  canHire,
  hireMercenary,
  absolutionPrice,
  authorityFor,
  canJoinHolyWar,
  donate,
  faithOf,
  holyWarHolder,
  isCensured,
  isSworn,
  joinHolyWar,
  seekAbsolution,
  standingOf,
  isMercenary,
  mercenaryCompanies,
  offersAt,
  shipBuildTurns,
  shipCost,
  startShipbuilding,
  type BattlePlan,
} from '../core/campaign';
import {
  agentDestinations,
  agentsAt,
  agentsOf,
  attemptMission,
  canRecruitAgent,
  dismissAgent,
  guard,
  merchantIncome,
  missionsFor,
  moveAgent,
  recruitAgent,
  MAX_AGENTS,
} from '../core/campaign/agents';
import type { MissionOffer } from '../core/campaign/agents';
import { AGENT_TYPES, getAgentType } from '../core/data/agents';
import {
  canMarry,
  heirApparent,
  isAdult,
  isMinor,
  leaderOf,
  legitimacyUnrest,
  marriageOdds,
  marriedTo,
  proposeMarriage,
} from '../core/campaign/dynasty';
import {
  GUIDE_STEPS,
  dismissGuide,
  guideDismissed,
  guideProgress,
  restoreGuide,
} from './tutorial';
import {
  canPoach,
  mercenaryUpkeep,
  poachCompany,
  poachable,
} from '../core/campaign/mercenaries';
import { Rng } from '../core/rng';
import { commitRng, rngFor } from '../core/campaign';
import { getBuildingType } from '../core/data/buildings';
import { getUnitType } from '../core/data/units';
import { getRegion } from '../core/data/regions';
import { FACTIONS, factionName, tryGetFaction } from '../core/data/factions';
import type { SeaZoneId } from '../core/data/seas';
import { getSeaZone, zonesOffPort } from '../core/data/seas';
import { getTradeRoute } from '../core/data/trade';
import type { MapView } from '../render/map';
import { drawMap, provinceAt, zoneAt } from '../render/map';
import { createCamera, panCamera, zoomCamera } from '../render/projection';
import { bar, clear, count, el, money, pretty, row, swatch } from './dom';
import { downloadSave, saveToBrowser } from './persistence';

export interface CampaignScreenHooks {
  /** Hand a battle to the battle screen; resolve when the player is done. */
  readonly onBattle: (plan: BattlePlan) => void;
}

type PanelTab =
  | 'province'
  | 'build'
  | 'recruit'
  | 'shipyard'
  | 'trade'
  | 'diplomacy'
  | 'agents'
  | 'realm';

export class CampaignScreen {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly panel: HTMLElement;
  private readonly topBar: HTMLElement;
  private readonly logBox: HTMLElement;
  private readonly view: MapView;
  private tab: PanelTab = 'province';
  private selectedArmy: ArmyId | undefined;
  private selectedFleet: FleetId | undefined;
  private selectedAgent: AgentId | undefined;
  private moveMode = false;
  private travelMode = false;
  /** The opening guide, until the player puts it away. */
  private guideOpen = !guideDismissed();
  private guideBox: HTMLElement;
  /** What the player has opened and ordered, for the guide to read. */
  private readonly seen = new Set<string>();
  private sailMode = false;
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
    this.guideBox = el('div', { class: 'guide-box' });

    host.appendChild(
      el('div', { class: 'campaign-screen' },
        this.topBar,
        el('div', { class: 'campaign-body' },
          el('div', { class: 'map-holder' }, this.canvas, this.guideBox, this.logBox),
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
      selectedZone: undefined,
      hoveredZone: undefined,
      reachableZones: new Set(),
      alwaysLabel: false,
      showRoutes: false,
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

  /**
   * Opens a given panel. Used by the development URL parameters to bring up a
   * known screen without a sequence of clicks.
   */
  openTab(tab: string): void {
    const known: readonly PanelTab[] = [
      'province', 'build', 'recruit', 'shipyard', 'trade', 'diplomacy', 'agents', 'realm',
    ];
    if ((known as readonly string[]).includes(tab)) {
      this.tab = tab as PanelTab;
      this.seen.add(`tab:${tab}`);
      this.renderPanel();
    }
  }

  /** Plays a number of turns without the player, for development and testing. */
  fastForward(turns: number): void {
    for (let i = 0; i < turns; i++) endTurn(this.state);
    this.selectProvince(this.view.selected);
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
      const hoveredZone = hovered ? undefined : zoneAt(this.view, x, y);
      if (hovered !== this.view.hovered || hoveredZone !== this.view.hoveredZone) {
        this.view.hovered = hovered;
        this.view.hoveredZone = hoveredZone;
        this.canvas.style.cursor = hovered || hoveredZone ? 'pointer' : 'grab';
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
      } else if (event.key === 't' || event.key === 'T') {
        this.view.showRoutes = !this.view.showRoutes;
        this.draw();
      }
    });
  }

  private handleClick(event: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const id = provinceAt(this.view, this.state, x, y);

    if (id) {
      if (this.travelMode && this.selectedAgent && this.view.reachable.has(id)) {
        moveAgent(this.state, this.selectedAgent, id);
        const agent = this.state.agents.get(this.selectedAgent);
        this.view.reachable = new Set(
          agent ? agentDestinations(this.state, this.selectedAgent) : [],
        );
        this.travelMode = Boolean(agent && agent.movement > 0);
        this.selectProvince(id);
        this.tab = 'agents';
        this.renderAll();
        return;
      }
      if (this.moveMode && this.selectedArmy && this.view.reachable.has(id)) {
        this.orderMove(this.selectedArmy, id);
        return;
      }
      if (this.sailMode && this.selectedFleet && this.view.reachable.has(id)) {
        this.orderSail(this.selectedFleet, { kind: 'port', region: id });
        return;
      }
      this.selectProvince(id);
      this.renderAll();
      return;
    }

    const zone = zoneAt(this.view, x, y);
    if (!zone) return;
    if (this.sailMode && this.selectedFleet && this.view.reachableZones.has(zone)) {
      this.orderSail(this.selectedFleet, { kind: 'sea', zone });
      return;
    }
    this.selectZone(zone);
    this.renderAll();
  }

  /** Selects a water, which shows the fleets standing in it. */
  private selectZone(id: SeaZoneId | undefined): void {
    this.view.selectedZone = id;
    this.view.selected = undefined;
    this.clearMovementHighlights();
    this.selectedArmy = undefined;
    this.selectedFleet = id
      ? fleetsInZone(this.state, id, this.state.player)[0]?.id
      : undefined;
    if (this.tab !== 'diplomacy' && this.tab !== 'realm' && this.tab !== 'agents') {
      this.tab = 'province';
    }
  }

  private clearMovementHighlights(): void {
    this.moveMode = false;
    this.sailMode = false;
    this.travelMode = false;
    this.view.reachable.clear();
    this.view.reachableZones.clear();
  }

  private selectProvince(id: RegionId | undefined): void {
    if (id) this.seen.add('province');
    this.view.selected = id;
    this.view.selectedZone = undefined;
    this.clearMovementHighlights();
    this.selectedArmy = undefined;
    this.selectedFleet = undefined;
    if (id) {
      const ourFleet = [...this.state.fleets.values()].find(
        (fleet) =>
          fleet.location.kind === 'port' &&
          fleet.location.region === id &&
          fleet.faction === this.state.player,
      );
      this.selectedFleet = ourFleet?.id;
    }
    if (id) {
      // Selecting a province also picks up our own army standing in it.
      const own = [...this.state.armies.values()].find(
        (army) => army.location === id && army.faction === this.state.player,
      );
      this.selectedArmy = own?.id;
    }
    if (this.tab === 'build' || this.tab === 'recruit' || this.tab === 'shipyard') {
      const region = id ? this.state.regions.get(id) : undefined;
      if (!region || region.owner !== this.state.player) this.tab = 'province';
      else if (this.tab === 'shipyard' && !getRegion(region.id).port) this.tab = 'province';
    }
  }

  /**
   * Development aid: put a few men in the player's service, so the agents
   * panel can be looked at without first playing to a chancery.
   */
  planted(kinds: readonly string[]): void {
    for (const kind of kinds) {
      const type = AGENT_TYPES.find((candidate) => candidate.kind === kind);
      if (!type) continue;
      const home = provincesOf(this.state, this.state.player).find((province) =>
        province.buildings.has(type.requires),
      );
      if (!home) continue;
      this.roll((rng) => recruitAgent(this.state, home.id, type.kind, rng));
    }
    this.selectedAgent = agentsOf(this.state, this.state.player)[0]?.id;
    this.tab = 'agents';
    this.renderAll();
  }

  /** Development aid: put the camera somewhere specific at a given zoom. */
  look(id: RegionId, zoom: number | undefined): void {
    this.focusOn(id);
    if (zoom !== undefined) this.view.camera.zoom = zoom;
    this.draw();
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
    this.renderGuide();
    this.renderLog();
    this.draw();
  }

  /**
   * The opening guide: what a ruler has to be able to do, in any order, each
   * marked off the moment the player does it rather than when he reads about
   * it. It puts itself away once everything on it is done.
   */
  private renderGuide(): void {
    clear(this.guideBox);
    if (!this.guideOpen) {
      this.guideBox.className = 'guide-box hidden';
      return;
    }
    const ctx = { state: this.state, me: this.state.player, seen: this.seen };
    const progress = guideProgress(ctx);
    if (!progress.next) {
      // Nothing left to teach. Say so once and get out of the way.
      this.guideBox.className = 'guide-box';
      this.guideBox.appendChild(el('div', { class: 'guide-head' },
        el('strong', {}, 'You have the run of it'),
        el('button', {
          class: 'tiny',
          onClick: () => {
            this.guideOpen = false;
            dismissGuide();
            this.renderAll();
          },
        }, 'Close'),
      ));
      this.guideBox.appendChild(el('p', { class: 'guide-why' },
        'Every part of the game has been used at least once. The guide is off the screen ' +
        'from here; the Guide button brings it back.',
      ));
      return;
    }

    this.guideBox.className = 'guide-box';
    this.guideBox.appendChild(el('div', { class: 'guide-head' },
      el('strong', {}, `Guide · ${progress.done} of ${progress.total}`),
      el('button', {
        class: 'tiny',
        title: 'Put the guide away',
        onClick: () => {
          this.guideOpen = false;
          dismissGuide();
          this.renderAll();
        },
      }, 'Close'),
    ));

    for (const step of GUIDE_STEPS) {
      const done = step.done(ctx);
      const current = step.id === progress.next.id;
      const entry = el('div', { class: `guide-step${done ? ' done' : current ? ' current' : ''}` },
        el('span', { class: 'guide-mark' }, done ? '✓' : current ? '→' : '·'),
        el('span', { class: 'guide-title' }, step.title),
      );
      this.guideBox.appendChild(entry);
      if (!current || done) continue;
      this.guideBox.appendChild(el('p', { class: 'guide-why' }, step.why));
      this.guideBox.appendChild(el('p', { class: 'guide-where' }, step.where));
    }
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
        this.holyWarBadge(),
      ),
    );
    this.topBar.appendChild(
      el('div', { class: 'top-right' },
        el('span', { class: 'coin' }, count(treasury)),
        el('span', { class: finances.net >= 0 ? 'income good' : 'income bad' }, money(finances.net)),
        el('button', {
          class: 'small',
          title: 'Save to this browser',
          onClick: () => {
            const outcome = saveToBrowser(this.state);
            this.flash(outcome.ok ? 'The campaign is saved.' : outcome.reason);
          },
        }, 'Save'),
        el('button', {
          class: 'small',
          title: 'Download the campaign as a file',
          onClick: () => downloadSave(this.state),
        }, 'Export'),
        el('button', {
          class: 'small',
          title: this.guideOpen ? 'Put the guide away' : 'Show the opening guide',
          onClick: () => {
            this.guideOpen = !this.guideOpen;
            if (this.guideOpen) restoreGuide();
            else dismissGuide();
            this.renderAll();
          },
        }, 'Guide'),
        el('button', {
          class: 'primary',
          disabled: this.busy,
          onClick: () => void this.doEndTurn(),
        }, this.busy ? 'Resolving…' : 'End turn'),
      ),
    );
  }

  /** A word in the top bar while a holy war stands, and a way into it. */
  private holyWarBadge(): HTMLElement | false {
    const war = this.state.faith.holyWar;
    if (!war) return false;
    const ours = faithOf(this.state.player) === war.faith;
    const sworn = isSworn(this.state, this.state.player);
    const label =
      war.faith === 'christian'
        ? `Crusade: ${getRegion(war.target).settlement}`
        : `Jihad: ${getRegion(war.target).settlement}`;
    return el('button', {
      class: `holy-badge${sworn ? ' sworn' : ours ? ' calling' : ''}`,
      title: sworn
        ? 'We have taken the vow. Our soldiers cost less while it stands.'
        : ours
          ? 'Our faith is calling. Open the realm to answer it.'
          : 'A holy war is being preached, though not by our faith.',
      onClick: () => {
        this.selectProvince(war.target);
        this.focusOn(war.target);
        this.tab = 'realm';
        this.renderAll();
      },
    }, label);
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

    if (this.view.selectedZone) {
      this.renderZonePanel(this.view.selectedZone);
      return;
    }

    const id = this.view.selected;
    if (!id) {
      this.panel.appendChild(el('div', { class: 'panel-empty' }, 'Select a province or a sea.'));
      this.panel.appendChild(this.tabBar(false, false));
      return;
    }
    const region = regionState(this.state, id);
    const mine = region.owner === this.state.player;

    this.panel.appendChild(this.panelHeader(region));
    this.panel.appendChild(this.tabBar(mine, mine && getRegion(region.id).port));

    const body = el('div', { class: 'panel-body' });
    switch (this.tab) {
      case 'build':
        this.renderBuildTab(body, region);
        break;
      case 'recruit':
        this.renderRecruitTab(body, region);
        break;
      case 'shipyard':
        this.renderShipyardTab(body, region);
        break;
      case 'trade':
        this.renderTradeTab(body, region);
        break;
      case 'diplomacy':
        this.renderDiplomacyTab(body);
        break;
      case 'agents':
        this.renderAgentsTab(body, region);
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

  private tabBar(mine: boolean, harbour: boolean): HTMLElement {
    const make = (tab: PanelTab, label: string, enabled = true): HTMLElement =>
      el('button', {
        class: `tab${this.tab === tab ? ' active' : ''}`,
        disabled: !enabled,
        onClick: () => {
          this.tab = tab;
          this.seen.add(`tab:${tab}`);
          this.renderAll();
        },
      }, label);
    return el('nav', { class: 'tab-bar' },
      make('province', 'Province'),
      make('build', 'Build', mine),
      make('recruit', 'Recruit', mine),
      make('shipyard', 'Ships', harbour),
      make('trade', 'Trade'),
      make('diplomacy', 'Diplomacy'),
      make('agents', 'Agents'),
      make('realm', 'Realm'),
    );
  }

  // --- the water

  private renderZonePanel(id: SeaZoneId): void {
    const zone = getSeaZone(id);
    const fleets = fleetsInZone(this.state, id);
    this.panel.appendChild(
      el('div', { class: 'panel-header' },
        el('h2', {}, zone.name),
        el('p', { class: 'panel-sub' },
          zone.river ? 'River system' : 'Open sea',
          ` · ${zone.ports.length} harbours`,
        ),
      ),
    );
    this.panel.appendChild(this.tabBar(false, false));

    const body = el('div', { class: 'panel-body' });
    if (fleets.length === 0) {
      body.appendChild(el('p', { class: 'muted' }, 'No fleet is standing in this water.'));
    }
    for (const fleet of fleets) this.renderFleet(body, fleet);

    body.appendChild(el('h3', {}, 'Harbours on this water'));
    for (const port of zone.ports) {
      const province = this.state.regions.get(port);
      if (!province) continue;
      const closed = blockaderOf(this.state, port);
      body.appendChild(el('div', {
        class: 'realm-row',
        onClick: () => {
          this.selectProvince(port);
          this.focusOn(port);
          this.renderAll();
        },
      },
        swatch(tryGetFaction(province.owner)?.colour ?? '#8d8578'),
        el('span', { class: 'realm-name' }, getRegion(port).settlement),
        el('span', { class: 'muted' }, factionName(province.owner)),
        closed && el('span', { class: 'bad', title: `Blockaded by ${factionName(closed)}` }, 'blockaded'),
      ));
    }
    this.panel.appendChild(body);
  }

  /** One fleet, with its hulls, its cargo and its orders. */
  private renderFleet(body: HTMLElement, fleet: Fleet): void {
    const mine = fleet.faction === this.state.player;
    const selected = this.selectedFleet === fleet.id;
    const header = el('div', { class: `army-header${selected ? ' selected' : ''}` },
      swatch(tryGetFaction(fleet.faction)?.colour ?? '#888'),
      el('span', {}, `${factionName(fleet.faction)} · ${fleet.ships.length} ships`),
      fleet.cargo.length > 0 && el('span', { class: 'muted' }, `${fleet.cargo.length} aboard`),
      mine && el('span', { class: 'muted' }, `sail ${fleet.movement.toFixed(1)}`),
    );
    if (mine) {
      header.addEventListener('click', () => {
        this.selectedFleet = fleet.id;
        this.clearMovementHighlights();
        this.renderAll();
      });
    }
    body.appendChild(header);

    if (!selected && mine) return;

    const hulls = el('section', { class: 'unit-list' });
    fleet.ships.forEach((ship, index) => {
      const type = getUnitType(ship.type);
      hulls.appendChild(el('div', { class: 'unit-row', title: type.description },
        el('span', { class: 'unit-name' }, type.name),
        el('span', { class: 'unit-strength' }, `${count(ship.soldiers)}/${type.soldiers}`),
        mine && fleet.location.kind === 'port' && el('button', {
          class: 'tiny',
          title: 'Break up this hull',
          onClick: () => {
            scrapShip(this.state, fleet.id, index);
            this.renderAll();
          },
        }, '×'),
      ));
    });
    body.appendChild(hulls);

    if (fleet.cargo.length > 0) {
      body.appendChild(el('h3', {}, `Aboard (${count(strengthOf(fleet.cargo))} men)`));
      const cargo = el('section', { class: 'unit-list' });
      for (const regiment of fleet.cargo) {
        const type = getUnitType(regiment.type);
        cargo.appendChild(el('div', { class: 'unit-row' },
          el('span', { class: 'unit-name' }, type.name),
          el('span', { class: 'unit-strength' }, count(regiment.soldiers)),
        ));
      }
      body.appendChild(cargo);
    }

    if (mine) body.appendChild(this.fleetControls(fleet));
  }

  private fleetControls(fleet: Fleet): HTMLElement {
    const controls = el('div', { class: 'army-controls' });
    const options = reachableWaters(this.state, fleet);

    controls.appendChild(el('button', {
      class: this.sailMode ? 'small active' : 'small',
      disabled: fleet.movement <= 0 || (options.zones.length === 0 && options.ports.length === 0),
      onClick: () => {
        this.sailMode = !this.sailMode;
        this.view.reachableZones = this.sailMode ? new Set(options.zones) : new Set();
        this.view.reachable = this.sailMode ? new Set(options.ports) : new Set();
        this.renderAll();
      },
    }, this.sailMode ? 'Choose a water…' : 'Sail'));

    // Taking an army aboard, when both are in the same harbour.
    if (fleet.location.kind === 'port') {
      const home = fleet.location.region;
      const army = [...this.state.armies.values()].find(
        (candidate) => candidate.faction === fleet.faction && candidate.location === home,
      );
      const room = fleetCapacity(fleet) - fleet.cargo.length;
      if (army && room > 0) {
        const take = Math.min(room, army.regiments.length);
        controls.appendChild(el('button', {
          class: 'small',
          title: `Take ${take} regiments aboard`,
          onClick: () => {
            const indices = Array.from({ length: take }, (_, index) => index);
            const result = embark(this.state, fleet.id, army.id, indices);
            if (!result.ok) this.flash(result.reason);
            this.renderAll();
          },
        }, `Embark ${take}`));
      }
    }

    // Putting them ashore: any harbour on this water we may land at.
    if (fleet.cargo.length > 0) {
      const shores =
        fleet.location.kind === 'port'
          ? [fleet.location.region]
          : getSeaZone(fleet.location.zone).ports.filter((port) => {
              const province = this.state.regions.get(port);
              if (!province) return false;
              return (
                province.owner === fleet.faction ||
                isAtWar(this.state, fleet.faction, province.owner)
              );
            });
      for (const shore of shores.slice(0, 4)) {
        controls.appendChild(el('button', {
          class: 'small',
          onClick: () => {
            const result = disembark(this.state, fleet.id, shore);
            if (!result.ok) this.flash(result.reason);
            else {
              this.selectProvince(shore);
              this.focusOn(shore);
            }
            this.renderAll();
          },
        }, `Land at ${getRegion(shore).settlement}`));
      }
    }

    const others = [...this.state.fleets.values()].filter(
      (other) =>
        other.id !== fleet.id &&
        other.faction === fleet.faction &&
        sameWater(other.location, fleet.location),
    );
    if (others.length > 0) {
      controls.appendChild(el('button', {
        class: 'small',
        onClick: () => {
          for (const other of others) mergeFleets(this.state, fleet.id, other.id);
          this.renderAll();
        },
      }, 'Combine fleets'));
    }

    return controls;
  }

  // --- trade

  private renderTradeTab(body: HTMLElement, region: RegionState): void {
    const mine = region.owner === this.state.player;
    const roads = activeRoutesThrough(this.state, region.id);

    const passing = caravansIn(this.state, region.id);
    if (passing.length > 0) {
      body.appendChild(el('h3', {}, 'Caravans here'));
      for (const caravan of passing) {
        const route = getTradeRoute(caravan.route);
        body.appendChild(row(
          `${factionName(caravan.faction)} · ${route.name}`,
          `${count(caravan.value)} florins`,
        ));
      }
    }

    if (roads.length === 0) {
      body.appendChild(el('p', { class: 'muted' },
        'No trade road passes through this province.',
      ));
      return;
    }

    body.appendChild(el('h3', {}, 'Roads through here'));
    body.appendChild(el('p', { class: 'muted' },
      'A caravan costs money now and pays more on arrival, less a toll to every ' +
        'lord whose land it crosses. Press T to see every road on the map.',
    ));

    const treasury = factionState(this.state, this.state.player).treasury;
    for (const route of roads) {
      const outlay = caravanOutlay(route);
      const expected = expectedReturn(this.state, this.state.player, route, region.id);
      const held = route.path.filter(
        (id) => this.state.regions.get(id)?.owner === this.state.player,
      ).length;
      const allowed = canDispatch(this.state, region.id, route.id);
      const ours = caravansOf(this.state, this.state.player).filter(
        (caravan) => caravan.route === route.id,
      ).length;

      body.appendChild(el('div', { class: 'offer' },
        el('div', { class: 'offer-main' },
          el('strong', {}, route.name),
          el('p', { class: 'offer-text' }, route.description),
          el('p', { class: 'offer-meta' },
            `${pretty(route.commodity)} · ${route.path.length} stages · ` +
              `we hold ${held} of them · ${ours} of ours on the road`,
          ),
          el('p', { class: 'offer-meta' },
            `outlay ${count(outlay)} · expected return ` +
              (expected > 0 ? count(expected) : 'nothing, the road is shut'),
          ),
        ),
        mine && el('button', {
          class: 'small',
          disabled: !allowed.ok || treasury < outlay,
          title: allowed.ok ? 'Load a caravan here' : allowed.reason,
          onClick: () => {
            const result = dispatchCaravan(this.state, region.id, route.id);
            if (!result.ok) this.flash(result.reason);
            this.renderAll();
          },
        }, 'Send caravan'),
      ));
    }
  }

  // --- shipyard

  private renderShipyardTab(body: HTMLElement, region: RegionState): void {
    if (!getRegion(region.id).port) {
      body.appendChild(el('p', { class: 'muted' }, 'This settlement has no harbour.'));
      return;
    }
    const blockader = blockaderOf(this.state, region.id);
    if (blockader) {
      body.appendChild(el('p', { class: 'warning' },
        `The harbour is blockaded by ${factionName(blockader)}. Nothing can be launched.`,
      ));
    }
    if (region.shipyardQueue.length > 0) {
      body.appendChild(el('h3', {}, 'On the slipway'));
      const list = el('section', {});
      region.shipyardQueue.forEach((entry, index) => {
        list.appendChild(row(
          `${index + 1}. ${getUnitType(entry.unit).name}`,
          `${entry.turnsLeft} turns`,
        ));
      });
      body.appendChild(list);
    }

    const waters = zonesOffPort(region.id);
    body.appendChild(el('p', { class: 'muted' },
      `Opens onto ${waters.map((zone) => getSeaZone(zone).name).join(', ')}.`,
    ));

    const treasury = factionState(this.state, this.state.player).treasury;
    const options = buildableShips(this.state, region.id);
    if (options.length === 0) {
      body.appendChild(el('p', { class: 'muted' },
        'No hull can be laid down here. Build a harbour, a shipyard or an arsenal first.',
      ));
      return;
    }
    for (const id of [...options].sort((a, b) => getUnitType(a).tier - getUnitType(b).tier)) {
      const type = getUnitType(id);
      const cost = shipCost(this.state.player, id);
      const affordable = treasury >= cost;
      body.appendChild(el('div', { class: 'offer' },
        el('div', { class: 'offer-main' },
          el('strong', {}, type.name),
          el('p', { class: 'offer-text' }, type.description),
          el('p', { class: 'offer-meta' },
            `${type.soldiers} crew · ${count(cost)} florins · ${type.upkeep}/turn · ` +
              `${shipBuildTurns(id)} turns · carries ${type.capacity ?? 0}`,
          ),
        ),
        el('button', {
          class: 'small',
          disabled: !affordable || region.shipyardQueue.length >= 2,
          onClick: () => {
            const result = startShipbuilding(this.state, region.id, id);
            if (result.ok) this.seen.add('recruit');
            if (!result.ok) this.flash(result.reason);
            this.renderAll();
          },
        }, affordable ? 'Lay down' : 'Too costly'),
      ));
    }
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
        el('span', { class: 'unit-name' },
          type.name,
          isMercenary(regiment) && el('span', { class: 'merc', title: 'A hired company' }, ' ƒ'),
        ),
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

    this.renderHireSection(body, region);
    this.renderPoachSection(body, region);
    this.renderArmySection(body, region);
    this.renderFleetSection(body, region);

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

  /**
   * Companies standing here in somebody else's pay whose pay has stopped.
   *
   * Only ever from a realm in arrears and only ever one we are at war with.
   * Buying one is an act of war carried out with money: it is an immediate
   * loss to the enemy and an immediate gain to us, and it is the one use for
   * a treasury that an enemy's bankruptcy creates.
   */
  private renderPoachSection(body: HTMLElement, region: RegionState): void {
    const me = this.state.player;
    const offers = poachable(this.state, me).filter((offer) => offer.where === region.id);
    if (offers.length === 0) return;
    const treasury = factionState(this.state, me).treasury;

    body.appendChild(el('h3', {}, 'Companies that can be bought'));
    body.appendChild(el('p', { class: 'muted' },
      'Their employer has not paid them. A company whose wages have stopped listens to ' +
      'other offers, and a paid one does not.',
    ));
    for (const offer of offers) {
      const type = getUnitType(offer.regiment.type);
      const allowed = canPoach(this.state, me, offer);
      body.appendChild(el('div', { class: 'offer' },
        el('div', { class: 'offer-main' },
          el('strong', {}, type.name),
          el('p', { class: 'offer-text' },
            `In the pay of ${factionName(offer.employer)}, ` +
            `who are ${this.state.factions.get(offer.employer)?.arrears ?? 0} seasons behind.`,
          ),
          el('p', { class: 'offer-meta' },
            `${count(offer.regiment.soldiers)} men · ${count(offer.cost)} florins · ` +
              `${mercenaryUpkeep(offer.regiment.type)}/turn to keep`,
          ),
          !allowed.ok && el('p', { class: 'offer-meta' }, allowed.reason),
        ),
        el('button', {
          class: 'small',
          disabled: !allowed.ok || treasury < offer.cost,
          title: allowed.ok ? 'Buy them out of his service' : allowed.reason,
          onClick: () => {
            const result = poachCompany(this.state, me, offer);
            if (!result.ok) this.flash(result.reason);
            this.renderAll();
          },
        }, 'Buy them'),
      ));
    }
  }

  /** Companies standing about here that we could take into service. */
  private renderHireSection(body: HTMLElement, region: RegionState): void {
    const offers = offersAt(this.state, region.id);
    if (offers.length === 0) return;
    const treasury = factionState(this.state, this.state.player).treasury;

    body.appendChild(el('h3', {}, 'Companies for hire'));
    body.appendChild(el('p', { class: 'muted' },
      'A hired company joins at once, with no muster to wait for, and costs ' +
        'nearly twice a levy to keep. They are the first to leave when the pay stops.',
    ));
    for (const offer of offers) {
      const type = getUnitType(offer.unit);
      const allowed = canHire(this.state, region.id, offer.pool.id, this.state.player);
      body.appendChild(el('div', { class: 'offer' },
        el('div', { class: 'offer-main' },
          el('strong', {}, offer.pool.name),
          el('p', { class: 'offer-text' }, offer.pool.description),
          el('p', { class: 'offer-meta' },
            `${type.name} · ${type.soldiers} men · ${offer.available} free · ` +
              `${count(offer.cost)} florins · ${offer.upkeep}/turn`,
          ),
        ),
        el('button', {
          class: 'small',
          disabled: !allowed.ok || treasury < offer.cost,
          title: allowed.ok ? 'Take this company into service' : allowed.reason,
          onClick: () => {
            const result = hireMercenary(
              this.state,
              region.id,
              offer.pool.id,
              this.state.player,
            );
            if (!result.ok) this.flash(result.reason);
            this.renderAll();
          },
        }, 'Hire'),
      ));
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
            el('span', { class: 'unit-name' },
              type.name,
              isMercenary(regiment) && el('span', { class: 'merc', title: 'A hired company' }, ' ƒ'),
            ),
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

  private renderFleetSection(body: HTMLElement, region: RegionState): void {
    const fleets = [...this.state.fleets.values()].filter(
      (fleet) => fleet.location.kind === 'port' && fleet.location.region === region.id,
    );
    const blockader = blockaderOf(this.state, region.id);
    if (fleets.length === 0 && !blockader) return;
    body.appendChild(el('h3', {}, 'In harbour'));
    if (blockader) {
      body.appendChild(el('p', { class: 'warning' },
        `Blockaded by ${factionName(blockader)}.`,
      ));
    }
    for (const fleet of fleets) this.renderFleet(body, fleet);
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
              this.seen.add('build');
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
            this.seen.add('recruit');
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
          this.marriageButton(faction.id),
        ),
      );
      body.appendChild(row);
    }
  }

  /**
   * A marriage offer, when both houses have somebody of an age.
   *
   * The cheapest instrument in the game: it costs nothing but a daughter and
   * buys a great deal of goodwill. The button says what the odds are, because
   * a refusal costs a little and the player should know what he is risking.
   */
  private marriageButton(other: FactionId): HTMLElement | false {
    const me = this.state.player;
    if (marriedTo(this.state, me, other)) {
      return el('span', { class: 'muted tiny', title: 'Our houses are already joined' }, 'married');
    }
    const allowed = canMarry(this.state, me, other);
    if (!allowed.ok) return false;
    const odds = Math.round(marriageOdds(this.state, me, other) * 100);
    return el('button', {
      class: 'tiny',
      title: `${odds}% that the offer is accepted. A refusal is remembered.`,
      onClick: () => {
        const outcome = this.roll((rng) => proposeMarriage(this.state, me, other, rng));
        if (!outcome.ok) this.flash(`${factionName(other)} declines the match.`);
        this.renderAll();
      },
    }, `Marry ${odds}%`);
  }

  // --- realm tab

  // --- agents

  /**
   * The establishment abroad.
   *
   * Everything about an agent is shown before he is committed: the odds on
   * every mission, the chance of losing him, and what it costs. A failed
   * mission should be a gamble the player took, never a surprise.
   */
  /**
   * Draws on the campaign's own generator and puts the advanced state back.
   *
   * A player's action that needs a die must use the same stream the turn loop
   * uses, or a save taken afterwards would no longer continue identically —
   * which is the one property the whole save model rests on.
   */
  private roll<T>(act: (rng: Rng) => T): T {
    const rng = rngFor(this.state);
    const result = act(rng);
    commitRng(this.state, rng);
    return result;
  }

  /**
   * The house: who rules, how securely, and who is left to inherit.
   *
   * A succession is the one event a player cannot do anything about after the
   * fact, so the panel shows what the realm would be left with beforehand:
   * the heir, the children growing up, and what a shaky title is costing.
   */
  private renderHouse(body: HTMLElement, me: FactionId): void {
    const faction = factionState(this.state, me);
    const ruler = leaderOf(this.state, me);
    body.appendChild(el('h3', {}, 'The house'));
    if (!ruler) {
      body.appendChild(el('p', { class: 'muted' }, 'The throne is vacant.'));
      return;
    }

    const minor = isMinor(this.state, me);
    body.appendChild(el('section', {},
      row('Ruler', `${ruler.name}${minor ? ' (a minor)' : ''}`),
      row('Aged', `${Math.floor(ruler.age)}`),
      row('Legitimacy', `${Math.round(faction.legitimacy)}/100`,
        'A realm that does not believe in its own ruler is harder to hold everywhere at once'),
      faction.legitimacy < 100 && row('Cost in order', `-${legitimacyUnrest(faction).toFixed(1)}`,
        'Subtracted from public order in every province of the realm'),
      row('Line', faction.rulers.length > 1 ? faction.rulers.join(', ') : faction.rulers[0] ?? '—'),
    ));

    const heir = heirApparent(this.state, me);
    body.appendChild(el('p', { class: 'offer-meta' },
      heir
        ? `If the ruler dies today, ${heir.name} succeeds${isAdult(heir) ? '' : ' as a child, under a regency'}.`
        : 'There is nobody of the house to succeed: the crown would go to whoever is strongest.',
    ));

    const court = [...faction.characters].sort((a, b) => b.age - a.age);
    for (const character of court) {
      const roles: string[] = [];
      if (character.leader) roles.push('rules');
      if (character.id === ruler.spouse) roles.push('consort');
      if (character.father === ruler.id) roles.push(character.sex === 'm' ? 'son' : 'daughter');
      if (character.bornIn) roles.push(`of ${factionName(character.bornIn)}`);
      const post =
        [...this.state.regions.values()].find((r) => r.governor?.id === character.id) ??
        undefined;
      const army = [...this.state.armies.values()].find((a) => a.general?.id === character.id);
      if (post) roles.push(`governs ${getRegion(post.id).settlement}`);
      if (army) roles.push('commands an army');
      if (!isAdult(character)) roles.push('a child');
      else if (!character.spouse) roles.push('unmarried');

      body.appendChild(el('div', {
        class: 'realm-row',
        title: `Command ${character.command} · administration ${character.governance} · guile ${character.guile}`,
      },
        el('span', { class: 'realm-name' }, `${character.name}${character.sex === 'f' ? ' ♀' : ''}`),
        el('span', { class: 'muted' }, `${Math.floor(character.age)}`),
        el('span', { class: 'muted' }, roles.join(' · ')),
      ));
    }
  }

  private renderAgentsTab(body: HTMLElement, region: RegionState): void {
    const me = this.state.player;
    const mine = agentsOf(this.state, me);

    body.appendChild(el('p', { class: 'muted' },
      'A spy, an envoy, a priest and a factor go where an army cannot, and nobody ' +
      'declares war over them. What they risk is themselves.',
    ));

    // Whoever is standing on the province in view, ours and anyone else's,
    // because the man you want to act on is nearly always one of those.
    const here = agentsAt(this.state, region.id);
    if (here.length > 0) {
      body.appendChild(el('h3', {}, `Standing in ${getRegion(region.id).settlement}`));
      for (const agent of here) this.renderAgentRow(body, agent, true);
    }

    const elsewhere = mine.filter((agent) => !here.some((other) => other.id === agent.id));
    body.appendChild(el('h3', {}, `Our people (${mine.length}/${MAX_AGENTS})`));
    if (mine.length === 0) {
      body.appendChild(el('p', { class: 'muted' }, 'Nobody abroad.'));
    } else if (elsewhere.length === 0) {
      body.appendChild(el('p', { class: 'muted' }, 'All of them are here.'));
    }
    for (const agent of elsewhere) this.renderAgentRow(body, agent, false);

    // Raising one is the thing you do least often, so it goes last.
    body.appendChild(el('h3', {}, `Raise in ${getRegion(region.id).settlement}`));
    if (region.owner !== me) {
      body.appendChild(el('p', { class: 'muted' }, 'Not our ground: no one can be raised here.'));
      return;
    }
    for (const type of AGENT_TYPES) {
      const allowed = canRecruitAgent(this.state, region.id, type.kind);
      body.appendChild(el('div', { class: 'offer' },
        el('div', { class: 'offer-main' },
          el('strong', {}, type.name),
          el('p', { class: 'offer-text' }, type.description),
          el('p', { class: 'offer-meta' },
            `${count(type.cost)} florins · ${type.upkeep}/turn · ` +
              `travels ${type.movement} provinces a season · ` +
              `from the ${getBuildingType(type.requires).name.toLowerCase()}`,
          ),
          !allowed.ok && el('p', { class: 'offer-meta' }, allowed.reason),
        ),
        el('button', {
          class: 'small',
          disabled: !allowed.ok,
          title: allowed.ok ? `Raise a ${type.name.toLowerCase()} here` : allowed.reason,
          onClick: () => {
            this.roll((rng) => recruitAgent(this.state, region.id, type.kind, rng));
            this.renderAll();
          },
        }, 'Raise'),
      ));
    }
  }

  private renderAgentRow(body: HTMLElement, agent: Agent, local: boolean): void {
    const mine = agent.faction === this.state.player;
    const selected = this.selectedAgent === agent.id;
    const type = getAgentType(agent.kind);
    const where = getRegion(agent.location).settlement;

    const header = el('div', { class: `army-header${selected ? ' selected' : ''}` },
      swatch(tryGetFaction(agent.faction)?.colour ?? '#888'),
      el('span', {}, `${agent.name} · ${type.name.toLowerCase()}`),
      el('span', { class: 'muted', title: 'Skill' }, '★'.repeat(Math.max(1, Math.round(agent.skill / 2)))),
      !local && el('span', { class: 'muted' }, where),
    );
    if (mine) {
      header.addEventListener('click', () => {
        this.selectedAgent = selected ? undefined : agent.id;
        this.travelMode = false;
        this.view.reachable.clear();
        // Looking at a man should not throw away the panel you are looking at.
        const tab = this.tab;
        this.selectProvince(agent.location);
        this.tab = tab;
        this.renderAll();
      });
    }
    body.appendChild(header);
    if (!mine || !selected) return;

    const region = regionState(this.state, agent.location);
    body.appendChild(el('p', { class: 'offer-meta' },
      `Skill ${agent.skill}/10 · ${agent.missions} missions · travel ${agent.movement}/${type.movement}` +
      (agent.kind === 'merchant' && merchantIncome(this.state, agent) > 0
        ? ` · sends home ${count(merchantIncome(this.state, agent))} ƒ a turn`
        : ''),
    ));
    body.appendChild(el('p', { class: 'offer-meta' },
      `${getRegion(region.id).settlement} is watched at ${guard(this.state, region).toFixed(1)}.`,
    ));

    const controls = el('div', { class: 'army-controls' });
    controls.appendChild(el('button', {
      class: this.travelMode ? 'small active' : 'small',
      disabled: agent.movement <= 0,
      onClick: () => {
        this.travelMode = !this.travelMode;
        this.view.reachable = this.travelMode
          ? new Set(agentDestinations(this.state, agent.id))
          : new Set();
        this.renderAll();
      },
    }, this.travelMode ? 'Choose a province…' : 'Travel'));
    controls.appendChild(el('button', {
      class: 'danger small',
      onClick: () => {
        dismissAgent(this.state, agent.id);
        this.selectedAgent = undefined;
        this.renderAll();
      },
    }, 'Dismiss'));
    body.appendChild(controls);

    const offers = missionsFor(this.state, agent.id);
    if (offers.length === 0) {
      body.appendChild(el('p', { class: 'muted' },
        agent.movement <= 0
          ? 'He has done his work for the season.'
          : 'There is nothing for him to do here.',
      ));
      return;
    }
    for (const offer of offers) this.renderMission(body, agent, offer);
  }

  private renderMission(body: HTMLElement, agent: Agent, offer: MissionOffer): void {
    const purse = factionState(this.state, this.state.player).treasury;
    body.appendChild(el('div', { class: 'offer' },
      el('div', { class: 'offer-main' },
        el('strong', {}, offer.name),
        el('p', { class: 'offer-text' }, offer.description),
        el('p', { class: 'offer-meta' },
          `${Math.round(offer.chance * 100)}% to succeed` +
            (offer.peril > 0
              ? ` · ${Math.round(offer.peril * 100)}% to lose him if it fails`
              : ' · no risk to him') +
            (offer.cost > 0 ? ` · ${count(offer.cost)} florins` : ''),
        ),
      ),
      el('button', {
        class: 'small',
        disabled: offer.cost > purse,
        title: offer.cost > purse ? 'Not enough money for it' : 'Send him',
        onClick: () => {
          this.roll((rng) => attemptMission(this.state, agent.id, offer.kind, rng));
          this.renderAll();
        },
      }, 'Send him'),
    ));
  }

  private renderRealmTab(body: HTMLElement): void {
    const me = this.state.player;
    const finances = factionFinances(this.state, me);
    const faction = factionState(this.state, me);
    body.appendChild(el('section', {},
      row('Treasury', count(faction.treasury)),
      row('Provincial net', money(finances.provinceNet)),
      row('Army upkeep', `-${count(finances.armyUpkeep)}`),
      row('Garrison upkeep', `-${count(finances.garrisonUpkeep)}`),
      row('Administration', `-${count(finances.administration)}`),
      finances.hoarding > 0 && row('Hoarding', `-${count(finances.hoarding)}`,
        'Idle treasure lost to display, officials and debasement'),
      finances.agents !== 0 && row('Agents', money(-finances.agents),
        'What the establishment abroad costs, less what the factors send home'),
      finances.stipend > 0 && row('Stipend', money(finances.stipend)),
      mercenaryCompanies(this.state, me) > 0 &&
        row('Hired companies', String(mercenaryCompanies(this.state, me))),
      row('Balance', money(finances.net), 'emphasis'),
    ));

    this.renderHouse(body, me);

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

    this.renderFaithSection(body, me);

    const navy = fleetsOf(this.state, me);
    if (navy.length > 0) {
      body.appendChild(el('h3', {}, 'Fleets'));
      for (const fleet of navy) {
        const where =
          fleet.location.kind === 'port'
            ? getRegion(fleet.location.region).settlement
            : getSeaZone(fleet.location.zone).name;
        body.appendChild(el('div', {
          class: 'realm-row',
          onClick: () => {
            if (fleet.location.kind === 'port') {
              this.selectProvince(fleet.location.region);
              this.focusOn(fleet.location.region);
            } else {
              this.selectZone(fleet.location.zone);
            }
            this.selectedFleet = fleet.id;
            this.renderAll();
          },
        },
          el('span', { class: 'realm-name' }, where),
          el('span', { class: 'muted' }, `${fleet.ships.length} ships`),
          fleet.cargo.length > 0 && el('span', { class: 'muted' }, `${fleet.cargo.length} aboard`),
        ));
      }
    }

    const caravans = caravansOf(this.state, me);
    if (caravans.length > 0) {
      body.appendChild(el('h3', {}, 'Caravans on the road'));
      for (const caravan of caravans) {
        const route = getTradeRoute(caravan.route);
        const where = caravanLocation(caravan);
        body.appendChild(el('div', {
          class: 'realm-row',
          onClick: () => {
            if (!where) return;
            this.selectProvince(where);
            this.focusOn(where);
            this.tab = 'trade';
            this.renderAll();
          },
        },
          el('span', { class: 'realm-name' }, route.name),
          el('span', { class: 'muted' }, where ? getRegion(where).settlement : '—'),
          el('span', { class: 'good' }, count(caravan.value)),
          caravan.stalled > 0 && el('span', { class: 'bad' }, 'held up'),
        ));
      }
    }

  }

  /** Standing with the authority of our faith, and what to do about it. */
  private renderFaithSection(body: HTMLElement, me: FactionId): void {
    const faith = faithOf(me);
    const war = this.state.faith.holyWar;

    if (!faith) {
      if (war) {
        body.appendChild(el('h3', {}, 'The faith'));
        body.appendChild(el('p', { class: 'muted' },
          `${factionName(war.caller)} preaches ${war.faith === 'christian' ? 'a crusade' : 'a jihad'} ` +
            `for ${getRegion(war.target).settlement}. It is not our communion that calls.`,
        ));
      }
      return;
    }

    const authority = authorityFor(this.state, faith);
    const standing = Math.round(standingOf(this.state, me));
    const censured = isCensured(this.state, me);

    body.appendChild(el('h3', {}, 'The faith'));
    body.appendChild(el('section', {},
      row('Authority', authority ? factionName(authority) : 'The see is empty'),
      row('Standing', el('span', {},
        bar((standing + 100) / 200, standing < -20 ? '#e2574c' : standing > 20 ? '#7fb069' : '#e5a33a'),
        ` ${standing}`,
      )),
    ));

    if (censured) {
      const price = absolutionPrice(this.state, me);
      const treasury = factionState(this.state, me).treasury;
      body.appendChild(el('p', { class: 'warning' },
        faith === 'christian'
          ? 'We are excommunicated. The churches are shut, our alliances are dissolved, and ' +
            'every Catholic prince may make war on us without pretext.'
          : 'We are declared a rebel against the faith. Our oaths are void and every Muslim ' +
            'ruler may make war on us without pretext.',
      ));
      body.appendChild(el('div', { class: 'army-controls' },
        el('button', {
          class: 'small',
          disabled: treasury < price,
          title: `Pay ${count(price)} florins for absolution`,
          onClick: () => {
            const result = seekAbsolution(this.state, me);
            if (!result.ok) this.flash(result.reason);
            this.renderAll();
          },
        }, `Seek absolution (${count(price)})`),
      ));
      return;
    }

    if (authority && authority !== me) {
      const gift = Math.min(2000, Math.max(250, Math.floor(factionState(this.state, me).treasury / 6)));
      body.appendChild(el('div', { class: 'army-controls' },
        el('button', {
          class: 'small',
          disabled: factionState(this.state, me).treasury < gift,
          title: 'A gift buys goodwill, though never the office itself',
          onClick: () => {
            const result = donate(this.state, me, gift);
            if (!result.ok) this.flash(result.reason);
            this.renderAll();
          },
        }, `Give ${count(gift)} to the church`),
      ));
    }

    if (!war) return;
    body.appendChild(el('h3', {},
      war.faith === 'christian' ? 'The crusade' : 'The jihad',
    ));
    const holder = holyWarHolder(this.state);
    body.appendChild(el('p', { class: 'offer-text' },
      `${factionName(war.caller)} calls for ${getRegion(war.target).settlement}` +
        (holder ? `, held by ${factionName(holder)}` : '') +
        `. The call stands for ${Math.max(0, war.expires - this.state.turn)} more turns.`,
    ));
    if (war.participants.length > 0) {
      body.appendChild(el('p', { class: 'offer-meta' },
        `Sworn: ${war.participants.map((id) => factionName(id)).join(', ')}`,
      ));
    }

    if (isSworn(this.state, me)) {
      body.appendChild(el('p', { class: 'good' },
        `We have taken the ${war.faith === 'christian' ? 'cross' : 'oath'}. ` +
          'Our soldiers cost a quarter less while the vow stands.',
      ));
      return;
    }
    const allowed = canJoinHolyWar(this.state, me);
    body.appendChild(el('div', { class: 'army-controls' },
      el('button', {
        class: 'small',
        disabled: !allowed.ok,
        title: allowed.ok
          ? 'Taking the vow declares war on whoever holds the place'
          : allowed.reason,
        onClick: () => {
          const result = joinHolyWar(this.state, me);
          if (!result.ok) {
            this.flash(result.reason);
          } else if (holder && !isAtWar(this.state, me, holder)) {
            declareWar(this.state, me, holder);
          }
          this.renderAll();
        },
      }, war.faith === 'christian' ? 'Take the cross' : 'Take the oath'),
    ));
  }

  // -------------------------------------------------------------------------
  // Orders that can start a battle
  // -------------------------------------------------------------------------

  private orderMove(id: ArmyId, to: RegionId): void {
    const army = this.state.armies.get(id);
    if (!army) return;
    const result = moveArmy(this.state, id, to);
    this.seen.add('march');
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

  private orderSail(id: FleetId, target: FleetLocation): void {
    const fleet = this.state.fleets.get(id);
    if (!fleet) return;
    const result = moveFleet(this.state, id, target);
    this.clearMovementHighlights();

    switch (result.kind) {
      case 'moved':
        if (target.kind === 'sea') this.selectZone(target.zone);
        else this.selectProvince(target.region);
        this.selectedFleet = id;
        break;
      case 'blocked':
        this.flash(result.reason);
        break;
      case 'battle': {
        const enemies = result.fleets
          .map((other) => this.state.fleets.get(other))
          .filter((other): other is Fleet => other !== undefined);
        if (target.kind !== 'sea') return;
        const plan = planNavalBattle(this.state, target.zone, [fleet], enemies);
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

}

export type { UnitTypeId, BuildingId };
