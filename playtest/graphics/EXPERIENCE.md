# HUD, video and sound review

Run these checks alongside the three blind still reviews and the existing sampled
motion and performance gates. Record each lane separately so an attractive still
cannot compensate for an unclear control, an animation fault or a bad mix.

## HUD and controls

Assign a dedicated UI/UX reviewer who did not implement the change. Start with
a first sortie on a landscape phone, then test a narrow landscape and portrait
layout, a crowded fight, an objective arrival, and recovery or rearming. Check
whether the player can identify their aircraft, choose where to go, steer and
fire with two thumbs, read health and weapon state, and understand the next
action. Check touch targets, focus, text contrast, clipping, overlap, and cues
that rely on color alone.

Rate each 1–10 in this order: task clarity, information hierarchy, control
ergonomics, and accessibility. Record the screen or timestamp for each finding,
including the meaning of each unexplained marker. Reject an obscured critical
control, misleading status, or loss of player identification in combat. Check
the same tasks before and after a HUD change.

## Continuous motion

Capture playable footage of both fixed phone profiles using the normal render
loop, with camera movement, banking, an overflight of a coast or carrier,
weapon fire, an impact and fading effects. Show the whole HUD. Record the
scenario, inputs, viewport, quality, source hash, capture settings and media
hash. Keep the existing fixed-tick motion evidence for repeatable comparisons.

Watch the clip at normal speed and replay a suspect interval. Rate each 1–10
in this order: tracking stability, spatial attachment, effect timing, and
temporal clarity. Look for a detached shadow or marker during banking, flicker,
popping, wakes that move away from the stern, abrupt changes in smoke, and HUD
labels that cross protected controls. Give timestamps. A frame strip can locate
a problem, but approval requires continuous playback. Capture cadence is not a
device frame-rate measurement.

## Sound

Use the actual game mix synchronized to the same clips. Include takeoff or
engine idle, a turn, short and sustained firing, incoming fire or damage, an
explosion, and a quieter navigation interval. Check the same sequence on phone
speaker and headphones when available. Preserve the original recording level
for comparisons and document the listening device or playback path.

Rate each 1–10 in this order: character and fit, cue distinction, mix and
fatigue, and synchronization. Listen for an engine masking weapon cues,
repeated tones, clicks, clipping, and feedback that makes danger or a hit
ambiguous. Record timestamps and playback conditions. A waveform, spectrogram,
or code audit may support a finding. They cannot substitute for listening.

## Acceptance evidence

Add a top-level `experience` object to `reviews.json`. Its `sourceHash` must
match the reviewed runtime. `clips` contains one continuous recording each for
`phone` and `fallback`, with `profile`, an `evidence/`-relative `file` path from this
directory, and `sha256`. Each clip must contain actual gameplay picture and mix.
Store capture settings and event timings alongside it.

Add `hud`, `video` and `audio` records with `judge`, `method`, `accept`,
four `scores` in the orders above, and nonempty `findings`. Required method
values are `task-review`, `continuous-playback` and `listened`. Include which
builds and playback conditions the reviewer used in findings. When the evaluator
cannot watch or hear the source media, leave that lane pending. A reviewer may
be human. CI checks the evidence and verdicts without impersonating a reviewer.

## Continuous gameplay clip

Run `npm run graphics:av` with Playwright Chromium, `ffmpeg` and `ffprobe`
available. Set `GRAPHICS_AV_PROFILE=fallback` for quality 4. The default
is the native phone profile at quality 2. `GRAPHICS_AV_OUT` chooses the
output directory. `PLAYWRIGHT_EXECUTABLE_PATH` selects an optional Chromium
executable, which must support CDP screencast and WebAudio.

The helper starts a fresh seeded campaign, positions a player and three raiders
near the first carrier, then drives a short live encounter using the normal RAF
loop. Gunfire, hit feedback and explosions use game code and its actual WebAudio
outputs. CDP captures the composited tab, including the HTML HUD. The helper
records the game's sound mix through a capture-only WebAudio tap and muxes it with
compositor timestamps. `gameplay.mp4` contains H.264 video and AAC audio. The
one-pixel bottom pad satisfies the encoder without cropping gameplay. A mono
PCM WAV exposes the recorded mix for separate review. The JSON records both
artifact hashes, runtime and helper hashes, input events, frame timestamps,
maximum capture gap and non-silent decoded audio peak.

Live frame deltas, AI outcomes, compositor cadence and procedural audio noise
can differ across machines and runs. The shared host clock aligns streams
approximately. The encoded 60 FPS presentation holds the previous capture
through dropped compositor frames. Frame counts and gaps describe this recorder,
so use them only to judge evidence quality. Capture and audio instrumentation
add overhead. This clip supplements the unchanged fixed still/motion gates
and physical-device validation. Play the MP4 with sound for complete review.

The current combat fixture does not cover every listening scenario above. Record additional scenarios before approving the sound review.
