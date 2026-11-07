# Game audio capture experiment

The capture-only patch adds `GRAPHICS_AV_AUDIO=pcm`. It tees the same WebAudio
speaker connections to an AudioWorklet, keeps the game's speaker path intact,
and buffers up to ten seconds of interleaved stereo float samples. Missing
render quanta remain silent on the audio clock. The review MP4 still encodes
AAC and its companion WAV is a mono decode of that track. The internal capture
method changes, not the gameplay source or the mix.

Four separate six-second live encounter runs use identical gun-pressure source
`b7a317d81004` and recorder suite `437fbc3e7141`. Artifact and source hashes match
the full hashes in each report. Both logged impact events and non-silent audio
are present in every run.

| Profile | Opus maximum packet gap | PCM maximum render gap | PCM audio clock drift | PCM maximum video frame gap |
| --- | ---: | ---: | ---: | ---: |
| Phone | 751 ms | 0 ms | +11.6 ms | 611 ms |
| Fallback | 749 ms | 11.6 ms at startup | +12.9 ms | 644 ms |

Fallback PCM had no internal missing quanta. Gap measurements apply to
different stages. Opus reports packet timestamp spacing, while PCM reports
missing render frames. The data points to loss or timing in the MediaRecorder
capture path in these tests. It does not isolate the encoder from the stream
scheduler or establish perfect playback timing.

The PCM runs retained roughly −33 dBFS RMS around the logged small-impact cue
and −27 dBFS around the large cue. Opus measured roughly −44 to −45 dBFS and
−34 to −35 dBFS in the corresponding windows. The windows include the rest of
the live mix and separate runs vary. These are signal checks and not a listening
verdict. Video compositor gaps still limit continuous visual review.

Verified captures are under `resumed-graphics/gun-av-ab-` with suffixes
`pcm-phone-repeat`, `pcm-fallback`, `opus-phone`, and `opus-fallback`. The first
native PCM run reported zero missing quanta but its MP4 failed a subsequent
hash check. Its directory is retained separately and excluded from the table.
