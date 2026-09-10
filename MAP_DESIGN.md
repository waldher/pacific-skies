# Pacific Skies: expedition theater

Design direction and reviewable geography prototype, September 10, 2026. The atlas in `atlas/` is independent of the playable game's generator. Fleet behavior, campaign persistence, supply and discovery events described below are proposed work, not implemented atlas features.

## The experience

You leave a familiar runway, follow a broken coastline into unknown waters, and spot shipping disappearing behind a volcanic island. Following it reveals a protected anchorage. You have enough ordnance to hurt something, but not clear the region. Do you attack the escort, keep following the transport, or find somewhere closer to land?

On the next sortie that bay is familiar. Your new forward strip makes it reachable quickly. A carrier has moved through the channel while you were away; radar shows its last observed course. The same geography now presents a different decision.

That is the campaign: learning a place, gaining a foothold, and changing what is possible there. Scale comes from recognizable distances, incomplete knowledge and a growing operational reach. It must preserve immediate arcade flying and the existing two-thumb controls.

## Why the current map still fails

The playable generator retains a small fixed arrangement of holdings beneath its scenery. Changing coastline shapes and adding islets cannot remove the repeating rhythm of nearby, similar objectives. The player clears a large fraction of the theater in four minutes, with little need to learn routes or establish forward positions.

We should replace that structure, not add another layer of coordinate jitter. Geography must be generated before objectives. Land count, strategic holdings, regional count and campaign progression cannot remain interchangeable.

## Geography at three scales

| Scale | Initial pacing target | Purpose |
|---|---|---|
| Local encounter | 5–15 seconds between nearby tactical choices | Immediate fighting, approach routes, cover from ship fire, useful landmarks |
| Regional sortie | 15–30 seconds between useful bases or discoveries | Learn a coast, choose an objective, return with two spent weapons |
| New expedition | Typically 30–55 seconds between regional centers; occasional longer branches | Feel a departure and arrival; secure a forward base to shorten repeat journeys |

These are cruise-time targets, not minimum waiting periods. Measure actual airfield-to-target-to-rearm journeys before tuning. A flight around a large island can have more decisions than a shorter featureless crossing.

The prototype generates 4–7 regions. A curved, branching regional structure grows with separation constraints, occasional lateral connections and variable direction. Within it are great islands with offshore satellites, broken calderas and lagoons, volcanic arcs, and sparse outer reefs. Region identities can repeat; their distribution is not an obligatory checklist.

Generate larger landforms first, then smaller coast fragments and islands. Facilities come afterward: several can share one landmass, while many islands have none. A small radar outpost can matter more than a large empty island. Ports must ultimately be placed on suitable sheltered coastlines; the atlas's center markers are conceptual placeholders, not validated harbor positions.

The next geometry pass should introduce large irregular bays, peninsulas and necks to major islands, with ridge orientation and shallow shelves that visually connect an archipelago. The atlas establishes macro spacing and branching; its simple coastline polygons are not the final terrain art. Sea routes must be derived from navigable water and clearance for the complete escort formation, never straight lines through land. Atlas dashed links only describe regional adjacency.

## Exploration that changes decisions

Start with a useful chart of home, rough knowledge of distant regions and one specific lead. Avoid both an omniscient objective board and a completely black map requiring lawnmower scouting.

Use three separate information layers:

1. **Geography:** persistent coast and regional knowledge. Major distant land can be approximately charted; small islands and useful anchorages resolve during scouting.
2. **Installations:** unknown until seen, reported or revealed by regional radar. Static discoveries stay known, but ownership changes require refreshed intelligence.
3. **Moving forces:** observations with time, course and uncertainty. Covered radar tracks a fleet; an uncovered contact becomes last-known rather than following its live position invisibly.

Radar should immediately reveal nearby enemy facilities and give meaningful warning of formations and fleet movement. Its value is answering “what is out there?” and “what is approaching our foothold?” Coverage should cross part of a region, not reveal the whole theater from home.

Discoveries should create actions: a transport leads toward its support port; departing bombers suggest an unseen airfield; an abandoned strip offers emergency recovery; a reconnaissance outpost reveals two different routes forward. Quiet water is allowed. No collectible in every empty square and no mandatory fog clearing.

The chart's main action remains **set destination**. A discreet bearing and distance supports manual flight. Leads and reports should use the established compact visual language, not a new paperwork menu.

## Conquest changes operational reach

Capture a forward runway and the next expedition becomes practical. Secure its supply port and it becomes harder to dislodge. Capture radar and the next hostile region becomes understandable. Request friendly carrier deployment into a secured sea area and create a mobile launch point.

Represent frontlines through regional connections and surviving supply/launch sources, not a rigid colored tile overlay. A rear region is usually safe until an actual enemy route reopens. Enemy pressure must be legible and suppressible: destroy the airfield launching a raid and that source stops contributing; take a port and its fleet must withdraw elsewhere or operate with reduced support.

First implementation: one friendly task group, one enemy task group, regional launch facilities and a small number of supply links. Do not start with an inventory economy or logistics dashboard.

Fleet state should be purposeful: patrol a passage, advance toward a contested region, prepare and launch a strike, withdraw for repair, regroup near a support port. Destroyers travel with and protect the carrier. Losing escorts creates an attack opportunity. Losing the port changes the fleet's choices. Include preparation and recovery periods so the player can understand and exploit behavior.

Use at most one major active offensive and one minor nearby threat initially. New conquest activates the adjacent front rather than summoning attackers everywhere. Friendly pilots and garrisons handle some pressure without requiring constant personal intervention. This limit is a readability and balancing starting point, not a promise that every situation is safe.

## A ten-minute opening

- **0–2 minutes:** launch from the substantial home island, follow a reconnaissance lead along its coast, encounter an objective the starting P-38 can actually resolve.
- **2–4 minutes:** discover a branch: a forward strip or shipping entering an uncertain lagoon. The choice changes the next sortie.
- **4–6 minutes:** establish the foothold or identify the fleet's support base. Return, rearm immediately on landing, and deploy from the new position when available.
- **6–8 minutes:** observe an enemy response originating in the neighboring region. Intercept it, hit its launch source, or trust local defenders while pursuing another opportunity.
- **8–10 minutes:** finish learning the first region and gain a clear reason to cross into the next. A substantial aircraft qualification should now be becoming attainable, not have unlocked at minute two.

Generate this progression from constraints rather than fixed coordinates or mandatory missions. Test the weakest starting loadout: two bombs must not make the first usable foothold impossible without repeated long return flights.

## Persistence and rewards

A larger theater needs a persistent expedition campaign. Ordinary pilot loss should preserve chart knowledge, qualifications and territorial ownership, return the player to a surviving friendly launch point, and cost the unfinished sortie's bonus. The immediate enemy operation can advance modestly, with its consequence explained. Defeat occurs when no viable friendly launch foothold remains.

This is an explicit change to the current campaign-ending death rule. Implement local saves and recovery together, with versioned deterministic world data and a clear new-campaign action. Keep short arcade sorties; persistence should reduce repetition, not introduce a long setup ritual.

Rewards worth pursuing include forward deployment, radar coverage, repaired abandoned runways, carrier support, better local defense, and aircraft qualifications for different roles. Score alone should not unlock the whole hangar. Award exploration and distinct strategic achievements, with enough combat experience to demonstrate the role. Do not require grinding repeated nearby targets or delay an unlocked plane through a punitive replacement timer.

The campaign endpoint can be securing the principal enemy anchorage and neutralizing its main task group. Optional branches stay optional. Total cleanup of every rock is not the victory condition.

## Delivery order

1. **Review macro geography:** this atlas. Compare seed shapes, zoom from theater to region, measure flights from different launch points, and preview incomplete chart knowledge. No claim that it validates combat or exploration fun.
2. **Playable expedition slice:** integrate the generator with shared collision/render shorelines, guaranteed runway/hull clearances, saved discoveries, a first lead, forward deployment and recoverable pilot loss. One region should support several useful sorties before the next opens.
3. **A moving front:** purposeful enemy/friendly task groups, traversable sea corridors, radar observations, regional raid preparation and source suppression.
4. **Campaign rewards:** strategic upgrades and revised aircraft qualifications using measured outcomes from human sessions and seeded simulations.

Fuel management, inventory hauling, mechanical weather, elaborate research screens and numerous independent fleets are deferred. Clouds, distant mountains, reef color and coastal landmarks can establish atmosphere without adding another resource bar.

## How we will judge it

The prototype passed generation across 500 seeds (38–102 landforms), and the three provided seeds have different region counts and topology. That proves repeatable generation, not balanced maps. Inspect maps with objective icons removed as well as with them; reject even spacing hidden by attractive coastlines.

For the playable slice record first useful discovery, first forward deployment, actual repeat rearm travel, time to first qualification, regions visited, sources of each raid, base loss/recovery and long periods without a decision or meaningful sighting. Compare novice, aggressive, exploration-first and defensive play. Keep human route observations separate from scripted bot performance.

Acceptance questions:

- Can a player recognize the home region and next frontier without reading every label?
- Do two players choose different second or third objectives on the same seed?
- Does discovery change a destination, attack decision or launch option?
- Does a forward base substantially shorten repeated travel?
- Can the player explain where an attack came from and how to stop another?
- Does destroying a port or escort change fleet behavior measurably?
- After a loss, is there a purposeful continuation within a minute?
- At ten minutes, is there still a compelling horizon rather than mostly cleanup?

Run seeded geometry checks for collision-safe runways, open lagoons, complete fleet-route clearance, reachable starting objectives and repeatable saves. Use screenshots across a seed corpus for asymmetry and mobile readability, and profile terrain batching/streaming before increasing detail. Avoid updating all distant decorative meshes every frame.
