# Backlog

Ideas and known issues, roughly ordered. Move items to "Done" with
the commit that shipped them.

## Known gameplay issues (from playtesting)

- Conquest balance is first-pass: raid cadence, garrison stock, AA
  damage, and ammo pool all need tuning against real playthroughs.
  Watch whether landing to rearm feels like a beat or a chore.
- The deck-landing tolerances (speed/angle) are untested on real
  touch devices; the virtual stick may need a landing assist.

## Feature ideas

- **Enemy variety:** bombers (slow, tough, straight lines, worth
  more) as the raid backbone with fighter escorts; floatplanes that
  turn lazily.
- **Sea targets:** enemy ships between islands to strafe;
  torpedo-run bonus objectives; an enemy carrier as the tier-5
  final objective.
- **Moving carrier:** your carrier steams slowly north as you take
  islands, shortening the supply line — landing on a moving deck.
- **Friendly island defenses:** captured islands rebuild a weak AA
  gun so raids bleed a little without you babysitting.
- **Power-ups:** repair, spread guns, brief overdrive — dropped by
  aces, risk/reward to fly through the wreckage.
- **Persistence:** localStorage for best score/best time; daily-seed
  mode so everyone fights the same campaign.
- **Feel:** prop sound loop pitched by throttle; deck-crew sprites
  during rearm; catapult steam on launch; water splash rings when
  bullets miss low.
- **Mobile polish:** real-device touch testing, haptics on hit
  (navigator.vibrate), safe-area insets for notched phones.

## Done

- Conquest mode: take off and land on a friendly carrier (repair +
  rearm), limited ammo, four capturable islands with AA/HQ
  defenses, garrisons, recapture raids, hunter patrols, and a win
  state when the whole front line is yours. Death still ends the
  run. (Replaces the endless wave loop and the between-wave heal.)
- Gun heat: holding fire ~4 s overheats the guns (1.5 s lockout,
  amber HUD gauge, steam hiss + cowling smoke). Rewards trigger
  discipline instead of pinning the space bar.
- v0.1: first playable (single file).
- v0.2: ES-module refactor, config.js tuning table, seeded RNG,
  playtest harness + CI, docs.
