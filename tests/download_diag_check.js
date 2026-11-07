'use strict';
// Actual content functions, synthetic protocol replies; no real media or credentials.
// Optional root permits proving the diagnostic regressions against the prior source.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let passed = 0;
function check(name, value) { assert.ok(value, name); passed++; console.log('PASS ' + name); }
function setup(kind = 'mp4') {
  const timers = [], requests = [], probes = [];
  const url = 'https://private.invalid/private-video?token=PRIVATE-SENTINEL';
  const source = { sourceId: 'source-private-id', revision: 7, kind, role: kind === 'hls' ? 'master' : 'file',
    association: { state: 'bound', evidence: ['element-src'] }, browser: 'loaded',
    quality: { status: 'observed', value: { height: 360 } },
    provenance: [{ kind: 'element', origin: 'element-playing', observedAt: Date.now() - 120000 }] };
  const opt = { ctx: {}, sourceId: source.sourceId, revision: 7, identity: 'played' };
  const v = { isConnected: true, currentSrc: url, readyState: 4, videoWidth: 640, videoHeight: 360,
    buffered: { length: 1, start: () => 0, end: () => 8 }, played: { length: 1, start: () => 0, end: () => 2 }, paused: false };
  const ctx = { URL, Date, WeakMap, CONFIG: {}, document: { hidden: false }, active: v,
    setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout() {}, toast() {}, tr: (x) => x,
    pageTitle: () => 'PRIVATE-TITLE', fmtTime: () => '1:00',
    mediaRegistry: { snapshot: () => [source], resolveSelection: () => ({ ok: true, url }), resolveStream: () => ({ ok: true, url, bind: {} }) },
    gmXhr: () => (o) => { probes.push(o); o.onload({ status: 206 }); return { abort() {} }; },
    KADRI_DOWNLOAD: async (op, args) => { requests.push({ op, args }); return ctx.reply(op, args); },
    reply: () => ({ ok: true, value: { job: { id: 'job-private-id', state: 'running', ...(kind === 'hls' ? { kind, done: 0, of: 0 } : {}) } } }) };
  vm.createContext(ctx);
  vm.runInContext(read('src/080-helper-app.js').split('  // Einen früher gespeicherten')[0] + '\n' + read('src/105-download-knopf.js') +
    '\nglobalThis.api={pageDlStartMp4,pageDlPlan,hdlDiagUpdate,hdlDiagText,diags:hdlDiags};', ctx);
  const anon = read('src/280-diagnose.js');
  vm.runInContext(anon.slice(anon.indexOf('  function anonScrub'), anon.indexOf('  function diagAnon')) + '\nglobalThis.scrub=anonScrub;', ctx);
  return { ctx, api: ctx.api, opt, url, timers, requests, probes, source };
}
(async () => {
  const a = setup();
  await a.api.pageDlStartMp4(a.opt);
  check('direct MP4 creates a diagnostic without opening the player', a.api.diags.length === 1);
  a.api.hdlDiagUpdate({ id: 'job-private-id', state: 'failed', reason: 'http_404' });
  let text = a.api.hdlDiagText(a.api.diags[0]);
  check('MP4 exposes helper status, GET phase, source age and played identity', /Grund http_404/.test(text) && /HTTP 404/.test(text) && /Phase mp4-get/.test(text) && /Alter beim Start 120 s/.test(text) && /Identität diese Wiedergabe/.test(text));
  check('anonymous comparison is one GET Range 0-0 without session headers', a.probes.length === 1 && a.probes[0].anonymous === true && a.probes[0].method === 'GET' && JSON.stringify(a.probes[0].headers) === '{"Range":"bytes=0-0"}');
  check('comparison result differs explicitly from helper result', /Browser ohne Cookies\/Referer: HTTP 206/.test(text));
  check('source/job/title/URL sentinels never appear in shareable diagnostic', !/private|PRIVATE|token=|https:|\.invalid/.test(a.ctx.scrub(text)));
  check('download request unchanged; no diagnostic data forwarded', a.requests[0].op === 'start' && Object.keys(a.requests[0].args).sort().join(',') === 'name,url');

  const b = setup('hls');
  b.ctx.reply = (op) => op === 'hlsplan' ? { ok: true, value: { planId: 'plan-private-id', options: [{ id: 'option-private-id' }] } }
    : { ok: true, value: { job: { id: 'job-private-id', kind: 'hls', state: 'interrupted', reason: 'http_404', done: 2, of: 13, phase: '' } } };
  await b.api.pageDlPlan(b.opt);
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
  console.log('RESULT download_diag PASS ' + passed + '/' + passed);
})().catch(e => { console.error(e); process.exitCode = 1; });
