import { describe, it, expect } from 'vitest';
import { newCampaign } from '../src/core/campaign';
import {
  campaignFromJson,
  campaignToJson,
  endTurn,
  factionState,
  provincesOf,
  serialiseCampaign,
  deserialiseCampaign,
  strengthOf,
  SAVE_VERSION,
  type CampaignState,
} from '../src/core/campaign';
import { factionId } from '../src/core/types';

const CROATIA = factionId('croatia');

/** A fingerprint of everything the player can see. */
function digest(state: CampaignState): string {
  const regions = [...state.regions.values()]
    .map((region) =>
      [
        region.id,
        region.owner,
        region.tier,
        Math.round(region.population * 1000),
        Math.round(region.unrest),
        region.religion,
        [...region.buildings].sort().join(','),
        region.garrison.map((r) => `${r.type}:${r.soldiers}`).join(','),
        region.shipyardQueue.map((q) => `${q.unit}:${q.turnsLeft}`).join(','),
        region.siege ? `${region.siege.besieger}@${region.siege.turns}` : '-',
        region.governor?.id ?? '-',
      ].join('/'),
    )
    .join('|');
  const factions = [...state.factions.values()]
    .map((faction) =>
      [
        faction.id,
        Math.round(faction.treasury),
        faction.alive,
        faction.characters.map((c) => `${c.id}:${c.age}:${c.command}`).join(','),
        [...faction.relations.entries()]
          .map(([other, rel]) => `${other}=${rel.stance}:${Math.round(rel.attitude)}`)
          .sort()
          .join(','),
      ].join('/'),
    )
    .join('|');
  const armies = [...state.armies.values()]
    .map((army) =>
      [
        army.id,
        army.faction,
        army.location,
        army.general?.id ?? '-',
        army.regiments.map((r) => `${r.type}:${r.soldiers}`).join(','),
      ].join('/'),
    )
    .sort()
    .join('|');
  const fleets = [...state.fleets.values()]
    .map((fleet) =>
      [
        fleet.id,
        fleet.faction,
        fleet.location.kind === 'port' ? `port:${fleet.location.region}` : `sea:${fleet.location.zone}`,
        fleet.admiral?.id ?? '-',
        fleet.ships.map((ship) => `${ship.type}:${ship.soldiers}`).join(','),
        fleet.cargo.map((unit) => `${unit.type}:${unit.soldiers}`).join(','),
      ].join('/'),
    )
    .sort()
    .join('|');
  return [
    state.turn,
    state.year,
    state.season,
    JSON.stringify(state.rngState),
    regions,
    factions,
    armies,
    fleets,
  ].join('\n');
}

describe('saving a campaign', () => {
  it('round-trips a fresh campaign exactly', () => {
    const state = newCampaign({ seed: 'save-fresh', player: CROATIA });
    const restored = deserialiseCampaign(serialiseCampaign(state));
    expect(digest(restored)).toBe(digest(state));
  });

  it('round-trips a campaign in progress exactly', () => {
    const state = newCampaign({ seed: 'save-progress', player: CROATIA });
    for (let i = 0; i < 25; i++) endTurn(state);
    const restored = campaignFromJson(campaignToJson(state));
    expect(digest(restored)).toBe(digest(state));
  }, 30_000);

  it('continues identically after a save and load', () => {
    const original = newCampaign({ seed: 'save-continue', player: CROATIA });
    for (let i = 0; i < 20; i++) endTurn(original);

    const restored = campaignFromJson(campaignToJson(original));
    // Play both forward the same number of turns. If anything at all was lost
    // in the save, the two histories diverge.
    for (let i = 0; i < 15; i++) {
      endTurn(original);
      endTurn(restored);
    }
    expect(digest(restored)).toBe(digest(original));
  }, 60_000);

  it('carries fleets, their cargo and their station through a save', () => {
    const state = newCampaign({ seed: 'save-fleets', player: CROATIA });
    expect(state.fleets.size, 'nobody starts with a fleet').toBeGreaterThan(0);
    const restored = deserialiseCampaign(serialiseCampaign(state));
    expect(restored.fleets.size).toBe(state.fleets.size);
    for (const [id, fleet] of state.fleets) {
      const copy = restored.fleets.get(id)!;
      expect(copy, `fleet ${id} was lost`).toBeDefined();
      expect(copy.location).toEqual(fleet.location);
      expect(copy.ships.length).toBe(fleet.ships.length);
      expect(copy.cargo.length).toBe(fleet.cargo.length);
      expect(copy.faction).toBe(fleet.faction);
    }
  });

  it('keeps shared characters shared rather than copied', () => {
    const state = newCampaign({ seed: 'save-characters', player: CROATIA });
    const province = provincesOf(state, CROATIA)[0]!;
    expect(province.governor).toBeDefined();
    const restored = deserialiseCampaign(serialiseCampaign(state));
    const restoredProvince = [...restored.regions.values()].find(
      (region) => region.id === province.id,
    )!;
    const faction = factionState(restored, CROATIA);
    const governor = restoredProvince.governor;
    expect(governor).toBeDefined();
    // The province's governor must be the very same object the faction holds,
    // or ageing him in one place would not age him in the other.
    expect(faction.characters.includes(governor!)).toBe(true);
    const army = [...restored.armies.values()].find((candidate) => candidate.faction === CROATIA);
    if (army?.general) expect(faction.characters.includes(army.general)).toBe(true);
  });

  it('preserves buildings, queues and sieges', () => {
    const state = newCampaign({ seed: 'save-detail', player: CROATIA });
    for (let i = 0; i < 40; i++) endTurn(state);
    const before = [...state.regions.values()];
    const restored = deserialiseCampaign(serialiseCampaign(state));
    for (const region of before) {
      const copy = restored.regions.get(region.id)!;
      expect([...copy.buildings].sort()).toEqual([...region.buildings].sort());
      expect(copy.recruitQueue.length).toBe(region.recruitQueue.length);
      expect(copy.construction?.turnsLeft).toBe(region.construction?.turnsLeft);
      expect(copy.siege?.turns).toBe(region.siege?.turns);
      expect(strengthOf(copy.garrison)).toBe(strengthOf(region.garrison));
    }
  }, 45_000);

  it('refuses a save from another version', () => {
    const state = newCampaign({ seed: 'save-version' });
    const saved = { ...serialiseCampaign(state), version: SAVE_VERSION + 99 };
    expect(() => deserialiseCampaign(saved)).toThrow(/different version/);
  });

  it('refuses something that is not a save at all', () => {
    expect(() => campaignFromJson('{"hello":"world"}')).toThrow(/not a Regna save/);
    expect(() => campaignFromJson('null')).toThrow(/not a Regna save/);
  });

  it('produces a save of a reasonable size', () => {
    const state = newCampaign({ seed: 'save-size', player: CROATIA });
    for (let i = 0; i < 30; i++) endTurn(state);
    const text = campaignToJson(state);
    // Large enough to hold the whole map, small enough for local storage.
    expect(text.length).toBeGreaterThan(50_000);
    expect(text.length).toBeLessThan(4_000_000);
  }, 40_000);
});
