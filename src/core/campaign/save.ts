/**
 * Saving and loading.
 *
 * The campaign state is a graph with Maps, Sets and shared character objects,
 * none of which survive `JSON.stringify` intact. This module converts it to a
 * flat, versioned document and back, preserving the one thing that matters most
 * for a deterministic simulation: the generator state. A campaign reloaded from
 * a save must continue exactly as it would have done had it never been saved,
 * and that property is asserted in the tests.
 */
import type {
  ArmyId,
  CaravanId,
  FleetId,
  BuildingId,
  CharacterId,
  DiplomaticStance,
  FactionId,
  RegionId,
  Religion,
  SettlementTier,
  UnitTypeId,
} from '../types';
import {
  armyId as toArmyId,
  fleetId as toFleetId,
  caravanId as toCaravanId,
  buildingId as toBuildingId,
  characterId as toCharacterId,
  factionId as toFactionId,
  regionId as toRegionId,
  unitTypeId as toUnitTypeId,
} from '../types';
import type {
  Army,
  CampaignState,
  Caravan,
  Fleet,
  Character,
  FactionState,
  LogEntry,
  Regiment,
  RegionState,
  Season,
} from './state';
import type { RngState } from '../rng';
import type { SeaZoneId } from '../data/seas';
import type { TradeRouteId } from '../data/trade';

/**
 * Bumped whenever the saved shape changes. Version 2 added fleets, the ships
 * building at a harbour, and the cargo a fleet is carrying. Version 3 added
 * the caravans on the trade roads, version 4 the mercenary pools and which
 * regiments are hired companies, and version 5 the standing of each ruler with
 * the authority of his faith, who is under censure, and the holy war being
 * preached.
 */
export const SAVE_VERSION = 5;

interface SavedRegiment {
  readonly t: string;
  readonly s: number;
  readonly e: number;
  /** Present and true only for a hired company. */
  readonly m?: boolean;
}

interface SavedCharacter {
  readonly id: string;
  readonly faction: string;
  readonly name: string;
  readonly command: number;
  readonly governance: number;
  readonly guile: number;
  readonly age: number;
  readonly leader: boolean;
}

interface SavedRegion {
  readonly id: string;
  readonly owner: string;
  readonly population: number;
  readonly tier: string;
  readonly buildings: readonly string[];
  readonly construction: { readonly building: string; readonly turnsLeft: number } | null;
  readonly recruitQueue: readonly { readonly unit: string; readonly turnsLeft: number }[];
  readonly shipyardQueue: readonly { readonly unit: string; readonly turnsLeft: number }[];
  readonly garrison: readonly SavedRegiment[];
  readonly unrest: number;
  readonly religion: string;
  readonly conversion: number;
  readonly siege: { readonly besieger: string; readonly turns: number } | null;
  readonly ownedSince: number;
  /** Governor stored by id; the object itself lives on the faction. */
  readonly governor: string | null;
}

interface SavedFaction {
  readonly id: string;
  readonly treasury: number;
  readonly alive: boolean;
  readonly relations: readonly [string, { stance: string; attitude: number; since: number }][];
  readonly capital: string | null;
  readonly characters: readonly SavedCharacter[];
  readonly joinedOn: number;
  readonly destroyedOn: number | null;
}

interface SavedFleet {
  readonly id: string;
  readonly faction: string;
  /** Either a harbour province or a sea zone; exactly one is set. */
  readonly port: string | null;
  readonly zone: string | null;
  readonly ships: readonly SavedRegiment[];
  readonly cargo: readonly SavedRegiment[];
  readonly admiral: string | null;
  readonly movement: number;
}

interface SavedCaravan {
  readonly id: string;
  readonly faction: string;
  readonly route: string;
  readonly position: number;
  readonly direction: number;
  readonly destination: number;
  readonly value: number;
  readonly stalled: number;
}

interface SavedArmy {
  readonly id: string;
  readonly faction: string;
  readonly location: string;
  readonly regiments: readonly SavedRegiment[];
  readonly general: string | null;
  readonly movement: number;
  readonly embarked: boolean;
}

export interface SavedCampaign {
  readonly version: number;
  readonly seed: string;
  readonly rngState: RngState;
  readonly turn: number;
  readonly year: number;
  readonly season: string;
  readonly player: string;
  readonly nextArmySerial: number;
  readonly nextFleetSerial: number;
  readonly nextCaravanSerial: number;
  readonly nextCharacterSerial: number;
  readonly factions: readonly SavedFaction[];
  readonly regions: readonly SavedRegion[];
  readonly armies: readonly SavedArmy[];
  readonly fleets: readonly SavedFleet[];
  readonly caravans: readonly SavedCaravan[];
  readonly mercenaries: readonly [string, { available: number; countdown: number }][];
  readonly faith: {
    readonly standing: readonly [string, number][];
    readonly censured: readonly [string, number][];
    readonly holyWar: {
      readonly faith: string;
      readonly caller: string;
      readonly target: string;
      readonly calledOn: number;
      readonly expires: number;
      readonly participants: readonly string[];
    } | null;
    readonly lastWarEnded: number;
  };
  readonly log: readonly {
    readonly turn: number;
    readonly year: number;
    readonly faction: string | null;
    readonly text: string;
  }[];
}

const saveRegiment = (regiment: Regiment): SavedRegiment => ({
  t: regiment.type as string,
  s: regiment.soldiers,
  e: regiment.experience,
  ...(regiment.mercenary ? { m: true } : {}),
});

const loadRegiment = (saved: SavedRegiment): Regiment => ({
  type: toUnitTypeId(saved.t) as UnitTypeId,
  soldiers: saved.s,
  experience: saved.e,
  ...(saved.m ? { mercenary: true } : {}),
});

const saveCharacter = (character: Character): SavedCharacter => ({
  id: character.id as string,
  faction: character.faction as string,
  name: character.name,
  command: character.command,
  governance: character.governance,
  guile: character.guile,
  age: character.age,
  leader: character.leader,
});

const loadCharacter = (saved: SavedCharacter): Character => ({
  id: toCharacterId(saved.id) as CharacterId,
  faction: toFactionId(saved.faction) as FactionId,
  name: saved.name,
  command: saved.command,
  governance: saved.governance,
  guile: saved.guile,
  age: saved.age,
  leader: saved.leader,
});

export function serialiseCampaign(state: CampaignState): SavedCampaign {
  return {
    version: SAVE_VERSION,
    seed: state.seed,
    rngState: { ...state.rngState },
    turn: state.turn,
    year: state.year,
    season: state.season,
    player: state.player as string,
    nextArmySerial: state.nextArmySerial,
    nextFleetSerial: state.nextFleetSerial,
    nextCaravanSerial: state.nextCaravanSerial,
    nextCharacterSerial: state.nextCharacterSerial,
    factions: [...state.factions.values()].map((faction) => ({
      id: faction.id as string,
      treasury: faction.treasury,
      alive: faction.alive,
      relations: [...faction.relations.entries()].map(([other, relation]) => [
        other as string,
        { stance: relation.stance as string, attitude: relation.attitude, since: relation.since },
      ]),
      capital: (faction.capital as string | undefined) ?? null,
      characters: faction.characters.map(saveCharacter),
      joinedOn: faction.joinedOn,
      destroyedOn: faction.destroyedOn ?? null,
    })),
    regions: [...state.regions.values()].map((region) => ({
      id: region.id as string,
      owner: region.owner as string,
      population: region.population,
      tier: region.tier,
      buildings: [...region.buildings].map((id) => id as string),
      construction: region.construction
        ? {
            building: region.construction.building as string,
            turnsLeft: region.construction.turnsLeft,
          }
        : null,
      recruitQueue: region.recruitQueue.map((entry) => ({
        unit: entry.unit as string,
        turnsLeft: entry.turnsLeft,
      })),
      shipyardQueue: region.shipyardQueue.map((entry) => ({
        unit: entry.unit as string,
        turnsLeft: entry.turnsLeft,
      })),
      garrison: region.garrison.map(saveRegiment),
      unrest: region.unrest,
      religion: region.religion,
      conversion: region.conversion,
      siege: region.siege
        ? { besieger: region.siege.besieger as string, turns: region.siege.turns }
        : null,
      ownedSince: region.ownedSince,
      governor: (region.governor?.id as string | undefined) ?? null,
    })),
    armies: [...state.armies.values()].map((army) => ({
      id: army.id as string,
      faction: army.faction as string,
      location: army.location as string,
      regiments: army.regiments.map(saveRegiment),
      general: (army.general?.id as string | undefined) ?? null,
      movement: army.movement,
      embarked: army.embarked,
    })),
    fleets: [...state.fleets.values()].map((fleet) => ({
      id: fleet.id as string,
      faction: fleet.faction as string,
      port: fleet.location.kind === 'port' ? (fleet.location.region as string) : null,
      zone: fleet.location.kind === 'sea' ? (fleet.location.zone as string) : null,
      ships: fleet.ships.map(saveRegiment),
      cargo: fleet.cargo.map(saveRegiment),
      admiral: (fleet.admiral?.id as string | undefined) ?? null,
      movement: fleet.movement,
    })),
    caravans: [...state.caravans.values()].map((caravan) => ({
      id: caravan.id as string,
      faction: caravan.faction as string,
      route: caravan.route as string,
      position: caravan.position,
      direction: caravan.direction,
      destination: caravan.destination,
      value: caravan.value,
      stalled: caravan.stalled,
    })),
    mercenaries: [...state.mercenaries.entries()].map(([id, pool]) => [id, { ...pool }]),
    faith: {
      standing: [...state.faith.standing.entries()].map(([id, value]) => [id as string, value]),
      censured: [...state.faith.censured.entries()].map(([id, turn]) => [id as string, turn]),
      holyWar: state.faith.holyWar
        ? {
            faith: state.faith.holyWar.faith,
            caller: state.faith.holyWar.caller as string,
            target: state.faith.holyWar.target as string,
            calledOn: state.faith.holyWar.calledOn,
            expires: state.faith.holyWar.expires,
            participants: state.faith.holyWar.participants.map((id) => id as string),
          }
        : null,
      lastWarEnded: state.faith.lastWarEnded,
    },
    log: state.log.map((entry) => ({
      turn: entry.turn,
      year: entry.year,
      faction: (entry.faction as string | undefined) ?? null,
      text: entry.text,
    })),
  };
}

export function deserialiseCampaign(saved: SavedCampaign): CampaignState {
  if (saved.version !== SAVE_VERSION) {
    throw new Error(
      `This save was written by a different version of the game (${saved.version}, expected ${SAVE_VERSION}).`,
    );
  }

  const factions = new Map<FactionId, FactionState>();
  // Characters are shared between a faction, a province and an army, so they
  // are rebuilt once here and then referenced by id everywhere else.
  const characters = new Map<string, Character>();

  for (const entry of saved.factions) {
    const own = entry.characters.map(loadCharacter);
    for (const character of own) characters.set(character.id as string, character);
    factions.set(toFactionId(entry.id) as FactionId, {
      id: toFactionId(entry.id) as FactionId,
      treasury: entry.treasury,
      alive: entry.alive,
      relations: new Map(
        entry.relations.map(([other, relation]) => [
          toFactionId(other) as FactionId,
          {
            stance: relation.stance as DiplomaticStance,
            attitude: relation.attitude,
            since: relation.since,
          },
        ]),
      ),
      capital: entry.capital ? (toRegionId(entry.capital) as RegionId) : undefined,
      characters: own,
      joinedOn: entry.joinedOn,
      destroyedOn: entry.destroyedOn ?? undefined,
    });
  }

  const regions = new Map<RegionId, RegionState>();
  for (const entry of saved.regions) {
    regions.set(toRegionId(entry.id) as RegionId, {
      id: toRegionId(entry.id) as RegionId,
      owner: toFactionId(entry.owner) as FactionId,
      population: entry.population,
      tier: entry.tier as SettlementTier,
      buildings: new Set(entry.buildings.map((id) => toBuildingId(id) as BuildingId)),
      construction: entry.construction
        ? {
            building: toBuildingId(entry.construction.building) as BuildingId,
            turnsLeft: entry.construction.turnsLeft,
          }
        : undefined,
      recruitQueue: entry.recruitQueue.map((queued) => ({
        unit: toUnitTypeId(queued.unit) as UnitTypeId,
        turnsLeft: queued.turnsLeft,
      })),
      shipyardQueue: (entry.shipyardQueue ?? []).map((queued) => ({
        unit: toUnitTypeId(queued.unit) as UnitTypeId,
        turnsLeft: queued.turnsLeft,
      })),
      garrison: entry.garrison.map(loadRegiment),
      unrest: entry.unrest,
      religion: entry.religion as Religion,
      conversion: entry.conversion,
      siege: entry.siege
        ? { besieger: toFactionId(entry.siege.besieger) as FactionId, turns: entry.siege.turns }
        : undefined,
      ownedSince: entry.ownedSince,
      governor: entry.governor ? characters.get(entry.governor) : undefined,
    });
  }

  const armies = new Map<ArmyId, Army>();
  for (const entry of saved.armies) {
    armies.set(toArmyId(entry.id) as ArmyId, {
      id: toArmyId(entry.id) as ArmyId,
      faction: toFactionId(entry.faction) as FactionId,
      location: toRegionId(entry.location) as RegionId,
      regiments: entry.regiments.map(loadRegiment),
      general: entry.general ? characters.get(entry.general) : undefined,
      movement: entry.movement,
      embarked: entry.embarked,
    });
  }

  const fleets = new Map<FleetId, Fleet>();
  for (const entry of saved.fleets ?? []) {
    const location: Fleet['location'] =
      entry.zone !== null
        ? { kind: 'sea', zone: entry.zone as SeaZoneId }
        : { kind: 'port', region: toRegionId(entry.port ?? '') as RegionId };
    fleets.set(toFleetId(entry.id) as FleetId, {
      id: toFleetId(entry.id) as FleetId,
      faction: toFactionId(entry.faction) as FactionId,
      location,
      ships: entry.ships.map(loadRegiment),
      cargo: entry.cargo.map(loadRegiment),
      admiral: entry.admiral ? characters.get(entry.admiral) : undefined,
      movement: entry.movement,
    });
  }

  const caravans = new Map<CaravanId, Caravan>();
  for (const entry of saved.caravans ?? []) {
    caravans.set(toCaravanId(entry.id) as CaravanId, {
      id: toCaravanId(entry.id) as CaravanId,
      faction: toFactionId(entry.faction) as FactionId,
      route: entry.route as TradeRouteId,
      position: entry.position,
      direction: entry.direction === -1 ? -1 : 1,
      destination: entry.destination,
      value: entry.value,
      stalled: entry.stalled,
    });
  }

  const mercenaries = new Map<string, { available: number; countdown: number }>(
    (saved.mercenaries ?? []).map(([id, pool]) => [id, { ...pool }]),
  );

  const savedFaith = saved.faith;
  const faith: CampaignState['faith'] = {
    standing: new Map(
      (savedFaith?.standing ?? []).map(([id, value]) => [toFactionId(id) as FactionId, value]),
    ),
    censured: new Map(
      (savedFaith?.censured ?? []).map(([id, turn]) => [toFactionId(id) as FactionId, turn]),
    ),
    holyWar: savedFaith?.holyWar
      ? {
          faith: savedFaith.holyWar.faith === 'muslim' ? 'muslim' : 'christian',
          caller: toFactionId(savedFaith.holyWar.caller) as FactionId,
          target: toRegionId(savedFaith.holyWar.target) as RegionId,
          calledOn: savedFaith.holyWar.calledOn,
          expires: savedFaith.holyWar.expires,
          participants: savedFaith.holyWar.participants.map(
            (id) => toFactionId(id) as FactionId,
          ),
        }
      : undefined,
    lastWarEnded: savedFaith?.lastWarEnded ?? -99,
  };

  const log: LogEntry[] = saved.log.map((entry) => ({
    turn: entry.turn,
    year: entry.year,
    faction: entry.faction ? (toFactionId(entry.faction) as FactionId) : undefined,
    text: entry.text,
  }));

  return {
    seed: saved.seed,
    rngState: { ...saved.rngState },
    turn: saved.turn,
    year: saved.year,
    season: saved.season as Season,
    factions,
    regions,
    armies,
    fleets,
    caravans,
    mercenaries,
    faith,
    nextArmySerial: saved.nextArmySerial,
    nextFleetSerial: saved.nextFleetSerial ?? 0,
    nextCaravanSerial: saved.nextCaravanSerial ?? 0,
    nextCharacterSerial: saved.nextCharacterSerial,
    player: toFactionId(saved.player) as FactionId,
    log,
  };
}

export function campaignToJson(state: CampaignState): string {
  return JSON.stringify(serialiseCampaign(state));
}

export function campaignFromJson(text: string): CampaignState {
  const parsed = JSON.parse(text) as SavedCampaign;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.version !== 'number') {
    throw new Error('That file is not a Regna save.');
  }
  return deserialiseCampaign(parsed);
}
