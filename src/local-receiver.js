import { parseReceiverCode, validLocalAudio } from '../shared/local-receiver.js';

const storageKey = 'mic:local-receiver';
const timeout = (promise, ms, message) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
};
export function saveReceiverCode(code) {
  const config = parseReceiverCode(code);
  sessionStorage.setItem(storageKey, JSON.stringify(config));
  return config;
}
export function readReceiver() {
  try {
    const c = JSON.parse(sessionStorage.getItem(storageKey));
    if (c && validLocalAudio({ ...c, ticket: c.key })) return c;
  } catch {}
  return null;
}
export function importReceiverLink() {
  const params = new URLSearchParams(location.hash.slice(1));
  const code = params.get('receiver');
  if (!code) return;
  // The control key stays in this tab; it is never sent to the cloud server.
  history.replaceState({}, '', location.pathname + location.search);
  try { saveReceiverCode(code); } catch {}
}
function openTransport(config, path) {
  if (!globalThis.WebTransport) throw new Error('Local audio needs a browser with WebTransport support. Try Safari 26.4 or newer, or current Chrome.');
  const hash = Uint8Array.from(atob(config.hash.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const transport = new WebTransport(config.url + path, { serverCertificateHashes: [{ algorithm: 'sha-256', value: hash }], congestionControl: 'low-latency' });
  transport.closed.catch(() => {});
  return transport;
}
export class LocalReceiver {
  constructor(config, onFailure) { this.config = config; this.onFailure = onFailure; this.pending = new Map(); this.id = 0; this.armedTicket = null; this.stats = null; }
  async connect() {
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.open().finally(() => { this.connecting = null; });
    return this.connecting;
  }
  async open() {
    this.closed = false;
    const transport = this.transport = openTransport(this.config, '/control?key=' + encodeURIComponent(this.config.key));
    try {
      await timeout(transport.ready, 5000, 'Cannot reach the local receiver. Keep it running, allow local network access, and use the same Wi-Fi.');
      if (this.closed) throw new Error('Receiver closed.');
      const stream = await timeout(transport.createBidirectionalStream(), 3000, 'Receiver did not respond.');
      this.writer = stream.writable.getWriter(); this.reader = stream.readable.getReader(); this.connected = true;
      this.readResponses().catch(() => this.fail());
      transport.closed.then(() => this.fail(), () => this.fail());
      await this.request('ping');
      this.timer = setInterval(() => { this.request('ping').catch(() => this.fail()); }, 250);
    } catch (e) { this.close(); throw e; }
  }
  async readResponses() {
    const decoder = new TextDecoder(); let text = '';
    while (!this.closed) {
      const { value, done } = await this.reader.read(); if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length > 16384) throw new Error('Invalid receiver response.');
      let end;
      while ((end = text.indexOf('\n')) >= 0) {
        const msg = JSON.parse(text.slice(0, end)); text = text.slice(end + 1);
        if (msg.stats) this.stats = msg.stats;
        this.pending.get(msg.id)?.resolve(msg); this.pending.delete(msg.id);
      }
    }
    this.fail();
  }
  request(type, extra = {}) {
    if (!this.connected || this.closed) return Promise.reject(new Error('Local receiver is disconnected.'));
    const id = ++this.id;
    const pending = new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); });
    this.writer.write(new TextEncoder().encode(JSON.stringify({ id, type, ...extra }) + '\n')).catch(() => this.fail());
    return timeout(pending, 850, 'Receiver did not respond.').finally(() => this.pending.delete(id));
  }
  async arm(volume) {
    await this.connect();
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const ticket = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await this.request('arm', { ticket, volume }); this.armedTicket = ticket;
    return { url: this.config.url, hash: this.config.hash, ticket };
  }
  async mute() {
    this.armedTicket = null;
    if (this.connected) try { await this.request('mute'); } catch { this.fail(); }
  }
  fail() { if (this.closed) return; this.close(); this.onFailure?.(); }
  close() {
    this.closed = true; this.connected = false; this.armedTicket = null; clearInterval(this.timer);
    for (const p of this.pending.values()) p.reject(new Error('Local receiver disconnected.')); this.pending.clear();
    this.reader?.cancel().catch(() => {}); this.transport?.close();
  }
}

export async function connectLocalSender(config) {
  if (!validLocalAudio(config)) throw new Error('Invalid local audio connection.');
  const transport = openTransport(config, '/audio?ticket=' + encodeURIComponent(config.ticket));
  try {
    await timeout(transport.ready, 5000, 'Cannot reach the local receiver. Use the same Wi-Fi as the teacher and allow local network access.');
    // A reliable-only connection loses the intended deadline behavior.
    if (transport.reliability === 'reliable-only') throw new Error('This network does not support local audio datagrams.');
    try { transport.datagrams.outgoingMaxAge = 15; transport.datagrams.outgoingHighWaterMark = 3; } catch {}
    const writer = transport.datagrams.writable.getWriter();
    return { transport, writer };
  } catch (e) { transport.close(); throw e; }
}
