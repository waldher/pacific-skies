// Module worker: synthesises sound buffers off the main thread, one job at a
// time. audio.js falls back to idle slices on the main thread where module
// workers are unavailable.
import { buildCue, exhaustLoop, propLoop, windLoop, buffetLoop, rattleLoop } from './audio-synth.js';

const MAKE = { cue: buildCue, exhaust: exhaustLoop, prop: propLoop, wind: windLoop, buffet: buffetLoop, rattle: rattleLoop };
self.onmessage = event => {
  const data = MAKE[event.data.kind](...event.data.args);
  self.postMessage(data, [data.buffer]);
};
