/**
 * The four kinds of agent, and what each one costs.
 *
 * A medieval state did most of its work abroad through men who were not
 * soldiers. An envoy carried a credential and a purse; a priest carried a
 * mission; a merchant carried goods and, incidentally, everything he had seen
 * on the way; and a prince's household kept men whose business was knowing
 * what was happening in someone else's. None of them moved an army, and all of
 * them went where an army could not.
 *
 * Each kind is gated on an institution that actually produced it, so the
 * building tree pays for itself twice: a governor's household to run
 * informers, a governor's villa with a chancery in it to write a credential, a
 * parish church to ordain a priest, a market to make a merchant.
 *
 * What a realm's learned buildings buy is not another kind of man but a better
 * one: see SCHOOLS below.
 */
import type { BuildingId } from '../types';
import { buildingId } from '../types';

export type AgentKind = 'spy' | 'envoy' | 'priest' | 'merchant';

export const AGENT_KINDS: readonly AgentKind[] = ['spy', 'envoy', 'priest', 'merchant'];

export interface AgentType {
  readonly kind: AgentKind;
  readonly name: string;
  /** What it costs to put one into the field. */
  readonly cost: number;
  /** What he costs to keep, every turn, wherever he is. */
  readonly upkeep: number;
  /** Provinces he can cross in a turn. */
  readonly movement: number;
  /** The institution that produces him. */
  readonly requires: BuildingId;
  readonly description: string;
}

const a = (type: AgentType): AgentType => type;

export const AGENT_TYPES: readonly AgentType[] = [
  a({
    kind: 'spy',
    name: 'Spy',
    cost: 500,
    upkeep: 35,
    movement: 4,
    requires: buildingId('governors_house'),
    description:
      'A man of no stated occupation, kept out of the prince\'s own purse. He sets fires in ' +
      'the works, puts money about among the discontented, opens a gate to a besieger, and ' +
      'occasionally kills someone. He is also the only reliable way to catch another one.',
  }),
  a({
    kind: 'envoy',
    name: 'Envoy',
    cost: 400,
    upkeep: 25,
    movement: 5,
    requires: buildingId('governors_villa'),
    description:
      'A credentialled negotiator with a clerk and a purse. He does not make treaties by ' +
      'himself; he makes a court willing to hear one, which is most of the work.',
  }),
  a({
    kind: 'priest',
    name: 'Priest',
    cost: 450,
    upkeep: 20,
    movement: 3,
    requires: buildingId('chapel'),
    description:
      'A preacher sent among a population of the wrong faith. Conversion was slow, local and ' +
      'done by men on foot, and a province that has changed its faith stops resenting its lord ' +
      'for having a different one.',
  }),
  a({
    kind: 'merchant',
    name: 'Merchant',
    cost: 350,
    upkeep: 15,
    movement: 4,
    requires: buildingId('market'),
    description:
      'A factor posted on someone else\'s resource, taking a cut of it and sending it home. ' +
      'He can be bought out by a richer rival, which is how the Italian cities fought most of ' +
      'their wars with each other.',
  }),
];

/**
 * Buildings that produce a better man of any kind.
 *
 * A scriptorium turns out someone who can read a treaty, a cathedral someone
 * who can argue theology, a palace someone who has watched a court work.
 * These are the chains an AI rarely builds and a player often does, so this is
 * also where the investment shows.
 */
export const SCHOOLS: readonly BuildingId[] = [
  buildingId('scriptorium'),
  buildingId('university'),
  buildingId('cathedral'),
  buildingId('governors_palace'),
].map((id) => id);

const BY_KIND = new Map(AGENT_TYPES.map((type) => [type.kind, type]));

export function getAgentType(kind: AgentKind): AgentType {
  const type = BY_KIND.get(kind);
  if (!type) throw new Error(`No such agent: ${kind}`);
  return type;
}
