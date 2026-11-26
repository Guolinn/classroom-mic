import { request } from 'node:https';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const origin = process.env.TEST_ORIGIN || 'https://classroom-mic.beringtech.com';
const path = '/downloads/MicTurn-Receiver-macOS.zip';
function read(path, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(new URL(path, origin), { method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Download timed out')));
    req.end();
  });
}
const head = await read(path, 'HEAD');
assert.equal(head.status, 200);
assert.equal(head.headers['accept-ranges'], 'bytes');
assert.match(head.headers['content-disposition'], /attachment/);
const size = Number(head.headers['content-length']);
assert.ok(size > 0);
const first = await read(path, 'GET', { Range: 'bytes=0-99999' });
assert.equal(first.status, 206);
assert.equal(first.body.length, 100000);
const rest = await read(path, 'GET', { Range: 'bytes=100000-', 'If-Range': head.headers.etag });
assert.equal(rest.status, 206);
assert.equal(rest.headers['content-range'], `bytes 100000-${size - 1}/${size}`);
const bytes = Buffer.concat([first.body, rest.body]);
assert.equal(bytes.length, size);
const checksum = await read('/downloads/SHA256SUMS.txt');
assert.equal(checksum.status, 200);
const sha256 = createHash('sha256').update(bytes).digest('hex');
assert.equal(sha256, checksum.body.toString().trim().split(/\s+/)[0]);
console.log(JSON.stringify({ pass: true, bytes: size, sha256, checks: ['HEAD metadata', 'partial download', 'resume', 'full checksum'] }));
