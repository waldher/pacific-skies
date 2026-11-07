# Pilot chevron combat HUD review

Independent UX inspection of 12 paired 852×393 stills. I compared
`resumed-graphics/chevron-touch-paired` and `resumed-graphics/pilot-chevron`
at native phone and fallback quality, across coast, dogfight, and stress.
The earlier candidate 17 HUD review supplied context. This check used still
images only. Live tracking, real handset thumb reach, focus, input behavior,
and continuous motion remain unverified.

## Findings

- **Coast, both qualities.** The blue doubled plane and its ring are gone. The
  lone aircraft is readable and its paint is clear. The small upward chevron
  appears below it, but its separation and teal color make it easy to read as
  another navigation cue alongside the separate teal and amber arrows.
- **Dogfight, both qualities.** The ring makes it easier to locate the aircraft
  cluster at the carrier bow, though it tints that cluster and competes with the
  gold aim circle. In the trial I can see the chevron below the bow. Its apex
  reads as pointing at the ship before it reads as identifying a particular
  aircraft, especially in the softened fallback image.
- **Stress, both qualities.** The little chevron is still visible just beneath
  the bow, but associating it with the pilot requires a second look. The marker
  appears about 45 px below the center of the previous ring. The deck edge,
  gold aim circle, neighboring planes, and bursts interrupt the visual link.
  At fallback quality I could locate the marked area but could not confidently
  identify the pilot airframe at a glance. The ring locates the relevant cluster
  more readily, even though overlap prevents clean separation of every aircraft.
- **Controls and status.** The top status and objective panels, map, ordnance
  count, and large Fire affordance stay readable to the same extent in each
  pair. No new control is covered. Small status type and the distinction between
  the objective and nearest base remain existing concerns. Touch activation
  and accessibility semantics cannot be inferred from these stills.

| Experience axis | Ring | Chevron | Basis |
| --- | ---: | ---: | --- |
| Task clarity | 7 | 6 | The next-action text stays clear. The pilot cue takes more interpretation in both carrier scenes. |
| Information hierarchy | 6 | 7 | Removing the translucent duplicate clears the plane and reduces competition with the aim cue. |
| Control ergonomics | 6 | 6 | Visible affordance only. Fire and ordnance remain large, separate targets. |
| Accessibility | 5 | 5 | Visible legibility only. The chevron offers a distinct shape, but it is small and weakly associated with its subject in clutter. |

**Verdict: revise.** The trial clears the unwanted overlay, but it regresses
quick pilot identification in crowded combat. The scores describe the visible
aspects of this comparison and do not constitute a full experience review.

**One follow-up to test:** Replace the single low chevron with two open corner
ticks flanking the projected player silhouette. Use a pale stroke with a dark
keyline, a tight clear gap, and no tinted fill. This should localize the pilot
without obscuring aircraft markings or resembling the round gold aim pipper.
Compare native and fallback stress at glance speed, then check that the ticks
stay close through banking without covering the model.
