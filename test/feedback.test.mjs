import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedbackDetector } from '../src/feedback.js';
import { ClassroomAudio } from '../src/audio.js';

function spectrum(rate, tones = [], floor = -100) {
  const power = new Float64Array(1024).fill(10 ** (floor / 10));
  for (const [frequency, db] of tones) {
    const bin = Math.round(frequency / (rate / 2048));
    // Approximate the main lobe of a windowed sinusoid, including leakage.
    for (const [offset, weight] of [[-2, .0064], [-1, .25], [0, 1], [1, .25], [2, .0064]]) {
      if (bin + offset >= 0 && bin + offset < power.length) power[bin + offset] += 10 ** (db / 10) * weight;
    }
  }
  return Float32Array.from(power, p => 10 * Math.log10(p));
}

test('feedback detector waits for a stable tone and limits correction to two narrow bands', () => {
  for (const rate of [16000, 44100, 48000, 96000]) {
    const detector = new FeedbackDetector(rate), detected = [];
    const input = spectrum(rate, [[1200, -24]]);
    for (let i = 0; i < 8; i++) assert.equal(detector.read(input, i * .08), null, 'cut a short sound');
    for (let i = 8; i < 25; i++) {
      const result = detector.read(input, i * .08);
      if (result !== null) detected.push(result);
    }
    assert.equal(detected.length, 1);
    assert.ok(Math.abs(detected[0] - 1200) <= rate / 2048);
    for (let i = 25; i < 50; i++) {
      const result = detector.read(spectrum(rate, [[2400, -24]]), i * .08);
      if (result !== null) detected.push(result);
    }
    assert.equal(detected.length, 2);
    for (let i = 50; i < 75; i++) assert.equal(detector.read(spectrum(rate, [[3600, -24]]), i * .08), null);
  }
});

test('feedback detector preserves quiet sound, harmonic voice, noise, changing pitches, and interrupted tones', () => {
  const rate = 48000;
  const cases = [
    () => spectrum(rate),
    () => spectrum(rate, [[1200, -60]]),
    () => spectrum(rate, [[300, -22], [600, -25], [900, -29], [1200, -32]]),
    () => spectrum(rate, [], -30),
    i => spectrum(rate, [[600 + (i % 10) * 65, -25]]),
    i => i % 6 === 0 ? spectrum(rate) : spectrum(rate, [[1200, -24]]),
  ];
  for (const makeSpectrum of cases) {
    const detector = new FeedbackDetector(rate);
    for (let i = 0; i < 50; i++) assert.equal(detector.read(makeSpectrum(i), i * .08), null);
  }
  const detector = new FeedbackDetector(rate), tone = spectrum(rate, [[1200, -24]]);
  for (let i = 0; i < 6; i++) assert.equal(detector.read(tone, i * .08), null);
  assert.equal(detector.read(tone, 10), null, 'a suspended page must not count as continuous evidence');
  assert.equal(detector.read(new Float32Array(1024).fill(NaN), 10.08), null);
});

test('a delayed WebRTC track cannot restart playback after switching to relay', async t => {
  const previous = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = class { close() { this.closed = true; } };
  t.after(() => { if (previous === undefined) delete globalThis.RTCPeerConnection; else globalThis.RTCPeerConnection = previous; });
  const engine = new ClassroomAudio('host', () => {}, () => {}, () => {});
  t.after(() => engine.destroy());
  let resume;
  engine.context = () => new Promise(resolve => { resume = resolve; });
  await engine.sync({ grant: 1, mode: 'direct' });
  const peer = engine.pc;
  const receiver = { jitterBufferTarget: null };
  const pending = peer.ontrack({ track: { kind: 'audio' }, receiver, streams: [{}] });
  // Defer only the already-running ontrack callback; let relay startup run.
  engine.context = async () => ({});
  await engine.sync({ grant: 1, mode: 'relay' });
  assert.equal(peer.closed, true);
  assert.equal(peer.ontrack, null);
  resume({});
  await pending;
  assert.equal(engine.remoteAudio, undefined, 'obsolete native playback was resurrected');
  assert.equal(receiver.jitterBufferTarget, 20);
  assert.equal(engine.mode, 'relay');
});

test('relay discards accumulated old audio and keeps normal playback continuous', () => {
  const engine = new ClassroomAudio('host', () => {}, () => {}, () => {});
  engine.grant = 7; engine.mode = 'relay'; engine.gain = {};
  const scheduled = [];
  engine.ctx = {
    currentTime: 1,
    createBuffer(channels, length, rate) { return { duration: length / rate, getChannelData: () => new Float32Array(length) }; },
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, stop() { this.stopped = true; }, start(time) { this.startTime = time; } };
      scheduled.push(source); return source;
    },
  };
  const frame = new ArrayBuffer(8 + 960 * 2), view = new DataView(frame);
  view.setUint32(0, 7, true); view.setUint32(4, 48000, true);
  for (let i = 0; i < 100; i++) {
    engine.receivePcm(frame);
    assert.ok(engine.playAt - engine.ctx.currentTime < .141, 'relay queued perceptibly old audio');
  }
  assert.ok(scheduled.some(s => s.stopped), 'burst backlog was never cleared');
  const previousCount = scheduled.length;
  engine.ctx.currentTime = 10;
  for (let i = 0; i < 30; i++) { engine.receivePcm(frame); engine.ctx.currentTime += .02; }
  const normal = scheduled.slice(previousCount);
  assert.equal(normal.length, 30);
  assert.equal(normal.some(s => s.stopped), false, 'normal arrivals should not be dropped');
  for (let i = 1; i < normal.length; i++) assert.ok(Math.abs(normal[i].startTime - normal[i - 1].startTime - .02) < .000001);
  engine.cleanupConnection();
});
