'use strict';
// Execute the actual C3 source selector. An original-page bridge must not count as a loaded own MP4.
const fs = require('fs'), vm = require('vm'), assert = require('assert/strict');
const path = require('path');
const source = fs.readFileSync(process.argv[2] && process.argv[2] !== '--mutations' ? process.argv[2] : path.join(__dirname, '../src/180-player-bedienung.js'), 'utf8');
const url = 'https://media.example/file.mp4?validfrom=1&validto=2&hash=a%2Fb+Z&x=1&x=2';
function run(text, change = {}) {
  const direct = text.match(/    const directUrl = [^\n]+;/)[0];
  const start = text.indexOf('    const hdlUrl = '), end = text.indexOf('    st.hdl = ', start);
  assert.ok(start >= 0 && end > start, 'source selector boundaries');
  const st = Object.assign({ mode: 'own', hls: null, cur: url }, change.st);
  const vid = Object.assign({ currentSrc: url, readyState: 2, error: null, srcObject: null }, change.vid);
  return vm.runInNewContext(direct + '\n' + text.slice(start, end) + '\nhdlUrl()', { st, vid, URL, PLAYLIST_RE: /\.(m3u8|mpd)(\?|#|$)/i });
}
function verify(text) {
  assert.equal(run(text, { vid: { readyState: 0 } }), '', 'unloaded MP4 candidate must not be offered');
  assert.equal(run(text, { vid: { readyState: 1 } }), '', 'metadata alone is not a decoded frame');
  assert.equal(run(text, { vid: { error: { code: 4 } } }), '', 'failed source must not be offered');
  assert.equal(run(text, { vid: { srcObject: {} } }), '', 'captured media must not be treated as a file');
  assert.equal(run(text, { vid: { currentSrc: 'https://media.example/previous.mp4' } }), '', 'previous loaded file cannot validate a new candidate');
  assert.equal(run(text, { vid: { currentSrc: '' } }), '', 'empty currentSrc cannot validate a candidate');
  assert.equal(run(text, { st: { mode: 'capture' } }), '', 'capture mode excluded');
  assert.equal(run(text, { st: { hls: {} } }), '', 'hls.js source excluded');
  for (const candidate of ['https://media.example/720.mp4:hls:manifest.m3u8', 'https://media.example/live.mpd', 'blob:https://media.example/id', 'https://media.example/clip.webm']) {
    assert.equal(run(text, { st: { cur: candidate }, vid: { currentSrc: candidate } }), '', 'unsupported source: ' + candidate);
  }
  assert.equal(run(text), url, 'loaded MP4 keeps signed query bytes and duplicate parameters');
  for (const readyState of [2, 3, 4]) assert.equal(run(text, { vid: { readyState } }), url, 'loaded MP4 available');
  const raw = 'https://MEDIA.example/a b.mp4?hash=abc%2Fdef';
  assert.equal(run(text, { st: { cur: raw }, vid: { currentSrc: new URL(raw).href } }), raw, 'browser URL canonicalization used only for comparison');
  const event = text.match(/    vid\.addEventListener\('loadeddata', [^\n]+;/);
  assert.ok(event, 'loadeddata must refresh eligibility after loadedmetadata');
  let refreshes = 0, callback;
  const st = { refreshDl() { refreshes++; } }, ctx = { st, vid: { addEventListener(name, f) { assert.equal(name, 'loadeddata'); callback = f; } } };
  ctx.vp = st;
  vm.runInNewContext(event[0], ctx);
  callback(); assert.equal(refreshes, 1, 'refresh once media data is ready');
  ctx.vp = {}; callback(); assert.equal(refreshes, 1, 'closed/replaced player ignored');
}

// ---------- Capability probe (hdlProbe) with deferred answers: the real function from the source ----------
// A stale answer (replaced player, newer probe, source meanwhile unsuitable or different) must be ignored without
// blocking a later valid probe of the same source. No probe loop, no request without a trigger.
function probeHarness(text) {
  const init = text.match(/    st\.hdl = \{[^\n]+\};/);
  assert.ok(init, 'hdl state initializer');
  const from = text.indexOf('    const hdlMark = ') >= 0 ? text.indexOf('    const hdlMark = ') : text.indexOf('    function hdlProbe()');
  const to = text.indexOf('    // Start nach Tipp.', from);
  assert.ok(from >= 0 && to > from, 'probe boundaries');
  const h = { url: 'https://media.example/a.mp4?sig=1&x=1&x=2', calls: [], sets: [] };
  const st = {};
  const ctx = {
    st, vp: st, bDl: { dataset: {} }, vid: { readyState: 4 },
    hdlUrl: () => h.url, hdlPrimary: () => h.url, KADRI_DOWNLOAD: () => {}, hdlActive: (j) => !!j && j.state === 'running',
    hdlSet: (j) => h.sets.push(j),
    helperDl: (op, a) => new Promise((resolve) => h.calls.push({ op, url: a && a.url, resolve })),
  };
  st.refreshDl = () => ctx.hdlProbe();
  vm.runInNewContext(init[0] + '\n' + text.slice(from, to) + '\nthis.hdlProbe = hdlProbe;', ctx);
  h.ctx = ctx; h.st = st;
  h.probe = () => ctx.hdlProbe();
  h.ops = (op) => h.calls.filter((c) => c.op === op);
  h.answer = async (i, v) => { h.calls[i].resolve(v); for (let k = 0; k < 5; k++) await Promise.resolve(); };
  return h;
}
const CAPS_OK = { ok: true, value: { reachable: true, supported: true } };
const CAPS_NO = { ok: true, value: { reachable: true, supported: false } };
const CAPS_DOWN = { ok: true, value: { reachable: false, supported: false, error: 'offline' } };
const FIND_NONE = { ok: true, value: null };
async function verifyProbe(text) {
  { // temporary unsuitability while caps is pending, then the same source is suitable again
    const h = probeHarness(text), u = h.url;
    h.probe(); h.url = ''; await h.answer(0, CAPS_OK);
    assert.equal(h.ops('find').length, 0, 'stale caps answer must not continue with find');
    h.url = u; h.probe();
    assert.equal(h.ops('caps').length, 2, 're-probe required after temporary unsuitability during caps');
    await h.answer(1, CAPS_OK);
    assert.equal(h.st.hdl.ok, true, 'helper offer available after the re-probe');
    assert.deepEqual(h.ops('find').map((c) => c.url), [u], 'find for the exact source (query bytes kept)');
    await h.answer(2, FIND_NONE);
    assert.equal(h.sets.length, 1, 'probe completed');
    h.probe(); h.probe();
    assert.equal(h.calls.length, 3, 'completed probe of the same source is not repeated');
  }
  { // temporary unsuitability while find is pending
    const h = probeHarness(text), u = h.url;
    h.probe(); await h.answer(0, CAPS_OK);
    h.url = ''; await h.answer(1, FIND_NONE);
    assert.equal(h.sets.length, 0, 'stale find answer ignored');
    h.url = u; h.probe();
    assert.equal(h.ops('caps').length, 2, 're-probe required after temporary unsuitability during find');
  }
  { // repeated triggers while pending: one request; no request without a trigger
    const h = probeHarness(text);
    h.probe(); h.probe(); h.probe();
    assert.equal(h.calls.length, 1, 'no probe storm while a probe is pending');
    await h.answer(0, CAPS_DOWN);
    assert.equal(h.calls.length, 1, 'no automatic retry after an unreachable helper');
    assert.equal(h.st.hdl.ok, false, 'unreachable helper not offered');
    h.probe();
    assert.equal(h.calls.length, 2, 'transient unreachable answer does not block a later triggered probe');
    await h.answer(1, null);   // helperDl maps a rejected/absent answer to null
    assert.equal(h.st.hdl.ok, false, 'rejected probe not offered');
    h.probe();
    assert.equal(h.calls.length, 3, 'rejected probe does not block a later triggered probe');
  }
  { // definitive answer for the same source is not repeated
    const h = probeHarness(text);
    h.probe(); await h.answer(0, CAPS_NO);
    h.probe();
    assert.equal(h.calls.length, 1, 'unsupported helper: same source not probed again');
    assert.equal(h.st.hdl.ok, false, 'unsupported helper not offered');
  }
  { // A -> B -> A with a late answer for A
    const h = probeHarness(text), a = h.url, b = 'https://media.example/b.mp4?sig=2';
    h.probe(); h.url = b; h.probe();
    assert.equal(h.ops('caps').length, 2, 'new source probed while the old answer is pending');
    await h.answer(1, CAPS_OK);
    assert.deepEqual(h.ops('find').map((c) => c.url), [b], 'find for B');
    await h.answer(2, FIND_NONE);
    await h.answer(0, CAPS_NO);   // late answer for A
    assert.equal(h.st.hdl.ok, true, 'late answer for A must not change the result for B');
    assert.deepEqual(h.ops('find').map((c) => c.url), [b], 'late answer for A must not start find');
    h.url = a; h.probe();
    assert.equal(h.ops('caps').length, 3, 'back to A: probed again');
    await h.answer(3, CAPS_OK);
    assert.deepEqual(h.ops('find').map((c) => c.url), [b, a], 'find for A after returning');
  }
  { // late answer for A while the probe for B is still pending
    const h = probeHarness(text), b = 'https://media.example/b.mp4?sig=2';
    h.probe(); h.url = b; h.probe();
    await h.answer(0, CAPS_NO);
    assert.equal(h.ops('caps').length, 2, 'late answer of an older probe neither restarts nor replaces the current probe');
    await h.answer(1, CAPS_OK);
    assert.equal(h.st.hdl.ok, true, 'current answer counts');
    assert.deepEqual(h.ops('find').map((c) => c.url), [b], 'find only for the current source');
  }
  { // replaced player: late answers are ignored
    const h = probeHarness(text);
    h.probe(); h.ctx.vp = {};
    await h.answer(0, CAPS_OK);
    assert.equal(h.ops('find').length, 0, 'replaced player: no find');
    assert.equal(h.st.hdl.ok, false, 'replaced player: no offer');
  }
  const ready = text.match(/    \['canplay', 'seeked'\]\.forEach\([^\n]+\);/);
  assert.ok(ready, 'canplay/seeked must re-run the probe after a temporary unsuitability');
  const seen = {}; let probes = 0;
  const c2 = { st: {}, hdlProbe: () => probes++, vid: { addEventListener(name, f) { seen[name] = f; } } };
  c2.vp = c2.st;
  vm.runInNewContext(ready[0], c2);
  assert.deepEqual(Object.keys(seen).sort(), ['canplay', 'seeked'], 'ready events');
  seen.canplay(); seen.seeked(); assert.equal(probes, 2, 'probe triggered when media is ready again');
  c2.vp = {}; seen.canplay(); assert.equal(probes, 2, 'replaced player: no probe');
}
(async () => {
verify(source);
await verifyProbe(source);
console.log('PASS source readiness: candidate, metadata, failure, switch, HLS/DASH, capture, signed URL and loadeddata');
console.log('PASS capability probe: temporary unsuitability (caps/find), A->B->A, late/replaced/rejected/unreachable, no storm, ready events');
if (process.argv.includes('--mutations')) {
  const mutations = [
    ['vid.readyState < 2', 'false'], ['vid.error', 'false'], ['vid.srcObject', 'false'],
    ["if (vid.currentSrc !== new URL(d).href) return '';", ''],
    ["vid.addEventListener('loadeddata'", "vid.addEventListener('loadedmetadata'"],
    ['if (vp === st) st.refreshDl();', 'st.refreshDl();'],
    // capability probe: stale answers, generation, pending/checked separation, transient failures, ready events
    ['st.hdl.pending.gen === gen', 'true'],
    ["if (hdlPrimary() !== u) { drop('stale'); hdlProbe(); return; }   //", '//'],
    ["{ drop('stale'); hdlProbe(); return; }\n          if (!(f && f.ok))", "{}\n          if (!(f && f.ok))"],
    ['st.hdl.pending = { u, gen };', 'st.hdl.pending = { u, gen }; st.hdl.checked = u;'],
    [' || (st.hdl.pending && st.hdl.pending.u === u)', ''],
    ["drop('unreachable'); return; }   // vorübergehend", "st.hdl.checked = u; drop('unreachable'); return; }   // vorübergehend"],
    ["const current = () => vp === st && ", 'const current = () => '],
    ["['canplay', 'seeked'].forEach((ev) => vid.addEventListener(ev, () => { if (vp === st) hdlProbe(); }));", ''],
    ["['canplay', 'seeked'].forEach((ev) => vid.addEventListener(ev, () => { if (vp === st) hdlProbe(); }));", "['canplay', 'seeked'].forEach((ev) => vid.addEventListener(ev, () => { hdlProbe(); }));"],
  ];
  for (const [a, b] of mutations) {
    assert.equal(source.split(a).length, 2, 'unique mutation anchor: ' + a);
    const m = source.replace(a, b);
    let caught = false; try { verify(m); await verifyProbe(m); } catch (e) { caught = true; }
    assert.ok(caught, 'surviving mutation: ' + a);
  }
  console.log('PASS source readiness and probe mutations: ' + mutations.length + '/' + mutations.length);
}
})().catch((e) => { console.error(e); process.exitCode = 1; });
