# How the simulation fits together

## The shape of the state

`CampaignState` is a plain mutable object graph with no behaviour on it: maps of
provinces, factions and armies, a turn counter and a serialised generator state.
Every rule is a function that takes the state. That keeps the simulation easy to
snapshot, diff and serialise, and keeps the rules testable without constructing
a game.

Nothing in `src/core/` touches the DOM or calls `Math.random`. Randomness comes
from `Rng`, a xoshiro128\*\* generator whose state lives in the campaign state and
is saved with it. This is the property that makes save games exact: a campaign
reloaded from a save continues identically to one that was never saved, and the
test suite asserts it by playing both forward fifteen turns and comparing.

## A turn

`endTurn` runs a fixed pipeline, in this order:

1. Every AI faction takes its turn, through the same order functions the player
   uses.
2. Sieges progress: starvation, free garrison turning out, surrender.
3. Each province builds, musters, grows, converts and settles or revolts.
4. Finances settle; a faction that cannot pay disbands regiments.
5. The clock advances; two turns make a year, a summer and a winter.
6. Factions due this year emerge; factions with nothing left are marked dead;
   relations drift; characters age and die.
7. Armies get their movement back.

The order is fixed so that a save taken at any point replays identically.

## The economy

Four income streams and two costs, each computed from something the player can
see on the province panel:

- **Farming** from population, fertility and the farm chain.
- **Taxes** from population and settlement rank, reduced by unrest.
- **Trade** from the trade and port chains plus the province's resource,
  multiplied by its open trade routes. A route is an adjacent province not at
  war with us; a sea route counts double, which is what makes Venice, Genoa and
  Ragusa rich.
- **Mining** from the mine chain.

Against that: building upkeep per province, regiment upkeep per soldier in the
field or on the walls, and an administration cost that rises faster than the
realm does. The last is the brake that stops a large empire accumulating a
treasury it has no use for.

Population grows logistically towards a carrying capacity set by land, farming,
water supply and settlement rank. Without that ceiling a province compounds for
four centuries and ends up with a tax base no medieval state ever had; it did,
in an early build, reach 162 million people.

## Public order

A score, not a mystery: buildings, garrison, walls and a governor raise it;
the wrong faith, distance from the capital, recent conquest, settlement size and
an active siege lower it. Unrest moves towards the level the score implies, and
a province in open revolt either goes independent or is put down at a cost in
men and population.

## Battles

A fixed-timestep simulation on a field measured in metres. One tick resolves, in
order: orders and movement, missile fire, melee, morale, victory check.

- **Melee** compares attack against defence, both modified by experience,
  fatigue, slope and ability. A shield counts only against attacks from the
  front and left. Being hit in the flank or rear is close to twice as bad, and
  being outnumbered in contact worse again.
- **Missiles** fall off with range, are blunted by armour and shield, and run
  out: ammunition is finite and nobody resupplies in the field.
- **Morale** accumulates shock from casualties, from being shot at, from flank
  attacks and from watching the regiment beside you break. Past a threshold set
  by the unit, its experience and the general's command, it routs; clear of the
  fighting it may rally.
- **Terrain** is a height function. Hills and mountains fight on a ridge, which
  is worth real combat and missile advantage.

Both presentations run the same model. A battle the player watches and a battle
the campaign resolves for them differ only in whether it is drawn.

## The AI

One routine per faction per turn, in four stages:

1. **Retrench** anything the realm can no longer pay for, quiet garrisons first
   and field regiments last, budgeting on the year rather than the harvest.
2. **Build and recruit**, tracking what is left to spend as it commits.
3. **Diplomacy**: sue for peace when losing or overextended, trade with those
   who already like it, ally rarely, and declare war when the opportunity is
   worth the risk.
4. **Armies**: muster the surplus of a garrison into the field, combine armies
   that meet, hold a siege it has begun, relieve a besieged province, take a
   weakly held neighbour, march towards the nearest enemy, or make for the
   quayside when the only enemy it has is across water.
5. **The navy**: build to a target set by how much coast it has and how rich it
   is, fight a squadron it can beat, sail to close an enemy harbour, carry an
   army to a hostile shore, and come home before the winter gales.
6. **Trade**: take the wager on a road when the expected return clearly beats
   the outlay, and leave it alone when the road is cut.
7. **Hiring**: buy companies only when at war and only where they are needed,
   because a company is a stopgap rather than a standing establishment.

It plays by the player's rules, through the player's order functions.

## The sea

The map has two layers. Provinces are the land; sea zones are the water. A
harbour province opens onto one or more zones, and a fleet moves from zone to
zone rather than from port to port. Great rivers are zones too, because the
Nile, the Danube, the Dnieper, the Volga and the Rhine carried more medieval
traffic than most coastlines, and a war galley on them is as real as one at sea.

A ship is a fighting unit like any other, so a sea battle runs the same
simulation a land battle does: closing, shooting and then boarding, which is
what a medieval sea fight was. What ships have that regiments do not is
capacity, the number of land regiments they can carry, which is how an invasion
crosses water. The land regiments a fleet is carrying take no part in a sea
battle, which is why a loaded invasion fleet is such a poor thing to be
intercepted with, and why losing the hulls drowns the army aboard.

Blockade works per lane rather than per port. A squadron at sea between two
harbours closes the trade along that lane and stops an army crossing it. For a
harbour to count as invested, every water it opens onto must be closed and its
owner must have nothing afloat to contest them; a port with three seas in front
of it is correspondingly hard to shut.

Winter is the great limiter. A fleet kept at sea through it loses hulls to
weather, seaworthy designs fewer than galleys, and every fleet's range falls.
That is why medieval fleets were laid up from autumn to spring, and why a
blockade was so hard to maintain.

## Trade

Two kinds, deliberately separate.

**Local trade** is what a province earns from the neighbours it can reach: a
function of open borders, computed in `economy.ts`. It is passive, and a war
with a neighbour reduces it.

**Long-distance trade** is the nineteen named roads. Each is an ordered path of
provinces whose consecutive pairs share a border, so a caravan can walk it. A
caravan costs an outlay to load, carries a cargo worth more than that, pays a
toll of five per cent to every foreign lord it crosses, and pays the rest to
its owner on arrival. Any army at war with its owner that stands where it
stands takes the lot.

That makes a road worth three different things to three different states: worth
sending caravans along if you hold an end of it, worth holding the middle of
even with nothing to sell, and worth cutting if your enemy depends on it. War
shuts a road rather than taxing it, which is why a caravan that cannot pass
waits, turns back, and is eventually lost.

## Soldiers you do not own

A realm raises troops from its own provinces, slowly, limited by what its
settlements can muster. It can also buy them.

A mercenary pool is a company standing about in the country that produced it.
Hiring ignores the hiring state's roster: what matters is being there with the
money. A company joins immediately, which is the whole point of the
institution, and in exchange it costs a premium to take on and nearly twice a
levy to keep.

Pools are finite and replenish slowly, so hiring a company denies it to
everyone else until the country furnishes another. Two states at war over the
same ground are bidding against each other for the same men.

Companies leave when the pay does. When a realm cannot meet its bills the hired
men go first, before anything of its own, which is both what happened and a
reason to think twice before building an army out of other people's soldiers.

## Where the money goes

A realm pays for its buildings, its soldiers, its administration, and its
hoard. The last is the least obvious and the most necessary. Medieval
treasuries leaked: money in a vault was spent on display, siphoned by the
officials guarding it, lent to favourites, or quietly debased. Mechanically it
is the brake that stops a small state on a rich trade road accumulating a
fortune it has no use for, and it leaves a working reserve untouched.

The AI commits to about twenty-five turns of extra upkeep out of savings as
well as out of income. Without that it spent revenue only, and a rich state sat
on its money while poorer neighbours out-built it.

## What is deliberately simple

- **No mercenary politics.** Companies serve or leave; they do not change
  sides mid-battle, besiege the employer who shorted them, or carve out
  states of their own, all of which happened.
- **No family trees.** Characters age, govern, command and die; they do not
  marry or inherit.
- **Battle AI is a doctrine, not a search.** Hold a line with the heavy foot,
  shoot with everything, use cavalry against whatever is exposed.

Each of these is a place the game could grow, not a thing that is broken.
