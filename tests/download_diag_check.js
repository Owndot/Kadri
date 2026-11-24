'use strict';
// Actual content functions, synthetic protocol replies; no real media or credentials.
// Optional root permits proving the diagnostic regressions against the prior source.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let passed = 0;
function check(name, value) { assert.ok(value, name); passed++; console.log('PASS ' + name); }
function setup(kind = 'mp4', env = {}) {
  const timers = [], requests = [], probes = [];
  const url = 'https://private.invalid/private-video?token=PRIVATE-SENTINEL';
  const source = { sourceId: 'source-private-id', revision: 7, kind, role: kind === 'hls' ? 'master' : 'file',
    association: { state: 'bound', evidence: ['element-src'] }, browser: 'loaded',
    quality: { status: 'observed', value: { height: 360 } },
    provenance: [{ kind: 'element', origin: 'element-playing', observedAt: Date.now() - 120000 }] };
  const opt = { ctx: {}, sourceId: source.sourceId, revision: 7, identity: 'played' };
  const v = { isConnected: true, currentSrc: url, readyState: 4, videoWidth: 640, videoHeight: 360,
    buffered: { length: 1, start: () => 0, end: () => 8 }, played: { length: 1, start: () => 0, end: () => 2 }, paused: false };
  const ctx = { IN_FRAME: false, fui: { n: '', rid: '' }, fuiLog() {}, URL, Date, WeakMap, TextDecoder, Uint8Array, CONFIG: {}, document: { hidden: false }, active: v, addEventListener() {}, removeEventListener() {},
    setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout() {}, toast() {}, tr: (x) => x,
    pageTitle: () => 'PRIVATE-TITLE', fmtTime: () => '1:00',
    mediaRegistry: { snapshot: () => [source], resolveSelection: () => ({ ok: true, url }), resolveStream: () => ({ ok: true, url, bind: {} }) },
    gmXhr: () => (o) => { probes.push(o); ctx.probeReply(o); return { abort() {} }; },
    probeReply: (o) => o.onload({ status: 206 }),
    // Browser-Vergleich: zulässiger Referer und Sitzungsregel wie im Inhaltsskript (synthetisch)
    mediaReferrer: () => (env.ref === undefined ? 'https://private.invalid/page' : env.ref),
    baseDomain: (h) => String(h).split('.').slice(-2).join('.'), location: { hostname: env.page || 'www.private.invalid' },
    SHOW_DOWNLOAD: false,
    // Variante C nur nach Bestätigung: Aufrufe und Texte des Dialogs werden festgehalten
    confirms: [], confirm: (msg) => { ctx.confirms.push(msg); return typeof env.confirm === 'function' ? env.confirm(msg) : false; },
    KADRI_DOWNLOAD: async (op, args) => { requests.push({ op, args }); return ctx.reply(op, args); },
    reply: () => ({ ok: true, value: { job: { id: 'job-private-id', state: 'running', ...(kind === 'hls' ? { kind, done: 0, of: 0 } : {}) } } }) };
  vm.createContext(ctx);
  vm.runInContext(read('src/045-media-source.js') + '\n' + read('src/080-helper-app.js').split('  // Einen früher gespeicherten')[0] + '\n' + read('src/105-download-knopf.js') +
    '\nglobalThis.api={pageDlStartMp4,pageDlPlan,onPageDownload,hdlDiagUpdate,hdlDiagText,diags:hdlDiags};', ctx);
  const anon = read('src/280-diagnose.js');
  vm.runInContext(anon.slice(anon.indexOf('  function anonScrub'), anon.indexOf('  function diagAnon')) + '\nglobalThis.scrub=anonScrub;', ctx);
  return { ctx, api: ctx.api, opt, url, timers, requests, probes, source };
}
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
(async () => {
  const a = setup('mp4', { confirm: () => true });
  await a.api.pageDlStartMp4(a.opt);
  check('direct MP4 creates a diagnostic without opening the player', a.api.diags.length === 1);
  a.api.hdlDiagUpdate({ id: 'job-private-id', state: 'failed', reason: 'http_404' });
  await flush();
  let text = a.api.hdlDiagText(a.api.diags[0]);
  check('MP4 exposes helper status, GET phase, source age and played identity', /Grund http_404/.test(text) && /HTTP 404/.test(text) && /Phase mp4-get/.test(text) && /Alter beim Start 120 s/.test(text) && /Identität diese Wiedergabe/.test(text));
  check('comparison is three plain GETs without Range: A anonymous, B Referer without cookies, C Referer with session',
    a.probes.length === 3 && a.probes.every((o) => o.method === 'GET' && !Object.keys(o.headers).some((k) => /range/i.test(k))) &&
    a.probes[0].anonymous === true && JSON.stringify(a.probes[0].headers) === '{}' &&
    a.probes[1].anonymous === true && JSON.stringify(a.probes[1].headers) === '{"Referer":"https://private.invalid/page"}' &&
    a.probes[2].anonymous === false && JSON.stringify(a.probes[2].headers) === '{"Referer":"https://private.invalid/page"}');
  check('comparison result differs explicitly from helper result',
    /Browser-Vergleich \(Browser-User-Agent\): A ohne Cookies\/Referer HTTP 206 · B mit Referer, ohne Cookies HTTP 206 · C mit Browsersitzung HTTP 206/.test(text));
  check('comparison is bounded: 15 s timeout, no body kept', a.probes.every((o) => o.timeout === 15000 && o.responseType === 'arraybuffer'));
  check('source/job/title/URL sentinels never appear in shareable diagnostic', !/private|PRIVATE|token=|https:|\.invalid/.test(a.ctx.scrub(text)));
  check('download request unchanged; no diagnostic data forwarded', a.requests[0].op === 'start' && Object.keys(a.requests[0].args).sort().join(',') === 'name,url');

  const b = setup('hls');
  b.ctx.reply = (op) => op === 'hlsplan' ? { ok: true, value: { planId: 'plan-private-id', options: [{ id: 'option-private-id', height: 720, audio: 'muxed' }] } }
    : { ok: true, value: { job: { id: 'job-private-id', kind: 'hls', state: 'interrupted', reason: 'http_404', done: 2, of: 13, phase: '' } } };
  const bMenus = [];
  b.ctx.pageDlMenu = (title, items) => bMenus.push(items);
  await b.api.pageDlPlan(b.opt);
  check('single HLS quality: selection shown first, nothing started by the plan alone',
    bMenus.length === 1 && bMenus[0].length === 1 && /720p/.test(bMenus[0][0].label) && !b.requests.some((r) => r.op === 'hlsstart'));
  await bMenus[0][0].fn();
  check('direct HLS preserves HTTP 404 in interrupted state', b.api.diags.length === 1 && b.api.diags[0].reason === 'http_404' && b.api.diags[0].state === 'interrupted');
  text = b.api.hdlDiagText(b.api.diags[0]);
  check('HLS distinguishes successful planning from unknown error resource', /Planung erfolgreich \(erste Option\)/.test(text) && /Ressourcen 2\/13 \(inkl. Init\)/.test(text) && /Phase unbekannt/.test(text));
  check('HLS never probes the master as a substitute for the failed resource', b.probes.length === 0 && /HLS-Ressource unbekannt/.test(text));
  b.ctx.reply = () => ({ ok: true, value: { job: { id: 'job-private-id', kind: 'hls', state: 'running', done: 3, of: 13, phase: 'fetch', reason: '' } } });
  b.timers.shift()(); await new Promise(resolve => setImmediate(resolve));
  check('interrupted diagnostic keeps polling and follows helper resume', b.requests.some(x => x.op === 'status') && b.api.diags[0].state === 'running' && b.api.diags[0].reason === '');
  b.api.hdlDiagUpdate({ id: 'job-private-id', state: 'cancelled', reason: '', done: 0, of: 13 });
  b.api.hdlDiagUpdate({ id: 'job-private-id', state: 'running', reason: '' });
  check('cancelled remains final even on a late status reply', b.api.diags[0].state === 'cancelled');

  const c = setup('hls');
  c.ctx.reply = () => ({ ok: false, error: { kind: 'plan', reason: 'http_404', message: 'PRIVATE-SENTINEL' } });
  await c.api.pageDlPlan(c.opt);
  text = c.api.hdlDiagText(c.api.diags[0]);
  check('hlsplan rejection recorded before a job exists', c.api.diags.length === 1 && /Phase hlsplan/.test(text) && /HTTP 404/.test(text) && !c.api.diags[0].id);
  check('plan rejection creates no job, no retry and no browser media probe', c.requests.length === 1 && c.requests[0].op === 'hlsplan' && c.probes.length === 0);
  check('free-form helper error message excluded', !text.includes('PRIVATE'));
  const precondition = setup('hls');
  precondition.ctx.reply = () => ({ ok: false, error: { kind: 'plan', reason: 'http_412' } });
  await precondition.api.pageDlPlan(precondition.opt);
  check('HTTP 412 remains a planning rejection, with no HTTP 404 substitution or probe',
    /HTTP 412.*Phase hlsplan/.test(precondition.api.hdlDiagText(precondition.api.diags[0])) && precondition.probes.length === 0 && precondition.requests.length === 1);
  for (const [phase, playlists] of [['source_fetch', 0], ['video_fetch', 1], ['audio_fetch', 2], ['audio_parse', 2], ['plan_build', 3]]) {
    const h = setup('hls');
    h.ctx.reply = () => ({ ok: false, error: { kind: 'plan', reason: 'http_412',
      diag: { v: 1, phase, playlists, url: 'https://private.invalid/SECRET', cookie: 'PRIVATE' } } });
    await h.api.pageDlPlan(h.opt);
    await flush();
    const text = h.ctx.scrub(h.api.hdlDiagText(h.api.diags[0]));
    check('Direct button anonymous diagnostic identifies ' + phase,
      text.includes('Planungsschritt ' + phase) && text.includes('Listen verarbeitet ' + playlists) &&
      text.includes('Medienabrufe noch nicht begonnen') && !/private|PRIVATE|SECRET/.test(text));
    // Nur wenn der Helfer die gewählte Liste selbst als Fehlerstelle meldet, ist sie die richtige Vergleichsressource
    if (phase === 'source_fetch') check('HLS source_fetch: the selected playlist is compared (A, B; C only after confirmation)',
      h.probes.length === 2 && h.probes.every((o) => o.url === h.url && !o.headers.Range && o.anonymous === true) && /Browser-Vergleich/.test(text) &&
      /A ohne Cookies\/Referer HTTP 206/.test(text) && /C mit Browsersitzung nicht ausgeführt \(nicht bestätigt\)/.test(text));
    else check('HLS ' + phase + ': failed resource unknown, no substitute probe', h.probes.length === 0 && !/Browser-Vergleich/.test(text));
  }
  for (const diag of [{ v: 1, phase: 'https://private.invalid/SECRET', playlists: 0 },
    { v: 1, phase: 'source_fetch', playlists: 4 }, { v: 1, phase: 'source_fetch', playlists: '0' },
    { v: 2, phase: 'source_fetch', playlists: 0 }]) {
    const h = setup('hls');
    h.ctx.reply = () => ({ ok: false, error: { reason: 'http_404', diag } });
    await h.api.pageDlPlan(h.opt);
    check('Page boundary drops untrusted phase/count/version', !h.api.diags[0].planPhase &&
      !h.api.hdlDiagText(h.api.diags[0]).includes('PRIVATE'));
  }

  const d = setup();
  await d.api.pageDlStartMp4(d.opt);
  d.api.hdlDiagUpdate({ id: 'job-private-id', state: 'failed', reason: 'range_http_404' });
  check('MP4 Range failure distinct from initial GET', /Phase mp4-range/.test(d.api.hdlDiagText(d.api.diags[0])));
  const e = setup('hls');
  let now = Date.now();
  e.ctx.Date = { now: () => now };
  e.ctx.reply = () => { now += 8000; return { ok: false, error: { reason: 'http_404' } }; };
  await e.api.pageDlPlan(e.opt);
  check('time to plan failure includes the actual request duration', e.api.diags[0].failAfter === 8);
  const f = setup('hls');
  f.ctx.reply = () => ({ ok: true, value: { planId: 'plan-private-id', options: [], job: { id: 'existing-private-id', kind: 'hls', state: 'running' } } });
  await f.api.pageDlPlan(f.opt);
  f.api.hdlDiagUpdate({ id: 'existing-private-id', kind: 'hls', state: 'interrupted', reason: 'http_404' });
  check('existing job discovered while planning is not mislabelled as a plan failure', /Phase unbekannt/.test(f.api.hdlDiagText(f.api.diags[0])) && f.requests.length === 1);
  const g = setup();
  g.ctx.reply = () => ({ ok: false, error: { kind: 'helper-busy' } });
  await g.api.pageDlStartMp4(g.opt);
  check('fixed channel codes with hyphens are preserved', /Grund helper-busy/.test(g.api.hdlDiagText(g.api.diags[0])));
  // Known protocol errors must survive the *anonymous copy*, not just the unfiltered diagnostic.
  // These are synthetic cases, not a guess at the device's redacted reason.
  for (const reason of ['no_supported_variant', 'av_duration_mismatch', 'attributes_duplicate', 'stream_inf_without_uri',
    'blocked_automatic_retry', 'blocked_bad_argument', 'blocked_body_too_large', 'blocked_credential_header',
    'blocked_credentials_in_url', 'blocked_headers_too_large', 'blocked_redirect_target',
    'blocked_redirect_without_location', 'blocked_too_many_redirects']) {
    const h = setup('hls');
    h.ctx.reply = () => ({ ok: false, error: { kind: 'plan', reason } });
    await h.api.pageDlPlan(h.opt);
    const anon = h.ctx.scrub(h.api.hdlDiagText(h.api.diags[0]));
    check('anonymous copy preserves known helper code ' + reason, anon.includes('Grund ' + reason + ' nach') && anon.includes('Phase hlsplan'));
  }
  const scrub = g.ctx.scrub;
  for (const secret of ['private_identifier_123456789', 'blocked_private_identifier_123456789',
    'no_supported_variant_private', 'private_no_supported_variant', 'NO_SUPPORTED_VARIANT',
    'https://private.invalid/no_supported_variant?token=private_identifier_123456789', 'no_supported_variant.private.invalid']) {
    check('anonymous copy still removes synthetic private value ' + secret.split(':')[0], scrub(secret) === '[entfernt]');
  }
  // C nur, wo die bestehende Regel Cookies erlaubt (gleiche Basisdomain wie die Seite); sonst nicht durchgeführt
  const x1 = setup('mp4', { page: 'www.other.example' });
  await x1.api.pageDlStartMp4(x1.opt);
  x1.api.hdlDiagUpdate({ id: 'job-private-id', state: 'failed', reason: 'http_412' });
  await flush();
  let tx = x1.api.hdlDiagText(x1.api.diags[0]);
  check('other site: no session request, C reported as not permitted', x1.probes.length === 2 && x1.probes.every((o) => o.anonymous === true) &&
    /C mit Browsersitzung nicht zulässig \(andere Seite\)/.test(tx));
  const x2 = setup('mp4', { ref: '', confirm: () => true });
  await x2.api.pageDlStartMp4(x2.opt);
  x2.api.hdlDiagUpdate({ id: 'job-private-id', state: 'failed', reason: 'http_404' });
  await flush();
  tx = x2.api.hdlDiagText(x2.api.diags[0]);
  check('no permitted Referer: B not sent, C with session but without Referer',
    x2.probes.length === 2 && /B mit Referer, ohne Cookies kein zulässiger Referer/.test(tx) && x2.probes[1].anonymous === false && JSON.stringify(x2.probes[1].headers) === '{}');
  const x3 = setup('mp4', { confirm: () => true });
  x3.ctx.probeReply = (o) => (o.anonymous ? o.onerror({ error: 'nicht erlaubt: Adresse im eigenen Netz' }) : o.ontimeout({}));
  await x3.api.pageDlStartMp4(x3.opt);
  x3.api.hdlDiagUpdate({ id: 'job-private-id', state: 'failed', reason: 'http_404' });
  await flush();
  tx = x3.api.hdlDiagText(x3.api.diags[0]);
  check('errors become fixed codes only', /A ohne Cookies\/Referer gesperrt \(Netzschutz\)/.test(tx) && /C mit Browsersitzung Zeitüberschreitung/.test(tx) && !/eigenen Netz/.test(tx));
  const x4 = setup('mp4', { confirm: () => true });
  x4.ctx.probeReply = (o) => o.onreadystatechange({ readyState: 2, status: 403 });
  await x4.api.pageDlStartMp4(x4.opt);
  x4.api.hdlDiagUpdate({ id: 'job-private-id', state: 'failed', reason: 'http_403' });
  await flush();
  tx = x4.api.hdlDiagText(x4.api.diags[0]);
  check('status taken from response headers; no URL, Referer or token in the shareable text',
    /A ohne Cookies\/Referer HTTP 403 · B mit Referer, ohne Cookies HTTP 403 · C mit Browsersitzung HTTP 403/.test(tx) && !/private|PRIVATE|token=|https:|\.invalid|Referer:/.test(x4.ctx.scrub(tx)));

  // Variante C nie automatisch: ohne Bestätigung, bei Ablehnung und bei Seite im Hintergrund keine Anfrage mit Sitzung
  for (const [name, env, hidden, asked] of [['no confirmation available', {}, false, true], ['declined', { confirm: () => false }, false, true],
    ['page in background', { confirm: () => true }, true, false]]) {
    const y = setup('mp4', env);
    y.ctx.document.hidden = hidden;
    await y.api.pageDlStartMp4(y.opt);
    y.api.hdlDiagUpdate({ id: 'job-private-id', state: 'failed', reason: 'http_404' });
    await flush();
    const ty = y.api.hdlDiagText(y.api.diags[0]);
    check('C not run (' + name + '): only anonymous A/B requests, fixed text',
      y.probes.length === 2 && y.probes.every((o) => o.anonymous === true) && /C mit Browsersitzung nicht ausgeführt \(nicht bestätigt\)/.test(ty) &&
      y.ctx.confirms.length === (asked ? 1 : 0));
  }
  check('confirmation asked once, before the session request, with a fixed text without address',
    a.ctx.confirms.length === 1 && !/private|PRIVATE|token|https?:|\.invalid/.test(a.ctx.confirms[0]) && /Browsersitzung/.test(a.ctx.confirms[0]));
  check('no Cookie header is ever set by Kadri; no cookie text in the diagnostic',
    [a, x2, x3, x4].every((t) => t.probes.every((o) => !Object.keys(o.headers).some((k) => /cookie/i.test(k)))) &&
    !/cookie=|Cookie:|Set-Cookie/i.test(a.api.hdlDiagText(a.api.diags[0])));
  // HLS-Auftrag: der Helfer meldet den Fehlerort (feste Codes/Nummern); Kadri bildet genau diese Ressource aus der
  // Hauptliste der Seite nach und vergleicht A/B/(C nach Bestätigung). Synthetische Listen, keine echten Medien.
  const MASTER = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="de",URI="aud/a.m3u8"\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="x",URI="sub/x.m3u8"\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="a"\nvid/low.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2,AUDIO="a"\nvid/high.m3u8\n';
  const MEDIA = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nseg0.m4s\n#EXTINF:4,\nseg1.m4s\n#EXT-X-ENDLIST\n';
  const buf = (t) => new TextEncoder().encode(t).buffer;
  const hlsWalk = async (loc, statusOf, env = { confirm: () => true }, base = 'https://www.private.invalid/v/master.m3u8') => {
    const h = setup('hls', env);
    h.ctx.reply = (op) => op === 'hlsplan' ? { ok: true, value: { planId: 'plan-private-id', options: [{ id: 'option-private-id', audio: 'muxed' }] } }
      : { ok: true, value: { job: { id: 'job-private-id', kind: 'hls', state: 'interrupted', reason: 'http_403', done: 0, of: 137, phase: '', loc } } };
    h.ctx.pageDlMenu = (title, items) => items[0].fn();   // Nutzer wählt die eine angebotene Qualität
    h.ctx.mediaRegistry.resolveStream = () => ({ ok: true, url: base, bind: {} });
    h.ctx.probeReply = (o) => {
      const st = statusOf(o);
      if (/\.m3u8$/.test(o.url) && st === 200) return o.onload({ status: 200, finalUrl: o.url, response: buf(/master/.test(o.url) ? MASTER : MEDIA) });
      return o.onreadystatechange ? (o.onreadystatechange({ readyState: 2, status: st }), o.onload({ status: st })) : o.onload({ status: st });
    };
    await h.api.pageDlPlan(h.opt);
    await flush(); await flush();
    return { h, text: h.api.hdlDiagText(h.api.diags[0]) };
  };
  let w = await hlsWalk({ at: 'video_segment', index: 1, variant: 1, audio: 0 },
    (o) => (/seg1\.m4s$/.test(o.url) ? (o.headers.Referer ? 200 : 403) : 200));
  const segReq = w.h.probes.filter((o) => /seg1\.m4s$/.test(o.url));
  check('HLS segment: exactly the reported segment of the reported variant is compared (A, B, C)',
    segReq.length === 3 && segReq.every((o) => o.url === 'https://www.private.invalid/v/vid/seg1.m4s') &&
    w.h.probes.some((o) => o.url === 'https://www.private.invalid/v/vid/high.m3u8') && !w.h.probes.some((o) => /low\.m3u8|seg0|init\.mp4/.test(o.url)));
  check('HLS segment: location and per-variant result shown',
    /Fehlerort Video-Segment 2 \(Variante 2\)/.test(w.text) &&
    /Ressource Video-Segment 2 \(Variante 2\): A ohne Cookies\/Referer HTTP 403 · B mit Referer, ohne Cookies HTTP 200 · C mit Browsersitzung HTTP 200/.test(w.text));
  check('HLS segment: list requests use the same request type as the variant',
    w.h.probes.filter((o) => /\.m3u8$/.test(o.url) && o.anonymous === false).length === 2 && w.h.probes.filter((o) => /\.m3u8$/.test(o.url) && o.headers.Referer).length === 4);
  check('HLS: no address, path, file name, token or Referer value in the shareable text',
    !/private|PRIVATE|token|https?:|\.invalid|m3u8|m4s|init\.mp4|vid\/|aud\/|Referer:/.test(w.h.ctx.scrub(w.text)) && !/m3u8|m4s|vid\//.test(w.text));
  w = await hlsWalk({ at: 'audio_init', index: -1, variant: 0, audio: 0 }, (o) => (/aud\/init\.mp4$/.test(o.url) ? 403 : 200));
  check('HLS audio init: audio rendition list and its EXT-X-MAP',
    w.h.probes.filter((o) => o.url === 'https://www.private.invalid/v/aud/init.mp4').length === 3 && /Fehlerort Audio-Init \(Audiospur 1\)/.test(w.text) &&
    /A ohne Cookies\/Referer HTTP 403 · B mit Referer, ohne Cookies HTTP 403 · C mit Browsersitzung HTTP 403/.test(w.text));
  w = await hlsWalk({ at: 'master', index: -1, variant: 0, audio: -1 }, () => 403);
  check('HLS master: only the master itself is requested', w.h.probes.length === 3 && w.h.probes.every((o) => /master\.m3u8$/.test(o.url)) &&
    /Fehlerort Hauptliste/.test(w.text) && /Ressource Hauptliste: A ohne Cookies\/Referer HTTP 403/.test(w.text));
  w = await hlsWalk({ at: 'video_list', index: -1, variant: 0, audio: 0 }, (o) => (/low\.m3u8$/.test(o.url) ? 412 : 200));
  check('HLS video list: master read, then the reported variant list compared',
    w.h.probes.filter((o) => /low\.m3u8$/.test(o.url)).length === 3 && /Video-Medienliste \(Variante 1\): A ohne Cookies\/Referer HTTP 412/.test(w.text));
  w = await hlsWalk({ at: 'video_segment', index: 0, variant: 0, audio: 0 }, (o) => (/master/.test(o.url) && !o.headers.Referer ? 403 : 200));
  check('HLS: chain stops where a list fails, per variant',
    /A ohne Cookies\/Referer Hauptliste HTTP 403 · B mit Referer, ohne Cookies HTTP 200/.test(w.text) && !w.h.probes.some((o) => /seg0/.test(o.url) && !o.headers.Referer));
  w = await hlsWalk({ at: 'video_segment', index: 99, variant: 0, audio: 0 }, () => 200);
  check('HLS: index outside the page list → not reproducible, nothing guessed',
    /A ohne Cookies\/Referer nicht nachbildbar · B mit Referer, ohne Cookies nicht nachbildbar · C mit Browsersitzung nicht nachbildbar/.test(w.text) &&
    !w.h.probes.some((o) => /\.m4s$/.test(o.url)) && w.h.ctx.confirms.length === 0);
  w = await hlsWalk({ at: 'video_segment', index: 1, variant: 0, audio: 0 }, () => 200, {});
  check('HLS: C never without confirmation', w.h.probes.every((o) => o.anonymous === true) && /C mit Browsersitzung nicht ausgeführt \(nicht bestätigt\)/.test(w.text));
  w = await hlsWalk({ at: 'video_segment', index: 1, variant: 0, audio: 0 }, () => 200, { confirm: () => true, page: 'www.other.example' });
  check('HLS: C not permitted for another site', w.h.ctx.confirms.length === 0 && /C mit Browsersitzung nicht zulässig \(andere Seite\)/.test(w.text));
  for (const bad of [{ at: 'https://x.invalid/seg', index: 1, variant: 0, audio: 0 }, { at: 'video_segment', index: 'x', variant: 0, audio: 0 },
    { at: 'video_segment', index: 1.5, variant: 0, audio: 0 }, { at: 'video_segment', index: 1, variant: 0 }, 'video_segment']) {
    w = await hlsWalk(bad, () => 200);
    check('HLS: malformed location dropped at the page boundary (' + JSON.stringify(bad).slice(0, 30) + ')',
      w.h.probes.length === 0 && /nicht durchgeführt \(HLS-Ressource unbekannt\)/.test(w.text) && !/x\.invalid/.test(w.text));
  }

  // ⬇ am Video: kein Sofortstart einer nur behaupteten MP4; tatsächlich Geladenes zuerst
  const btn = (mp4, hls) => {
    const t = setup('mp4'), menus = [];
    t.ctx.reply = (op) => op === 'caps' ? { ok: true, value: { reachable: true, supported: true, hls: true } }
      : op === 'find' ? { ok: true, value: null } : { ok: true, value: { job: { id: 'job-private-id', state: 'running' } } };
    t.ctx.pageDlOptions = () => ({ mp4, hls, all: mp4, allS: hls });
    t.ctx.pageDlMenu = (title, items) => menus.push(items);
    t.ctx.pageDlExternal = (v, items) => items;
    t.ctx.pageDlPlan = async () => { t.requests.push({ op: 'plan-menu' }); };
    return Object.assign(t, { menus });
  };
  const mp4d = { ctx: {}, sourceId: 's1', revision: 1, state: 'attemptable', height: 1080, identity: 'declared', loaded: false };
  const mp4p = { ctx: {}, sourceId: 's2', revision: 1, state: 'attemptable', height: 360, identity: 'played', loaded: true };
  const hlsL = { ctx: {}, sourceId: 's3', revision: 1, state: 'attemptable', role: 'media-playlist', identity: 'declared', loaded: true };
  const hlsD = { ctx: {}, sourceId: 's4', revision: 1, state: 'attemptable', role: 'master', identity: 'declared', loaded: false };
  let t = btn([mp4d], []);
  await t.api.onPageDownload();
  check('single claimed adapter MP4: no immediate start, menu with "laut Seite"', !t.requests.some((r) => r.op === 'start') && t.menus.length === 1 &&
    t.menus[0].length === 1 && /laut Seite, Länge\/Inhalt ungeprüft/.test(t.menus[0][0].sub));
  t = btn([mp4p], []);
  await t.api.onPageDownload();
  check('single actually loaded MP4: selection first, no immediate start', !t.requests.some((r) => r.op === 'start') && t.menus.length === 1 &&
    t.menus[0].length === 1 && t.menus[0][0].label === 'Mit Helper herunterladen' && /^MP4 · 360p · direkt in die Helfer-App · kein neuer Tab/.test(t.menus[0][0].sub));
  await t.menus[0][0].fn();
  check('… helper download starts only after tapping the entry', t.requests.filter((r) => r.op === 'start').length === 1);
  t = btn([], [hlsL]);
  await t.api.onPageDownload();
  check('single stream: selection first, no plan request by the tap alone', t.menus.length === 1 && t.menus[0].length === 1 &&
    t.menus[0][0].label === 'Stream mit Helper herunterladen …' && /als MP4 · Qualität und Ton wählen/.test(t.menus[0][0].sub) && !t.requests.some((r) => r.op === 'plan-menu' || r.op === 'hlsplan'));
  t = btn([mp4d], [hlsL]);
  await t.api.onPageDownload();
  check('loaded stream ranks before a claimed MP4 and says so', t.menus.length === 1 && t.menus[0][0].label === 'Stream mit Helper herunterladen …' &&
    /läuft gerade \(Stücke geladen\)/.test(t.menus[0][0].sub) && t.menus[0][1].label === 'Mit Helper herunterladen' && /^MP4/.test(t.menus[0][1].sub));
  t = btn([mp4d], [hlsD]);
  await t.api.onPageDownload();
  check('nothing loaded: previous order (MP4 before stream) unchanged', t.menus.length === 1 && t.menus[0][0].label === 'Mit Helper herunterladen' && t.menus[0][1].label === 'Stream mit Helper herunterladen …');
  // Alternativen am Seitenknopf: nur die nachweislich abgespielte Videodatei, nur auf ausdrücklichen Tipp
  const ext = (patch, env) => {
    const u = setup('mp4'), opened = [], saved = [];
    Object.assign(u.ctx.active, patch || {});
    u.ctx.window = { open: (x) => { opened.push(x); return {}; } };
    u.ctx.browserDownload = async (x) => { saved.push(x); return true; };
    u.ctx.shareUrl = () => {}; u.ctx.toYtdlnis = () => {};
    u.ctx.sameOrigin = () => true;   // Datei derselben Herkunft wie die Seite
    u.ctx.IS_ANDROID_UA = () => false;
    u.toasts = []; u.ctx.toast = (m) => u.toasts.push(m);
    Object.assign(u.ctx, env || {});
    return Object.assign(u, { items: u.ctx.pageDlExternal(u.ctx.active, []), opened, saved });
  };
  let x = ext();
  check('alternatives (same origin): browser download, open and share offered for the played file, nothing done before a tap',
    x.items.map((i) => i.label).join('|') === 'Im Browser herunterladen|Im Browser öffnen|Teilen …' && !x.opened.length && !x.saved.length && !x.requests.length);
  check('… entries say clearly: download vs. only open (new tab, no download)', /Download-Manager des Browsers/.test(x.items[0].sub) &&
    /^nur öffnen: neuer Tab, kein Download/.test(x.items[1].sub));
  x.items[0].fn(); x.items[1].fn(); await flush();
  check('… browser actions only on their own entry', x.saved.length === 1 && x.opened.length === 1 && x.saved[0] === x.url && x.opened[0] === x.url);
  check('… browser download only claims the hand-over, not a running download', x.toasts.includes('Download an Browser übergeben') &&
    !x.toasts.some((m) => /läuft/.test(m)));
  for (const [why, patch] of [['stream (HLS)', { currentSrc: 'https://private.invalid/master.m3u8' }], ['DASH', { currentSrc: 'https://private.invalid/a.mpd?x=1' }],
    ['MSE/blob', { currentSrc: 'blob:https://private.invalid/1' }], ['no frame yet', { readyState: 1 }], ['media error', { error: { code: 4 } }],
    ['srcObject', { srcObject: {} }]]) {
    x = ext(patch);
    check('alternatives: no browser file for ' + why, !x.items.some((i) => /Im Browser/.test(i.label)));
  }
  x = ext({}, { IS_ANDROID_UA: () => true });
  check('alternatives on Android: no browser download even for the same origin – only "Im Browser öffnen" and share',
    x.items.map((i) => i.label).join('|') === 'Im Browser öffnen|Teilen …');
  x = ext({}, { sameOrigin: () => false });
  check('alternatives (other server): no misleading browser download – only "Im Browser öffnen" and share',
    x.items.map((i) => i.label).join('|') === 'Im Browser öffnen|Teilen …');
  // Helfer-Download: kein neuer Tab, keine Navigation
  t = btn([mp4p], []);
  let opens = 0; t.ctx.window = { open: () => { opens++; return {}; } };
  await t.api.onPageDownload(); await t.menus[0][0].fn();
  check('helper download: started via the helper, never window.open', t.requests.some((r) => r.op === 'start') && opens === 0);
  // ohne Helfer-Kanal: Auswahl statt direktem Sprung zu YTDLnis
  const nh = setup('mp4'), nhMenus = [];
  nh.ctx.KADRI_DOWNLOAD = undefined;
  nh.ctx.SHOW_DOWNLOAD = true; nh.ctx.postUrlFor = () => 'https://private.invalid/post/1';
  let ytdl = 0;
  nh.ctx.toYtdlnis = () => { ytdl++; }; nh.ctx.shareUrl = () => {}; nh.ctx.window = { open: () => ({}) }; nh.ctx.browserDownload = async () => true;
  nh.ctx.sameOrigin = () => false; nh.ctx.IS_ANDROID_UA = () => false;
  nh.ctx.pageDlMenu = (title, items) => nhMenus.push(items);
  nh.ctx.onDownload = () => { ytdl++; };
  await nh.api.onPageDownload();
  check('without helper channel: tap shows the selection (YTDLnis first), YTDLnis not opened', nhMenus.length === 1 && nhMenus[0][0].label === 'Mit YTDLnis' && ytdl === 0);
  // S4b-3: eingebettetes Fenster – zweiter Tipp auf ⬇, während der erste Ablauf noch die Fähigkeit abfragt: der laufende
  // Ablauf antwortet mit der Kennung des LETZTEN Tipps (sonst verwürfe das Hauptfenster die Auswahl als veraltet)
  {
    const f = btn([mp4p], []), rids = [];
    f.ctx.IN_FRAME = true; f.ctx.fui = { n: 'f'.repeat(32), rid: 'aaaaaaaa' };
    f.ctx.pageDlMenu = (title, items, here, rid) => { f.menus.push(items); rids.push(rid); };
    let release; const gate = new Promise((r) => { release = r; });
    const plain = f.ctx.reply;
    f.ctx.KADRI_DOWNLOAD = async (op, args) => { f.requests.push({ op, args }); if (op === 'caps') await gate; return plain(op, args); };
    const first = f.api.onPageDownload();          // Tipp 1 (aaaaaaaa): wartet auf caps
    await flush();
    f.ctx.fui.rid = 'bbbbbbbb';
    await f.api.onPageDownload();                   // Tipp 2 (bbbbbbbb) während Tipp 1 läuft: kein zweiter Ablauf
    release(); await first; await flush();
    check('frame: second ⬇ during the first flow – one flow, one menu, sent with the LATEST tap id',
      f.requests.filter((r) => r.op === 'caps').length === 1 && f.menus.length === 1 && rids[0] === 'bbbbbbbb');
    const g = btn([mp4p], []), grids = [];
    g.ctx.IN_FRAME = true; g.ctx.fui = { n: 'f'.repeat(32), rid: 'cccccccc' };
    g.ctx.pageDlMenu = (title, items, here, rid) => { g.menus.push(items); grids.push(rid); };
    await g.api.onPageDownload();
    check('frame: single ⬇ – menu carries the id of that tap', g.menus.length === 1 && grids[0] === 'cccccccc');
  }
  console.log('RESULT download_diag PASS ' + passed + '/' + passed);
})().catch(e => { console.error(e); process.exitCode = 1; });
