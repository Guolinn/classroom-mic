import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { validEndpoint, validLocalAudio, parseReceiverCode } from '../shared/local-receiver.js';
import { AudioDiagnostics } from '../src/diagnostics.js';
import { ClassroomAudio } from '../src/audio.js';
import { connectLocalSender, LocalReceiver } from '../src/local-receiver.js';

test('receiver pairing accepts private endpoints and rejects remote hosts, credentials and malformed pins', () => {
  const hash = 'a'.repeat(43), key = 'b'.repeat(43);
  for (const url of ['https://192.168.1.3:4444', 'https://10.0.0.2:4444', 'https://127.0.0.1:4444']) assert.ok(validEndpoint(url));
  for (const url of ['http://192.168.1.3:4444', 'https://evil.test', 'https://8.8.8.8', 'https://192.168.1.3:4444/path', 'https://x:y@192.168.1.3:4444', 'https://192.168.1.3:4444?key=x']) assert.equal(validEndpoint(url), false);
  const config = {v:1, url:'https://192.168.1.3:4444',hash,key};
  assert.deepEqual(parseReceiverCode('mt1.'+Buffer.from(JSON.stringify(config)).toString('base64url')), config);
  assert.ok(validLocalAudio({...config,ticket:key}));
  assert.equal(validLocalAudio({...config,ticket:'short'}),false);
  assert.throws(()=>parseReceiverCode('mt1.broken'));
});

test('local capture emits ordered five-millisecond datagrams at 48 and 44.1 kHz, then stops', async () => {
  const source = await readFile(new URL('../public/local-pcm-worklet.js', import.meta.url),'utf8');
  for (const rate of [48000,44100]) {
    let Processor; const messages=[];
    const context={sampleRate:rate,currentTime:0,AudioWorkletProcessor:class {constructor(){this.port={postMessage:data=>messages.push(data)}}},registerProcessor:(name,p)=>{Processor=p}};
    vm.runInNewContext(source,context); const p = new Processor();
    const blocks=Math.ceil(rate/128);
    for(let i=0;i<blocks;i++){context.currentTime=i*128/rate;p.process([[new Float32Array(128).fill(.25)]]);}
    assert.ok(messages.length>=199 && messages.length<=201,`bad duration at ${rate}`);
    messages.forEach((m,i)=>{const b=new DataView(m.buffer);assert.equal(b.byteLength,492);assert.equal(b.getUint32(0,true),0x3130544d);assert.equal(b.getUint32(4,true),i);assert.equal(b.getUint32(8,true),48000);assert.ok(Math.abs(b.getInt16(12,true)-8192)<2)});
    const direct=[]; let portClosed=false;
    p.port.onmessage({data:{type:'sender-port',port:{postMessage:m=>direct.push(m),close:()=>{portClosed=true}}}});
    p.process([[new Float32Array(512).fill(.25)]]);
    assert.ok(direct.length >= 2); assert.ok(Number.isFinite(direct[0].producedAt));
    const before=messages.length;p.port.onmessage({data:'stop'});assert.equal(p.process([[new Float32Array(128)]]),false);assert.equal(messages.length,before);
    assert.equal(portClosed,true);
  }
});

test('local diagnostics do not confuse the native queue with browser output or disclose pairing credentials', async () => {
  const r=await new AudioDiagnostics().sample({role:'host',mode:'local',grant:1,localReceiver:{config:{key:'private-key',url:'https://192.168.0.1'},stats:{queueMs:5,targetMs:5,underruns:0,dropped:2}},ctx:{outputLatency:.024}});
  assert.equal(r.transport,'Local receiver'); assert.equal(r.localQueueMs,5);assert.equal(r.relayOutputLatencyMs,null);assert.equal(r.totalLatencyMs,undefined);assert.ok(!JSON.stringify(r).includes('private-key'));assert.ok(!JSON.stringify(r).includes('192.168'));
});

test('a local handshake completing after mute cannot start microphone transmission', async t => {
  const original = globalThis.WebTransport; let ready, transport;
  globalThis.WebTransport = class {
    constructor() { transport = this; this.ready = new Promise(r => {ready=r}); this.closed = new Promise(()=>{}); this.datagrams={writable:{getWriter:()=>({})}}; }
    close(){this.wasClosed=true;}
  };
  t.after(()=>{if(original===undefined)delete globalThis.WebTransport;else globalThis.WebTransport=original});
  const engine=new ClassroomAudio('student',()=>{},()=>{},()=>{});
  engine.grant=9;engine.desiredGrant=9;engine.mode='local';engine.desiredMode='local';
  const pending=engine.startLocal(9,{url:'https://127.0.0.1:4444',hash:'a'.repeat(43),ticket:'b'.repeat(43)});
  engine.stopAll();ready();await pending;
  assert.equal(transport.wasClosed,true);assert.equal(engine.worklet,undefined);assert.equal(engine.grant,0);
});

test('local audio sends using Safari createWritable and legacy Chromium writable APIs', async t => {
  const original = globalThis.WebTransport;
  t.after(() => { if (original === undefined) delete globalThis.WebTransport; else globalThis.WebTransport = original; });
  for (const modern of [true, false]) {
    const sent = [];
    const stream = new WritableStream({ write: bytes => sent.push([...bytes]) });
    const datagrams = { outgoingMaxAge: null, ...(modern ? { outgoingMaxBufferedDatagrams: 0 } : { outgoingHighWaterMark: 0 }) };
    if (modern) {
      datagrams.createWritable = function () { assert.equal(this, datagrams); return stream; };
      Object.defineProperty(datagrams, 'writable', { get() { throw new Error('The deprecated property must not be accessed when createWritable exists.'); } });
    } else datagrams.writable = stream;
    globalThis.WebTransport = class {
      constructor() { this.ready = Promise.resolve(); this.closed = new Promise(() => {}); this.datagrams = datagrams; }
      close() {}
    };
    const { writer } = await connectLocalSender({ url: 'https://192.168.1.3:4444', hash: 'a'.repeat(43), ticket: 'b'.repeat(43) });
    await writer.write(new Uint8Array([1, 2, 3]));
    assert.deepEqual(sent, [[1, 2, 3]]);
    assert.equal(datagrams.outgoingMaxAge, 15);
    assert.equal(datagrams[modern ? 'outgoingMaxBufferedDatagrams' : 'outgoingHighWaterMark'], 3);
    writer.releaseLock();
  }
});

test('an unavailable datagram writer closes the connection with an actionable error', async t => {
  const original = globalThis.WebTransport; let transport;
  t.after(() => { if (original === undefined) delete globalThis.WebTransport; else globalThis.WebTransport = original; });
  globalThis.WebTransport = class {
    constructor() { transport = this; this.ready = Promise.resolve(); this.closed = new Promise(() => {}); this.datagrams = {}; }
    close() { this.wasClosed = true; }
  };
  await assert.rejects(connectLocalSender({ url: 'https://192.168.1.3:4444', hash: 'a'.repeat(43), ticket: 'b'.repeat(43) }), /cannot send local audio datagrams/);
  assert.equal(transport.wasClosed, true);
});

test('mute cancels a never-ready local handshake and lets a new speaking turn proceed', { timeout: 1000 }, async t => {
  const original = globalThis.WebTransport; let transport;
  globalThis.WebTransport = class {
    constructor() { transport = this; this.ready = new Promise(() => {}); this.closed = new Promise(() => {}); }
    close() { this.wasClosed = true; }
  };
  t.after(() => { if (original === undefined) delete globalThis.WebTransport; else globalThis.WebTransport = original; });
  const sent = [], updates = [];
  const engine = new ClassroomAudio('student', data => sent.push(data), () => {}, data => updates.push(data));
  const stream = () => ({ getTracks: () => [{ stop() {}, enabled: false }] });
  engine.stream = stream();
  const first = engine.sync({ activeId: 's', grant: 9, mode: 'local', local: { url: 'https://127.0.0.1:4444', hash: 'a'.repeat(43), ticket: 'b'.repeat(43) } }, 's');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(engine.localStage, 'connecting');
  assert.equal(updates.some(update => update.localSending === true), false);
  engine.stopAll();
  engine.stream = stream(); let nextStarted = false;
  engine.startRelay = async () => { nextStarted = true; };
  await engine.sync({ activeId: 's', grant: 10, mode: 'relay' }, 's'); await first;
  assert.equal(transport.wasClosed, true); assert.equal(nextStarted, true);
  assert.equal(engine.grant, 10); assert.deepEqual(sent, []);
});

test('an old receiver close callback cannot disconnect a new control session', async t => {
  const original = globalThis.WebTransport, transports = []; let failures = 0;
  globalThis.WebTransport = class {
    constructor() {
      transports.push(this); this.ready = Promise.resolve();
      this.closed = new Promise(resolve => { this.finishClose = resolve; });
    }
    async createBidirectionalStream() {
      let output;
      return {
        readable: new ReadableStream({ start(controller) { output = controller; } }),
        writable: new WritableStream({ write(bytes) {
          const { id } = JSON.parse(new TextDecoder().decode(bytes));
          output.enqueue(new TextEncoder().encode(JSON.stringify({ id, ok: true, stats: { received: 0 } }) + '\n'));
        } }),
      };
    }
    close() {}
  };
  const receiver = new LocalReceiver({ url: 'https://127.0.0.1:4444', hash: 'a'.repeat(43), key: 'b'.repeat(43) }, () => failures++);
  t.after(() => { receiver.close(); if (original === undefined) delete globalThis.WebTransport; else globalThis.WebTransport = original; });
  await receiver.connect(); receiver.close();
  await new Promise(resolve => setImmediate(resolve));
  await receiver.connect();
  transports[0].finishClose({});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(receiver.connected, true);
  assert.equal(failures, 0);
  await receiver.request('ping');
});

test('teacher startup distinguishes waiting, received audio and a bounded no-audio failure', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let now = 0; t.mock.method(performance, 'now', () => now);
  const sent = [], updates = [];
  const engine = new ClassroomAudio('host', data => sent.push(data), () => {}, data => updates.push(data));
  engine.localReceiver = { connected: true, armedTicket: 'ticket', stats: { received: 0 }, mute() {} };
  t.after(() => engine.stopAll());
  await engine.sync({ grant: 9, mode: 'local', local: { ticket: 'ticket' } });
  assert.equal(updates.at(-1).status, 'Waiting for phone audio…');
  now = 34999; t.mock.timers.tick(500); assert.deepEqual(sent, []);
  now = 35000; t.mock.timers.tick(500);
  assert.deepEqual(sent, [{ type: 'local-failed', grant: 9 }]);
  assert.equal(engine.grant, 0);
  assert.match(updates.at(-1).receiverError, /No audio reached/);

  await engine.sync({ grant: 10, mode: 'local', local: { ticket: 'ticket' } });
  engine.localReceiver.stats.received = 1; t.mock.timers.tick(500);
  assert.equal(updates.at(-1).status, '');
  now = 100000; t.mock.timers.tick(35000);
  assert.equal(sent.length, 1); assert.equal(engine.grant, 10);
});

test('a stalled audio context times out, stops transmission and does not block the next request', async t => {
  const original = globalThis.WebTransport; let transport, finishContext;
  t.mock.timers.enable({ apis: ['setInterval'] });
  let now = 0; t.mock.method(performance, 'now', () => now);
  globalThis.WebTransport = class {
    constructor() { transport = this; this.ready = Promise.resolve(); this.closed = new Promise(() => {}); this.datagrams = { writable: { getWriter: () => ({}) } }; }
    close() { this.wasClosed = true; }
  };
  const sent = [], updates = [];
  const engine = new ClassroomAudio('student', data => sent.push(data), () => {}, data => updates.push(data));
  t.after(() => { engine.stopAll(); if (original === undefined) delete globalThis.WebTransport; else globalThis.WebTransport = original; });
  const stream = () => ({ getTracks: () => [{ stop() {}, enabled: false }] });
  engine.stream = stream(); engine.context = () => new Promise(resolve => { finishContext = resolve; });
  const first = engine.sync({ activeId: 's', grant: 9, mode: 'local', local: { url: 'https://127.0.0.1:4444', hash: 'a'.repeat(43), ticket: 'b'.repeat(43) } }, 's');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(engine.localStage, 'starting-capture');
  now = 35000; t.mock.timers.tick(500); await first;
  assert.equal(transport.wasClosed, true);
  assert.deepEqual(sent, [{ type: 'local-failed', grant: 9 }]);
  assert.match(updates.at(-1).status, /not sending audio/);
  engine.stream = stream(); let nextStarted = false;
  engine.startRelay = async () => { nextStarted = true; };
  await engine.sync({ activeId: 's', grant: 10, mode: 'relay' }, 's');
  finishContext({}); await new Promise(resolve => setImmediate(resolve));
  assert.equal(nextStarted, true); assert.equal(engine.grant, 10);
  assert.equal(engine.worklet, undefined); assert.equal(sent.length, 1);
});
