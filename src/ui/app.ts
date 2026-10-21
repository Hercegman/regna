/**
 * Application shell: faction selection, then the campaign, with battles
 * borrowing the screen and handing control back when they finish.
 */
import type { FactionId, RegionId } from '../core/types';
import type { BattlePlan, CampaignState } from '../core/campaign';
import type { Reckoning } from '../core/campaign';
import {
  endTurn,
  newCampaign,
  planBattle,
  planNavalBattle,
  reckon,
  CAMPAIGN_START_YEAR,
} from '../core/campaign';
import { getUnitType } from '../core/data/units';
import { getRegion } from '../core/data/regions';
import { getSeaZone } from '../core/data/seas';
import type { TimeOfDay, Weather } from '../core/battle/weather';
import { HOUR_NAME, WEATHER_NAME } from '../core/battle/weather';
import { unitTypeId } from '../core/types';
import { FACTIONS, factionName } from '../core/data/factions';
import { CampaignScreen } from './campaignScreen';
import { BattleScreen } from './battleScreen';
import { renderFactionSelect } from './factionSelect';
import { heraldry, renderBattleSetup, renderMainMenu, type BattleKind } from './menu';
import { browserSaveMeta, loadFromBrowser, uploadSave } from './persistence';
import { clear, count, el, row } from './dom';

export class App {
  private campaign: CampaignScreen | undefined;
  private state: CampaignState | undefined;

  constructor(private readonly host: HTMLElement) {
    // `?faction=croatia` skips selection and starts that campaign straight
    // away, which makes it possible to open a known game state directly.
    const requested = new URLSearchParams(window.location.search).get('faction');
    const known = requested
      ? FACTIONS.find((faction) => (faction.id as string) === requested)
      : undefined;
    // `?demo=battle` opens a sample field battle. It is a development aid for
    // looking at the battle screen without first fighting a campaign to one.
    const demo = new URLSearchParams(window.location.search).get('demo');
    if (demo === 'battle') {
      this.openDemoBattle();
      return;
    }
    if (demo === 'siege') {
      this.openDemoSiege();
      return;
    }
    if (demo === 'sea') {
      this.openDemoSeaBattle();
      return;
    }
    if (demo === 'end') {
      this.openDemoEnding();
      return;
    }
    // `?screen=roster` and `?screen=battles` open a page of the front of the
    // game directly, which is how the screenshots in the README are taken.
    const screen = new URLSearchParams(window.location.search).get('screen');
    if (screen === 'roster') {
      this.showFactionSelect();
      return;
    }
    if (screen === 'battles') {
      this.showBattleSetup();
      return;
    }
    if (known && known.appearsIn <= CAMPAIGN_START_YEAR) {
      const seed = new URLSearchParams(window.location.search).get('seed') ?? 'regna-direct';
      this.state = newCampaign({ seed, player: known.id });
      this.openCampaign();
      return;
    }
    this.showMenu();
  }

  /**
   * The front of the game.
   *
   * Everything that is not already under way starts here: a campaign, a
   * campaign in progress, a file, or one battle fought on its own.
   */
  private showMenu(): void {
    const meta = browserSaveMeta();
    renderMainMenu(this.host, {
      onCampaign: () => this.showFactionSelect(),
      ...(meta
        ? {
            onContinue: {
              label: `${factionName(meta.faction as FactionId)}, ${meta.year}`,
              act: () => {
                const loaded = loadFromBrowser();
                if (!loaded) return;
                this.state = loaded;
                this.openCampaign();
              },
            },
          }
        : {}),
      onImport: () => this.importSave(),
      onCustomBattle: (kind: BattleKind) => {
        if (kind === 'siege') this.openDemoSiege();
        else if (kind === 'sea') this.openDemoSeaBattle();
        else this.openDemoBattle();
      },
    });
  }

  private showBattleSetup(): void {
    renderBattleSetup(this.host, {
      onCampaign: () => this.showFactionSelect(),
      onImport: () => this.importSave(),
      onCustomBattle: (kind: BattleKind) => {
        if (kind === 'siege') this.openDemoSiege();
        else if (kind === 'sea') this.openDemoSeaBattle();
        else this.openDemoBattle();
      },
    });
  }

  private importSave(): void {
    void uploadSave()
      .then((loaded) => {
        this.state = loaded;
        this.openCampaign();
      })
      .catch(() => {
        // A cancelled file dialog or an unreadable file leaves the player
        // exactly where they were.
      });
  }

  private showFactionSelect(): void {
    const meta = browserSaveMeta();
    renderFactionSelect(this.host, CAMPAIGN_START_YEAR, (id) => this.startCampaign(id), {
      onBack: () => this.showMenu(),
      backdrop: () => heraldry(),
      ...(meta
        ? {
            resume: {
              label: `Continue ${factionName(meta.faction as FactionId)}, ${meta.year}`,
              onResume: () => {
                const loaded = loadFromBrowser();
                if (!loaded) return;
                this.state = loaded;
                this.openCampaign();
              },
            },
          }
        : {}),
      onImport: () => this.importSave(),
    });
  }

  private startCampaign(player: FactionId): void {
    const seed = `regna-${Date.now().toString(36)}`;
    this.state = newCampaign({ seed, player });
    this.openCampaign();
  }

  private openCampaign(): void {
    const state = this.state;
    if (!state) return;
    this.campaign = new CampaignScreen(this.host, state, {
      onBattle: (plan) => this.askAboutBattle(plan),
    });
    // Development aids: `?turns=40` plays forty turns before handing over, and
    // `?tab=realm` opens a given panel.
    const params = new URLSearchParams(window.location.search);
    const turns = Number.parseInt(params.get('turns') ?? '', 10);
    if (Number.isFinite(turns) && turns > 0) this.campaign.fastForward(Math.min(turns, 400));
    const tab = params.get('tab');
    if (tab) this.campaign.openTab(tab);
    const planted = params.get('agents');
    if (planted) this.campaign.planted(planted.split(','));
    const look = params.get('look');
    if (look) {
      const zoom = Number.parseFloat(params.get('zoom') ?? '');
      this.campaign.look(look as RegionId, Number.isFinite(zoom) ? zoom : undefined);
    }
    this.checkEnd();
  }

  /**
   * A battle the player is involved in is theirs to fight or to delegate. A
   * battle between two other powers never reaches here: the AI resolves it.
   */
  private askAboutBattle(plan: BattlePlan): void {
    const campaign = this.campaign;
    if (!campaign) return;
    const state = campaign.getState();
    const dialog = el('div', { class: 'modal' },
      el('div', { class: 'modal-card' },
        el('h2', {},
          plan.naval ? 'The fleets are in sight' : plan.isAssault ? 'Storm the walls?' : 'Battle is offered',
        ),
        el('p', {},
          `${factionName(plan.setup.attacker)} against ${factionName(plan.setup.defender)} ` +
            (plan.zone
              ? `in the ${getSeaZone(plan.zone).name}.`
              : plan.region
                ? `at ${getRegion(plan.region).settlement}.`
                : '.'),
        ),
        el('p', { class: 'muted' },
          plan.naval
            ? `${count(sideStrength(plan, 'attacker'))} crew against ` +
              `${count(sideStrength(plan, 'defender'))}.`
            : `${count(sideStrength(plan, 'attacker'))} attacking against ` +
              `${count(sideStrength(plan, 'defender'))} defending.`,
        ),
        el('div', { class: 'modal-actions' },
          el('button', {
            class: 'primary',
            onClick: () => {
              dialog.remove();
              this.openBattle(plan);
            },
          }, 'Take command'),
          el('button', {
            class: 'small',
            onClick: () => {
              dialog.remove();
              campaign.resolveAutomatically(plan);
              this.checkEnd();
            },
          }, 'Let the captains decide'),
        ),
      ),
    );
    this.host.appendChild(dialog);
    void state;
  }

  private openBattle(plan: BattlePlan): void {
    const campaign = this.campaign;
    if (!campaign) return;
    const state = campaign.getState();
    new BattleScreen(this.host, plan, state.player as string, (result) => {
      // Rebuild the campaign screen around the state the battle has changed.
      this.campaign = new CampaignScreen(this.host, state, {
        onBattle: (next) => this.askAboutBattle(next),
      });
      this.campaign.applyFoughtBattle(plan, result);
      this.checkEnd();
    });
  }

  /** A set-piece battle used to inspect the battle screen on its own. */
  private openDemoBattle(): void {
    const state = newCampaign({ seed: 'demo-battle', player: 'france' as FactionId });
    const attacker = [...state.armies.values()].find((army) => army.faction === ('france' as FactionId));
    const defender = [...state.armies.values()].find((army) => army.faction === ('hre' as FactionId));
    if (!attacker || !defender) {
      this.showMenu();
      return;
    }
    // Give both sides a proper order of battle rather than a starting escort.
    const stock = (army: typeof attacker, types: readonly string[]): void => {
      for (const id of types) {
        const type = getUnitType(unitTypeId(id));
        army.regiments.push({ type: type.id, soldiers: type.soldiers, experience: 2 });
      }
    };
    stock(attacker, [
      'feudal_knights', 'feudal_knights', 'armoured_sergeants', 'armoured_sergeants',
      'french_men_at_arms', 'crossbow_militia', 'crossbow_militia', 'levy_archers',
    ]);
    stock(defender, [
      'imperial_spearmen', 'imperial_spearmen', 'armoured_sergeants', 'halberdiers',
      'crossbow_militia', 'levy_archers', 'mailed_knights', 'mailed_knights',
    ]);
    defender.location = attacker.location;
    const plan = planBattle(state, attacker.location, [attacker], [defender]);
    this.state = state;
    const screen = new BattleScreen(this.host, demoWeather(plan), 'france', () => this.showMenu());
    applyBattleParams(screen);
  }

  /**
   * An assault on a walled town, which is the one battle with works on the
   * field and the one the garrison turns out for.
   */
  private openDemoSiege(): void {
    const state = newCampaign({ seed: 'demo-siege', player: 'hre' as FactionId });
    const besieger = [...state.armies.values()].find(
      (army) => army.faction === ('hre' as FactionId),
    );
    if (!besieger) {
      this.showMenu();
      return;
    }
    const target = [...state.regions.values()].find(
      (region) => region.owner !== besieger.faction && region.tier !== 'village',
    );
    if (!target) {
      this.showMenu();
      return;
    }
    for (const id of [
      'imperial_spearmen', 'imperial_spearmen', 'armoured_sergeants', 'halberdiers',
      'crossbow_militia', 'levy_archers', 'mailed_knights',
      // A siege train, because nobody stormed a walled town without one and
      // because this is the demo the engines are looked at in.
      'trebuchet', 'bombard',
    ]) {
      const type = getUnitType(unitTypeId(id));
      besieger.regiments.push({ type: type.id, soldiers: type.soldiers, experience: 2 });
    }
    besieger.location = target.id;
    const plan = planBattle(state, target.id, [besieger], [], { isAssault: true });
    this.state = state;
    const screen = new BattleScreen(this.host, demoWeather(plan), 'hre' as FactionId, () =>
      this.showFactionSelect(),
    );
    applyBattleParams(screen);
  }

  /** A set-piece sea fight, for looking at the naval battle on its own. */
  private openDemoSeaBattle(): void {
    const state = newCampaign({ seed: 'demo-sea', player: 'venice' as FactionId });
    const venetian = [...state.fleets.values()].find((f) => f.faction === ('venice' as FactionId));
    const genoese = [...state.fleets.values()].find((f) => f.faction === ('genoa' as FactionId));
    if (!venetian || !genoese) {
      this.showMenu();
      return;
    }
    const stock = (fleet: typeof venetian, types: readonly string[]): void => {
      for (const id of types) {
        const type = getUnitType(unitTypeId(id));
        fleet.ships.push({ type: type.id, soldiers: type.soldiers, experience: 1 });
      }
    };
    stock(venetian, ['war_galley', 'war_galley', 'war_galley', 'great_galley', 'hulk']);
    stock(genoese, ['war_galley', 'war_galley', 'great_galley', 'great_galley', 'nef']);
    const plan = planNavalBattle(state, 'adriatic_sea' as never, [venetian], [genoese]);
    this.state = state;
    const screen = new BattleScreen(this.host, demoWeather(plan), 'venice', () => this.showMenu());
    applyBattleParams(screen);
  }

  /**
   * The closing reckoning, for looking at it without playing four and a half
   * centuries to reach it. `?demo=end&faction=croatia` names the realm.
   */
  private openDemoEnding(): void {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get('faction');
    const chosen = FACTIONS.find((faction) => (faction.id as string) === wanted);
    const player = chosen && chosen.appearsIn <= CAMPAIGN_START_YEAR ? chosen.id : undefined;
    const state = newCampaign({ seed: 'demo-end', ...(player ? { player } : {}) });
    for (let turn = 0; turn < 60; turn++) endTurn(state);
    state.year = 1531;
    this.state = state;
    this.campaign = new CampaignScreen(this.host, state, {
      onBattle: (plan) => this.askAboutBattle(plan),
    });
    this.checkEnd();
  }

  private checkEnd(): void {
    const campaign = this.campaign;
    if (!campaign) return;
    const verdict = reckon(campaign.getState());
    if (verdict) this.showEnd(verdict);
  }

  private showEnd(verdict: Reckoning): void {
    const title =
      verdict.outcome === 'supremacy'
        ? 'The realm is supreme'
        : verdict.outcome === 'ruin'
          ? 'The realm has fallen'
          : 'The age closes';

    const opening =
      verdict.outcome === 'supremacy'
        ? `${factionName(verdict.faction)} holds more of the map than everyone else together, ` +
          `in the year ${verdict.year}.`
        : verdict.outcome === 'ruin'
          ? `${factionName(verdict.faction)} holds nothing and commands nobody. The year is ` +
            `${verdict.year}.`
          : `The year is ${verdict.year} and the Middle Ages are over. ` +
            `${factionName(verdict.faction)} ends them ` +
            (verdict.rank === 1
              ? 'the first power in the world.'
              : verdict.rank <= 3
                ? `the ${verdict.rank === 2 ? 'second' : 'third'} power in the world.`
                : `${verdict.rank}th among the powers.`);

    clear(this.host);
    this.host.appendChild(
      el('div', { class: 'end-screen' },
        el('h1', {}, title),
        el('p', {}, opening),
        verdict.outcome !== 'ruin' &&
          el('section', { class: 'reckoning' },
            row('Provinces', `${verdict.provinces} of ${verdict.totalProvinces}`),
            row('Share of the map', `${Math.round(verdict.share * 100)}%`),
            row('Under arms', count(verdict.soldiers)),
            verdict.hulls > 0 && row('Hulls afloat', String(verdict.hulls)),
            row('Treasury', count(verdict.treasury)),
          ),
        el('h3', {}, 'The powers of the age'),
        el('ol', { class: 'ranking' },
          ...verdict.powers.slice(0, 8).map((entry) =>
            el('li', { class: entry.faction === verdict.faction ? 'ours' : '' },
              `${factionName(entry.faction)} — ${entry.provinces} provinces`,
            ),
          ),
        ),
        // A realm outside the first eight still wants to see where it stands.
        verdict.rank > 8 &&
          el('p', { class: 'ranking ours' },
            `${verdict.rank}. ${factionName(verdict.faction)} — ${verdict.provinces} provinces`,
          ),
        el('button', { class: 'primary', onClick: () => this.showFactionSelect() }, 'Play again'),
      ),
    );
  }
}

/**
 * `?weather=snow&hour=dusk` on a demo battle.
 *
 * The campaign rolls both from the battle's own seed and nothing in the game
 * lets you choose them, which is correct and makes the five skies and four
 * hours awkward to look at. This overrides them for the demo battles only,
 * and an unknown name is ignored rather than trusted.
 */
function demoWeather(plan: BattlePlan): BattlePlan {
  const params = new URLSearchParams(window.location.search);
  const sky = params.get('weather');
  const hour = params.get('hour');
  const weather = sky && sky in WEATHER_NAME ? (sky as Weather) : undefined;
  const timeOfDay = hour && hour in HOUR_NAME ? (hour as TimeOfDay) : undefined;
  if (!weather && !timeOfDay) return plan;
  return {
    ...plan,
    setup: {
      ...plan.setup,
      ...(weather ? { weather } : {}),
      ...(timeOfDay ? { timeOfDay } : {}),
    },
  };
}

/**
 * Development parameters that open a battle at a chosen moment: `at=180`
 * advances three minutes before drawing, `play=1` starts the clock, and
 * `resolve=1` runs the whole thing at once.
 */
function applyBattleParams(screen: BattleScreen): void {
  const params = new URLSearchParams(window.location.search);
  const at = Number.parseInt(params.get('at') ?? '', 10);
  if (Number.isFinite(at) && at > 0) screen.advanceTo(Math.min(at, 2700));
  const zoom = Number.parseFloat(params.get('bzoom') ?? '');
  if (Number.isFinite(zoom) && zoom > 0) screen.setZoom(zoom);
  // `blook=714,850` puts the camera over a point of the field in metres,
  // which is how the siege train at the back of an army gets looked at
  // without a sequence of drags.
  const look = (params.get('blook') ?? '').split(',').map(Number);
  if (look.length === 2 && look.every((value) => Number.isFinite(value))) {
    screen.lookAt(look[0] as number, look[1] as number);
  }
  if (params.get('play') === '1') screen.start();
  if (params.get('resolve') === '1') screen.resolveNow();
}

function sideStrength(plan: BattlePlan, side: 'attacker' | 'defender'): number {
  let total = 0;
  for (const unit of plan.setup.units) if (unit.side === side) total += unit.startingSoldiers;
  return total;
}

const root = document.getElementById('app');
if (root) new App(root);
