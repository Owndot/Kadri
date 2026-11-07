// P4b: „Stream speichern“ Ende-zu-Ende – Kadris Kanal-Module + Download-Verwaltung + vendorter WASM-Kern in Node gegen
// den echten ChannelServer UND die echte HLS-Engine der Helper-App (HlsEngine mit SafeHttpClient, Plänen, Sitzungs-
// bindung, Journal, Wiederaufnahme; Desktop-Harness). Nur der Remux ist im Harness nachgebildet (Verkettung); das echte
// Umpacken prüfen die Helper-Tests (tests/java/hlsmux, Emulator). Medien: synthetische HLS-Listen von einem lokalen Server.
//   HELPER_HOST_DIR=<Helper-Repo: tests/java/channel/build.sh OUT> node tests/channel/hls_integration_check.js
'use strict';
const crypto = require('crypto');
const http = require('http');
const { loadChannel, startHelper, check, summary } = require('./lib');

const { NS, core } = loadChannel();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- synthetischer HLS-Server ----------
// /s/<name>/master.m3u8 · v0.m3u8 (Video) · a.m3u8 (Ton) · v0_<n>.ts / a_<n>.ts. Jede Ressourcenzeile trägt ?t=<token>;
// ein anderes Token → 403 (abgelaufene Adresse). Starker ETag je Segment, If-Range (bytes=0-0) → 206.
function hlsServer() {
  const st = { token: 'T1', delay: 0, manifestDelay: 0, hits: [], changed: false, fault: null };
  const seg = (name) => crypto.createHash('sha256').update(name).digest();   // 32 B, deterministisch
  const body = (n) => Buffer.concat(new Array(64).fill(seg(n)));            // 2 KiB je Segment
  const N = 6;
  const lists = {
    'master.m3u8': () => '#EXTM3U\n#EXT-X-VERSION:6\n' +
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Deutsch",LANGUAGE="de",DEFAULT=YES,URI="a.m3u8?t=' + st.token + '"\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="aud"\nv0.m3u8?t=' + st.token + '\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2",AUDIO="aud"\nv1.m3u8?t=' + st.token + '\n' +
      (st.changed ? '#EXT-X-STREAM-INF:BANDWIDTH=100000,RESOLUTION=320x180,CODECS="avc1.4d400c,mp4a.40.2",AUDIO="aud"\nv1.m3u8?t=' + st.token + '\n' : ''),
    'v0.m3u8': () => media('v0'), 'v1.m3u8': () => media('v1'), 'a.m3u8': () => media('a'),
  };
  function media(p) {
    let s = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n';
    for (let i = 0; i < N; i++) s += '#EXTINF:4.0,\n' + p + '_' + i + '.ts?t=' + st.token + '\n';
    return s + '#EXT-X-ENDLIST\n';
  }
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const m = /^\/s\/[a-z0-9]+\/([a-z0-9_.]+)$/.exec(u.pathname);
    st.hits.push({ path: u.pathname, method: req.method, cookie: req.headers.cookie || '', auth: req.headers.authorization || '', referer: req.headers.referer || '',
      range: req.headers.range || '', ifRange: req.headers['if-range'] || '' });
    if (!m) { res.writeHead(404, { 'Content-Length': '0' }); res.end(); return; }
    if (u.searchParams.get('t') !== st.token) { res.writeHead(403, { 'Content-Length': '0' }); res.end(); return; }
    const f = m[1];
    // Deliberate, per-resource HTTP responses; no real site data involved.
    const fault = st.fault;
    if (fault && (f === 'gone.ts' || f === fault.file && st.hits.filter(x => x.path === u.pathname).length > fault.after)) {
      const redirect = fault.redirect && f !== 'gone.ts';
      const status = redirect ? 302 : fault.status || 404;
      st.hits[st.hits.length - 1].status = status;
      res.writeHead(status, Object.assign({ 'Content-Length': '0' }, redirect ? { Location: 'gone.ts?t=' + st.token } : {}));
      res.end(); return;
    }
    if (lists[f]) { if (st.manifestDelay) await sleep(st.manifestDelay); const b = Buffer.from(lists[f]()); res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Content-Length': String(b.length) }); res.end(b); return; }
    if (!/^(v0|v1|a)_\d+\.ts$/.test(f)) { res.writeHead(404, { 'Content-Length': '0' }); res.end(); return; }
    if (st.delay) await sleep(st.delay);
    const b = body(u.pathname);
    const etag = '"' + crypto.createHash('sha256').update(b).digest('hex').slice(0, 16) + '"';
    if (req.headers.range === 'bytes=0-0' && req.headers['if-range'] === etag) {
      res.writeHead(206, { 'Content-Length': '1', 'Content-Range': 'bytes 0-0/' + b.length, ETag: etag }); res.end(b.subarray(0, 1)); return;
    }
    res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Content-Length': String(b.length), ETag: etag });
    res.end(b);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(Object.assign(st, {
    port: srv.address().port, url: (name) => 'http://127.0.0.1:' + srv.address().port + '/s/' + name + '/master.m3u8?t=' + st.token,
    segs: () => st.hits.filter((h) => /\.ts$/.test(h.path) && !h.range).length, confirms: () => st.hits.filter((h) => h.range === 'bytes=0-0').length,
    close: () => srv.close(),
  }))));
}

function setup() {
  const store = NS.createStore(NS.memoryBackend(), () => core.identity_generate());
  const transport = NS.createTransport({ fetchImpl: (...a) => fetch(...a), port: 47899 });
  const channel = NS.createChannel({ core, store, transport });
  const mem = { jobs: undefined, writes: [] };
  const dl = NS.createDownloads({
    channel: { download: (op, a) => channel.download(op, a), status: () => channel.command('status') },
    storage: { get: async () => mem.jobs && JSON.parse(JSON.stringify(mem.jobs)), set: async (v) => { mem.jobs = JSON.parse(JSON.stringify(v)); mem.writes.push(JSON.stringify(v)); } },
    digest: async (u) => crypto.createHash('sha256').update('salt\n' + u).digest('hex'),
    random: () => crypto.randomBytes(16).toString('hex'),
  });
  return { channel, mem, dl };
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

async function main() {
  const m = await hlsServer();
  let h = startHelper();
  check('Desktop-Helfer gestartet', /^READY/.test(await h.ready));
  try {
    check('Download-Modus (nur 127.0.0.1:' + m.port + ' erlaubt)', (await h.cmd('downloads ' + m.port)) === 'DOWNLOADS on');
    const s = setup();
    await s.channel.pair(await h.code());

    // ---------- alter Helfer (ohne HLS): nichts angeboten, hlsplan abgelehnt ----------
    const c0 = await s.dl.capabilities();
    check('Helfer ohne HLS: MP4 ja, HLS nein (Status ohne „hls“)', c0.supported === true && c0.hls === false, JSON.stringify(c0));
    let e0 = null;
    try { await s.dl.hlsPlan(m.url('one'), BIND); } catch (e) { e0 = e; }
    check('Helfer ohne HLS: hlsplan → unsupported, kein Abruf beim Medienserver', e0 && e0.kind === 'unsupported' && m.hits.length === 0, e0 && e0.kind);

    // ---------- HLS an ----------
    check('HLS-Engine an', (await h.cmd('hls on')) === 'HLS on');
    const s2 = setup();
    await s2.channel.pair(await h.code());
    const caps = await s2.dl.capabilities();
    check('Helfer mit HLS meldet die Fähigkeit', caps.supported && caps.hls === true, JSON.stringify(caps));
    // Production timeout, real encrypted channel, actual HTTP: three valid playlists need > 5 s in total.
    // No retries, credentials or guessed media; planning alone must not create a download.
    m.manifestDelay = 2100;
    const slowAt = Date.now(), slowHits = m.hits.length, slowFiles = (await files(h)).length;
    let slowPlan, slowError;
    try { slowPlan = await s2.dl.hlsPlan(m.url('slowplan'), BIND); } catch (e) { slowError = e; }
    check('valid HLS planning beyond 5 s succeeds with production transport', slowPlan && slowPlan.options.length === 2 && Date.now() - slowAt >= 6000,
      slowError ? slowError.kind : 'elapsed=' + (Date.now() - slowAt));
    m.manifestDelay = 0;
    // Let an old timed-out helper finish before continuing (regression mode).
    if (slowError) await sleep(2500);
    const slowRequests = m.hits.slice(slowHits);
    check('slow plan fetches each playlist exactly once, no segments or credentials', slowRequests.length === 3 &&
      new Set(slowRequests.map(x => x.path)).size === 3 && slowRequests.every(x => x.path.endsWith('.m3u8') && x.method === 'GET' && !x.range && !x.cookie && !x.auth && !x.referer));
    check('slow plan creates no job or publication', !slowPlan?.job && (await files(h)).length === slowFiles);
    const p = await s2.dl.hlsPlan(m.url('one'), BIND);
    check('Plan: zwei Qualitäten mit eigener Tonspur, Dauer 24 s, keine Adresse', p.options.length === 2 && p.options[0].height === 720 &&
      p.options[0].audio.lang === 'de' && Math.abs(p.duration - 24) < 0.01 && !JSON.stringify(p).includes('127.0.0.1'), JSON.stringify(p));
    const r = await s2.dl.hlsStart(p.planId, p.options[0].id, 'Mein Stream');
    const d = await until(s2.dl, r.job.id, (j) => j.state === 'done' || j.state === 'failed');
    check('Stream gespeichert (echte Engine, 2 Listen + 12 Segmente)', d.job.state === 'done' && d.job.kind === 'hls', JSON.stringify(d.job));
    check('… Datei beim Helfer veröffentlicht', (await files(h)).some((f) => f.startsWith('Mein_Stream.mp4:')), (await files(h)).join(' '));
    check('… keine Teil-Datei', (await h.cmd('dl-parts')) === 'PARTS 0');
    check('Helfer sendet weder Cookie noch Authorization noch Referer', m.hits.length > 0 && m.hits.every((x) => !x.cookie && !x.auth && !x.referer));
    check('Kadris Speicher: keine Adresse, kein Token', s2.mem.writes.every((x) => !x.includes('127.0.0.1') && !x.includes('t=T') && !x.includes('m3u8')), s2.mem.writes.join('\n'));
    const again = await s2.dl.hlsPlan(m.url('one'), BIND);
    check('Fertige Quelle: neuer Plan nennt keinen laufenden Auftrag', !again.job || again.job.state !== 'running');

    // ---------- abgelaufene Quelle → unterbrochen → neuer Plan → Fortsetzen (gleiche Kennung, Segmente bestätigt) ----------
    m.delay = 150;
    const p3 = await s2.dl.hlsPlan(m.url('two'), BIND);
    const r3 = await s2.dl.hlsStart(p3.planId, p3.options[1].id, 'Abgelaufen');
    let end = Date.now() + 15000;
    while (m.segs() < 4 + 12 && Date.now() < end) await sleep(20);
    m.token = 'T2';
    const i3 = await until(s2.dl, r3.job.id, (j) => j.state !== 'running' && j.state !== 'starting');
    check('Adresse abgelaufen (403): unterbrochen, nicht fehlgeschlagen', i3.job.state === 'interrupted' && i3.job.reason === 'http_403', JSON.stringify(i3.job));
    m.delay = 0;
    const segsBefore = m.segs(), confBefore = m.confirms();
    const p4 = await s2.dl.hlsPlan(m.url('two'), BIND);
    check('Neuer Plan (neues Token) nennt den unterbrochenen Auftrag', p4.job && p4.job.id === r3.job.id && p4.job.state === 'interrupted');
    const res = await s2.dl.hlsResume(r3.job.id, p4.planId, p4.options.find((o) => o.height === 360).id);
    const d4 = await until(s2.dl, r3.job.id, (j) => j.state === 'done' || j.state === 'failed');
    check('Fortsetzen: gleiche Kennung, fertig', res.job.id === r3.job.id && d4.job.state === 'done', JSON.stringify(d4.job));
    check('Fortsetzen: verifizierte Segmente per starkem ETag bestätigt statt neu geladen', m.confirms() - confBefore > 0 && m.segs() - segsBefore < 12,
      'refetched=' + (m.segs() - segsBefore) + ' confirmed=' + (m.confirms() - confBefore));

    // ---------- Helfer-Prozess bricht ab → nach Neustart unterbrochen → fortsetzen ----------
    m.delay = 150;
    const p5 = await s2.dl.hlsPlan(m.url('three'), BIND);
    const r5 = await s2.dl.hlsStart(p5.planId, p5.options[0].id, 'Neustart');
    end = Date.now() + 15000;
    const base = m.segs();
    while (m.segs() < base + 4 && Date.now() < end) await sleep(20);
    await h.stop({ keep: true, kill: true });
    h = startHelper({ state: h.state });
    check('Helfer nach hartem Abbruch neu gestartet (Kopplung, Journal, HLS bleiben)', /^READY/.test(await h.ready));
    m.delay = 0;
    const i5 = await until(s2.dl, r5.job.id, (j) => j.state !== 'running' && j.state !== 'starting' && j.state !== 'unconfirmed', 20000);
    check('Nach Prozessabbruch: unterbrochen (restarted)', i5.job.state === 'interrupted' && i5.job.reason === 'restarted', JSON.stringify(i5.job));
    const p6 = await s2.dl.hlsPlan(m.url('three'), BIND);
    await s2.dl.hlsResume(r5.job.id, p6.planId, p6.options[0].id);
    const d6 = await until(s2.dl, r5.job.id, (j) => j.state === 'done' || j.state === 'failed');
    check('… fortgesetzt und fertig', d6.job.state === 'done', JSON.stringify(d6.job));

    // ---------- Abbruch gewinnt ----------
    m.delay = 200;
    const p7 = await s2.dl.hlsPlan(m.url('four'), BIND);
    const r7 = await s2.dl.hlsStart(p7.planId, p7.options[0].id, 'Abbruch');
    await sleep(500);
    await s2.dl.cancel(r7.job.id);
    const c7 = await until(s2.dl, r7.job.id, (j) => j.state === 'cancelled' || j.state === 'done', 15000);
    check('Abbruch: cancelled, keine Datei, keine Teil-Datei', c7.job.state === 'cancelled' && !(await files(h)).some((f) => f.startsWith('Abbruch')) && (await h.cmd('dl-parts')) === 'PARTS 0', JSON.stringify(c7.job));
    m.delay = 0;
    const p8 = await s2.dl.hlsPlan(m.url('four'), BIND);
    check('Abgebrochene Quelle: kein Fortsetzen angeboten', !p8.job || p8.job.state !== 'interrupted');

    // ---------- neue Kanal-Sitzung zwischen Plan und Start: einmal neu planen, dann starten ----------
    const p9 = await s2.dl.hlsPlan(m.url('five'), BIND);
    check('Kanal neu gestartet (alle Sitzungen ungültig)', /^READY/.test(await h.cmd('restart')));
    const r9 = await s2.dl.hlsStart(p9.planId, p9.options[1].id, 'Neue Sitzung');
    const d9 = await until(s2.dl, r9.job.id, (j) => j.state === 'done' || j.state === 'failed');
    check('Plan an alte Sitzung gebunden → automatisch neu geplant, gleiche Auswahl, fertig', d9.job.state === 'done', JSON.stringify(d9.job));

    // ---------- Liste ändert sich zwischen Plan und Start ----------
    const p10 = await s2.dl.hlsPlan(m.url('six'), BIND);
    m.changed = true;
    const r10 = await s2.dl.hlsStart(p10.planId, p10.options[0].id, 'Geändert');
    const d10 = await until(s2.dl, r10.job.id, (j) => j.state !== 'running' && j.state !== 'starting');
    check('Geänderte Liste: fehlgeschlagen mit plan_changed, kein stilles Weiterladen', d10.job.state === 'failed' && d10.job.reason === 'plan_changed', JSON.stringify(d10.job));
    m.changed = false;

    // Device evidence now also contains http_412 during planning. Preserve that distinct origin response.
    for (const file of ['master.m3u8', 'v0.m3u8']) {
      const at = m.hits.length, before = (await files(h)).length;
      m.fault = { file, after: 0, status: 412 };
      let error;
      try { await s2.dl.hlsPlan(m.url(file === 'master.m3u8' ? 'preconditionsource' : 'preconditionmedia'), BIND); } catch (e) { error = e; }
      check('HTTP 412 at ' + file + ' preserves helper planning rejection', error?.kind === 'plan' && error.reason === 'http_412', error?.kind);
      const hits = m.hits.slice(at);
      check('HTTP 412: one failed anonymous GET, no retry, no segments, no publication', hits.filter(x => x.status === 412).length === 1 &&
        hits.filter(x => x.path.endsWith('/' + file)).length === 1 && hits.every(x => x.path.endsWith('.m3u8') && x.method === 'GET' && !x.range && !x.cookie && !x.auth && !x.referer) && (await files(h)).length === before);
      m.fault = null;
    }
    // Synthetic protocol evidence: same outward http_404 can mean different resources. A menu is no guarantee.
    const failures = [
      ['plan source', 'master.m3u8', 0, 0, true, false],
      ['plan video', 'v0.m3u8', 0, 0, true, false],
      ['plan audio', 'a.m3u8', 0, 0, true, false],
      ['source expires after plan', 'master.m3u8', 1, 0, false, false],
      ['video unavailable after plan', 'v0.m3u8', 1, 0, false, false],
      ['audio unavailable after plan', 'a.m3u8', 1, 0, false, false],
      ['only second quality unavailable', 'v1.m3u8', 0, 1, false, false],
      ['first video segment', 'v0_0.ts', 0, 0, false, false],
      ['later video segment', 'v0_4.ts', 0, 0, false, false],
      ['first audio segment', 'a_0.ts', 0, 0, false, false],
      ['segment redirect to missing resource', 'v0_0.ts', 0, 0, false, true],
    ];
    for (const [i, [label, file, after, option, planFailure, redirect]] of failures.entries()) {
      const name = 'httpcase' + i, start = m.hits.length, before = (await files(h)).length;
      m.fault = { file, after, redirect };
      let plan, err;
      try { plan = await s2.dl.hlsPlan(m.url(name), BIND); } catch (e) { err = e; }
      if (planFailure) check(label + ': rejected at hlsplan with http_404', err && err.reason === 'http_404' && !plan);
      else {
        check(label + ': planning succeeds before the failing fetch', plan && plan.options.length === 2 && !err);
        if (option === 1) check('planning does not fetch the second media playlist', !m.hits.slice(start).some(x => x.path.endsWith('/v1.m3u8')));
        const r = await s2.dl.hlsStart(plan.planId, plan.options[option].id, 'Synthetic HTTP');
        const status = await until(s2.dl, r.job.id, j => !['running', 'starting', 'unconfirmed'].includes(j.state));
        check(label + ': old helper reports interrupted/http_404 without exact resource', status.job.state === 'interrupted' && status.job.reason === 'http_404' && !status.job.phase, JSON.stringify(status.job));
        if (file === 'v0_4.ts') check('late failure preserves already fetched resources', status.job.done > 0);
        await s2.dl.cancel(r.job.id);
      }
      const hits = m.hits.slice(start);
      check(label + ': actual server response proves HTTP 404', hits.some(x => x.status === 404));
      check(label + ': no credentials and fresh HLS requests use GET without Range', hits.every(x => x.method === 'GET' && !x.cookie && !x.auth && !x.referer && !x.range));
      check(label + ': no automatic retry of the missing resource', hits.filter(x => x.path.endsWith('/' + file)).length === after + 1);
      check(label + ': no publication', (await files(h)).length === before);
      if (redirect) check('redirect chain captured as 302 then 404', hits.some(x => x.status === 302) && hits.some(x => x.path.endsWith('/gone.ts') && x.status === 404));
      m.fault = null;
    }
  } finally {
    await h.stop();
    m.close();
  }
  summary('hls-integration');
}
main().catch((e) => { console.error(e); process.exit(1); });
