// A small, disposable relay probe. Measures transport, not microphone-to-speaker latency.
import { WebSocket } from 'ws';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';

const origin = new URL(process.env.TEST_ORIGIN || 'http://127.0.0.1:3101').origin;
const count = 600;
const sockets = [];
async function api(path, body) {
  const response = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
async function connect(session) {
  const ws = new WebSocket(origin.replace(/^http/, 'ws') + '/ws', { origin, handshakeTimeout: 10000 });
  sockets.push(ws);
  const messages = [], waiters = [];
  ws.on('error', () => {});
  ws.on('message', (data, binary) => {
    if (binary) return;
    const msg = JSON.parse(data);
    const index = waiters.findIndex(w => w.match(msg));
    if (index >= 0) waiters.splice(index, 1)[0].resolve(msg); else messages.push(msg);
  });
  const wait = match => new Promise((resolve, reject) => {
    const index = messages.findIndex(match);
    if (index >= 0) return resolve(messages.splice(index, 1)[0]);
    const entry = { match, resolve: msg => { clearTimeout(timer); resolve(msg); } };
    const timer = setTimeout(() => { const i = waiters.indexOf(entry); if (i >= 0) waiters.splice(i, 1); reject(new Error('Control message timeout')); }, 10000);
    waiters.push(entry);
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ type: 'auth', ...session }));
  await wait(m => m.type === 'ready');
  return { ws, wait, send: msg => ws.send(JSON.stringify(msg)) };
}
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = p => sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] * 100) / 100 : null;
  return { count: sorted.length, minMs: at(0), medianMs: at(.5), p95Ms: at(.95), maxMs: at(1) };
}
let host;
try {
  await api('/healthz');
  const hostSession = await api('/api/rooms', { title: 'Temporary latency diagnostic' });
  host = await connect(hostSession);
  const studentSession = await api(`/api/rooms/${hostSession.code}/join`, { name: 'Synthetic probe' });
  const student = await connect(studentSession);
  student.send({ type: 'request' });
  await host.wait(m => m.type === 'state' && m.queue?.includes(studentSession.id));
  host.send({ type: 'approve', id: studentSession.id });
  const state = await host.wait(m => m.type === 'state' && m.activeId === studentSession.id);
  student.send({ type: 'relay', grant: state.grant });
  await host.wait(m => m.type === 'state' && m.mode === 'relay');
  const sent = new Map(), samples = [];
  host.ws.on('message', (raw, binary) => {
    if (!binary || raw.length < 12) return;
    const sequence = raw.readUInt32LE(8), started = sent.get(sequence);
    if (started !== undefined) { samples.push({ sequence, ms: performance.now() - started }); sent.delete(sequence); }
  });
  let maxBufferedBytes = 0;
  for (let sequence = 0; sequence < count; sequence++) {
    const frame = Buffer.alloc(8 + 960 * 2);
    frame.writeUInt32LE(state.grant, 0); frame.writeUInt32LE(48000, 4); frame.writeUInt32LE(sequence, 8);
    sent.set(sequence, performance.now());
    student.ws.send(frame);
    maxBufferedBytes = Math.max(maxBufferedBytes, student.ws.bufferedAmount);
    await delay(20);
  }
  const deadline = performance.now() + 3000;
  while (sent.size && performance.now() < deadline) await delay(50);
  const report = {
    at: new Date().toISOString(), origin, measurement: 'One process sends synthetic 20 ms PCM frames to the server and receives them on its separate host socket. Both clients use the same machine/network. Excludes capture, codecs, playback, speakers, classroom Wi-Fi and sound propagation.',
    framesSent: count, framesReceived: samples.length, unreceivedFrames: sent.size, maxBufferedBytes,
    transport: summary(samples.map(s => s.ms)), first100: summary(samples.filter(s => s.sequence < 100).map(s => s.ms)), last100: summary(samples.filter(s => s.sequence >= count - 100).map(s => s.ms)),
  };
  console.log(JSON.stringify(report, null, 2));
  await mkdir('test-results', { recursive: true });
  await writeFile(`test-results/latency-transport-${new URL(origin).hostname}.json`, JSON.stringify(report, null, 2) + '\n');
} finally {
  if (host?.ws.readyState === WebSocket.OPEN) {
    host.send({ type: 'end' });
    await host.wait(m => m.type === 'ended').catch(() => {});
  }
  for (const ws of sockets) { ws.close(); const timer = setTimeout(() => ws.terminate(), 500); timer.unref(); }
}
