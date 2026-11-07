# Blind HUD review A

Axes run from 0 to 5. Weighted values use 30% integrated status, 30% contextual guidance, 25% phone legibility/action, 15% character/restraint. I inspected all 45 stills separately for world-render quality. Below are the 20 visually matched modern HUD captures.

| View | Status | Guidance | Phone | Character | Weighted | First glance and friction |
|---|---:|---:|---:|---:|---:|---|
| 03 | 2.5 | 3.5 | 3.5 | 4.0 | 3.27 | Blue bracketed plane at bow, outpost primary, base secondary. The formation and deck obscure the airframe. |
| 08 | 3.0 | 3.5 | 3.5 | 4.0 | 3.42 | Brackets point to the blue plane crossing the bow. The bracket detail looks decorative at first. |
| 15 | 3.5 | 4.0 | 4.0 | 4.0 | 3.85 | Brackets isolate the pilot on grass and the paired gold arrows point out to sea. The dark map shows the route. |
| 18 | 3.0 | 3.5 | 3.5 | 4.0 | 3.42 | Brackets are enough to locate the pilot ahead of the carrier tower. Deck trim reduces the right bracket's contrast. |
| 19 | 2.5 | 3.5 | 3.5 | 4.0 | 3.27 | Outpost order is legible above the fight. The player sits among attackers with similar wing spans. |
| 21 | 3.5 | 4.0 | 4.0 | 4.0 | 3.85 | Pilot brackets isolate the hangar overlap, and gold arrows across the runway separate navigation from the pilot. |
| 23 | 3.0 | 4.0 | 3.5 | 4.0 | 3.58 | Same runway bearing reads clearly in the soft image. Blue fuselage still blends into the building. |
| 25 | 3.0 | 3.5 | 3.5 | 4.0 | 3.42 | Carrier and other aircraft stay clear. Tight framing near the bow briefly invites reading brackets as part of the ship. |
| 31 | 3.0 | 3.5 | 3.5 | 4.0 | 3.42 | Aircraft can be found despite the soft bow overlap. The shaded right bracket has lower contrast. |
| 33 | 3.5 | 4.0 | 3.5 | 4.0 | 3.73 | Shore and arrows give a clear rightward heading. Aircraft and shadow overlap near the rock. |
| 39 | 2.5 | 3.0 | 3.0 | 3.0 | 2.85 | Old compact order is readable after looking away from the swarm. The brackets compete with effects at the bow. |
| 41 | 3.0 | 3.0 | 3.5 | 3.0 | 3.12 | The pilot and bow are closely aligned. A detached small arrow sits ahead and left. |
| 45 | 3.0 | 3.5 | 3.5 | 3.0 | 3.27 | The pilot is bracketed on grass, and a single chevron points out to sea. The two mission rows have similar emphasis. |
| 44 | 3.0 | 3.0 | 3.5 | 3.0 | 3.12 | One carrier at speed and two subtle brackets at its bow. Objective and base compete in the stacked tabs. |
| 06 | 2.5 | 3.0 | 3.0 | 3.0 | 2.85 | Dark water and a bright swarm. The order at top reads, but airframe identification takes several glances. |
| 02 | 3.0 | 3.0 | 3.5 | 3.0 | 3.12 | Runway and its painted arrow dominate. The little arrow in the top strip can be mistaken for a UI affordance. |
| 43 | 2.5 | 3.0 | 3.0 | 3.0 | 2.85 | Runway sets the scene. Soft pilot brackets blend into the buildings. |
| 32 | 2.5 | 3.0 | 3.5 | 3.0 | 2.98 | The bow and the pilot compete. One offshore chevron is easy to miss. |
| 29 | 3.0 | 3.0 | 3.5 | 3.0 | 3.12 | Lone carrier with the pilot under its bow. Detached chevron looks like another transient world mark. |
| 36 | 3.0 | 3.5 | 3.5 | 3.0 | 3.27 | Small brackets bracket the blue pilot and a single arrow signals offshore travel. The existing action buttons read clearly. |

- Active-course/hold-right style mean **3.52/5**.

- Stacked-tabs/rounded-controls style mean **3.06/5**.

## Benchmarks and behavior

- **Dead Space integration: falls short.** Isaac's segmented light follows the physical spine and unambiguously looks like a status display. Here the brackets reliably frame the pilot in most positions. Tiny changing edge treatments still read as outlines before they read as vital state, and the numeric readout remains detached in the corner. The damage samples make the health loss readable in that corner and show an immediate white flash, but I could not read an urgent condition from the brackets alone.
- **Ghost of Tsushima guidance and restraint: falls short.** Sony's shrine exploration lets the destination dominate the frame without persistent dark cards. Its combat sample pulls controls to the lower corners and leaves the horizon open. Pacific Skies' arrow pair avoids center text and the map route agrees, but persistent opaque mission and action plates carry the route and cover scene content at the top edge. The Sony effects still also shows environmental particles arranged as guidance. Pacific Skies' synthetic arrows are legible across dark water and pale land, with a distinct language that suits the aerial camera.
- First-glance mapping in the new style is pilot brackets, direction chevrons, primary outpost, secondary nearest base, and two active right-side actions. “Hold right” reads like an input instruction, but the stills do not establish whether it refers to a region or button. Bomb counts are clear in the initial samples. Safe areas, hit targets, two-thumb behavior, capture progress, overheated fire feedback and sustained playback remain unverified here.
- The sampled critical sequence clearly switches to **RETURN TO BASE** and distinguishes **ACTIVE COURSE** from **IN STATION**. The hull percentage and shorter bar expose damage. The 27% state reads as low health, but a player concentrating on the brackets has to look away to see the magnitude. The sustained overheat state is absent, so its readability remains an unresolved acceptance check.
