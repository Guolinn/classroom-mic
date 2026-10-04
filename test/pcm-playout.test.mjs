import test from 'node:test';
import assert from 'node:assert/strict';
import { PcmPlayout } from '../src/pcm-playout.js';
import { readFileSync } from 'node:fs';

test('stable and mildly jittery relay arrivals play continuously with a 20 ms starting buffer', () => {
  const p = new PcmPlayout();
  for (let i = 0; i < 500; i++) {
    const now = 1 + i * .02 + (i === 0 ? 0 : (i % 3 - 1) * .009);
    const s = p.schedule(now, .02);
    assert.equal(s.reset, i === 0);
    assert.ok(Math.abs(s.at - (1.02 + i * .02)) < 1e-8, 'audio must stay contiguous');
  }
  assert.equal(p.underruns, 0);
  assert.equal(p.target, .02);
});

test('late audio increases safety margin, caps it, and resets for a new speaker', () => {
  const p = new PcmPlayout();
  p.schedule(1, .02);
  assert.deepEqual(p.schedule(1.08, .02), { at: 1.12, reset: true });
  assert.equal(p.underruns, 1);
  assert.equal(p.target, .04);
  p.schedule(2, .02); p.schedule(3, .02);
  assert.equal(p.target, .04);
  assert.equal(p.underruns, 3);
  p.reset();
  assert.equal(p.target, .02);
  assert.equal(p.underruns, 0);
  assert.equal(p.resyncs, 0);
});

test('burst recovery caps queued playback including the incoming frame and preserves rate validation', () => {
  const p = new PcmPlayout();
  for (let n = 0; n < 200; n++) {
    p.schedule(1, .02);
    assert.ok(p.playAt <= 1.140001);
  }
  assert.ok(p.resyncs > 0);
  assert.equal(p.underruns, 0);
  const before = { ...p };
  for (const [now, duration] of [[NaN, .02], [1, Infinity], [1, 0], [1, .2], [-1, .02]]) assert.equal(p.schedule(now, duration), null);
  assert.deepEqual({ ...p }, before, 'invalid frames must not alter scheduling');
});

test('recorded public-network bursts do not cause more interruptions than the former scheduler', () => {
  const trace = JSON.parse(readFileSync(new URL('./fixtures/relay-arrivals.json', import.meta.url)));
  const p = new PcmPlayout();
  let now = 10, oldAt = 0, oldUnderruns = 0, oldResyncs = 0;
  for (const quanta of trace.quanta) {
    now += quanta * 128 / trace.sampleRate;
    if (oldAt && oldAt < now) oldUnderruns++;
    if (oldAt > now + .12) oldResyncs++;
    if (!oldAt || oldAt < now || oldAt > now + .12) oldAt = now + .04;
    oldAt += .02;
    p.schedule(now, .02);
    assert.ok(p.playAt - now <= .140001);
  }
  assert.ok(oldUnderruns > 10 && oldResyncs > 10, 'fixture must exercise sustained network jitter');
  assert.ok(p.underruns <= oldUnderruns, `underruns increased: ${p.underruns} > ${oldUnderruns}`);
  assert.ok(p.resyncs <= oldResyncs, `queue resets increased: ${p.resyncs} > ${oldResyncs}`);
  assert.equal(p.target, .04);
});
