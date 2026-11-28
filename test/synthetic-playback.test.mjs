import test from 'node:test';
import assert from 'node:assert/strict';
import { playSyntheticSpeech } from './manual-local-audio/synthetic-playback.js';

function fixture() {
  const events = [];
  const engine = { grant: 1, localSent: 10, micSource: { disconnect: () => events.push('disconnect-input') },
    highpass: {}, worklet: {}, sync: async () => {}, ctx: { createBufferSource() {
      return { connect() {}, start: () => events.push('start'), stop: () => events.push('stop'), disconnect() {} };
    } } };
  return { engine, events, args: { engine, phaseTicks: 2, wait: async () => {} } };
}

test('inspection retains a startup failure instead of dereferencing released audio nodes', async () => {
  const { engine, events, args } = fixture();
  engine.sync = async () => { engine.grant = 0; engine.micSource = null; };
  await assert.rejects(playSyntheticSpeech({ ...args, failure: () => 'Receiver disconnected.' }), /Receiver disconnected/);
  assert.deepEqual(events, []);
});

test('inspection stops its current signal when the connection ends, without starting the next path', async () => {
  const { engine, events, args } = fixture();
  args.wait = async () => { engine.grant = 0; engine.micSource = null; engine.highpass = null; };
  await assert.rejects(playSyntheticSpeech(args), /Audio connection stopped/);
  assert.deepEqual(events, ['start', 'stop']);
});

test('inspection cancellation stops the signal and a successful run requires sent audio', async () => {
  const { events, args } = fixture(); const controller = new AbortController();
  await assert.rejects(playSyntheticSpeech({ ...args, signal: controller.signal, wait: async () => controller.abort() }), { name: 'AbortError' });
  assert.deepEqual(events, ['start', 'stop']);
  const next = fixture(); await playSyntheticSpeech(next.args);
  assert.deepEqual(next.events, ['start', 'stop', 'disconnect-input', 'start', 'stop']);
  const empty = fixture(); empty.engine.localSent = 0;
  await assert.rejects(playSyntheticSpeech(empty.args), /No test audio was sent/);
});
