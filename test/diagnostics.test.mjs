import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioDiagnostics, formatDiagnosticMs } from '../src/diagnostics.js';

function fixture() {
  let rows = [];
  const peer = { connectionState: 'connected', getStats: async () => new Map(rows.map(r => [r.id, r])) };
  return {
    engine: { role: 'host', pc: peer, grant: 7, mode: 'direct', ctx: { currentTime: 10, outputLatency: .025, sampleRate: 48000 } },
    rows: value => { rows = value; },
  };
}
const inbound = extra => ({ type: 'inbound-rtp', id: 'audio', kind: 'audio', jitter: .005, packetsReceived: 100, packetsLost: 0, jitterBufferEmittedCount: 48000, jitterBufferDelay: 960, jitterBufferTargetDelay: 960, ...extra });

test('diagnostics uses interval deltas, not misleading lifetime jitter-buffer averages', async () => {
  const f = fixture(), sampler = new AudioDiagnostics();
  f.rows([inbound({})]);
  assert.equal((await sampler.sample(f.engine)).receiverBufferMs, null);
  f.rows([inbound({ packetsReceived: 199, packetsLost: 1, jitterBufferEmittedCount: 96000, jitterBufferDelay: 5760, jitterBufferTargetDelay: 2400 })]);
  const result = await sampler.sample(f.engine);
  assert.equal(result.receiverBufferMs, 100);
  assert.equal(result.receiverTargetMs, 30);
  assert.equal(result.packetLossPercent, 1);
  assert.equal(result.receiverJitterMs, 5);
  assert.equal(result.relayOutputLatencyMs, null, 'Web Audio output estimate does not describe native WebRTC playback');
});

test('diagnostics selects the active ICE pair without reporting network addresses', async () => {
  const f = fixture();
  f.rows([
    { type: 'candidate-pair', id: 'old', state: 'succeeded', nominated: true, currentRoundTripTime: .3 },
    { type: 'candidate-pair', id: 'current', currentRoundTripTime: .018, localCandidateId: 'private-address' },
    { type: 'transport', id: 'transport', selectedCandidatePairId: 'current' },
    { type: 'local-candidate', id: 'private-address', address: '192.168.0.10' },
  ]);
  const result = await new AudioDiagnostics().sample(f.engine);
  assert.equal(result.peerRoundTripMs, 18);
  assert.ok(!JSON.stringify(result).includes('192.168'));
});

test('unsupported metrics remain unavailable; counter resets cannot produce bogus latency', async () => {
  const f = fixture(), sampler = new AudioDiagnostics();
  f.rows([inbound({})]); await sampler.sample(f.engine);
  f.rows([inbound({ jitterBufferEmittedCount: 0, jitterBufferDelay: 0, packetsReceived: 0, jitter: undefined })]);
  const result = await sampler.sample(f.engine);
  assert.equal(result.receiverBufferMs, null);
  assert.equal(result.packetLossPercent, null);
  assert.equal(result.receiverJitterMs, null);
  assert.equal(formatDiagnosticMs(null), 'Unavailable');
  assert.equal(formatDiagnosticMs(0), '0 ms');
});

test('a speaker change resets history and a stale asynchronous report is discarded', async () => {
  const f = fixture(), sampler = new AudioDiagnostics();
  f.rows([inbound({})]); await sampler.sample(f.engine);
  f.engine.grant = 8;
  f.rows([inbound({ jitterBufferEmittedCount: 96000, jitterBufferDelay: 3000 })]);
  assert.equal((await sampler.sample(f.engine)).receiverBufferMs, null);
  let finish;
  f.engine.pc.getStats = () => new Promise(resolve => { finish = resolve; });
  const pending = sampler.sample(f.engine);
  f.engine.mode = 'relay';
  finish(new Map());
  assert.equal(await pending, null);
});

test('relay measurements separate playback queue from browser output and do not add a total', async () => {
  const f = fixture(); f.engine.mode = 'relay'; f.engine.playAt = 10.06;
  f.engine.playout = { target: .04, underruns: 1, resyncs: 2 };
  const result = await new AudioDiagnostics().sample(f.engine);
  assert.equal(result.relayQueueMs, 60);
  assert.equal(result.relayOutputLatencyMs, 25);
  assert.equal(result.relayTargetMs, 40);
  assert.equal(result.relayUnderruns, 1);
  assert.equal(result.relayResyncs, 2);
  assert.equal(result.peerRoundTripMs, null);
  assert.equal(result.totalLatencyMs, undefined);
  f.engine.grant = 0;
  const inactive = await new AudioDiagnostics().sample(f.engine);
  assert.equal(inactive.transport, 'Inactive');
  assert.equal(inactive.relayQueueMs, null);
});

test('capture diagnostics report applied settings rather than requested preferences', async () => {
  const f = fixture(); f.engine.role = 'student';
  f.engine.stream = { getAudioTracks: () => [{ getSettings: () => ({ latency: .02, sampleRate: 44100, echoCancellation: true, noiseSuppression: true, deviceId: 'secret-device' }) }] };
  const result = await new AudioDiagnostics().sample(f.engine);
  assert.equal(result.captureLatencyMs, 20);
  assert.equal(result.sampleRate, 44100);
  assert.equal(result.voiceIsolation, null);
  assert.ok(!JSON.stringify(result).includes('secret-device'));
});
