import { request } from 'node:https';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
const origin = process.env.TEST_ORIGIN || 'https://classroom-mic.beringtech.com';
const lookup = process.env.LOCAL_RESOLVE === '1' ? (hostname, options, callback) => options.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4) : undefined;
function http(path, data) {
  return new Promise((resolve, reject) => {
    const req = request(new URL(path, origin), { lookup, method: data ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json' } }, res => {
      let text = ''; res.on('data', c => text += c); res.on('end', () => { try { const parsed = JSON.parse(text); if (res.statusCode >= 400) reject(new Error(parsed.error)); else resolve(parsed); } catch(e) { reject(e); } });
    });
    req.on('error', reject); req.setTimeout(10000, () => req.destroy(new Error('HTTP timeout'))); req.end(data ? JSON.stringify(data) : undefined);
  });
}
async function connect(session) {
  const socket = new WebSocket(origin.replace('https:', 'wss:') + '/ws', { origin, lookup });
  const messages = [];
  socket.on('message', (raw, binary) => messages.push(binary ? { type: 'binary', raw } : JSON.parse(raw)));
  socket.on('error', () => {});
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.send(JSON.stringify({ type: 'auth', ...session }));
  const wait = predicate => new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const timer = setInterval(() => { const i = messages.findIndex(predicate); if (i >= 0) { clearInterval(timer); resolve(messages.splice(i, 1)[0]); } else if (Date.now() > deadline) { clearInterval(timer); reject(new Error('WebSocket message timeout')); } }, 20);
  });
  await wait(m => m.type === 'ready');
  return { socket, wait, send: data => socket.send(JSON.stringify(data)) };
}
assert.deepEqual(await http('/healthz'), { ok: true });
const hostSession = await http('/api/rooms', { title: 'Deployment verification' });
const studentSession = await http(`/api/rooms/${hostSession.code}/join`, { name: 'Deployment check' });
const host = await connect(hostSession), student = await connect(studentSession);
try {
  student.send({ type: 'request' }); await host.wait(m => m.type === 'state' && m.queue.length === 1);
  host.send({ type: 'approve', id: studentSession.id });
  const state = await host.wait(m => m.type === 'state' && m.activeId === studentSession.id);
  student.send({ type: 'relay', grant: state.grant }); await host.wait(m => m.type === 'state' && m.mode === 'relay');
  const audio = Buffer.alloc(1928); audio.writeUInt32LE(state.grant); audio.writeUInt32LE(24000, 4); audio.writeInt16LE(1234, 8);
  student.socket.send(audio); assert.equal((await host.wait(m => m.type === 'binary')).raw.readInt16LE(8), 1234);
  host.send({ type: 'mute' }); await student.wait(m => m.type === 'state' && !m.activeId && m.grant === 0);
  host.send({ type: 'end' }); await student.wait(m => m.type === 'ended');
  console.log(JSON.stringify({ pass: true, checks: ['HTTPS certificate', 'health endpoint', 'class creation', 'student join', 'WebSocket upgrade', 'approval', 'audio relay', 'mute', 'end class'] }));
} finally { host.send({ type: 'end' }); host.socket.close(); student.socket.close(); }
