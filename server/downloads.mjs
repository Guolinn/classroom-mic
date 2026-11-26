import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, extname } from 'node:path';

// Keep downloads separate from the SPA fallback: a missing zip must not be HTML.
export async function serveDownload(req, res, directory, path) {
  const match = /^\/downloads\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(path);
  const filename = match?.[1];
  let data, info;
  try {
    if (!filename || !['.zip', '.txt'].includes(extname(filename))) throw new Error('Not a download');
    const file = join(directory, filename);
    [data, info] = await Promise.all([readFile(file), stat(file)]);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(req.method === 'HEAD' ? undefined : 'Download not found.');
  }
  const size = data.length;
  const etag = '"' + createHash('sha256').update(data).digest('hex') + '"';
  const modified = info.mtime.toUTCString();
  res.setHeader('Content-Type', extname(filename) === '.zip' ? 'application/zip' : 'text/plain; charset=utf-8');
  if (extname(filename) === '.zip') res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', modified);
  res.setHeader('Content-Length', size);
  if (req.method === 'HEAD') return res.end();

  const ifRange = req.headers['if-range'];
  const range = !ifRange || ifRange === etag || ifRange === modified
    ? /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '') : null;
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
    // Ignore malformed backwards ranges; reject valid but unsatisfiable ones.
    if (!(range[1] && range[2] && Number(range[2]) < start)) {
      if (start >= size || end < start) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Content-Length': 0 });
        return res.end();
      }
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      return res.end(data.subarray(start, end + 1));
    }
  }
  res.end(data);
}
