// Testserver für direkte MP4-Downloads (Phase C3): liefert tests/web/clip.mp4 (VP9 in MP4, eigenes Testmaterial) mit
// Content-Length, starkem ETag und Range. Steuerung über die Abfrage:
//   rate=<Bytes/s>  langsam (für Fortschritt, Abbruch, Neustarts) – nur für Anfragen OHNE Browser-Kopfzeilen (Helfer)
//   auth=1          403 ohne Cookie „sess=…“ (Seite verlangt die Anmeldung des Browsers)
//   type=<mime>     anderer Content-Type
// Jede Anfrage wird mit Cookie/Authorization/Referer/User-Agent aufgezeichnet (hits).
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');

const CLIP = fs.readFileSync(path.join(__dirname, '..', 'web', 'clip.mp4'));
const ETAG = '"kadri-clip-v1"';

function start(port = 0) {
  const hits = [];
  const sockets = new Set();
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const browser = !!req.headers['sec-fetch-mode'];
    hits.push({ path: u.pathname, query: u.search, browser, cookie: req.headers.cookie || '', auth: req.headers.authorization || '',
      referer: req.headers.referer || '', ua: req.headers['user-agent'] || '', range: req.headers.range || '' });
    if (!u.pathname.endsWith('.mp4')) { res.writeHead(404, { 'Content-Length': '0' }); res.end(); return; }
    if (u.searchParams.get('auth') === '1' && !/(^|;\s*)sess=/.test(req.headers.cookie || '')) {
      res.writeHead(403, { 'Content-Type': 'text/plain', 'Content-Length': '9' }); res.end('forbidden'); return;
    }
    let start = 0, end = CLIP.length - 1, code = 200;
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m) { start = m[1] ? +m[1] : 0; end = m[2] ? Math.min(+m[2], CLIP.length - 1) : CLIP.length - 1; code = 206; }
    const head = { 'Content-Type': u.searchParams.get('type') || 'video/mp4', 'Content-Length': String(end - start + 1), 'ETag': ETAG,
      'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    if (code === 206) head['Content-Range'] = 'bytes ' + start + '-' + end + '/' + CLIP.length;
    res.writeHead(code, head);
    if (req.method === 'HEAD') { res.end(); return; }
    const body = CLIP.subarray(start, end + 1);
    const rate = browser ? 0 : +(u.searchParams.get('rate') || 0);
    if (!rate) { res.end(body); return; }
    const step = Math.max(1024, Math.floor(rate / 10));
    let at = 0;
    const tick = () => {
      if (res.destroyed) return;
      if (at >= body.length) { res.end(); return; }
      res.write(body.subarray(at, at + step)); at += step;
      setTimeout(tick, 100);
    };
    tick();
  });
  srv.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve({
    port: srv.address().port, hits, size: CLIP.length,
    url: (p, q) => 'http://127.0.0.1:' + srv.address().port + p + (q ? '?' + q : ''),
    close: () => new Promise((r) => { for (const s of sockets) s.destroy(); srv.close(r); }),
  })));
}

module.exports = { start };
if (require.main === module) start(+process.argv[2] || 0).then((m) => console.log('MEDIA ' + m.port));
