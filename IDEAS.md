# Pacific Skies roadmap

## Next conquest additions

- Supply convoys: escort friendly reinforcements (enemy convoys are in).
- Visual landed investment choices: radar, hardened hangars, repair crews and escorts.
- Squadron assignments: patrol a selected base, escort a strike; wingman upgrades beyond veteran aim.
- Fleet expansion: destroyer escorts and a second mobile carrier.
- Original enemy bomber and torpedo-aircraft models; current strike roles use the Zero.
- Visible enemy bomb and torpedo releases; current strikes damage their target on arrival.
- Persistent campaign saves and service records, paint schemes and nose art.

## Fun audit findings

`npm run test:fun` (see CLAUDE.md) tracks these; the report in
`playtest/shots/fun-report.md` has the numbers. Bots are models, not
people: treat a finding as a question to answer with a human session.

Fun-killers today:
- **Weak players cannot win** (rookie win rate 0 in 45 min, ~5 deaths per 10 min). The rookie gets stuck in fights nobody wins and abandons ~14 per 10 minutes: roaming Zeros chase forever and never break off. Mechanic candidates: enemy fuel or morale so dragged-out fights end; assists that fade with rank (pipper that leads along the arc, wider hit radius); fewer, weaker defenders on the first islands.

Warnings:
- **No death stakes for a competent pilot** (average dies ~0 per 10 min). Losing an aircraft is not part of the experience; stakes are only on the war map.
- **Skill is a cliff, not a slope**: aces win in ~18 min, average ~24, rookies never. Wants a middle: catch-up help, not only harder enemies.
- **Low pressure**: a player who defends home and never advances first loses a holding after ~22 min. The war does not force the player's hand; consider an enemy offensive clock.
- **Travel is half of flying** (0.51). Forward rearm points, shorter survey legs, or decisions en route.
- **The starter aircraft is abandoned at once**: the Dauntless unlocks after one combat sortie and the P-38 has no job only it does.
- **Seeds differ 2.3× in length** (18 to 39 min): region count and link lengths in expedition-geography.

Healthy: guns matter (pacifist never wins), no dominant strategy (fastest strategy varies by seed), fights pay (rushing is ~10% slower), rhythm of 2–3 intensity peaks per 10 min, novelty continues to the end, the second half differs from the first, objective and encounter variety.

Sensitivity notes (`npm run test:fun:sensitivity`): quadrupling enemy damage makes hunting fighters the dominant strategy on every seed and one campaign in three unwinnable; slowing aircraft to 60% also makes one in three unwinnable.

## Balance work

- Measure first-aircraft timing and rookie outcomes with human sessions to calibrate the rookie persona.
- Torpedo attacks are not exercised by the bots yet (they bomb the enemy carrier).
- Bomb runs are ~2% of play. Runway bombing may be too quick to matter as a decision, or the bot's release is simply accurate; watch a human do it.

## Implemented

- Campaign pilot harness (now `playtest/lib/pilot.cjs`, run by the fun audit). It found and now guards: a reached survey with no contact left the marker on empty sea forever; overrun garrisons stayed "ours" on the chart, so the marker never pointed back; once every island fell there was no objective at all (up to a third of a campaign idle) because guidance never pointed at the enemy fleet.

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
