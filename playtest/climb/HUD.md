# HUD hill climb

In-flight HUD redesign, climbed against two benchmarks with
`playtest/climb/capture.cjs` (`CLIMB_SET=hud` for the eight fixed scenes,
`CLIMB_SET=hud+` to add the `x-*` check scenes). Baseline captures are
`playtest/shots/climb/main`, the owner's attempt `playtest/shots/climb/theirs`,
this work `playtest/shots/climb/hud-mine`.

## Design rationale

**Dead Space — status worn by the character.** The RIG works because the
meter is part of the thing you are already looking at. The player's aircraft
therefore wears a ring (`drawRig` in `src/hud-marks.js`) that turns with the
heading and flattens in a bank:

- Aft arc, around the tail: hull, five cells a side, draining from the wings
  toward the tail. Lume green, amber at 60 %, red at 35 %. At 35 % the arc also
  grows a pulsing serrated outer ring and the figure appears at the tail, so
  the critical state is a shape, not a hue.
- Fore arc, across the nose: gun heat, growing outward from the nose. Absent
  when the guns are cold, cream when warm, amber with red limit stops past
  70 %, and when the guns lock a hatched band with a cross over the nose.
- Only the player wears a ring, so it is also the answer to "which one is me".
  Every stroke has a dark casing, so it holds on sand, deck and water.

The corner gauge stays as the precise backup, smaller than before, and dims
when hull is full and guns are cold. The fire placard repeats the lock in
words (GUNS HOT / COOLING) with a dashed border and hatching.

**Ghost of Tsushima — the world points the way.** There is no objective
panel. The objective is a wind: slipstream darts blow from the aircraft toward
the destination (each with a ground shadow and a thin outline), a double
chevron holds the bearing between gusts, and one small placard at the head of
the wind names the action and the seconds to fly. The three phases are
different marks, not different words:

- transit: wind + chevrons + placard;
- arrival (site in view): a plotted target ring with four ticks on the site,
  the wind stops short of it, the placard moves under the site;
- active capture: the ring becomes a stopwatch face that fills clockwise with
  a sweep hand, and three gusts circle it — the orbit to fly. The straight
  wind stops.

Secondary bearings ride the rim of the playfield, away from the wind: the
nearest base is the chart symbol for an airfield with a small tick (its words
drop away while a fight is on), a raid is a pulsing red head with two bars and
a hazard-striped placard. A raid formation is one cue rather than one arrow
per bomber. In a fight the wind thins from five gusts to four and the placard
drops a size. When hull falls under the repair threshold the wind turns to the
nearest base at once (the guidance does the same on its next tick).

**Character.** Two materials only: grease pencil on the plotting glass for
everything drawn over the world (rings, ticks, wind, halo-outlined words) and
black cockpit placards with cream engraving and corner rivets for controls and
words that must be read. Ordnance shows rounds as filled or hollow dots.

**Robustness.** A small placer (`placeLabel`) puts every placard in a free box:
it keeps off the player's ring, the lead pipper, every aircraft in view, the
HTML controls (measured occasionally, never per frame), the chart, the wind's
lane and labels already placed. Nothing uses `shadowBlur` or gradients; text
widths are cached; keep-out boxes are pooled.

## Iterations

Scores are my own, 0–5, on the owner's rubric (status / guidance / phone /
character), judged from the eight fixed scenes plus the check scenes.

| Set | Status | Guidance | Phone | Character | Weighted |
|---|---:|---:|---:|---:|---:|
| main | 1.5 | 2.0 | 2.5 | 2.0 | 1.98 |
| theirs | 3.5 | 3.5 | 4.0 | 3.5 | 3.63 |

### 1 — ring, wind, placards (first build)
Hypothesis: a status ring on the aircraft plus wind toward the objective can
replace both the hull tag and the top panel.
Change: `hud-marks.js`, new `drawHud`, placard CSS, `hud:` config.
Captures: the ring found the player at a glance in every scene and the lock
cross and serrated ring read in `hud-critical`. The wind did not: thin cream
lens shapes looked like the ocean's whitecaps and vanished over the deck. The
objective placard sat on an enemy in `hud-fight`. Kept the ring, placards and
stopwatch; wind needed work. Scores 4.0 / 3.0 / 3.5 / 3.5.

### 2 — wind as darts, labels dodge aircraft
Hypothesis: a dart (fine tail, full shoulder, pointed head) reads as direction
in a still, and thicker warm-white with a stronger shadow separates it from
whitecaps. Aircraft boxes added to the placer.
Captures (`x-fight-t1/t2`): better over water and sand, but at some phases only
one gust was visible over the deck, and on the white-ground test
(`x-fight-white`) the gusts disappeared. Kept. 4.0 / 3.5 / 3.5 / 3.5.

### 3 — outlined gusts, flatter fade, airfield symbol
Hypothesis: a 1 px dark outline holds the gust on white; a flatter fade
envelope keeps three or more gusts strong at any instant. The base cue (a
tilted box) became the chart symbol for an airfield; the corner gauge dims
when there is nothing to report.
Captures: wind now reads in all three time samples and on white and black.
`x-critical-portrait` exposed the chevrons running off the left edge with the
placard stranded 150 px away. Kept. 4.0 / 4.0 / 3.5 / 4.0.

### 4 — wind stops at the edge, placard anchored to the chevrons
Hypothesis: clamp the wind's reach to the playfield and place the placard
around the chevron head rather than around the player.
Captures: portrait critical fixed, placard always beside the chevrons.
`x-raid-portrait` showed the rim cue pulled 140 px in from the right for the
whole height because the control inset applied everywhere, putting the raid
placard over the wind. Kept. 4.0 / 4.0 / 3.5 / 4.0.

### 5 — rim steps in only where a control is; wind lane reserved
Change: dropped the fixed right inset (the rim point already steps back from
any keep-out box), reserved three boxes along the wind for the placer,
restyled the sortie panel as a plate.
Captures: raid placard clear of the wind in both orientations. Found that in
a single-frame capture the control boxes were measured before the HTML was
shown, so the raid head could sit over the chart. Kept. 4.5 / 4.0 / 4.0 / 4.0.

### 6 — controls laid out before they are measured
Change: `showControls()` shared by the canvas HUD and `drawMenus`; the chart
inset is reserved directly from its canvas rectangle.
Captures: `hud-raid` head and placard sit clear of the chart.
Kept. 4.5 / 4.0 / 4.0 / 4.0.

## Rejected

- Lens-shaped wind streaks with an offset shadow only (iteration 1): read as
  whitecaps, invisible on bright ground.
- A fixed 142 px rim inset on touch devices: wrong in portrait, where the
  controls only occupy the bottom of the right edge.
- Rim cue for the base drawn as a small runway rectangle: read as a box.
- A hull figure always attached to the ring: it is the floating tag again.
  It now appears only at critical hull.
- Hiding the objective placard after a few seconds of steady transit: closer
  to the benchmark, but a still frame could then fail "primary objective
  determinable", which is a blocker.

## Still weak

See the end of the final report in the commit that closes this climb.
