/**
 * Application shell: faction selection, then the campaign, with battles
 * borrowing the screen and handing control back when they finish.
 */
import type { FactionId } from '../core/types';
import type { BattlePlan, CampaignState } from '../core/campaign';
import { newCampaign, planBattle, CAMPAIGN_START_YEAR } from '../core/campaign';
import { getUnitType } from '../core/data/units';
import { unitTypeId } from '../core/types';
import { FACTIONS, factionName } from '../core/data/factions';
import { CampaignScreen } from './campaignScreen';
import { BattleScreen } from './battleScreen';
import { renderFactionSelect } from './factionSelect';
import { browserSaveMeta, loadFromBrowser, uploadSave } from './persistence';
import { clear, count, el } from './dom';

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
    if (new URLSearchParams(window.location.search).get('demo') === 'battle') {
      this.openDemoBattle();
      return;
    }
    if (known && known.appearsIn <= CAMPAIGN_START_YEAR) {
      const seed = new URLSearchParams(window.location.search).get('seed') ?? 'regna-direct';
      this.state = newCampaign({ seed, player: known.id });
      this.openCampaign();
      return;
    }
    this.showFactionSelect();
  }

  private showFactionSelect(): void {
    const meta = browserSaveMeta();
    renderFactionSelect(this.host, CAMPAIGN_START_YEAR, (id) => this.startCampaign(id), {
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
      onImport: () => {
        void uploadSave()
          .then((loaded) => {
            this.state = loaded;
            this.openCampaign();
          })
          .catch(() => {
            // A cancelled file dialog or an unreadable file leaves the player
            // exactly where they were.
          });
      },
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
        el('h2', {}, plan.isAssault ? 'Storm the walls?' : 'Battle is offered'),
        el('p', {},
          `${factionName(plan.setup.attacker)} against ${factionName(plan.setup.defender)}` +
            ` at ${plan.region}.`,
        ),
        el('p', { class: 'muted' },
          `${count(sideStrength(plan, 'attacker'))} attacking against ` +
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
      this.showFactionSelect();
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
    const screen = new BattleScreen(this.host, plan, 'france', () => this.showFactionSelect());
    const params = new URLSearchParams(window.location.search);
    if (params.get('play') === '1') screen.start();
    if (params.get('resolve') === '1') screen.resolveNow();
  }

  private checkEnd(): void {
    const campaign = this.campaign;
    if (!campaign) return;
    if (campaign.isDefeated()) this.showEnd(false);
    else if (campaign.hasWon()) this.showEnd(true);
  }

  private showEnd(victory: boolean): void {
    const campaign = this.campaign;
    if (!campaign) return;
    const state = campaign.getState();
    const ranked = campaign.rivals().slice(0, 8);
    clear(this.host);
    this.host.appendChild(
      el('div', { class: 'end-screen' },
        el('h1', {}, victory ? 'The realm is supreme' : 'The realm has fallen'),
        el('p', {},
          `${factionName(state.player)}, in the year ${state.year}.`,
        ),
        el('h3', {}, 'The powers of the age'),
        el('ol', { class: 'ranking' },
          ...ranked.map((entry) =>
            el('li', {}, `${factionName(entry.faction)} — ${entry.provinces} provinces`),
          ),
        ),
        el('button', { class: 'primary', onClick: () => this.showFactionSelect() }, 'Play again'),
      ),
    );
  }
}

function sideStrength(plan: BattlePlan, side: 'attacker' | 'defender'): number {
  let total = 0;
  for (const unit of plan.setup.units) if (unit.side === side) total += unit.startingSoldiers;
  return total;
}

const root = document.getElementById('app');
if (root) new App(root);
