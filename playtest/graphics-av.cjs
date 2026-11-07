#!/usr/bin/env node
// Continuous, real-RAF gameplay review. Capture overhead makes this unsuitable for benchmarking.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const sourceHash = require('./graphics/source-hash.cjs');

const root = path.resolve(__dirname, '..');
const out = path.resolve(process.env.GRAPHICS_AV_OUT || path.join(__dirname, 'shots/graphics-av'));
const profile = process.env.GRAPHICS_AV_PROFILE || 'phone';
const quality = { phone: 2, fallback: 4 }[profile];
const audioMode = process.env.GRAPHICS_AV_AUDIO || 'opus';
const durationSeconds = 6;
const width = 852;
const height = 393;
const seed = 1942;
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });

// This hook exists only in the capture page. Tee nodes connected to the game's
// own speakers to a MediaStream, without replacing the original connection.
function pcmWorklet() {
  class GameplayPcm extends AudioWorkletProcessor {
    constructor() {
      super();
      // Six seconds are requested. Allow room for the stop message under load.
      this.samples = new Float32Array(2 * sampleRate * 10);
      this.startFrame = null;
      this.nextFrame = null;
      this.firstFrame = null;
      this.missingFrames = 0;
      this.maxFrameGap = 0;
      this.quantumCount = 0;
      this.overflow = false;
      this.port.onmessage = ({ data }) => {
        if (data.startFrame !== undefined) this.startFrame = data.startFrame;
        if (data.stop) {
          const frames = Math.min(this.samples.length / 2, Math.max(0, (this.nextFrame ?? this.startFrame) - this.startFrame));
          const samples = this.samples.buffer;
          this.port.postMessage({
            samples, frames, firstFrame: this.firstFrame, quantumCount: this.quantumCount,
            missingFrames: this.missingFrames, maxFrameGap: this.maxFrameGap, overflow: this.overflow,
          }, [samples]);
          this.startFrame = null;
        }
      };
    }
    process([input], [output]) {
      if (this.startFrame === null || currentFrame < this.startFrame) return true;
      const count = output[0].length;
      const gap = Math.max(0, currentFrame - (this.nextFrame ?? this.startFrame));
      this.firstFrame ??= currentFrame;
      this.missingFrames += gap;
      this.maxFrameGap = Math.max(this.maxFrameGap, gap);
      this.nextFrame = currentFrame + count;
      this.quantumCount++;
      const offset = (currentFrame - this.startFrame) * 2;
      if (offset + count * 2 > this.samples.length) {
        this.overflow = true;
        return true;
      }
      if (input.length) {
        const [left, right = left] = input;
        for (let i = 0; i < count; i++) {
          this.samples[offset + 2 * i] = left[i];
          this.samples[offset + 2 * i + 1] = right[i];
        }
      }
      // Leave output silent. The game still has its normal speaker connection.
      return true;
    }
  }
  registerProcessor('gameplay-pcm', GameplayPcm);
}

function installAudioCapture({ mode, workletSource }) {
  let context;
  let tap;
  let recorder;
  let stopped;
  let routedNodes = 0;
  const NativeContext = window.AudioContext;
  const nativeConnect = AudioNode.prototype.connect;
  window.AudioContext = class extends NativeContext {
    constructor(...args) {
      super(...args);
      context = this;
    }
  };
  AudioNode.prototype.connect = function (...args) {
    const result = nativeConnect.apply(this, args);
    if (tap && this.context === context && args[0] === context.destination) {
      nativeConnect.call(this, tap, args[1] ?? 0, 0);
      routedNodes++;
    }
    return result;
  };
  window.__graphicsAvAudio = {
    async start() {
      if (!context) throw Error('The game did not initialize WebAudio');
      await context.resume();
      if (context.state !== 'running') throw Error('The game audio context did not start');
      if (mode === 'pcm') {
        const module = URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }));
        try { await context.audioWorklet.addModule(module); }
        finally { URL.revokeObjectURL(module); }
        tap = new AudioWorkletNode(context, 'gameplay-pcm', {
          channelCount: 2, channelCountMode: 'explicit', outputChannelCount: [2],
        });
        nativeConnect.call(tap, context.destination);
        stopped = new Promise((resolve, reject) => {
          tap.port.onmessage = ({ data }) => resolve(data);
          tap.onprocessorerror = () => reject(Error('AudioWorklet PCM processor failed'));
        });
        stopped.catch(() => {}); // Surface early failures when stop awaits the recording.
        const epochSeconds = (performance.timeOrigin + performance.now()) / 1000;
        const startFrame = Math.round(context.currentTime * context.sampleRate);
        tap.port.postMessage({ startFrame });
        return { epochSeconds, sampleRate: context.sampleRate, startFrame };
      }
      tap = context.createMediaStreamDestination();
      const chunks = [];
      recorder = new MediaRecorder(tap.stream, { mimeType: 'audio/webm;codecs=opus' });
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      stopped = new Promise((resolve, reject) => {
        recorder.onerror = event => reject(event.error);
        recorder.onstop = () => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error);
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.readAsDataURL(new Blob(chunks, { type: recorder.mimeType }));
        };
      });
      const epochSeconds = (performance.timeOrigin + performance.now()) / 1000;
      recorder.start();
      return { epochSeconds, sampleRate: context.sampleRate };
    },
    async stop() {
      if (mode === 'pcm') {
        const stopFrame = Math.round(context.currentTime * context.sampleRate);
        tap.port.postMessage({ stop: true });
        let timeout;
        const expired = new Promise((_, reject) => {
          timeout = setTimeout(() => reject(Error('AudioWorklet PCM stop timed out')), 5000);
        });
        const { samples, ...timing } = await Promise.race([stopped, expired]).finally(() => {
          clearTimeout(timeout);
          tap.disconnect();
        });
        if (timing.overflow || !timing.frames) throw Error('AudioWorklet PCM buffer overflowed or was empty');
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error);
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.readAsDataURL(new Blob([new Float32Array(samples, 0, timing.frames * 2)]));
        });
        return { data, routedNodes, timing: { ...timing, stopFrame } };
      }
      recorder.stop();
      return { data: await stopped, routedNodes };
    },
  };
}

async function capture() {
  if (!quality) throw Error('GRAPHICS_AV_PROFILE must be phone or fallback');
  if (!['opus', 'pcm'].includes(audioMode)) throw Error('GRAPHICS_AV_AUDIO must be opus or pcm');
  fs.mkdirSync(out, { recursive: true });
  const temp = fs.mkdtempSync(path.join(out, 'mux-'));
  const report = {
    protocol: 'graphics-av-v1-compositor-webaudio-real-raf',
    sourceHash: sourceHash(root),
    suiteHash: sha(__filename),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    seed, profile, quality, width, height, dpr: 1, durationSeconds, errors: [],
    fixture: 'Live carrier encounter with three seeded-position veteran raiders, held fire, a turn, two scripted real game impact events.',
    limitations: 'Real RAF deltas and audio noise vary across runs. CDP compositor frames can drop under load. Audio sync uses a common host epoch and is approximate. Capture overhead is not benchmark evidence.',
  };
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html');
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    const mime = { '.html': 'text/html', '.js': 'text/javascript' };
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
    });
    report.browser = browser.version();
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await page.addInitScript(installAudioCapture, { mode: audioMode, workletSource: `(${pcmWorklet.toString()})();` });
    page.on('pageerror', error => report.errors.push(String(error)));
    page.on('console', message => {
      if (message.type() === 'error' && /WebGL|shader|GL_INVALID|GL_OUT_OF_MEMORY|GL_CONTEXT_LOST/i.test(message.text())) {
        report.errors.push(message.text());
      }
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/?quality=${quality}`);
    await page.waitForFunction(() => window.__game?.rendering?.ready);
    await page.evaluate(value => window.__game.setSeed(value), seed);
    await page.locator('#menu-start').tap();
    await page.evaluate(() => {
      const { game, CONFIG, manualFrames } = window.__game;
      if (manualFrames || game.mode !== 'play') throw Error('The live game loop did not start');
      const carrier = game.ships[0];
      carrier.active = true;
      Object.assign(game.player, {
        x: carrier.x - 200, y: carrier.y + 120, a: -.4, flight: 'flying',
        altitude: CONFIG.render.flightHeight, aircraft: 'corsair', hp: 35,
      });
      game.cam = { x: carrier.x, y: carrier.y };
      game.messageTime = 0;
      for (const [i, offset] of [[130, -30], [195, 70], [40, -155]].entries()) {
        game.enemies.push({
          x: game.player.x + offset[0], y: game.player.y + offset[1],
          a: Math.atan2(-offset[1], -offset[0]), hp: CONFIG.enemy.hp,
          speed: CONFIG.airWar.raidSpeed, turn: CONFIG.enemy.turn,
          raider: true, ace: false, style: 'veteran', fireCd: .9 + .3 * i, wobble: i * 1.25,
        });
      }
    });
    await page.waitForFunction(() => {
      const { game, graphics, view } = window.__game;
      return game.time > .25 && graphics.world.isReady(game, view) && document.getElementById('loading').hidden;
    });
    const cdp = await page.context().newCDPSession(page);
    const frames = [];
    let markReady;
    const firstCompositorFrame = new Promise(resolve => { markReady = resolve; });
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      if (Number.isFinite(metadata.timestamp)) {
        frames.push({ timestamp: metadata.timestamp, data });
        markReady();
      }
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
    const firstFrameTimer = setTimeout(markReady, 5000);
    await firstCompositorFrame;
    clearTimeout(firstFrameTimer);
    if (!frames.length) throw Error('Compositor screencast did not start');
    const result = await page.evaluate(async seconds => {
      const { game, fireTouch, keys, graphics } = window.__game;
      const { damagePlayer } = await import('/src/player.js');
      const { explosion } = await import('/src/particles.js');
      const audio = await window.__graphicsAvAudio.start();
      const startGameTime = game.time;
      const startWall = performance.now();
      const events = [];
      const samples = [];
      let nextSample = 0;
      await new Promise(resolve => {
        function observe(now) {
          const elapsed = game.time - startGameTime;
          fireTouch.active = elapsed >= .2 && elapsed < 3.8;
          keys.ArrowRight = elapsed >= .55 && elapsed < 2;
          if (elapsed >= .65 && events.length === 0) {
            damagePlayer(8);
            explosion(game.player.x + 55, game.player.y - 25, false);
            events.push({ event: 'game damage feedback and small explosion', elapsed, epochSeconds: (performance.timeOrigin + now) / 1000 });
          }
          if (elapsed >= 1.7 && events.length === 1) {
            explosion(game.player.x + 70, game.player.y - 20, true);
            events.push({ event: 'game large explosion', elapsed, epochSeconds: (performance.timeOrigin + now) / 1000 });
          }
          if (elapsed >= nextSample) {
            samples.push({
              elapsed, hp: game.player.hp, particles: game.particles.length, enemies: game.enemies.length,
              camera: { ...game.cam },
            });
            nextSample += .25;
          }
          if (now - startWall < seconds * 1000) requestAnimationFrame(observe);
          else resolve();
        }
        requestAnimationFrame(observe);
      });
      fireTouch.active = false;
      keys.ArrowRight = false;
      const endEpochSeconds = (performance.timeOrigin + performance.now()) / 1000;
      const recordedAudio = await window.__graphicsAvAudio.stop();
      return {
        audio, endEpochSeconds, events, samples, elapsedGameSeconds: game.time - startGameTime,
        actualPixelRatio: graphics.diagnostics.pixelRatio,
        audioData: recordedAudio.data, pcmTiming: recordedAudio.timing, routedAudioNodes: recordedAudio.routedNodes,
      };
    }, durationSeconds);
    await cdp.send('Page.stopScreencast');
    const { audioData, ...timeline } = result;
    report.timeline = timeline;
    if (timeline.events.length !== 2 || !timeline.routedAudioNodes) throw Error('Live RAF fixture did not reach both impact events and real audio');
    const inRange = frames.filter(frame => frame.timestamp >= result.audio.epochSeconds && frame.timestamp <= result.endEpochSeconds);
    const ordered = inRange.sort((a, b) => a.timestamp - b.timestamp)
      .filter((frame, index, all) => index === 0 || frame.timestamp > all[index - 1].timestamp);
    if (ordered.length < 20) throw Error(`Insufficient compositor frames: ${ordered.length}`);
    const first = ordered[0].timestamp;
    const last = ordered.at(-1).timestamp;
    const audioTrim = first - result.audio.epochSeconds;
    for (const event of timeline.events) event.videoTimeSeconds = event.epochSeconds - first;
    const actualDuration = result.endEpochSeconds - first;
    report.videoTiming = {
      frameCount: ordered.length, audioTrimSeconds: audioTrim, durationSeconds: actualDuration,
      captureTimeSeconds: ordered.map(frame => frame.timestamp - first),
      maximumFrameGapSeconds: Math.max(...ordered.slice(1).map((frame, index) => frame.timestamp - ordered[index].timestamp)),
    };
    const list = ['ffconcat version 1.0'];
    ordered.forEach((frame, index) => {
      const filename = `frame-${String(index).padStart(4, '0')}.jpg`;
      fs.writeFileSync(path.join(temp, filename), Buffer.from(frame.data, 'base64'));
      const end = ordered[index + 1]?.timestamp ?? result.endEpochSeconds;
      list.push(`file ${filename}`, 'option framerate 1000', `duration ${Math.max(.001, end - frame.timestamp).toFixed(6)}`);
    });
    list.push(`file frame-${String(ordered.length - 1).padStart(4, '0')}.jpg`, 'option framerate 1000');
    const concat = path.join(temp, 'frames.ffconcat');
    const audioFile = path.join(temp, audioMode === 'pcm' ? 'game.f32le' : 'game.webm');
    fs.writeFileSync(concat, list.join('\n') + '\n');
    fs.writeFileSync(audioFile, Buffer.from(audioData, 'base64'));
    let audioInput = [];
    let audioFilter = 'aresample=48000:async=1:min_hard_comp=0.001:first_pts=0,apad';
    if (audioMode === 'pcm') {
      const { sampleRate, startFrame } = timeline.audio;
      const { frames, stopFrame, firstFrame, quantumCount, missingFrames, maxFrameGap } = timeline.pcmTiming;
      if (fs.statSync(audioFile).size !== frames * 2 * 4) throw Error('Wrong PCM byte count');
      audioInput = ['-f', 'f32le', '-ar', String(sampleRate), '-ac', '2'];
      audioFilter = 'aresample=48000,apad';
      const renderedSeconds = frames / sampleRate;
      const hostSeconds = result.endEpochSeconds - timeline.audio.epochSeconds;
      report.audioTiming = {
        mode: audioMode, quantumCount, renderedSeconds, hostSeconds,
        missingSeconds: missingFrames / sampleRate,
        maxQuantumGapSeconds: maxFrameGap / sampleRate,
        startDelaySeconds: (firstFrame - startFrame) / sampleRate,
        clockDriftSeconds: (stopFrame - startFrame) / sampleRate - hostSeconds,
        trailingPaddingSeconds: Math.max(0, hostSeconds - renderedSeconds),
        gapPolicy: 'Keep missing WebAudio render quanta silent without collapsing the audio clock.',
      };
    } else {
      const inputAudio = JSON.parse(execFileSync('ffprobe', [
        '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'packet=pts_time', '-of', 'json', audioFile,
      ]));
      const audioTimestamps = inputAudio.packets.map(packet => Number(packet.pts_time)).filter(Number.isFinite);
      const audioGaps = audioTimestamps.slice(1).map((stamp, index) => stamp - audioTimestamps[index]);
      report.audioTiming = {
        mode: audioMode,
        packets: audioTimestamps.length,
        maxPacketGapSeconds: Math.max(0, ...audioGaps),
        gapsOver60Ms: audioGaps.filter(gap => gap > .06).length,
        gapPolicy: 'Preserve elapsed time by filling omitted recorder samples with silence.',
      };
    }
    const videoFile = path.join(out, 'gameplay.mp4');
    const wavFile = path.join(out, 'gameplay-audio.wav');
    ffmpeg('-y', '-f', 'concat', '-safe', '0', '-i', concat, '-ss', audioTrim.toFixed(6), ...audioInput, '-i', audioFile,
      '-map', '0:v:0', '-map', '1:a:0', '-vf', 'fps=60,pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:black',
      '-af', audioFilter, '-t', actualDuration.toFixed(6), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast',
      '-crf', '18', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', videoFile);
    ffmpeg('-y', '-i', videoFile, '-vn', '-ac', '1', '-ar', '16000', wavFile);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', videoFile]));
    const wav = fs.readFileSync(wavFile);
    let peak = 0, sampleCount = 0;
    for (let offset = 12; offset + 8 <= wav.length;) {
      const bytes = wav.readUInt32LE(offset + 4);
      const start = offset + 8;
      if (wav.toString('ascii', offset, offset + 4) === 'data') {
        for (let sample = start; sample + 1 < Math.min(wav.length, start + bytes); sample += 2) {
          peak = Math.max(peak, Math.abs(wav.readInt16LE(sample)));
          sampleCount++;
        }
        break;
      }
      offset = start + bytes + (bytes % 2);
    }
    if (peak < 256) throw Error(`Game audio is silent or too quiet (PCM peak ${peak})`);
    report.audioTiming.decodedSeconds = sampleCount / 16000;
    if (Math.abs(report.audioTiming.decodedSeconds - actualDuration) > .08) {
      throw Error('Decoded audio duration differs from video by more than 80 ms');
    }
    report.audioPeakDbFS = 20 * Math.log10(peak / 32768);
    report.artifacts = [videoFile, wavFile].map(file => ({ file: path.basename(file), bytes: fs.statSync(file).size, sha256: sha(file) }));
    report.streams = probe.streams.map(({ codec_name, codec_type, width, height, sample_rate, duration }) => ({ codec_name, codec_type, width, height, sample_rate, duration }));
    report.videoTiming.lastCompositorFrameSeconds = last - first;
  } catch (error) {
    report.errors.push(String(error));
    if (error.stderr) report.errors.push(String(error.stderr).slice(-4000));
    throw error;
  } finally {
    await browser?.close();
    server.close();
    report.sourceHashAfter = sourceHash(root);
    if (report.sourceHashAfter !== report.sourceHash) report.errors.push('Runtime changed during capture');
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    fs.rmSync(temp, { recursive: true, force: true });
  }
  if (report.errors.length) throw Error(report.errors.join('\n'));
  console.log(`${report.videoTiming.frameCount} live compositor frames, audio peak ${report.audioPeakDbFS.toFixed(1)} dBFS, ${out}`);
}

capture().catch(error => { console.error(error); process.exitCode = 1; });
