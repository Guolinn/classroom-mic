import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { validEndpoint, validLocalAudio, parseReceiverCode } from '../shared/local-receiver.js';
import { AudioDiagnostics } from '../src/diagnostics.js';
import { ClassroomAudio } from '../src/audio.js';

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
    const before=messages.length;p.port.onmessage({data:'stop'});assert.equal(p.process([[new Float32Array(128)]]),false);assert.equal(messages.length,before);
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
