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
  is worth real combat and missile advantage. What the ridge buys is a better
  exchange rather than a cheaper battle: a fight uphill takes longer and costs
  both sides more men in total.
- **Deployment** forms a continuous line. Regiments stand shoulder to shoulder,
  each taking the ground its own numbers need; the wings form on the flanks of
  the centre rather than off on their own. A gap in a line of battle is an
  invitation, so the simulation does not leave any.

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

## Houses

Characters were in the game from the first commit: they aged, governed,
commanded and died. What they did not do was descend from anybody, so when a
ruler died the crown went to whoever happened to be standing nearest. That is
not what a succession was. A medieval crown was a claim, the claim came from
descent, and most of medieval diplomacy existed to manufacture one.

Every character now has a sex and, when the realm remembers it, a father.
A realm begins as a house rather than as a man: a ruler, his wife, and
whatever children the marriage has had time for. Children are born to married
couples, come of age at sixteen, and until then hold no post.

**Succession** follows the line as far as the line goes: the eldest adult son,
then an adult daughter, then a brother, then — rather than leave the line at
all — a boy, with everything a regency implies. Only when the house has nobody
does the crown fall to the strongest magnate in the realm, and only when the
house is extinct does it go to a stranger.

| Succession | Legitimacy left |
| :--- | ---: |
| son or daughter | 100 |
| brother | 82 |
| consort | 70 |
| nearest of the blood | 62 |
| a magnate with no claim | 45 |
| a stranger, the house extinct | 35 |

**Legitimacy** is subtracted from public order in every province of the realm
at once, and a regency costs more on top. It recovers at two points a year,
because reigning is what made a king legitimate, and it cannot recover past
fifty-five while the ruler is still a child. A disputed succession is
therefore a real event with a cost a player can watch and plan around.

**Marriage** moves a person. The bride leaves her father's court for her
husband's and keeps the house she came from, which is the whole of the bond:
twenty-five points of goodwill in both directions and a standing tie between
two realms. A reigning ruler never moves — a realm cannot hand its own crowned
head to the neighbours — but may marry. Offers are refused, and a refusal is
remembered.

Deaths all run through one function. Old age, a lost battle and an assassin's
knife used to clean up after themselves separately, and two of the three
forgot that the dead man might be the king: a ruler killed in battle left his
realm with nobody on the throne and nothing ever noticed.

### Civil war

A disputed succession cost the realm order in every province it held and
nothing else. What a disputed succession actually was is somebody else with a
claim, provinces declaring for him, and an army marching on the capital.

Two kinds of man rise. The first has the better right: a king's son passed
over, a brother who thought it should have been his. A claim is descent from
anybody this realm has crowned — not merely from the last ruler, which was the
bug that made the model useless, because by the time a usurper is on the
throne the old house is usually the reason he is there. The second kind has no
right at all and does not need one: a capable magnate looking at a king his own
realm does not believe in.

The provinces that declare are the discontented and the recently conquered, up
to a third of the realm, never the capital — that is the thing he has to come
and take. They leave the realm and are held as the independent lords hold
theirs, because from everybody else's point of view that is exactly what they
are: ground the king no longer controls. The difference is that this ground
has a claimant standing on it, and his host is the one independent army in the
game that manoeuvres. It has a single idea, which is the only one a pretender
needed.

It ends three ways. He reaches the capital and is king, and everything that
declared for him comes back into the realm with him while the old king is
deposed. The crown takes back everything that declared and breaks his army.
Or nobody wins for a generation and the cause dies with its moment, which
leaves the crown with the worst of both.

Measured over three two-century campaigns: two to four risings each, never
more than three at once.

## Men who are not soldiers

Everything else in the game moves soldiers. Most of what a medieval state
actually did to its neighbours it did with four or five men and a purse.

An agent belongs to a realm, stands in a province, and has one number that
matters: his skill, from one to ten. He crosses any border, land or sea,
whoever holds it and whatever the state of the war — that is the whole point of
him. He travels three to five provinces a season, and travelling or acting
uses him up for that season.

| | |
| :--- | :--- |
| Spy | sets fire to what is being built, puts money about among the discontented, shortens a siege from the inside, kills a commander, and is the only man who can take somebody else's agent |
| Envoy | makes a foreign court better disposed, by argument or by purse |
| Priest | turns a province's faith, and quiets one that already shares it |
| Merchant | posted on a foreign resource, sends home a share of it; can be bought out by a richer rival |

Each kind is gated on the institution that produced it — a governor's
household for a spy, a chancery in a governor's villa for an envoy, a parish
church for a priest, a market for a factor — so the building tree pays for
itself twice. A scriptorium, a university, a cathedral or a palace does not
produce another kind of man but a better one: each adds a point of skill to
anyone raised there.

**One roll decides a mission.** The man's skill is tried against the watch on
the province — its chancery, its owner's counter-spies, whether it is the
capital, less whatever unrest is making people look the other way. The chance
and the risk are both shown before the player commits, so a failed mission is
a gamble lost rather than a surprise. On a failure he may be taken, and a man
taken is gone: there is no ransom, no second attempt with the same man, and
the court he was caught in does not forget it.

Skill rises only by succeeding, so a veteran is a real asset and losing one
hurts. There is no fog of war anywhere in this game, so a foreign agent is
visible where he stands; taking him is still work, and only a spy can do it.

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

### When the money stops

Arrears are counted when the pay is late, not when the vault is empty. By the
time a treasury hits zero the realm has already disbanded its way back to
solvency and nobody has gone unpaid at all, so what a company watches is
whether the money is visibly running out: the realm losing money with less
than two seasons' wages in hand. Arrears are forgiven one season at a time —
one good harvest does not settle a debt the men have been carrying for a year.

One season behind and a company is listening to other offers. Any realm at war
with its employer can buy it out for rather more than it cost to hire: it does
not change sides on the field, it walks away from the man who is not paying
and turns up in the nearest force of the man who is. A paid company keeps its
contract, so this is a use for money that only an enemy's bankruptcy creates.

Two seasons behind, and a company garrisoning a town — if it is at least half
of what holds the place — may simply keep it. The province goes to nobody: the
company holds it for itself, and every soldier in it who was not a mercenary
is gone. This was rare and it is rare here: about one town a century.

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

## The faith as a political force

Each of the two great faiths has an authority: the pope at Rome, the caliph at
Baghdad, with named successors if either falls. The authority keeps a standing,
from -100 to 100, for every ruler who answers to it, moved by what those rulers
do with their armies. Making war on one's own communion costs standing; making
war on another gains it; taking a place the faith claims gains a great deal;
building for the church gains a little.

Below -55 the authority loses patience and censures. Excommunication shuts the
churches, which costs public order in every province whose people share the
faith, dissolves every alliance with co-religionists, and lets them declare war
without waiting out any cooldown. It is lifted by mending one's ways over time
or, as it usually was, by paying for it.

**Who answers to whom is not the same as who belongs to what.** Only Latin
rulers answer to Rome; the schism of 1054 is the point, and no pope could
excommunicate a Greek emperor in any sense the Greek emperor noticed. But
Byzantium is still Christendom, so no crusade is preached against it while it
holds Constantinople, and a Catholic who attacks it loses standing all the same,
if less than for attacking a Catholic.

A crusade and a jihad are one mechanism seen from two sides. The authority
preaches for a place its faith claims and somebody else holds, weighted by how
badly it wanted it, with Jerusalem the measure of everything. Rulers take the
vow, which relieves a quarter of their soldiers' upkeep and declares war on
whoever holds the place. Taking it pays the taker in standing and plunder;
letting the call lapse costs everyone who swore and did nothing.

## How a campaign ends

Three ways, and the third is the one that was missing. A realm wins by
supremacy when it holds more than half the map, and is finished by ruin when it
holds no province and commands no army. Otherwise the campaign runs out of
years in 1530 and is judged on where the realm stood: how much of the map it
held, how many men were under arms, how many hulls were afloat, what was in the
treasury, and its rank among the surviving powers.

The end date existed in the rules from the beginning and nothing consulted it,
so a campaign simply ran on for ever. `reckon` now answers all three cases in
one place, and the interface asks it after every turn and every battle.

## How it is drawn

The renderer is a separate layer with no state of its own beyond a camera. It
reads the simulation and draws it; nothing it does can change an outcome.

**Provinces have shapes the data does not give them.** `regions.ts` stores a
settlement and its coordinates, nothing more. The ground around each one is
worked out once, by dividing the whole theatre between the settlements with a
Voronoi diagram. It is computed by clipping a bounding rectangle against the
perpendicular bisector to every other site in turn — O(n²) in the number of
provinces, a few milliseconds for 222 of them, and no Delaunay triangulation
to get wrong. The result is cached for the life of the page, because the
settlements never move.

Each cell also records, for every edge, which province lies across it. That is
found by taking the edge's midpoint and asking which other site is as close to
it as its own — within a tolerance, which is how a shared border is told from
the edge of the map. National frontiers are drawn heavier than the lines
inside a realm because of it, and the band of the owner's colour is laid along
them.

**The coastline is real.** Natural Earth's 1:50m land, lakes and rivers,
public domain, clipped to the theatre and simplified by Ramer–Douglas–Peucker
to about seven thousand points, checked in as `src/core/data/geography.ts`.
Province fills are clipped to it, so a province is the land it holds and not a
polygon floating over the sea. Fifteen harbours — Venice on its lagoon, Split
under its mountain — fall just outside a coastline simplified this far, so the
clip region is the land together with a small disc around every settlement.

**Nothing is an image file.** Every mark on either screen is drawn with path
operations: terrain symbols, settlements by rank and wall, armies, ships,
caravans, banners. That is what lets a settlement take any of seventy-three
faction colours without seventy-three sprites, and stay sharp at any zoom.

**Ground reads by slope, not by height.** On the battlefield the shading is
the gradient of the height function lit from the north-west. Colouring by
altitude makes a uniform rise invisible; lighting it from one side makes the
shape of the land appear, which is the whole point of fighting on a ridge.

**A regiment is the men in it.** Ranks and files from the unit's own formation,
as many figures as the block has room for, thinning from the back as it takes
losses. Below about two pixels a man the renderer gives up and draws a bar,
because a smear of dots reads worse than a block does. Arrows are drawn only
where the simulation would have that unit shooting this tick, and dust only
where units are actually in contact: the picture does not say anything the
model is not doing.

**The battle has its own camera.** A field 1400 m across and a man a metre
wide do not share a scale. Untouched, the camera frames the two armies; the
player zooms and pans from there.

## Teaching it

The interface has eight panels and nine systems behind them and used to say
nothing at all about how any of it is played.

The guide is not a scripted sequence that takes the game away from the player.
It is a list of the things a ruler has to be able to do, in any order, each one
judged by a pure function. Most are answered by the campaign itself — a
building under construction, a caravan on the road, a man in the field — so a
step is complete because the thing happened rather than because a button was
pressed, and the guide can never disagree with the game.

Three of them cannot be answered that way, and say so: nothing in the state
records that a panel was opened or that an army was ordered to march. Two more
accept the interface's record as well as the state, because a project finishes
and a muster completes, and a step that un-ticks itself the moment the player
succeeds would be a poor teacher.

## What is deliberately simple

- **Mercenaries do not change sides mid-battle.** They take another prince's
  money between seasons and they keep towns they are owed for, but once a
  battle has begun the order of battle is fixed.
- **No fog of war.** Every province, army, fleet and agent is visible to
  everyone. A spy therefore sells sabotage and murder rather than information,
  which is the honest way to price him in a game where nothing is hidden.
- **Battle AI is a doctrine, not a search.** Hold a line with the heavy foot,
  shoot with everything, use cavalry against whatever is exposed.

Each of these is a place the game could grow, not a thing that is broken.
