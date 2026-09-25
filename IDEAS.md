# Pacific Skies roadmap

## Next conquest additions

- Supply convoys: escort friendly reinforcements (enemy convoys are in).
- Visual landed investment choices: radar, hardened hangars, repair crews and escorts.
- Squadron assignments: patrol a selected base, escort a strike; wingman upgrades beyond veteran aim.
- Fleet expansion: destroyer escorts and a second mobile carrier.
- Original enemy bomber and torpedo-aircraft models; current strike roles use the Zero.
- Visible enemy bomb and torpedo releases; current strikes damage their target on arrival.
- Persistent campaign saves and service records, paint schemes and nose art.

## Balance work

- Travel is about half of play. `npm run test:campaign` (six seeds, marker-following bot) splits it 28% outbound transit, 18% exploring, 8% flying home (plus 4% final approach), against 28% combat, 2% bomb runs and 8% circling to capture. Candidates: forward airfields that rearm closer to the front, shorter survey legs, or content en route. The band is 0.6; tighten it when this moves.
- Campaigns end in victory in 17–39 minutes for that bot, which dies well under once per 10 minutes: it sees everything visible and flies the combat-balance average pilot. Human sessions will be slower and bloodier; measure first-aircraft timing with them too.
- Bomb runs are ~2% of play. Runway bombing may be too quick to matter as a decision, or the bot's release is simply accurate; watch a human do it.
- Torpedo attacks are not exercised by the campaign bot yet (it bombs the enemy carrier).
- Extend seeded coverage beyond the three smoke-test seeds and compare full campaigns with similar skill levels.
- Inspect time spent travelling without useful decisions as the map and fleet expand. Region spacing was tightened and enemy convoys fill the empty stretches; measure whether rearm round-trips still dominate a sortie.
- Use the optional end report and playtest/balance.cjs together; isolated defense simulations do not prove overall fun or campaign difficulty.

## Implemented

- Campaign pilot harness (`playtest/campaign-pilot.cjs`). It found and now guards: a reached survey with no contact left the marker on empty sea forever; overrun garrisons stayed "ours" on the chart, so the marker never pointed back; once every island fell there was no objective at all (up to a third of a campaign idle) because guidance never pointed at the enemy fleet.

- Enemy supply convoys between holdings, sunk by guns; recovery at the nearest base.
- Wingman squadron with rank slots, replacements and veterans; airfield patrols; carrier CAP and strikes.
- Throttle trades speed for turn; recruit/veteran/ace enemy styles that weave on a merge and lead turning targets; glancing collisions (both hurt, shoved apart, stunned, no score); lead pipper.
- Wingman doctrine: cover the player, tail-chasers first, slow clean shots, break off when hurt, half score. `playtest/combat-balance.cjs` holds the bands.

- Three archipelagos with independent landforms and strategic holdings.
- Moving carrier task groups and escorts; friendly approach holds.
- Charted coastlines, discovered installations, live/stale fleet contacts and radar intelligence.
- Paused operations chart and observation-based navigation waypoints.

- Procedural island chains and manual airfield/carrier landing with instant rearming.
- P-38, Dauntless, Corsair, Avenger and P-51 roles with real model cards.
- Two-round ordnance, torpedo naval attacks and exact-hit naval bombing.
- Airfield, radar and port holdings; establishment, defense and raid-driven recapture.
- Organized bomber/torpedo flights with fighter escorts and detected raid routes.
- Slower score plus completed-combat-sortie qualifications.
- Recorded campaign outcomes and repeatable defense balance scenarios.
