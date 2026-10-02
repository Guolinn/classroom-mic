import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { VoiceLimiter } from '../public/voice-limiter.js';

test('limiter preserves quiet speech and silence without a gate or gain boost', () => {
  for (const rate of [16000, 22050, 24000, 32000, 44100, 48000, 96000]) {
    const limiter = new VoiceLimiter(rate);
    const input = Float32Array.from({ length: rate }, (_, n) => n < rate / 4 ? 0 : .001 * Math.sin(n * 2 * Math.PI * 440 / rate));
    for (let n = 0; n < input.length + limiter.delay; n++) {
      const out = limiter.process(input[n] || 0);
      assert.equal(out, input[n - limiter.delay] || 0);
    }
    assert.ok(limiter.delay / rate <= .0031, 'processing delay exceeds 3.1 ms');
  }
});

test('limiter controls peaks, including isolated impulses and sustained overload', () => {
  for (const rate of [16000, 44100, 48000, 96000]) {
    const limiter = new VoiceLimiter(rate);
    let audible = 0;
    for (let n = 0; n < rate * 2; n++) {
      const input = n < rate ? (n % 997 === 0 ? 4 : .3 * Math.sin(n * .3)) : 2 * Math.sin(n * .14);
      const out = limiter.process(input);
      assert.ok(Number.isFinite(out) && Math.abs(out) <= .890001, `peak escaped at ${rate} Hz / ${n}`);
      audible += out * out;
    }
    assert.ok(audible / (rate * 2) > .02, 'limiter incorrectly silenced the signal');
    for (let n = 0; n < rate; n++) limiter.process(0);
    assert.ok(limiter.gain > .9999, 'gain did not recover after overload');
    assert.equal(limiter.process(NaN), 0);
    assert.equal(limiter.process(Infinity), 0);
  }
});

test('limiter retains waveform shape at ordinary speech levels', () => {
  const limiter = new VoiceLimiter(48000);
  const samples = Float32Array.from({ length: 48000 }, (_, n) => .45 * Math.sin(n * .09) + .25 * Math.sin(n * .31));
  for (let n = 0; n < samples.length; n++) assert.equal(limiter.process(samples[n]), samples[n - limiter.delay] || 0);
});

test('PCM worklet emits complete 20 ms mono frames and stops when released', async () => {
  const source = await readFile(new URL('../public/pcm-worklet.js', import.meta.url), 'utf8');
  for (const rate of [16000, 44100, 48000, 96000]) {
    const frames = [];
    let Processor;
    vm.runInNewContext(source, {
      sampleRate: rate,
      AudioWorkletProcessor: class { constructor() { this.port = { postMessage: frame => frames.push(frame) }; } },
      registerProcessor: (_, value) => { Processor = value; },
    });
    const processor = new Processor();
    const input = new Float32Array(128).fill(.25);
    for (let n = 0; n < Math.ceil(rate / 128); n++) assert.equal(processor.process([[input]]), true);
    assert.equal(frames.length, 50);
    for (const frame of frames) {
      assert.equal(frame.sampleRate, rate);
      assert.equal(frame.samples.byteLength, Math.round(rate * .02) * 2);
      assert.equal(new Int16Array(frame.samples)[0], 8192);
    }
    processor.port.onmessage({ data: 'stop' });
    assert.equal(processor.process([[input]]), false);
    assert.equal(frames.length, 50);
  }
});
