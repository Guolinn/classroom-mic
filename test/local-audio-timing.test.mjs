import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalAudioTiming } from '../src/local-audio-timing.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const frame = seq => { const bytes = new Uint8Array(492); new DataView(bytes.buffer).setUint32(4, seq, true); return bytes; };
const ack = seq => { const bytes = new Uint8Array(8); const view = new DataView(bytes.buffer); view.setUint32(0, 0x3141544d, true); view.setUint32(4, seq, true); return bytes; };

test('receipt timing matches sampled audio, ignores unknown replies and uses a single clock', async () => {
  let now = 100, replies;
  const transport = { datagrams: { readable: new ReadableStream({ start(c) { replies = c; } }) } };
  const timing = new LocalAudioTiming(transport, { now: () => now });
  let writes = 0; const writer = timing.writer({ write() { writes++; } });
  writer.write(frame(0)); now = 113; replies.enqueue(ack(0)); await tick();
  replies.enqueue(ack(0)); replies.enqueue(ack(99)); await tick();
  writer.write(frame(20)); now = 134; replies.enqueue(ack(20)); await tick();
  assert.equal(writes, 2);
  assert.deepEqual(timing.snapshot(), { receiptSamples: 2, receiptMedianMs: 21, receiptP95Ms: 21 });
  timing.close(); assert.equal(timing.pending.size, 0);
});

test('older receivers and unavailable transport stats never block or grow storage unbounded', async () => {
  const timing = new LocalAudioTiming({ datagrams: {}, getStats: async () => { throw Error('unsupported'); } });
  let writes = 0; const writer = timing.writer({ write() { writes++; } });
  for (let i = 0; i < 10000; i++) writer.write(frame(i));
  await timing.poll();
  assert.equal(writes, 10000); assert.equal(timing.pending.size, 32);
  assert.equal(timing.snapshot().receiptMedianMs, null); timing.close();
});

test('transport stats are numeric-only and an outstanding measurement cannot revive a closed sender', async () => {
  let resolve, calls = 0;
  const timing = new LocalAudioTiming({ getStats: () => { calls++; return new Promise(r => { resolve = r; }); } });
  const first = timing.poll(); await timing.poll(); assert.equal(calls, 1);
  resolve({ smoothedRtt: 4, minRtt: 2, rttVariation: 1, remoteAddress: 'private', datagrams: { expiredOutgoing: 2, lostOutgoing: -1 } }); await first;
  assert.equal(timing.snapshot().transportRttMs, 4); assert.equal(timing.snapshot().transportLost, null);
  assert.equal(JSON.stringify(timing.snapshot()).includes('private'), false);
  const next = timing.poll(); timing.close(); resolve({ smoothedRtt: 999 }); await next;
  assert.equal(timing.snapshot().transportRttMs, 4);
});

test('sender summary stays off older receivers and forwards only numerical stage measurements', async () => {
  let replies, now = 0; const writes = [];
  const timing = new LocalAudioTiming({ datagrams: { readable: new ReadableStream({ start(c) { replies = c; } }) } }, { now: () => now });
  const writer = timing.writer({ write(bytes) { writes.push(bytes); return Promise.resolve(); } });
  timing.publish({ maxWriteMs: 2 }); assert.equal(writes.length, 0);
  writer.write(frame(0)); now = 10; replies.enqueue(ack(0)); await tick();
  timing.publish({ maxWriteMs: 2, privateAddress: 'secret', maxCaptureGapMs: -5 }); await tick();
  assert.equal(writes.length, 2);
  const payload = new TextDecoder().decode(writes[1]);
  assert.equal(payload.slice(0, 4), 'MTS1'); assert.equal(payload.includes('secret'), false);
  const report = JSON.parse(payload.slice(4));
  assert.equal(report.maxWriteMs, 2); assert.equal(report.maxCaptureGapMs, null); assert.equal(report.receiptMedianMs, 10);
  timing.close(); timing.publish({}); assert.equal(writes.length, 2);
});

test('zero-filled browser RTT placeholders are unavailable rather than zero delay', async () => {
  const timing = new LocalAudioTiming({ getStats: async () => ({ smoothedRtt: 0, minRtt: 0, rttVariation: 0 }) });
  await timing.poll();
  assert.equal(timing.snapshot().transportRttMs, null); assert.equal(timing.snapshot().transportMinRttMs, null);
  timing.close();
});
