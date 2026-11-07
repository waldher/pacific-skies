# Stock sound audit

Code inspection of the recovered candidate 17 runtime identifies three sound
families. The gun uses a square oscillator that sweeps from roughly 620–700 Hz
to 140 Hz in 60 ms. That pitch sweep is a plausible source of the arcade-like
character. The two explosion sizes use enveloped filtered white noise with
different durations, cutoffs, and gains. There is no continuous engine,
propeller, or wind layer and no distance or direction in this mix.

Both booms allocate fresh noise buffers during playback. Gunfire also draws from
the gameplay random stream after WebAudio unlock. A sound redesign should
separate audio randomness from simulation randomness and check that a fixed
seed and input script produce the same gameplay with sound enabled and disabled.

Try replacing the gun chirp with short mechanical and air-pressure transients
first. Give near hits and larger explosions distinct tails and reserve headroom
for overlapping sounds. Evaluate an engine layer separately so it cannot mask
gun heat, hit feedback, or important cues. Use matched loudness and the actual
game mix on a phone speaker and headphones. Peak, clipping, silence, cadence,
and spectral measurements can identify defects. Audible realism and fatigue
remain pending a listening review.
