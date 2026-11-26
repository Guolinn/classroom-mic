import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { LocalSenderQueue } from '../src/local-sender-queue.js';
import { openLocalAudioSender } from '../src/local-audio-sender.js';

const config = { url: 'https://127.0.0.1:4444', hash: 'a'.repeat(43), ticket: 'b'.repeat(43) };
const frame = (producedAt = Date.now()) => ({ buffer: new ArrayBuffer(492), producedAt, maxCaptureGapMs: 12 });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('sender bounds outstanding audio, discards stale messages, and stops after mute', async () => {
  let time = 100, failures = 0; const writes = [], finish = [];
  const queue = new LocalSenderQueue({ write: data => { writes.push(data); return new Promise(resolve => finish.push(resolve)); } }, () => failures++, { now: () => time, wallNow: () => time });
  for (let i = 0; i < 6; i++) queue.accept(frame(time));
  assert.equal(writes.length, 3); assert.equal(queue.stats.dropped, 3);
  time += 10; finish.splice(0).forEach(resolve => resolve()); await tick();
  queue.accept(frame(time - 40)); assert.equal(writes.length, 3);
  queue.accept(frame(time)); assert.equal(writes.length, 4);
  assert.equal(queue.stats.maxDispatchLagMs, 40); assert.equal(queue.stats.maxCaptureGapMs, 12);
  assert.equal(queue.stats.maxWriteMs, 10);
  queue.close(); queue.accept(frame(time)); assert.equal(writes.length, 4); assert.equal(failures, 0);
  finish.forEach(resolve => resolve());
});

test('an asynchronous writer failure is reported once and cannot revive a stopped sender', async () => {
  let failWrite, failures = 0;
  const queue = new LocalSenderQueue({ write: () => new Promise((_, reject) => { failWrite = reject; }) }, () => failures++);
  queue.accept(frame()); failWrite(new Error('closed')); await tick();
  assert.equal(failures, 1);
  queue.accept(frame()); queue.close(); failWrite(new Error('muted')); await tick();
  assert.equal(failures, 1);
});

test('worker network rejection does not silently retry on the page', async () => {
  let stopped = false;
  const worker = { terminate() { stopped = true; }, postMessage() { queueMicrotask(() => worker.onmessage({ data: { type: 'error', message: 'Permission denied' } })); } };
  await assert.rejects(openLocalAudioSender(config, () => {}, () => 0, () => worker), /Permission denied/);
  assert.equal(stopped, true);
});

test('audio transfers directly over a MessagePort to the actual sender worker and stops on close', async t => {
  const url = new URL('../src/local-sender-worker.js', import.meta.url).href;
  const bootstrap = `
    import { parentPort } from 'node:worker_threads';
    globalThis.self = globalThis;
    self.postMessage = data => parentPort.postMessage(data);
    globalThis.WebTransport = class {
      constructor() {
        this.ready = Promise.resolve(); this.closed = new Promise(() => {});
        this.datagrams = { createWritable: () => new WritableStream({ write: bytes => parentPort.postMessage({ type: 'observed-write', length: bytes.length, value: bytes[12] }) }) };
      }
      close() {}
    };
    await import(${JSON.stringify(url)});
    parentPort.on('message', data => self.onmessage({ data }));
  `;
  const native = new NodeWorker(new URL('data:text/javascript,' + encodeURIComponent(bootstrap)), { type: 'module' });
  t.after(() => native.terminate());
  let observed;
  const written = new Promise(resolve => { observed = resolve; });
  const adapter = { postMessage: (data, transfer) => native.postMessage(data, transfer), terminate: () => native.terminate() };
  native.on('message', data => { if (data.type === 'observed-write') observed(data); else adapter.onmessage?.({ data }); });
  native.on('error', error => adapter.onerror?.(error));
  const sender = await openLocalAudioSender(config, () => {}, () => 0, () => adapter);
  let audioPort;
  sender.attach({ port: { postMessage(data) { audioPort = data.port; } } });
  t.after(() => audioPort.close());
  const data = frame(); new Uint8Array(data.buffer)[12] = 37;
  audioPort.postMessage(data, [data.buffer]);
  assert.deepEqual(await written, { type: 'observed-write', length: 492, value: 37 });
  sender.close(); assert.equal((await sender.closed).closeCode, 1);
});
