// S3c: „DASH speichern“ Ende-zu-Ende in Node – Kadris Kanal-Module + Download-Verwaltung + vendorter WASM-Kern gegen den
// echten ChannelServer UND die echte DASH-Engine der Helper-App (DashEngine: MPD-Abruf über SafeHttpClient, Fingerabdruck
// kadri-dash-fp/1, S3-Profil, Plan mit Sitzungs- und Kadri-Bindung, Fmp4Inspect, Journal, Dauerprüfung; Desktop-Harness).
// Nur der Remux ist im Harness nachgebildet (Verkettung); das echte Umpacken prüfen die Helper-Tests (tests/java/dashdl).
// Quelle: selbst erzeugt (tests/make_dash_source.sh, fMP4 H.264 + AAC-LC). Kadris Fingerabdruck berechnet Chromium
// (tests/channel/dash_fp.py: src/038 + src/039 mit dem echten DOMParser).
//   HELPER_HOST_DIR=<Helper-Repo: tests/java/channel/build.sh OUT> node tests/channel/dash_integration_check.js
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { loadChannel, startHelper, check, summary } = require('./lib');

const { NS, core } = loadChannel();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SRC = fs.mkdtempSync(path.join(os.tmpdir(), 'kadri-dash-src-'));
execFileSync('bash', [path.join(__dirname, '..', 'make_dash_source.sh'), SRC]);
const MPD = fs.readFileSync(path.join(SRC, 'manifest.mpd'), 'utf8');

// ---------- Medienserver: /d/<name>/manifest.mpd und die Stücke; starker ETag, If-Range → 206 ----------
function dashServer() {
  const st = { hits: [], delay: 0, fault: null };
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const m = /^\/d\/([a-z0-9]+)\/((?:init-\d|chunk-\d-\d{5})\.m4s|manifest\.mpd)$/.exec(u.pathname);
    const hit = { path: u.pathname, cookie: req.headers.cookie || '', auth: req.headers.authorization || '', referer: req.headers.referer || '', range: req.headers.range || '' };
    st.hits.push(hit);
    if (!m) { res.writeHead(404, { 'Content-Length': '0' }); res.end(); return; }
    if (st.fault && m[2] === st.fault.file && m[1] === st.fault.name) { hit.status = 404; res.writeHead(404, { 'Content-Length': '0' }); res.end(); return; }
    if (m[2] === 'manifest.mpd') { const b = Buffer.from(MPD); res.writeHead(200, { 'Content-Type': 'application/dash+xml', 'Content-Length': String(b.length) }); res.end(b); return; }
    if (st.delay && /^chunk/.test(m[2])) await sleep(st.delay);
    const b = fs.readFileSync(path.join(SRC, m[2]));
    const etag = '"' + crypto.createHash('sha256').update(b).digest('hex').slice(0, 16) + '"';
    if (req.headers.range === 'bytes=0-0' && req.headers['if-range'] === etag) {
      res.writeHead(206, { 'Content-Length': '1', 'Content-Range': 'bytes 0-0/' + b.length, ETag: etag }); res.end(b.subarray(0, 1)); return;
    }
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(b.length), ETag: etag });
    res.end(b);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(Object.assign(st, {
    port: srv.address().port, url: (name) => 'http://127.0.0.1:' + srv.address().port + '/d/' + name + '/manifest.mpd',
    close: () => srv.close(),
  }))));
}
function setup() {
  const store = NS.createStore(NS.memoryBackend(), () => core.identity_generate());
  const transport = NS.createTransport({ fetchImpl: (...a) => fetch(...a), port: 47899 });
  const channel = NS.createChannel({ core, store, transport });
  const mem = { jobs: undefined, writes: [] }, sent = [];
  const dl = NS.createDownloads({
    channel: { download: (op, a) => { sent.push({ op, a: JSON.parse(JSON.stringify(a)) }); return channel.download(op, a); }, status: () => channel.command('status') },
    storage: { get: async () => mem.jobs && JSON.parse(JSON.stringify(mem.jobs)), set: async (v) => { mem.jobs = JSON.parse(JSON.stringify(v)); mem.writes.push(JSON.stringify(v)); } },
    digest: async (u) => crypto.createHash('sha256').update('salt\n' + u).digest('hex'),
    random: () => crypto.randomBytes(16).toString('hex'),
  });
  return { channel, mem, dl, sent };
}
async function until(dl, id, pred, ms = 30000) {
  const end = Date.now() + ms;
  let last = null;
  while (Date.now() < end) {
    last = await dl.status(id);
    if (last && pred(last.job)) return last;
    await sleep(200);
  }
  return last;
}
const BIND = { player: 'p0123456789abcdef01234567', gen: 1, rev: 1 };
const files = async (h) => (await h.cmd('dl-files')).split(' ').slice(1);
const bytes = (names) => names.reduce((n, f) => n + fs.statSync(path.join(SRC, f)).size, 0);
const SEL360 = ['init-1.m4s'].concat([1, 2, 3, 4, 5].map((i) => 'chunk-1-0000' + i + '.m4s'), ['init-2.m4s'], [1, 2, 3, 4, 5, 6].map((i) => 'chunk-2-0000' + i + '.m4s'));

async function main() {
  const m = await dashServer();
  const names = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'];
  const fps = {};
  execFileSync('python3', [path.join(__dirname, 'dash_fp.py'), path.join(SRC, 'manifest.mpd')].concat(names.map(m.url)), { encoding: 'utf8' })
    .trim().split('\n').forEach((l) => { const [u, f] = l.split('\t'); fps[u] = f; });
  check('Kadris Fingerabdruck (Chromium, src/039) für jede Dokumentadresse berechnet', names.every((n) => /^[0-9a-f]{64}$/.test(fps[m.url(n)])), JSON.stringify(fps));
  let h = startHelper();
  check('Desktop-Helfer gestartet', /^READY/.test(await h.ready));
  try {
    check('Download-Modus (nur 127.0.0.1:' + m.port + ' erlaubt)', (await h.cmd('downloads ' + m.port)) === 'DOWNLOADS on');
    const s0 = setup();
    await s0.channel.pair(await h.code());
    const c0 = await s0.dl.capabilities();
    check('Helfer ohne DASH-Engine: dash false (kein Feld dashdl)', c0.supported === true && c0.dash === false, JSON.stringify(c0));
    let e0 = null;
    try { await s0.dl.dashPlan(m.url('one'), fps[m.url('one')], BIND); } catch (e) { e0 = e; }
    check('Helfer ohne DASH: dashplan abgelehnt (unsupported), kein Abruf beim Medienserver', e0 && e0.kind === 'unsupported' && m.hits.length === 0, e0 && e0.kind);

    check('DASH-Engine an', (await h.cmd('dash on')) === 'DASH on');
    const s = setup();
    await s.channel.pair(await h.code());
    const caps = await s.dl.capabilities();
    check('Helfer mit DASH meldet die Fähigkeit dashdl (Profil fmp4-avc-aac, kadri-dash-fp/1)', caps.supported && caps.dash === true, JSON.stringify(caps));

    // ---------- abweichender Fingerabdruck ----------
    let at = m.hits.length, e1 = null;
    try { await s.dl.dashPlan(m.url('one'), crypto.createHash('sha256').update('x').digest('hex'), BIND); } catch (e) { e1 = e; }
    check('Abweichender Fingerabdruck: plan/manifest_mismatch, Phase fingerprint', e1 && e1.kind === 'plan' && e1.reason === 'manifest_mismatch' && e1.diag && e1.diag.phase === 'fingerprint', JSON.stringify(e1));
    check('… der Helfer hat nur das MPD geladen (kein Stück), ohne Cookie/Authorization/Referer', m.hits.slice(at).length === 1 && m.hits[at].path.endsWith('/manifest.mpd')
      && !m.hits[at].cookie && !m.hits[at].auth && !m.hits[at].referer, JSON.stringify(m.hits.slice(at)));

    // ---------- Gutfall ----------
    const p = await s.dl.dashPlan(m.url('one'), fps[m.url('one')], BIND, '1,2');
    check('Plan mit Kadris Fingerabdruck: 2 Optionen (360p, 180p), H.264 + AAC-LC, gespielte Kombination markiert, keine Adresse',
      p.options.length === 2 && p.options.some((o) => o.height === 360 && o.played) && p.options.some((o) => o.height === 180 && !o.played)
      && p.options.every((o) => o.audio === 'mp4a.40.2' && /^avc1\./.test(o.video)) && Math.abs(p.duration - 20) < 0.01 && !JSON.stringify(p).includes('127.0.0.1'), JSON.stringify(p));
    at = m.hits.length;
    const r = await s.dl.dashStart(p.planId, p.options.find((o) => o.height === 360).id, 'Mein DASH');
    const d = await until(s.dl, r.job.id, (j) => j.state === 'done' || j.state === 'failed');
    check('Gespeichert (echte Engine: MPD erneut geladen, Fingerabdruck gleich, Init/Stücke geprüft, Dauer geprüft)', d.job.state === 'done' && d.job.kind === 'dash', JSON.stringify(d.job));
    check('… Datei beim Helfer veröffentlicht (genau die gewählten Darstellungen)', (await files(h)).includes('Mein_DASH.mp4:' + bytes(SEL360)), (await files(h)).join(' '));
    const got = m.hits.slice(at).map((x) => x.path.replace(/^\/d\/one\//, ''));
    check('… geladen: MPD + Init/Stücke von 360p und Ton, nichts von 180p', got.filter((x) => x !== 'manifest.mpd').sort().join(',') === SEL360.slice().sort().join(','), got.join(','));
    check('… keine Teil-Datei; Helfer sendet weder Cookie noch Authorization noch Referer', (await h.cmd('dl-parts')) === 'PARTS 0' && m.hits.every((x) => !x.cookie && !x.auth && !x.referer));
    check('Kadris Speicher: keine Adresse, kein Fingerabdruck', s.mem.writes.every((x) => !x.includes('127.0.0.1') && !x.includes('manifest') && !x.includes(fps[m.url('one')])), s.mem.writes.join('\n'));
    const again = await s.dl.dashPlan(m.url('one'), fps[m.url('one')], BIND);
    check('Fertige Quelle: neuer Plan nennt keinen laufenden Auftrag', !again.job || again.job.state !== 'running');

    // ---------- Bindung beim Helfer ----------
    const pb = await s.dl.dashPlan(m.url('two'), fps[m.url('two')], BIND);
    const other = await s.channel.download('dashstart', { id: crypto.randomBytes(16).toString('hex'), planId: pb.planId, option: pb.options[0].id, bind: { player: 'pFREMD', gen: 1, rev: 1 } });
    check('dashstart mit anderer Bindung (Player/Epoche/Revision): vom Helfer abgelehnt (plan_stale), nichts geladen', other.ok === false && other.state === 'rejected' && other.reason === 'plan_stale', JSON.stringify(other));
    const s3 = setup();
    await s3.channel.pair(await h.code());
    const foreign = await s3.channel.download('dashstart', { id: crypto.randomBytes(16).toString('hex'), planId: pb.planId, option: pb.options[0].id, bind: BIND });
    check('dashstart aus einer anderen gekoppelten Kanal-Sitzung mit fremdem Plan: abgelehnt (plan_stale)', foreign.ok === false && foreign.reason === 'plan_stale', JSON.stringify(foreign));
    const sameId = r.job.id;
    const reuse = await s.channel.download('dashstart', { id: sameId, planId: pb.planId, option: pb.options[0].id, bind: BIND });
    check('Kennung eines fertigen Auftrags erneut: kein zweiter Download (Kennung gehört dem Auftrag)', reuse.ok !== false ? reuse.state === 'done' : true, JSON.stringify(reuse));

    // ---------- neue Kanal-Sitzung zwischen Plan und Start: einmal neu planen (gleicher Fingerabdruck), gleiche Kennung ----------
    const p4 = await s.dl.dashPlan(m.url('three'), fps[m.url('three')], BIND, '0,2');
    check('Kanal neu gestartet (alle Sitzungen und Pläne ungültig)', /^READY/.test(await h.cmd('restart')));
    const n4 = s.sent.length;
    const r4 = await s.dl.dashStart(p4.planId, p4.options.find((o) => o.height === 180).id, 'Neue Sitzung');
    const d4 = await until(s.dl, r4.job.id, (j) => j.state === 'done' || j.state === 'failed');
    const ops4 = s.sent.slice(n4).filter((x) => x.op !== 'dlstatus');
    check('Plan an alte Sitzung gebunden → automatisch neu geplant (gleiches fp und played), gleiche Auswahl und Kennung, fertig',
      d4.job.state === 'done' && ops4.map((x) => x.op).join(',') === 'dashstart,dashplan,dashstart' && ops4[1].a.fp === fps[m.url('three')] && ops4[1].a.played === '0,2'
      && ops4[0].a.id === ops4[2].a.id, JSON.stringify(ops4.map((x) => [x.op, x.a.id || ''])) + ' ' + JSON.stringify(d4.job));

    // ---------- Fehlerort und Status ----------
    m.fault = { name: 'four', file: 'chunk-1-00004.m4s' };
    const p5 = await s.dl.dashPlan(m.url('four'), fps[m.url('four')], BIND);
    const r5 = await s.dl.dashStart(p5.planId, p5.options.find((o) => o.height === 360).id, 'Fehlt');
    const i5 = await until(s.dl, r5.job.id, (j) => !['running', 'starting', 'unconfirmed'].includes(j.state));
    check('Stück 404: unterbrochen mit Fehlerort video_segment (Index), fester Text, keine Datei', i5.job.state === 'interrupted' && i5.job.reason === 'http_404'
      && i5.job.loc && i5.job.loc.at === 'video_segment' && Number.isInteger(i5.job.loc.index) && /^Unterbrochen – in der Benachrichtigung der Helfer-App/.test(NS.describeDownload(i5.job).label)
      && !(await files(h)).some((f) => f.startsWith('Fehlt')), JSON.stringify(i5.job));
    m.fault = null;
    await s.dl.cancel(r5.job.id);

    // ---------- Abbruch gewinnt ----------
    m.delay = 300;
    const p6 = await s.dl.dashPlan(m.url('five'), fps[m.url('five')], BIND);
    const r6 = await s.dl.dashStart(p6.planId, p6.options[0].id, 'Abbruch');
    await sleep(500);
    await s.dl.cancel(r6.job.id);
    const c6 = await until(s.dl, r6.job.id, (j) => j.state === 'cancelled' || j.state === 'done', 15000);
    check('Abbruch: cancelled, keine Datei, keine Teil-Datei', c6.job.state === 'cancelled' && !(await files(h)).some((f) => f.startsWith('Abbruch')) && (await h.cmd('dl-parts')) === 'PARTS 0', JSON.stringify(c6.job));
    m.delay = 0;

    // ---------- Helfer-Prozess bricht ab → unterbrochen (restarted); Kadri bleibt bei derselben Kennung ----------
    m.delay = 250;
    const p7 = await s.dl.dashPlan(m.url('six'), fps[m.url('six')], BIND);
    const r7 = await s.dl.dashStart(p7.planId, p7.options[0].id, 'Neustart');
    await sleep(700);
    await h.stop({ keep: true, kill: true });
    h = startHelper({ state: h.state });
    check('Helfer nach hartem Abbruch neu gestartet (Kopplung, Journal, DASH bleiben)', /^READY/.test(await h.ready));
    m.delay = 0;
    const i7 = await until(s.dl, r7.job.id, (j) => !['running', 'starting', 'unconfirmed'].includes(j.state), 20000);
    check('Nach Prozessabbruch: unterbrochen (restarted), dieselbe Kennung', i7.job.state === 'interrupted' && i7.job.reason === 'restarted' && i7.job.id === r7.job.id, JSON.stringify(i7.job));
    await s.dl.cancel(r7.job.id);
    const caps2 = await s.dl.capabilities();
    check('Nach Neustart meldet der Helfer weiter dashdl', caps2.dash === true, JSON.stringify(caps2));
  } finally {
    await h.stop();
    m.close();
  }
  summary('dash-integration');
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
