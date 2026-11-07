# Pacific Skies HUD benchmark

Publisher references are design targets. Compare the old and candidate Pacific Skies HUDs under matched phone scenes; the reference games have different cameras, inputs and encounter pacing.

- **Dead Space (2023), integrated status:** EA/Motive's [developer article](https://www.ea.com/inside-ea/news/inside-dead-space-1-remaking-a-classic) supplies `dead-space-rig.jpg`, an in-engine development image showing Isaac's segmented, luminous spine indicator attached to the suit. See the [official gameplay trailer](https://www.youtube.com/watch?v=cTDJNZ9cK1w) for the combat framing. Benchmark: locate the controlled subject and read its status as one glance. Check whether the status stays associated as the subject moves or banks. Retain a precise, legible readout as backup on a small screen.
- **Ghost of Tsushima, contextual guidance:** Sony's [State of Play](https://www.youtube.com/watch?v=Ur0pQblaZcE) introduces exploration from about 1:00 and samurai combat from about 7:15. Sucker Punch's [visual effects breakdown](https://blog.playstation.com/?p=345372) describes quest wind particles aimed directly at the destination. Benchmark: give the next destination a strong, context-sensitive cue while leaving the world and current fight readable. The full directional motion needs playback evidence.

## Blind review

Judge matched anonymous Pacific Skies captures at native and fallback phone profiles. Score each HUD from **0 to 5** independently on each criterion. Use **0** for missing, **1–2** for visible but ambiguous or obstructive, **3** for dependable, **4** for clear at a glance across the sample and **5** for exemplary clarity and coherence. Cite the scene and exact visible evidence. For a state or behavior outside the evidence, use **unverified** rather than awarding points.

| Criterion | Weight | What the reviewer checks |
|---|---:|---|
| Integrated status | 30% | Find your aircraft in a swarm. Distinguish healthy vs damaged and cold vs overheated if supplied. Read the status without mistaking a ship, shadow, or neighboring aircraft for yours. |
| Contextual guidance | 30% | Identify the primary next action, determine the destination bearing, and tell transit, arrival and active capture apart. Distinguish reserve/raid cues from the primary cue. Unrelated guidance should recede during busy moments. |
| Phone legibility and action | 25% | Read labels and indicators on a bright runway, dark water and crowded carrier bow. Distinguish critical states without relying on hue alone. Locate fire, ordnance and chart controls. Stills show visible space and labels; verify hit targets and two-thumb behavior separately. |
| Character and restraint | 15% | Assess visual hierarchy, 1940s aviation character, and usable playfield. New ideas earn credit when they help orient the player, not just when they resemble either reference. |

Score HUD change separately from world-render quality. A candidate can be bolder and cleaner yet still fail if pilot identification, status, mission, map, or action availability regress. Treat inability to read urgent damage/overheat, determine the primary objective, or operate a required touch control as a blocker regardless of weighted score. Ask for first-glance descriptions before revealing the intended mapping. Separately inspect bank/overlap, objective transition, safe areas and touch ergonomics in motion and interaction. State explicitly which checks remain open.

## Local evidence notes

- `dead-space-rig.jpg` is the in-engine development still from the linked EA article, at its official 1023px rendition. SHA-256 `8a8a09ed990546e6bb9c2f5abb46d4b1eafeff7acb1cc8b43c35749472f1fdcb`.
- `ghost-guiding-wind.webp` is the official poster frame embedded in the linked Sucker Punch effects article’s Wind section, showing directional particles with debug overlays. Use it to corroborate the environmental cue mechanism, not as a finished HUD screenshot. The official State of Play is the finished-presentation reference.
- Sony's [beginner’s guide](https://www.playstation.com/en-us/editorial/ghost-of-tsushima-beginners-guide/) provides two clean gameplay stills. `ghost-exploration.jpg` shows a player-facing exploration frame with no visible persistent HUD. `ghost-combat.jpg` shows compact contextual control palettes for Sticky Bomb and Stone Stance at the bottom corners, with the center open. Use these to judge hierarchy across states and the State of Play footage for directional motion.
- Keep these publisher images as local review evidence. Link to the official sources in a repository record.

At the end of each review, state where the challenger falls short of, matches,
or exceeds each named benchmark on its applicable criterion, with one visible
reason per comparison. Record the two benchmark observations separately from
the weighted Pacific Skies A/B score. The consoles' controller affordances
cannot establish a touch-legibility benchmark.
