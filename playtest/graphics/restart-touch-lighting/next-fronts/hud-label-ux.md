# Independent UI/UX review of HUD label clearance

Compared the 852 × 393 before and after captures in `resumed-graphics/pilot-brackets-motion` and `resumed-graphics/hud-label-clearance-motion`. Viewed each full frame and the region around the changed pixels at native resolution.

| Sample | Before | After | Judgment |
| --- | --- | --- | --- |
| Fleet 120, phone | The cyan “Hawk” callsign straddles the minimap's left edge near its lower-left corner. | The callsign is absent. The map outline, route and markers, and MAP affordance remain visible. | Cleaner separation between world labels and the map. |
| Fleet 120, fallback | The same callsign intrudes into the minimap. | The callsign is absent. The map retains the same visible contents and affordance. | Same improvement on the fallback tier. |
| Coast 180, phone | “Hawk” crowds the leading edge of the RETURN TO BASE objective. | The callsign is absent. The objective icon and text read cleanly. | The objective takes visual priority. |
| Coast 180, fallback | The same callsign crowds the objective. | The callsign is absent. The objective icon and text remain intact. | Same improvement on the fallback tier. |

In both fleet pairs, the changed pixels are confined to the 29 × 7 box at x=694, y=69. In both coast pairs, they are confined to a 29 × 7 box at x=289, y=12. The visible parts of the wingman and the rest of the scene are unchanged. Each new frame loses explicit callsign identification at that instant, especially where the airframe already sits partly behind the HUD or against the screen edge. A player can still see the same aircraft pixels, but these frames alone do not establish that a player could reliably recognize it as Hawk.

**Judgment:** Prefer the clearance candidate on these four stills. This is approval of the sampled collision fix only. Interactive play is needed to check whether the label returns promptly on exit, flickers at HUD edges, or stays hidden long enough to hamper wingman tracking. The stills establish visual map legibility, with map interaction and broader HUD usability untested.
