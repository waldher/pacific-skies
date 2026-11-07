# Pacific Skies

Read CLAUDE.md for architecture, model references and required functional tests.
`main` is the live game. Use a draft PR for graphics candidates until evidence passes.

## Graphics hill climb

For every runtime or asset change, follow `playtest/graphics/README.md`.
Use three separate reviewer agents to inspect every screenshot in both phone
profiles, previous incumbent, original baseline and the frozen references.
Reviewers must give evidence, rate the same rubric, and report regressions.
Do not rate images they have not seen. Prefer anonymized randomized A/B packets;
record honestly when review is unblinded and when agents share a model.

Use a dedicated UI/UX judge and record continuous video and listened audio reviews
as specified in `playtest/graphics/EXPERIENCE.md`.

Keep changes only when the visual and performance gates pass. Reject or revise
failed candidates; preserve their evidence. Do not lower thresholds, change
reference crops, hide expensive scenes, or selectively retain fast runs to win.
A reference victory also requires held-out gameplay scenes and real low-end
phone measurements. Software rasterization does not establish device FPS.

The checked-in initial candidate is experimental: read STATUS.md in that
folder for outstanding gates. A passing functional test alone does not approve
its graphics or performance. Do not merge this experiment while gates fail.
