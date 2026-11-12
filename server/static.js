// Serve the built web app from public/, falling back to index.html.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

export async function serveStatic(req, res, pathname, publicDir) {
  let rel;
  try {
    rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = join(publicDir, rel);
  if (!file.startsWith(publicDir.endsWith(sep) ? publicDir : publicDir + sep) && file !== publicDir) {
    res.writeHead(403).end();
    return;
  }
  let st = await stat(file).catch(() => null);
  if (!st || st.isDirectory()) {
    file = join(publicDir, 'index.html');
    st = await stat(file).catch(() => null);
    if (!st) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Web app not built. Run: npm run build\n');
      return;
    }
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'content-length': st.size,
    'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=3600',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}
