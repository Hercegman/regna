import { describe, it, expect } from 'vitest';
import { FACTIONS, playableFactions, emergentFactions, startingFactions, getFaction } from '../src/core/data/factions';
import { UNIT_TYPES } from '../src/core/data/units';
import { fullRoster, rosterFor, rosterByRole, generalUnitFor, rosterClasses } from '../src/core/data/roster';

const START_YEAR = 1080;

describe('faction data', () => {
  it('has well beyond the 21 factions of the genre benchmark', () => {
    // The design target is Medieval II's 21 factions plus at least 15 more.
    expect(FACTIONS.length).toBeGreaterThanOrEqual(36);
  });

  it('has unique ids', () => {
    const ids = FACTIONS.map((faction) => faction.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique names', () => {
    const names = FACTIONS.map((faction) => faction.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every faction a non-empty name, adjective and description', () => {
    for (const faction of FACTIONS) {
      expect(faction.name.length).toBeGreaterThan(2);
      expect(faction.adjective.length).toBeGreaterThan(2);
      expect(faction.description.length).toBeGreaterThan(60);
    }
  });

  it('uses valid hex colours', () => {
    for (const faction of FACTIONS) {
      expect(faction.colour).toMatch(/^#[0-9a-f]{6}$/i);
      expect(faction.colourDark).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('keeps appearance years inside the medieval window and before any fade', () => {
    for (const faction of FACTIONS) {
      expect(faction.appearsIn).toBeGreaterThanOrEqual(1080);
      expect(faction.appearsIn).toBeLessThan(1530);
      if (faction.fadesIn !== undefined) {
        expect(faction.fadesIn).toBeGreaterThan(faction.appearsIn);
      }
    }
  });

  it('keeps trait modifiers inside sane bounds', () => {
    for (const faction of FACTIONS) {
      for (const [key, value] of Object.entries(faction.traits)) {
        expect(Number.isFinite(value)).toBe(true);
        if (key === 'stipend') {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(500);
        } else if (key === 'diplomacy' || key === 'order') {
          expect(Math.abs(value as number)).toBeLessThanOrEqual(25);
        } else {
          expect(Math.abs(value as number)).toBeLessThanOrEqual(0.6);
        }
      }
    }
  });

  it('splits into starting, playable and emergent sets consistently', () => {
    const starting = startingFactions(START_YEAR);
    const emergent = emergentFactions(START_YEAR);
    expect(starting.length + emergent.length).toBe(FACTIONS.length);
    expect(playableFactions(START_YEAR).length).toBeGreaterThanOrEqual(25);
    // emergent factions must come back in chronological order
    const years = emergent.map((faction) => faction.appearsIn);
    expect([...years].sort((a, b) => a - b)).toEqual(years);
  });

  it('resolves every faction by id', () => {
    for (const faction of FACTIONS) {
      expect(getFaction(faction.id).name).toBe(faction.name);
    }
    // @ts-expect-error deliberately passing an unknown id
    expect(() => getFaction('atlantis')).toThrow();
  });
});

describe('unit data', () => {
  it('has unique ids and names', () => {
    const ids = UNIT_TYPES.map((unit) => unit.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = UNIT_TYPES.map((unit) => unit.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps every stat inside its declared scale', () => {
    for (const unit of UNIT_TYPES) {
      expect(unit.soldiers).toBeGreaterThan(0);
      expect(unit.attack).toBeGreaterThan(0);
      expect(unit.attack).toBeLessThanOrEqual(20);
      expect(unit.defence).toBeGreaterThanOrEqual(0);
      expect(unit.defence).toBeLessThanOrEqual(20);
      expect(unit.armour).toBeGreaterThanOrEqual(0);
      expect(unit.armour).toBeLessThanOrEqual(10);
      expect(unit.shield).toBeGreaterThanOrEqual(0);
      expect(unit.shield).toBeLessThanOrEqual(8);
      expect(unit.morale).toBeGreaterThan(0);
      expect(unit.morale).toBeLessThanOrEqual(20);
      expect(unit.discipline).toBeGreaterThan(0);
      expect(unit.discipline).toBeLessThanOrEqual(20);
      expect(unit.speed).toBeGreaterThan(0);
      expect(unit.speed).toBeLessThan(8);
      expect(unit.cost).toBeGreaterThanOrEqual(0);
      expect(unit.upkeep).toBeGreaterThanOrEqual(0);
      expect(unit.description.length).toBeGreaterThan(40);
    }
  });

  it('gives missile units a range and ammunition, and melee units neither', () => {
    for (const unit of UNIT_TYPES) {
      const isMissileClass =
        unit.unitClass === 'archers' ||
        unit.unitClass === 'crossbowmen' ||
        unit.unitClass === 'javelinmen' ||
        unit.unitClass === 'gunpowder_infantry' ||
        unit.unitClass === 'horse_archers' ||
        unit.unitClass === 'siege_engine';
      if (isMissileClass) {
        expect(unit.range, unit.name).toBeGreaterThan(0);
        expect(unit.ammunition, unit.name).toBeGreaterThan(0);
        expect(unit.missileAttack, unit.name).toBeGreaterThan(0);
      }
      if (unit.range === 0) {
        expect(unit.ammunition, unit.name).toBe(0);
        expect(unit.missileAttack, unit.name).toBe(0);
      }
    }
  });

  it('prices higher tiers above lower tiers on average', () => {
    const byTier = new Map<number, number[]>();
    for (const unit of UNIT_TYPES) {
      if (unit.unitClass === 'general') continue;
      const list = byTier.get(unit.tier) ?? [];
      list.push(unit.cost);
      byTier.set(unit.tier, list);
    }
    const means = [...byTier.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([tier, costs]) => ({ tier, mean: costs.reduce((a, b) => a + b, 0) / costs.length }));
    for (let i = 1; i < means.length; i++) {
      expect(means[i]!.mean, `tier ${means[i]!.tier} vs ${means[i - 1]!.tier}`)
        .toBeGreaterThan(means[i - 1]!.mean);
    }
  });

  it('references only real factions in faction-unique units', () => {
    const ids = new Set(FACTIONS.map((faction) => faction.id));
    for (const unit of UNIT_TYPES) {
      for (const faction of unit.factions ?? []) {
        expect(ids.has(faction), `${unit.name} -> ${faction}`).toBe(true);
      }
    }
  });

  it('keeps unit era windows coherent', () => {
    for (const unit of UNIT_TYPES) {
      if (unit.fromYear !== undefined && unit.untilYear !== undefined) {
        expect(unit.untilYear).toBeGreaterThan(unit.fromYear);
      }
    }
  });
});

describe('roster resolution', () => {
  it('gives every faction a usable army at its own start year', () => {
    for (const faction of FACTIONS) {
      const roster = rosterFor(faction, faction.appearsIn);
      const roles = rosterByRole(roster);
      const ranged = roster.filter((unit) => unit.range > 0 && unit.unitClass !== 'siege_engine');
      expect(roster.length, `${faction.name} roster size`).toBeGreaterThanOrEqual(5);
      expect(roles.melee.length, `${faction.name} melee`).toBeGreaterThanOrEqual(1);
      expect(ranged.length, `${faction.name} ranged`).toBeGreaterThanOrEqual(1);
      expect(roles.cavalry.length, `${faction.name} cavalry`).toBeGreaterThanOrEqual(1);
    }
  });

  it('gives every faction siege capability, bar the documented exceptions', () => {
    // Pure nomad confederations conducted no siege warfare of their own: the
    // Cumans raided and extorted but never reduced a fortified city. That is a
    // deliberate weakness, not missing data, so it is listed here explicitly.
    const noSiegeByDesign = new Set(['cumans']);
    for (const faction of FACTIONS) {
      const roles = rosterByRole(rosterFor(faction, faction.appearsIn));
      if (noSiegeByDesign.has(faction.id)) {
        expect(roles.siege.length, `${faction.name} should have no siege`).toBe(0);
      } else {
        expect(roles.siege.length, `${faction.name} siege`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('gives every faction exactly one general bodyguard', () => {
    for (const faction of FACTIONS) {
      const generals = fullRoster(faction).filter((unit) => unit.unitClass === 'general');
      expect(generals.length, `${faction.name} generals`).toBe(1);
      expect(generalUnitFor(faction).unitClass).toBe('general');
    }
  });

  it('gives every faction a distinctive roster, not a shared one', () => {
    const signatures = new Map<string, string[]>();
    for (const faction of FACTIONS) {
      const signature = fullRoster(faction)
        .map((unit) => unit.id)
        .sort()
        .join('|');
      const owners = signatures.get(signature) ?? [];
      owners.push(faction.name);
      signatures.set(signature, owners);
    }
    // Some overlap is historical (Aragon and Castile share much), but the
    // roster must not collapse into a handful of identical army lists.
    expect(signatures.size).toBeGreaterThanOrEqual(Math.floor(FACTIONS.length * 0.6));
  });

  it('respects era gating', () => {
    const ottomans = getFaction(FACTIONS.find((f) => f.id === ('ottomans' as never))!.id);
    const early = rosterFor(ottomans, 1300).map((u) => u.name);
    const late = rosterFor(ottomans, 1450).map((u) => u.name);
    expect(early).not.toContain('Janissaries');
    expect(late).toContain('Janissaries');
  });

  it('keeps faction-unique units out of other factions', () => {
    const england = getFaction(FACTIONS.find((f) => f.id === ('england' as never))!.id);
    const france = getFaction(FACTIONS.find((f) => f.id === ('france' as never))!.id);
    expect(fullRoster(england).map((u) => u.id)).toContain('longbowmen');
    expect(fullRoster(france).map((u) => u.id)).not.toContain('longbowmen');
  });

  it('covers several unit classes per faction', () => {
    for (const faction of FACTIONS) {
      const classes = rosterClasses(rosterFor(faction, faction.appearsIn));
      expect(classes.size, `${faction.name} classes`).toBeGreaterThanOrEqual(4);
    }
  });
});
