import { createServer } from 'node:http';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const token = () => randomBytes(32).toString('base64url');
const equal = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const send = (ws, data) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(data));

export function createApp(options = {}) {
  const env = { ...process.env, ...options.env };
  const rooms = new Map();
  const rates = new Map();
  const publicOrigin = env.PUBLIC_URL ? new URL(env.PUBLIC_URL).origin : null;
  const iceServers = env.ICE_SERVERS_JSON ? JSON.parse(env.ICE_SERVERS_JSON) : [{ urls: 'stun:stun.cloudflare.com:3478' }];
  const maxRooms = Number(env.MAX_ROOMS || 100);
  const maxStudents = Number(env.MAX_STUDENTS || 300);
  const ttl = Number(env.ROOM_TTL_MS || 12 * 60 * 60 * 1000);
  let devHandler;
  const originOK = req => {
    const origin = req.headers.origin;
    if (!origin) return false;
    try { return publicOrigin ? origin === publicOrigin : new URL(origin).host === req.headers.host; } catch { return false; }
  };
  function limited(key, limit, span = 60000) {
    const now = Date.now();
    let entry = rates.get(key);
    if (!entry || entry.until < now) { entry = { n: 0, until: now + span }; rates.set(key, entry); }
    return ++entry.n > limit;
  }
  function snapshot(room, student) {
    const list = [...room.students.values()];
    const queue = list.filter(s => s.requestedAt && s.ws?.readyState === 1).sort((a,b) => a.requestedAt - b.requestedAt);
    return {
      type: 'state', code: room.code, title: room.title, paused: room.paused,
      hostOnline: room.host?.readyState === 1, activeId: room.activeId, grant: room.grant, mode: room.mode,
      activeName: room.students.get(room.activeId)?.name || '', expiresAt: room.createdAt + ttl,
      online: list.filter(s => s.ws?.readyState === 1).length,
      ...(student ? { me: { id: student.id, name: student.name, requested: !!student.requestedAt, position: queue.findIndex(s => s.id === student.id) + 1 } } : {
        students: list.map(s => ({ id: s.id, name: s.name, online: s.ws?.readyState === 1, requestedAt: s.requestedAt, joinedAt: s.joinedAt })),
        queue: queue.map(s => s.id)
      })
    };
  }
  function broadcast(room) {
    send(room.host, snapshot(room));
    for (const s of room.students.values()) send(s.ws, snapshot(room, s));
  }
  function silence(room) { room.activeId = null; room.grant = 0; room.mode = 'direct'; }
  function end(room, reason = 'Class ended') {
    send(room.host, { type: 'ended', reason });
    room.host?.close(1000);
    for (const s of room.students.values()) { send(s.ws, { type: 'ended', reason }); s.ws?.close(1000); }
    rooms.delete(room.code);
  }
  function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }
  async function body(req) {
    let s = '';
    for await (const chunk of req) { s += chunk; if (s.length > 4096) throw new Error('Request too large'); }
    return JSON.parse(s || '{}');
  }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'microphone=(self), camera=()');
    res.setHeader('X-Frame-Options', 'DENY');
    const path = new URL(req.url, 'http://localhost').pathname;
    try {
      if (path === '/health' || path === '/healthz') return json(res, 200, { ok: true });
      if (path === '/api/config') return json(res, 200, { hostPasswordRequired: !!env.HOST_PASSWORD });
      if (path.startsWith('/api/')) {
        if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
        if (!originOK(req)) return json(res, 403, { error: 'Open this from the class website.' });
        const ip = env.TRUST_PROXY === '1' ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim() : req.socket.remoteAddress;
        const data = await body(req);
        if (path === '/api/rooms') {
          if (limited(`create:${ip}`, 10)) return json(res, 429, { error: 'Too many classes created. Try again later.' });
          if (env.HOST_PASSWORD && !equal(data.password, env.HOST_PASSWORD)) return json(res, 403, { error: 'Incorrect teacher password.' });
          if (rooms.size >= maxRooms) return json(res, 503, { error: 'Server at capacity. Try again later.' });
          let code; do { code = String(randomInt(100000, 1000000)); } while (rooms.has(code));
          const hostToken = token();
          rooms.set(code, { code, title: String(data.title || 'Class').trim().slice(0,60) || 'Class', hostToken, host: null, hostLastSeen: Date.now(), createdAt: Date.now(), students: new Map(), activeId: null, grant: 0, mode: 'direct', paused: false });
          return json(res, 201, { code, token: hostToken, role: 'host' });
        }
        const match = path.match(/^\/api\/rooms\/(\d{6})\/join$/);
        if (match) {
          // A lecture hall may share one public IP, so joins have a larger budget.
          if (limited(`join:${ip}`, 600)) return json(res, 429, { error: 'Too many join attempts. Try again later.' });
          const room = rooms.get(match[1]);
          if (!room) return json(res, 404, { error: 'Class not found. Check the code or ask your teacher for a new one.' });
          if (room.students.size >= maxStudents) return json(res, 409, { error: 'This class is full.' });
          const name = typeof data.name === 'string' ? data.name.trim().slice(0,24) : '';
          if (!name) return json(res, 400, { error: 'Enter your name.' });
          const student = { id: randomBytes(12).toString('hex'), token: token(), name, joinedAt: Date.now(), requestedAt: 0, ws: null, disconnectedAt: Date.now() };
          room.students.set(student.id, student);
          return json(res, 201, { code: room.code, id: student.id, token: student.token, role: 'student' });
        }
        return json(res, 404, { error: 'Not found.' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });
      if (devHandler) return devHandler(req, res);
      const publicDir = resolve(root, 'dist');
      let file = resolve(publicDir, '.' + decodeURIComponent(path));
      if (!file.startsWith(publicDir + '/')) file = resolve(publicDir, 'index.html');
      try { if (!(await stat(file)).isFile()) throw new Error(); } catch { file = resolve(publicDir, 'index.html'); }
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
      res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
      res.setHeader('Cache-Control', path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      if (req.method === 'HEAD') return res.end();
      res.end(await readFile(file));
    } catch (e) {
      if (path.startsWith('/api/')) return json(res, 400, { error: 'Invalid request. Try again.' });
      console.error('HTTP request failed:', e.message);
      json(res, 503, { error: 'Server unavailable. Try again later.' });
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32768, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://localhost').pathname !== '/ws') { if (!devHandler) socket.destroy(); return; }
    if (!originOK(req) || wss.clients.size >= maxRooms * (maxStudents + 1)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', ws => {
    let room, student, role;
    let textCount = 0, binaryCount = 0, windowAt = Date.now();
    ws.alive = true;
    const authTimer = setTimeout(() => ws.close(4001, 'Authentication required'), 8000);
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {});
    const error = message => send(ws, { type: 'error', message });
    ws.on('message', (raw, isBinary) => {
      if (Date.now() - windowAt > 1000) { textCount = 0; binaryCount = 0; windowAt = Date.now(); }
      if (isBinary) {
        if (++binaryCount > 65) return ws.close(4008, 'Too many frames');
        if (!room || role !== 'student' || student.ws !== ws || room.activeId !== student.id || room.mode !== 'relay' || !room.host) return;
        if (raw.length < 10 || raw.length > 8200 || raw.length % 2 || raw.readUInt32LE(0) !== room.grant) return;
        const sampleRate = raw.readUInt32LE(4);
        if (![16000, 22050, 24000, 32000, 44100, 48000, 96000].includes(sampleRate)) return;
        if (room.host.readyState === 1 && room.host.bufferedAmount < 65536) room.host.send(raw, { binary: true });
        return;
      }
      if (++textCount > 100) return ws.close(4008, 'Too many messages');
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return error('Invalid message format.'); }
      if (!msg || typeof msg !== 'object') return;
      if (!room) {
        if (msg.type !== 'auth') return;
        const found = rooms.get(msg.code);
        if (!found) { send(ws, { type: 'ended', reason: 'Class ended or expired. Join a new class.' }); return ws.close(4004); }
        if (msg.role === 'host' && equal(msg.token, found.hostToken)) {
          room = found; role = 'host';
          room.host?.close(4002, 'Opened elsewhere');
          room.host = ws; room.hostLastSeen = Date.now();
          silence(room);
        } else if (msg.role === 'student' && equal(msg.token, found.students.get(msg.id)?.token)) {
          room = found; role = 'student'; student = room.students.get(msg.id);
          student.ws?.close(4002, 'Opened elsewhere');
          student.ws = ws; student.disconnectedAt = null;
          if (room.activeId === student.id) silence(room);
        } else { error('Session expired. Join again.'); return ws.close(4001); }
        clearTimeout(authTimer);
        send(ws, { type: 'ready', iceServers });
        return broadcast(room);
      }
      if (!rooms.has(room.code) || (role === 'host' ? room.host !== ws : student.ws !== ws)) return;
      if (msg.type === 'rtc') {
        if (!room.activeId || msg.grant !== room.grant || room.mode !== 'direct') return;
        if (role === 'host') send(room.students.get(room.activeId)?.ws, msg);
        else if (room.activeId === student.id) send(room.host, msg);
        return;
      }
      if (msg.type === 'relay') {
        if (msg.grant !== room.grant || !room.activeId || (role !== 'host' && room.activeId !== student.id)) return;
        room.mode = 'relay'; broadcast(room); return;
      }
      if (role === 'host') {
        if (msg.type === 'approve') {
          const next = room.students.get(msg.id);
          if (room.paused) return error('Resume requests first.');
          if (!next?.requestedAt || next.ws?.readyState !== 1) return error('This student cancelled or disconnected.');
          room.activeId = next.id; room.grant = randomInt(1, 0xffffffff); room.mode = 'direct'; next.requestedAt = 0;
        } else if (msg.type === 'mute') silence(room);
        else if (msg.type === 'pause') { room.paused = !!msg.paused; if (room.paused) silence(room); }
        else if (msg.type === 'reject') { const s = room.students.get(msg.id); if (s) { s.requestedAt = 0; send(s.ws, { type: 'notice', message: 'Request dismissed. You can request again later.' }); } }
        else if (msg.type === 'end') return end(room);
        else return;
      } else {
        if (msg.type === 'request') {
          if (room.paused || room.host?.readyState !== 1) return error('Requests are paused or the teacher is offline.');
          if (room.activeId !== student.id && !student.requestedAt) student.requestedAt = Date.now();
        } else if (msg.type === 'cancel') student.requestedAt = 0;
        else if (msg.type === 'finish') { if (room.activeId === student.id) silence(room); }
        else if (msg.type === 'leave') { if (room.activeId === student.id) silence(room); room.students.delete(student.id); send(ws, { type: 'ended', reason: 'You left the class.' }); ws.close(1000); }
        else return;
      }
      broadcast(room);
    });
    ws.on('close', () => {
      clearTimeout(authTimer);
      if (!room || !rooms.has(room.code)) return;
      if (role === 'host' && room.host === ws) { room.host = null; room.hostLastSeen = Date.now(); silence(room); }
      if (role === 'student' && student.ws === ws) {
        student.ws = null; student.disconnectedAt = Date.now(); student.requestedAt = 0;
        if (room.activeId === student.id) silence(room);
      }
      broadcast(room);
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } }
    for (const room of rooms.values()) {
      if (Date.now() - room.createdAt > ttl || (!room.host && Date.now() - room.hostLastSeen > 5 * 60000)) { end(room, 'Class expired. Create a new class.'); continue; }
      for (const s of room.students.values()) if (!s.ws && Date.now() - s.disconnectedAt > 10 * 60000) room.students.delete(s.id);
    }
    for (const [key, value] of rates) if (value.until < Date.now()) rates.delete(key);
  }, 15000);
  heartbeat.unref();
  return {
    server, rooms, setDevHandler: handler => { devHandler = handler; },
    close: async () => { clearInterval(heartbeat); for (const ws of wss.clients) ws.terminate(); await new Promise(r => wss.close(r)); await new Promise(r => server.close(r)); }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile(resolve(root, '.env')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const app = createApp();
  let vite;
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({ server: { middlewareMode: true, hmr: { server: app.server, path: '/vite-hmr' } }, appType: 'spa' });
    app.setDevHandler(vite.middlewares);
  }
  const port = Number(process.env.PORT || 3000);
  app.server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Server listening at: http://localhost:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await vite?.close(); await app.close(); process.exit(0); });
}
