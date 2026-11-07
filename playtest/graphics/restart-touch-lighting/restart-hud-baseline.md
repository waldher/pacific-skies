# Candidate 17 mobile HUD review

Baseline source 4dd8f88af628a6b1c663bd436aa1af73774ba30b474a3ed1f4a60d79dfca3190. I inspected recovered 17's `phone-airfield.png`, `phone-stress.png`, and `fallback-dogfight.png`, plus the same HUD in touch-lighting coast tick 180 and fleet tick 60. I inspected HUD, input, aircraft, and operations source. This is an expert review of stills and sampled frames, without real device thumb reach, interactive screen reader, or continuous video measurement.

## Baseline score

| Axis | /10 | Visible evidence and impact |
| --- | ---: | --- |
| State and next action | 7 | Hull percentage, gun heat, remaining bombs, and goal ETA are available at a glance. Most panel typography is small, and the objective and nearest-base rows look equally important when both are present. |
| Symbol meaning | 4 | The cyan player ring and translucent blue plane shape look like a shield, targeting radius, or double exposure. The nearby gold lead pipper has no discoverable meaning in combat. |
| Combat legibility | 5 | The ring helps recover the pilot in the carrier stress scene, but the same tint crosses the player model and competes with the target pipper. In coast tick 180 the Hawk label and return banner overlap. |
| Mobile input and access | 6 | Fire and ordnance have visibly large controls, counts stay readable, and the chart has a named keyboard-focusable button. The Fire pill represents a wider right-side action area than its appearance suggests, and a second left-side pointer can fall through to fire while steering is active. Touch comfort and accessibility require interaction tests. |

## Identify the marks by state

- **Persistent cyan circle and blue duplicate aircraft.** Both come from the selected-player shader in `src/aircraft.js` lines 166–181. It renders a radial ring plus a filled top-down silhouette on a flat quad. The model banks separately, so that quad can appear to separate from the model or cross its paint. Its tint is distinct from the black fallback ground-shadow material and the projected sun shadow. The offset is visible in the coast and fleet samples. Continuous motion may make the effect more apparent and needs video review.
- **Small gold circle with dot in forward combat.** The lead predictor in `src/hud.js` lines 70–83 marks where to aim ahead of the nearest observed fighter in range and heading. Keep this function; change the visual to paired open amber brackets and a small center dot, with a one-time hint when it first appears.
- **White steering circles under the thumb.** The outer radius and inner thumb knob in `src/hud.js` lines 109–116 only draw while touch steering is active. Retain this direct input feedback; confirm it vanishes on pointer cancellation, release, and entering the chart.
- **Reached objective ring.** The gold ring at the arrived waypoint is capture progress in `src/hud.js` lines 166–170. Keep progress, give it a distinct segmented arc or progress bar and the text “Capturing,” and hide the empty circle when arrival has no capture action.
- **Dashed chart circles.** Detailed operations view uses circles for radar coverage, uncertain carrier contacts, and search areas. The chart already describes uncertain fleets. Preserve operational meaning and use explicit, short labels or a contextual legend where coverage and uncertainty can be confused.

## Design direction

Use a restrained carrier instrument panel with deep navy backplates and pale type, using amber for current tasks, teal for allies and landing, and warm red for danger. Pair meaning with form and text so color is redundant. Build around three priorities.

1. **One clear pilot marker.** Remove the filled blue mask and persistent radius. Trial one small, detached teal chevron with a dark keyline, positioned below the projected model silhouette. It should follow the player anchor while remaining visually separate through banks, landings and overlapping planes. Preserve the independently computed cast shadow. Reject the change if tracking the pilot in stress gets harder.
2. **Reserve the top edge for flight state and the next action.** Use stable left hull and heat gauges, one primary objective chip with ETA, and the chart affordance at right. Promote return or landing only when actionable, and use a shorter secondary row for useful nearest-base or raid information. Make text legible at phone scale. Reserve the HUD panels as exclusion zones for projected wingman labels, then move or suppress optional labels. Keep health as a number and bar, danger states as text plus color, and the chart keyboard focus visible.
3. **Organize actions by thumb.** Keep a transient left steering hint, a large right Fire target, smaller stacked ordnance with persistent count, and contextual landing or launch. Keep existing steering, held fire, two-thumb ordnance and keyboard behavior. The visual Fire affordance should accurately explain the effective input zone, or use a semantic button with equivalent held-pointer behavior. Preserve chart actions, 48 CSS px minimum touch targets, and accessible names. Use safe-area insets in portrait and landscape. Avoid decorative cockpit gauges.

## Repeatable UX pass for every candidate

Record both current phone tiers at 852×393, plus 393×852 portrait and a short landscape viewport. Assess HUD separately from the existing art scores. Score the four axes above with observed evidence, and track clear failures separately rather than averaging away lost controls.

| Scenario | Task and check |
| --- | --- |
| Airfield, carrier and dense dogfight | Locate the player immediately on grass, deck and ocean. Confirm pilot marker stays separate from aircraft and distinguishable from aim assist. Check at high and low banking angles, takeoff and landing. |
| Coast motion near end of sample | Follow Hawk and the return instruction simultaneously; there should be no label over the objective panel. Watch top and right margins in continuous motion as well as tick 180. |
| Pointer test on a real touch viewport | Hold left steering through turns, start and release right fire, then fire ordnance without dropping steering. The empty second left touch should have documented behavior. Check pointer cancellation, chart pause and resume, and control hit boxes. |
| Navigation states | Record no course, offscreen objective, non-capturing arrival, active capture, raid, low-hull return, and chart uncertainty. Each marker should answer “what is this?” and “what can I do?” without relying on color. |
| Keyboard and small layout | Focus and open chart, close and return focus, confirm keyboard fire and ordnance. Check that the control names and damage/ordnance state remain available and no panel or focused control is obscured. |

Continuous video should explicitly check whether the pilot mark appears to slip or duplicate the aircraft, whether the cast shadow separates plausibly from the plane during banks, and whether navigation text jumps or labels flicker. Static frames establish which state appeared, while real-time review is needed for transition timing and visual stability.
