import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveDownload } from '../server/downloads.mjs';

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'mic-download-test-'));
  const bytes = Buffer.alloc(8 * 1024 * 1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  await writeFile(join(dir, 'receiver.zip'), bytes);
  const server = createServer((req, res) => serveDownload(req, res, dir, new URL(req.url, 'http://localhost').pathname));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true }); });
  return { bytes, url: `http://127.0.0.1:${server.address().port}/downloads/receiver.zip` };
}

test('download metadata and resumed bytes reconstruct an interrupted transfer exactly', async t => {
  const { bytes, url } = await setup(t);
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), String(bytes.length));
  assert.equal(head.headers.get('accept-ranges'), 'bytes');
  assert.match(head.headers.get('content-disposition'), /attachment; filename="receiver.zip"/);
  const etag = head.headers.get('etag');
  const first = await new Promise((resolve, reject) => {
    const request = get(url, response => response.once('data', chunk => { request.destroy(); resolve(chunk); }));
    request.on('error', err => { if (err.code !== 'ECONNRESET') reject(err); });
  });
  assert.ok(first.length > 0 && first.length < bytes.length);
  const resumed = await fetch(url, { headers: { Range: `bytes=${first.length}-`, 'If-Range': etag } });
  assert.equal(resumed.status, 206);
  assert.equal(resumed.headers.get('content-range'), `bytes ${first.length}-${bytes.length - 1}/${bytes.length}`);
  assert.deepEqual(Buffer.concat([first, Buffer.from(await resumed.arrayBuffer())]), bytes);
});

test('downloads handle suffixes, unsatisfiable offsets, changed files and missing archives', async t => {
  const { bytes, url } = await setup(t);
  const tail = await fetch(url, { headers: { Range: 'bytes=-128' } });
  assert.equal(tail.status, 206);
  assert.deepEqual(Buffer.from(await tail.arrayBuffer()), bytes.subarray(-128));
  const outside = await fetch(url, { headers: { Range: `bytes=${bytes.length}-` } });
  assert.equal(outside.status, 416);
  assert.equal(outside.headers.get('content-range'), `bytes */${bytes.length}`);
  const changed = await fetch(url, { headers: { Range: 'bytes=100-', 'If-Range': '"old-file"' } });
  assert.equal(changed.status, 200);
  assert.deepEqual(Buffer.from(await changed.arrayBuffer()), bytes);
  const missing = await fetch(url.replace('receiver.zip', 'missing.zip'));
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), 'Download not found.');
});
