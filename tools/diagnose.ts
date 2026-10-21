/**
 * Two centuries of campaign, with somebody counting.
 *
 * The four worst faults this project has had were not found by reading the
 * code and were not found by a test. They were found by running the campaign
 * for two hundred turns and looking at the numbers that came out: a province
 * with a hundred and sixty-two million people in it, an AI that never formed
 * a field army and so fought two battles in a century, sieges that were
 * started and wandered away from, and everybody allied with everybody
 * because nothing capped goodwill. Every one of those is invisible in a unit
 * test, because each of them is a thing that is *true* at every single step
 * and absurd after two hundred of them.
 *
 * So this is the standing version of that. It plays the game with nobody at
 * the wheel, writes down what happened, and flags the numbers that cannot be
 * right. It is not a test and it does not assert: a diagnostic that fails
 * the build is a diagnostic people stop running.
 *
 *     npm run diagnose            # 200 turns, the usual seed
 *     npm run diagnose -- 400 b   # 400 turns, a different one
 */
import { newCampaign, endTurn } from '../src/core/campaign';
import { watchBattles } from '../src/core/campaign/resolve';
import type { CampaignState } from '../src/core/campaign';
import type { BattlePlan } from '../src/core/campaign';
import type { BattleResult } from '../src/core/battle/types';
import { INDEPENDENT_ID, factionName } from '../src/core/data/factions';
import { REGIONS } from '../src/core/data/regions';
import type { FactionId, RegionId } from '../src/core/types';

const turns = Number.parseInt(process.argv[2] ?? '', 10) || 200;
const seed = process.argv[3] ?? 'diagnose';

interface Battle {
  readonly turn: number;
  readonly weather: string;
  readonly hour: string;
  readonly ended: string;
  readonly outcome: string;
  readonly naval: boolean;
  readonly assault: boolean;
  readonly losses: number;
  readonly duration: number;
}

const battles: Battle[] = [];
const state = newCampaign({ seed });
let turn = 0;

watchBattles((plan: BattlePlan, result: BattleResult) => {
  battles.push({
    turn,
    weather: plan.setup.weather,
    hour: plan.setup.timeOfDay,
    ended: result.ended,
    outcome: result.outcome,
    naval: plan.naval,
    assault: plan.isAssault,
    losses: result.attackerLosses + result.defenderLosses,
    duration: result.duration,
  });
});

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const owners = new Map<RegionId, FactionId>();
for (const region of state.regions.values()) owners.set(region.id, region.owner);

let flips = 0;
let peakPopulation = 0;
let peakTreasury = 0;
let peakArmies = 0;
const started = Date.now();

for (turn = 1; turn <= turns; turn++) {
  endTurn(state);
  for (const region of state.regions.values()) {
    if (owners.get(region.id) !== region.owner) {
      flips += 1;
      owners.set(region.id, region.owner);
    }
    peakPopulation = Math.max(peakPopulation, region.population);
  }
  for (const faction of state.factions.values()) {
    if (faction.id !== INDEPENDENT_ID) peakTreasury = Math.max(peakTreasury, faction.treasury);
  }
  peakArmies = Math.max(peakArmies, state.armies.size);
}
const seconds = (Date.now() - started) / 1000;

// ---------------------------------------------------------------------------
// What came out
// ---------------------------------------------------------------------------

const warnings: string[] = [];
const note = (condition: boolean, text: string): void => {
  if (condition) warnings.push(text);
};

function tally<T>(items: readonly T[], of: (item: T) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(of(item), (counts.get(of(item)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

function show(title: string, rows: [string, number | string][]): void {
  console.log(`\n${title}`);
  const width = Math.max(...rows.map(([label]) => label.length), 1);
  for (const [label, value] of rows) {
    console.log(`  ${label.padEnd(width)}  ${value}`);
  }
}

const alive = [...state.factions.values()].filter((f) => f.alive && f.id !== INDEPENDENT_ID);
const held = new Map<FactionId, number>();
for (const region of state.regions.values()) {
  held.set(region.owner, (held.get(region.owner) ?? 0) + 1);
}
let soldiers = 0;
for (const army of state.armies.values()) {
  for (const regiment of army.regiments) soldiers += regiment.soldiers;
}
let garrison = 0;
let unrest = 0;
let sieges = 0;
for (const region of state.regions.values()) {
  for (const regiment of region.garrison) garrison += regiment.soldiers;
  unrest += region.unrest;
  if (region.siege) sieges += 1;
}
let wars = 0;
let allies = 0;
for (const faction of state.factions.values()) {
  for (const relation of faction.relations.values()) {
    if (relation.stance === 'war') wars += 1;
    if (relation.stance === 'alliance') allies += 1;
  }
}

console.log(`Regna — ${turns} turns on seed "${seed}", in ${seconds.toFixed(1)}s`);
console.log(`${state.year}, ${state.season}`);

show('The map', [
  ['provinces', REGIONS.length],
  ['changed hands', flips],
  ['held by nobody in particular', held.get(INDEPENDENT_ID) ?? 0],
  ['under siege right now', sieges],
  ['average unrest', (unrest / state.regions.size).toFixed(1)],
  ['largest province (thousands)', Math.round(peakPopulation)],
]);

show('The realms', [
  ['alive', alive.length],
  ['gone', [...state.factions.values()].filter((f) => f.destroyedOn !== undefined).length],
  ['at war (pairs)', wars / 2],
  ['allied (pairs)', allies / 2],
  ['richest treasury seen', Math.round(peakTreasury)],
  ['richest now', Math.round(Math.max(...alive.map((f) => f.treasury)))],
  ['median treasury now', Math.round(median(alive.map((f) => f.treasury)))],
]);

show('Under arms', [
  ['field armies', state.armies.size],
  ['most at any point', peakArmies],
  ['men in the field', Math.round(soldiers)],
  ['men in garrison', Math.round(garrison)],
  ['fleets', state.fleets.size],
  ['caravans', state.caravans.size],
  ['agents', state.agents.size],
  ['civil wars running', state.civilWars.size],
]);

show('Battles', [
  ['fought', battles.length],
  ['per turn', (battles.length / turns).toFixed(2)],
  ['assaults', battles.filter((b) => b.assault).length],
  ['at sea', battles.filter((b) => b.naval).length],
  ['men lost in them', Math.round(battles.reduce((sum, b) => sum + b.losses, 0))],
  ['average length (min)', (mean(battles.map((b) => b.duration)) / 60).toFixed(1)],
]);

if (battles.length > 0) {
  show('Fought under', tally(battles, (b) => b.weather));
  show('Fought at', tally(battles, (b) => b.hour));
  show('Ended by', tally(battles, (b) => b.ended));
  show('Won by', tally(battles, (b) => b.outcome));
}

show('The five largest realms', [
  ...[...held]
    .filter(([id]) => id !== INDEPENDENT_ID)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => [factionName(id), count] as [string, number]),
]);

// ---------------------------------------------------------------------------
// The numbers that cannot be right
// ---------------------------------------------------------------------------

note(peakPopulation > 3000, `a province reached ${Math.round(peakPopulation)} thousand people`);
note(peakTreasury > 200000, `a treasury reached ${Math.round(peakTreasury)} florins`);
note(battles.length < turns * 0.15, `only ${battles.length} battles in ${turns} turns`);
note(flips < turns * 0.2, `only ${flips} provinces changed hands`);
note(allies / 2 > alive.length * 2, `${allies / 2} alliances between ${alive.length} realms`);
note(wars === 0, 'nobody is at war with anybody');
note(state.armies.size === 0, 'there are no field armies left');
note(alive.length < 5, `only ${alive.length} realms are still alive`);
note(sieges > state.regions.size * 0.1, `${sieges} sieges are running at once`);
note(
  battles.filter((b) => b.ended === 'stalemate').length > battles.length * 0.4,
  'most battles are ending as stalemates rather than with somebody breaking',
);
note(
  battles.length > 20 && new Set(battles.map((b) => b.weather)).size < 3,
  'the weather hardly varies between battles',
);
note(
  battles.length > 20 && battles.every((b) => b.hour === 'day'),
  'every battle is fought in broad daylight',
);
// Two balance smells rather than faults. The AI picks the fights it thinks
// it can win, so attackers should come out ahead — but not by this much,
// and a world with four times as many alliances as wars is a world where
// goodwill is still too cheap.
const attackerWins = battles.filter((b) => b.outcome === 'attacker').length;
note(
  battles.length > 50 && attackerWins > battles.length * 0.7,
  `attackers win ${Math.round((attackerWins / battles.length) * 100)}% of battles`,
);
note(
  wars > 0 && allies > wars * 3,
  `${allies / 2} alliances against ${wars / 2} wars`,
);
for (const faction of alive) {
  note(faction.treasury < 0, `${factionName(faction.id)} is in debt (${Math.round(faction.treasury)})`);
  note(faction.capital === undefined, `${factionName(faction.id)} has no capital`);
}

console.log('');
if (warnings.length === 0) {
  console.log('Nothing looks wrong.');
} else {
  console.log(`${warnings.length} thing${warnings.length === 1 ? '' : 's'} worth a look:`);
  for (const warning of warnings) console.log(`  - ${warning}`);
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
