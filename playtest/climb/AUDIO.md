# Audio climb log

Nobody who worked on this could hear it. Every claim below is either reasoning
from how the real thing sounds or a number measured from an offline render.
The last section lists what only ears can settle.

    PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=/opt/node22/lib/node_modules \
      node playtest/climb/audio-render.cjs          # main, theirs, mine → playtest/shots/climb/audio/
    AUDIO_SOURCES=mine AUDIO_CLIPS=1 node playtest/climb/audio-render.cjs
    node playtest/climb/audio-score.cjs [dir]       # re-score existing reports

## How it is built

- `src/audio-synth.js` — pure DSP, no AudioContext: every one-shot bank and
  loop as a `Float32Array`, from a private seeded PRNG. Same seed, same samples.
- `src/audio-worker.js` — runs that synthesis in a module worker so the main
  thread never stalls; `audio.js` falls back to one buffer per idle slice.
- `src/audio.js` — bus, voices, engine, per-frame state reading, the `sfx*`
  functions the game calls. `createAudio(ctx)` takes any context, which is how
  the harness renders it offline.
- `CONFIG.audio` — every gain, cap, pitch range and cue routing.

Bus: nine categories → (engine, wind and other aircraft pass through a ducker
that guns, damage and big explosions push down) → sum → compressor used as a
limiter → tanh ceiling at 0.97 (so samples cannot reach full scale) → output.
Each category has a send into one generated 0.9 s impulse response (a few
surface reflections and a short dark tail). World events are attenuated by
1/(1+(d/700)²), culled past 2800 units, low-passed with distance and panned
from screen x. Voices are capped per category; guns and hits steal the oldest.

## Design rationale

| Sound | The real thing | Layers standing in for it |
|---|---|---|
| Engine | A radial fires each cylinder once per two crank turns; uneven exhaust collection puts lumpy half-orders under the firing note, and the geared propeller adds blade-pass harmonics that dominate at power. Everything scales with rpm. | `exhaustLoop`: one damped pulse per cylinder per cycle, each cylinder with its own strength, timing and pipe resonance, gas hiss riding the pulses. `propLoop`: 14 blade-pass harmonics plus blade-modulated tearing noise. Both loop exactly and are played with `playbackRate` = rpm, so every order moves together; a fixed low-pass and body peak stay put like a cowling. Layouts: 18/14/9-cylinder radials, V-12s (even firing, smoother), the P-38 as two sets 1.5 % apart so they beat. |
| Throttle, turn, ground | rpm and manifold pressure follow the lever; airspeed follows later. | rpm maps airspeed brake→boost (0.78→1.08), leads on acceleration, sags 3 % under turn load; exhaust/prop gains and the low-pass open with power. Landed: 0.42. Takeoff: straight to 1.12. |
| Wind, buffet | Slipstream noise grows roughly with speed squared; a hard turn shakes the airframe at low frequency. | Noise loop through a low-pass that opens with speed, gain ∝ speed²; a second loop of irregular 40–200 Hz thumps, gain ∝ turn load². |
| Low hull | A hurt engine drops cylinders and things come loose. | Crossfade to a loop with 30 % misfires and occasional backfires, plus a loop of small metallic chatter. No beeper. |
| Other aircraft | You hear the pass, with a Doppler drop. | Three shared looping voices on the nearest aircraft: level from distance and *relative speed*, pitch from closure (exaggerated: sound at 1500 units/s), panned. |
| Own guns | Six M2s at about 13 rounds/s each, never in step: a roar with a throb, not a tick per frame. Each round is a supersonic crack, a muzzle blast and the bolt cycling. | Each trigger pull plays a slice covering one fire interval: three gun pairs at 12.7/13.5/14.3 rounds/s with random phase, each report = crack (band-passed noise, 3 ms) + body (240→105 Hz and 520 Hz noise, 18 ms) + bolt (three high modes 27 ms later), over a little wing drumming. Slices tile at the fire cadence; six variations, never the same twice running. Dauntless and Avenger use a two-gun slice. Low-passed at 4.6 kHz to leave the top to hits. |
| Tail on release | The report rolls away over water. | `gunTail` 1.7 fire intervals after the last pull (judged on the game's own fire timer): last bolt, a 150 ms dark decay, a slap-back, faint brass. |
| Overheat / recovery | Guns stop mechanically; hot barrels hiss. | Bolt-stop clunk, fluttering 3–9 kHz hiss with metal ticks; recovery is a two-stage charging-handle clack. |
| Hit dealt | A round through aluminium: a bright tick. | Click plus four sheet-metal modes from 4.3 kHz, 85 ms, eight tunings. Sits above the guns' crack. |
| Hit on a hull | Steel is duller. | Modes from 720 Hz, sometimes a ricochet whine. |
| Hit taken | Felt through your own airframe. | Two knocks 40–60 ms apart (in one side, out the other) at 150–450 Hz, the seat armour ringing near 1.1 kHz, loose-structure modes; saturated; ducks the bed to 35 %. |
| Enemy guns | Rifle-calibre cowl guns across open air: thin and fast. | Four 1.9 kHz noise ticks at 17/s and their echo, low-passed, attenuated and panned by position. |
| Near miss | No report, only torn air falling in pitch. | Band-pass sweep 3.8 kHz→700 Hz over 200–300 ms, when an enemy round passes within 70 units. |
| Ship / emplacement gun | Slow and deep, rolling across water. | 115→44 Hz thump, mid knock, long low tail. |
| Aircraft destroyed | Fuel goes up, then pieces. | Crack, a 480 Hz whump, fluttering fire, eight scattered metal pings. About 1 s. |
| Big explosion | Chest thump, crack, long rumble. | 70→27 Hz and 150→62 Hz tones (the second is what a small speaker can carry), crack and 1.4 kHz body, 2.4 s rumble. Tails added by cause: falling earth (land), plating modes (ship). |
| Bomb in the sea | Detonation under water: no crack, a column of water that hangs and collapses. | Muffled thump plus a hiss that swells at 0.35 s and decays over 2 s. |
| Bomb release / fall | Shackle clunk. The whistle is film convention, not cockpit reality. | Clunk, then a quiet tone and narrow noise falling 2.5→1.2 kHz, time-scaled to the aircraft's fall time. |
| Torpedo | Splash, then contra-rotating screws receding. Hit: muffled detonation, the hull ringing, a plume. | Clunk, splash, two beating ~300 Hz tones with 24 Hz bubbling fading over 2.6 s; hit = sub thump + four long hull modes + plume. |
| Ship sinking | Steam and groaning steel. | Fluttering hiss, a gliding 92→54 Hz groan with harmonics, clanks. |
| Deck landing | Wheels on planks, the hook taking a wire. | Thump and knock, a band-pass screech falling 3.3 kHz→850 Hz as the cable pays out, the hook dropping the wire. Strip landing: two rubber chirps and roll-out rumble. |
| Takeoff | Chocks away, wheels drumming faster until they lift. | Clunk, knocks whose spacing shrinks from 160 to 28 ms, rumble fading at 1.9 s; the engine does the rest. |
| Capture / objective / loss / victory | A ship's bell. | Nine inharmonic partials over a hum note with a clapper click: two strikes at 640 Hz (capture), one at 852 Hz (objective), two slow at 322 Hz (loss), eight bells (victory). |
| Radio message | Squelch opening on static. | 130–180 ms band-limited noise between two clicks, on every `notify`. |
| Raid warning | Hand-cranked two-rotor siren. | Two harmonic tones a minor third apart winding 210→540 Hz and running down, when a detected strike first appears. |
| UI | A cockpit toggle. | Click and two short modes, 30 ms. |
| Shot down | Engine over-revving in the dive. | Rising harmonic tone with dying-cylinder thumps under the game's own explosion. |

## What the harness measures

`audio-render.cjs` drives a fixed 45 s sortie and a sheet of 36 isolated game
events through each source by calling its exported functions on an
`OfflineAudioContext`. Reports hold: sample peak and clipped count, EBU R128
loudness and range (ffmpeg), crest, five-band energy shares, centroid,
flatness, onset delay, rise and decay per cue, waveform and picture
correlation between consecutive gunshots, pairwise fingerprint distance
(24-band shape + centroid + 9-bin time profile + length), masking margins
over the un-ducked engine bed and over the player's own gunfire, engine
tracking, flyby/formation/damage levels. `audio-score.cjs` turns them into
57 checks; thresholds and reasons are printed at the foot of `scorecard.md`.

Known weaknesses of the instrument, so nobody over-reads it:

- I wrote the scorecard and tuned my sound against it. It was calibrated on
  v1 (four measurement fixes before the baseline, three checks added later,
  each noted below). Main and theirs fail most checks because 29 of 36
  events are silent there, not because their two sounds are bad.
- "A burst is a battery" counts onsets in a differenced signal; main's
  square-wave blip scores 60/s on it, which is the waveform's own edges. That
  pass for main is an artefact.
- Main and theirs render about 13 dB quieter (no master gain staging). The
  loudness checks say so; it also means the WAVs must be level-matched by
  hand before comparing character.
- Variation choice shifts with any change to the RNG stream, so distances
  move by about ±0.02 between runs of different code. Checks within that of
  a threshold are coin flips.
- Distance is spectral and envelope shape. It cannot tell a rhythm from a
  single event, which is most of what separates guns from a hit taken.

## Iterations

Score is pass / warn / fail on the scorecard as it stood at that step.

**v1 — first full version.** 38 / 11 / 4. −12.4 LUFS, range 3.6 LU: the engine
bed sat at −15 dBFS and flattened everything. Before taking this baseline
the harness was fixed four ways: non-integer sample indices (NaN engine
centroids), onset counting moved to the differenced signal, "attack"
redefined as rise to 70 % (a burst peaks on a later report), and a time
profile added to the fingerprint.

1. **Bed 12 dB down** (engine 0.5→0.12, wind 0.34→0.09, idle exhaust 0.5→0.3).
   Hypothesis: one loud bed is hiding every other problem. −15.7 LUFS, range
   3.6→14.7, own hits over boost bed 2.2→12.7 dB, idle 4→7 dB under cruise.
   45 / 5 / 3. Kept.
2. **Guns 5 dB down, bed 2.5 dB up.** Held fire was −8.8 LUFS, 17 LU over the
   bed. Burst RMS moved only 1.4 dB: the "limiter" was compressing. Added an
   upper bound (14 LU) to the quiet-stretch check. 45 / 5 / 3. Kept; led to 3.
3. **Limiter as a limiter** (threshold −14→−8 dB, knee 10→6, ratio 12→20).
   Hypothesis: with a low threshold and auto make-up it lifts the bed and
   squashes combat. Bed −2 dB, crest 16.2→17.0, range 11→13.2. 44 / 6 / 3
   (one distance fell across a threshold by 0.02). Kept: bus gains now mean
   what they say.
4. **Guns moved up out of the bass and 4.6 dB down.** 74 % of a burst was
   under 250 Hz: inaudible on a tablet and the same shape as taking a hit.
   Body 185→240 Hz, mid noise re-centred at 520 Hz, wing drumming halved.
   Under 250 Hz 0.74→0.41; above 300 Hz 0.24→0.57; guns vs hit taken
   0.138→0.255; held fire −10.2→−13.4 LUFS. 44 / 7 / 2. Kept.
5. **Armour-plate ring added to the hit taken.** Guns vs hit taken
   0.255→0.265, kill vs hit taken 0.204→0.214: inside the noise. Kept as
   harmless, superseded by 6.
6. **Hit taken rebuilt as a double knock** at 150–450 Hz, no sub, 377 ms.
   Guns vs hit taken 0.313, kill vs hit taken 0.324 (both pass); hit taken
   vs enemy fire fell 0.386→0.270. 45 / 6 / 2. Kept; fixed from the other
   side in 7.
7. **Enemy guns rebuilt**: four ticks at 1.9 kHz, no body tone, an echo.
   Margin over the boost bed 0.9→9.7 dB; hit taken vs enemy fire 0.356.
   47 / 5 / 1. Kept.
8. **Bomb in the sea lost most of its thump and gained plume; the big blast
   gained mid body.** Land vs sea 0.186→0.30; small-speaker share 0.135→0.19.
   *Also tried:* tail layers 30–40 % louder to separate land/ship/player-down
   blasts — the closest pair got closer (0.045→0.032). **That part reverted.**
   49 / 4 / 0.
9. **Near miss lowered and lengthened** (6.2→1.5 kHz in 150 ms became
   3.8 kHz→700 Hz in 250 ms). Near miss vs own hit 0.281→0.379. 50 / 3 / 0. Kept.
10. **Aircraft kill rebuilt as whump, fire and metal** instead of a small
    bomb. Kill vs bomb 0.248→0.414, centroid 482→1493 Hz. 51 / 2 / 0. Kept.
    Alongside: synthesis moved to a module worker (107 s of audio took 1.1 s
    here; the engine loops alone were a 130 ms stall), release detection
    moved to the game's fire timer after a slow headless session played 16
    tails for 19 pulls, victory reuses the capture bank.
11. **Engine spool 0.28→0.15 s.** Response to full throttle stayed 0.80 s: it
    is the airspeed lag itself. **Reverted.**
12. **Throttle lead 0.05→0.12.** 0.80→0.85 s; the centroid moves only 16 %
    between cruise and boost and the measure cannot resolve it. **Reverted.**
13. **Twice the shared space** (wet 0.6→1.2). Own hit 59→156 ms (no longer
    countable at the fire rate), every key distance shrank (hit vs enemy fire
    0.512→0.434), closest pair 0.042→0.033. 48 / 4 / 1. **Reverted.**
14. **Synthesis at 24 kHz instead of 32 kHz.** Burst dips −4.9→−8.4 dB, high
    share 0.20→0.165, closest pair 0.028. 50 / 2 / 1. The reason to try it
    (main-thread cost) had gone with the worker. **Reverted.**
15. **New measurement: cues against the player's own gunfire**, the masker
    that is actually present when hits land. Own hits measured −0.9 dB: under
    the guns' crack. Overheat moved to the cockpit bus (it peaked at −16 dBFS).
    52 / 2 / 1.
16. **Hit tick raised from 2.5 to 4.3 kHz** and its ring lengthened. Over
    gunfire −0.9→+4.8 dB; hit vs enemy fire 0.512→0.647; 85 ms. 52 / 3 / 0. Kept.
17. **Guns low-passed at 4.6 kHz.** Hits over gunfire 4.8→6.8 dB; costs guns
    vs hit taken 0.313→0.266 (warn). Kept: hearing hits while firing matters more.
18. **Louder, longer plate ring on the hit taken** to win that back. Guns vs
    hit taken 0.266→0.236, hit taken vs enemy fire 0.356→0.274, centroid
    628→1066 Hz. 50 / 5 / 0. **Reverted.**
19. **New measurements: a close pass, a wingman in formation, a damaged
    engine.** The wingman raised the bed 5.6 dB for as long as it held
    station. 53 / 4 / 1.
20. **Other aircraft scaled by relative speed.** Formation 5.6→0.1 dB over
    the bed; a crossing enemy still +7.6 dB. 54 / 4 / 0. Kept.
21. **More misfire and rattle at low hull** (0.22→0.30, 0.5→0.8). Level
    unevenness against a healthy engine 1.49×→1.71×. 55 / 3 / 0. Kept.
22. **Exhaust loop high-passed at 48 Hz** after the spectrogram showed steady
    energy under 45 Hz. Cruise sub share 0.131→0.107. No check moved. Kept.

Reverted or discarded: tail-layer gains (8), spool (11), lead (12), wet (13),
24 kHz (14), plate ring (18).

## Result

| | main | theirs | mine |
|---|---|---|---|
| Character and fit (17) | 4 / 0 / 13 | 3 / 1 / 13 | 17 / 0 / 0 |
| Cue distinction (12) | 0 / 0 / 12 | 0 / 1 / 11 | 9 / 3 / 0 |
| Mix and fatigue (18) | 4 / 0 / 13, 1 n/a | 5 / 0 / 12, 1 n/a | 18 / 0 / 0 |
| Synchronisation (10) | 3 / 0 / 7 | 3 / 0 / 7 | 10 / 0 / 0 |
| Coverage (1) | 0 / 0 / 1 | 0 / 0 / 1 | 1 / 0 / 0 |
| **Total pass / warn / fail** | **11 / 0 / 46** | **11 / 2 / 44** | **55 / 3 / 0** |
| Events with a sound | 7 of 36 | 7 of 36 | 36 of 36 |
| Integrated loudness, range | −30.9 LUFS, 14.1 LU | −30.0 LUFS, 16.6 LU | −17.6 LUFS, 10.8 LU |
| Sample peak, clipped samples | −13.2 dBFS, 0 | −12.8 dBFS, 0 | −1.4 dBFS, 0 |
| Quiet leg | silence (−70 LUFS) | silence (−70 LUFS) | −23.2 LUFS, 9.8 LU under held fire |
| Burst energy under 250 Hz | 2 % | 13 % | 44 % |
| Held burst within 12 dB of its median | 64 % of the time | 57 % | 100 % |
| Tail after release | 90 ms | 80 ms | 830 ms |
| Consecutive shots, waveform / picture correlation | 0.95 / 1.00 | 0.31 / 0.97 | 0.33 / 0.92 |
| Call to sound | 0.02 ms | 0.17 ms | 6.0 ms (limiter look-ahead) |

Where theirs is measurably ahead of main: gunshots are not copies of each
other (0.31 against 0.95), guns have six times the low-frequency body, and
explosions are capped and pre-rendered. It still has four kinds of sound.

My three warnings: guns vs hit taken (0.266, the trade in step 17), capture
bell vs raid siren (0.297 against 0.30), and the closest pair overall (0.042:
a bomb on land and the player's own aircraft exploding share one blast buffer
by construction, as do bomb-on-ship and ship-sinking).

## Not verified by listening

Everything about whether it is pleasant. In order of how likely I think it
is to be wrong:

1. **Engine timbre.** The loops are physically motivated but I have only
   seen their spectra: lines at 20 Hz multiples around 150–350 Hz, moving
   with throttle. Whether that reads as a radial or as a buzz, and whether
   the P-38's two-engine beat is a throb or a wobble, needs ears. Listen to
   `mine-engineIdle/Cruise/Boost/BrakeTurn/Hurt.wav`. If it is wrong, the
   knobs are `engine.layouts` (`uneven`, `pipe`), `engine.tone` and `engine.prop`.
2. **Gun roar.** 38 reports/s of layered noise bursts, saturated. It may be
   a convincing battery or a buzzy smear, and the 130 ms slice period may be
   audible as a pulse. `mine-gun.wav` (one pull), `mine-gunSustain.wav` (24).
3. **Hit tick at 4–10 kHz.** Chosen to clear the guns; could be piercing over
   a long burst. `mine-hit.wav`, and 17.6–18.3 s of `mine.wav`.
4. **Bed level.** −27.7 dBFS at cruise, 10 LU under held fire, from a number
   I picked. It may be too quiet on a tablet or too present on headphones.
5. **Hit taken vs own guns**, the pair the metric is least sure about:
   22.5–27 s of `mine.wav` has enemy fire, near misses and three hits taken.
6. **Bells and siren.** Whether the bell reads as a ship's bell rather than
   a chime, and whether the siren is evocative or annoying on its fifth raid.
   `mine-capture.wav`, `mine-objective.wav`, `mine-raid.wav`.
7. **The bomb whistle**, a deliberate film convention, and the radio squelch
   on every message: both could grate.
8. **The space.** One short impulse response at modest level. Doubling it
   measurably smeared the cues; whether the present amount is heard at all,
   I cannot say.
9. **Ducking** (bed to 60 % under guns, 35 % when hit) could pump audibly.
   None of the metrics look at it.
10. **Real devices.** Latency, the worker fallback on old Safari, CPU on a
    cheap Android tablet (about 12 looping sources, a convolver and a
    compressor) and how any of this sounds through a tablet speaker were not
    tested. Headless Chromium on desktop ran a session with zero errors;
    that is all.

A/B: `main.wav`, `theirs.wav`, `mine.wav` are the same 45 s script;
`cues.json` gives the start of each section. Raise main and theirs by about
13 dB first.
