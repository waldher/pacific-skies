# Backlog

Ideas and known issues, roughly ordered. Move items to "Done" with
the commit that shipped them.

## Known gameplay issues (from playtesting)

- Waves 1–3 are nearly risk-free: the +25 hp heal between waves
  almost tops the player off, danger only starts around wave 4, then
  wave 5 spikes hard (bot went 86→0 hp in ~4 s). Consider smoothing
  the curve: smaller heal, or earlier aces, or gentler wave-5 count.
- The "— WAVE N —" banner renders at H*0.22, right where dogfights
  happen; it overlapped an enemy plane in playtests. Move it higher,
  shrink it, or render it under the HUD panel.

## Feature ideas

- **Enemy variety:** bombers (slow, tough, straight lines, worth
  more) with fighter escorts; floatplanes that turn lazily.
- **Ground/sea targets:** ships and island AA guns to strafe between
  waves; torpedo-run bonus objectives.
- **Power-ups:** repair, spread guns, brief overdrive — dropped by
  aces, risk/reward to fly through the wreckage.
- **Carrier:** friendly carrier you can land on between waves to
  repair (replaces the automatic heal with a skill action).
- **Persistence:** localStorage for best score; daily-seed mode so
  everyone fights the same waves.
- **Feel:** prop sound loop pitched by throttle; engine smoke
  trails at full boost; water splash rings when bullets miss low.
- **Mobile polish:** real-device touch testing, haptics on hit
  (navigator.vibrate), safe-area insets for notched phones.

## Done

- v0.1: first playable (single file).
- v0.2: ES-module refactor, config.js tuning table, seeded RNG,
  playtest harness + CI, docs.
