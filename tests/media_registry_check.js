'use strict';
// Shared media source model and registry (src/045, src/065), executed from the real source files in a VM.
// Covers strict observation schema, roles over extensions, unknown never treated as known, context separation
// (documents, players, epochs), budgets, exact URL preservation, stale selections and download state.
// node tests/media_registry_check.js [--mutations]
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert/strict');
const SRC = (f) => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8');
const model = SRC('045-media-source.js'), registrySrc = SRC('065-media-registry.js');
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; };
const plainOf = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const eq = (a, b, m) => { assert.deepEqual(plainOf(a), plainOf(b), m); passed++; };

function load(modelText, regText) {
  let n = 0;
  const ctx = { URL, Uint8Array, JSON, Object, Array, Math, Number, String, Map, Set, WeakMap, Date, isFinite, Promise,
    location: { href: 'https://site.example/watch/1' }, crypto: { getRandomValues: (a) => a } };
  vm.createContext(ctx);
  vm.runInContext(modelText + '\n' + regText.replace('const mediaRegistry = createMediaRegistry();', '') +
    '\nthis.api = { createMediaRegistry, mediaValidObservation, mediaKindOf, mediaDownloadState, selectDownloads, MEDIA_LIMITS };', ctx);
  ctx.mk = () => ctx.api.createMediaRegistry({ random: () => 'id' + (++n).toString(16).padStart(6, '0'), docKey: () => ctx.location.href.split('#')[0] });
  return ctx;
}
class FakeVideo { constructor() { this.l = {}; } addEventListener(n, f) { (this.l[n] = this.l[n] || []).push(f); } fire(n) { (this.l[n] || []).forEach((f) => f()); } }
const obs = (url, extra) => Object.assign({ url, provenance: { kind: 'element', origin: 'element-src' }, association: { state: 'bound', evidence: ['element-src'] } }, extra || {});

function verify(modelText, regText) {
  const c = load(modelText, regText), A = c.api;
  // ---------- schema ----------
  const v = (o) => A.mediaValidObservation(o);
  ok(v(obs('https://cdn.example/a.mp4')).ok, 'valid observation');
  eq(v(Object.assign(obs('https://cdn.example/a.mp4'), { cookie: 'x' })).reason, 'unknown-field', 'unknown field rejected');
  eq(v(obs('https://cdn.example/a.mp4', { headers: {} })).reason, 'unknown-field', 'free headers rejected');
  eq(v(obs('blob:https://site.example/x')).reason, 'url', 'blob rejected');
  eq(v(obs('file:///etc/passwd')).reason, 'url', 'file rejected');
  eq(v(obs('https://u:p@cdn.example/a.mp4')).reason, 'url', 'credentials in URL rejected');
  eq(v(obs('https://cdn.example/' + 'a'.repeat(5000) + '.mp4')).reason, 'url', 'overlong URL rejected');
  eq(v(obs('https://cdn.example/a.mp4', { association: { state: 'bound', evidence: [] } })).reason, 'bound-without-evidence', 'binding needs evidence');
  eq(v(obs('https://cdn.example/a.mp4', { quality: { status: 'claimed', value: { height: -1 } } })).reason, 'knowledge', 'negative height rejected');
  eq(v(obs('https://cdn.example/a.mp4', { quality: { status: 'claimed', value: { height: 1.5 } } })).reason, 'knowledge', 'fractional height rejected');
  eq(v(obs('https://cdn.example/a.mp4', { duration: { status: 'claimed', value: Infinity } })).reason, 'knowledge', 'infinite duration rejected');
  eq(v(obs('https://cdn.example/a.mp4', { quality: { status: 'sure', value: { height: 720 } } })).reason, 'knowledge', 'unknown status rejected');
  eq(v(obs('https://cdn.example/a.mp4', { audio: { status: 'verified', value: { present: true } } })).reason, 'unverifiable-claim', 'page data cannot be verified');
  eq(v(obs('https://cdn.example/a.mp4', { kind: 'zip' })).reason, 'kind', 'kind enum');
  eq(v({ url: 'https://cdn.example/a.mp4' }).reason, 'provenance', 'provenance required');
  const plain = v(obs('https://cdn.example/a.mp4')).value;
  eq([plain.audio.status, plain.video.status, plain.quality.status, plain.protection], ['unknown', 'unknown', 'unknown', 'unknown'], 'unknown stays unknown');
  // ---------- kinds: the path counts ----------
  eq(A.mediaKindOf('https://cdn.example/720.mp4:hls:manifest.m3u8'), 'hls', '.mp4 inside an HLS path is HLS');
  eq(A.mediaKindOf('https://cdn.example/v.mp4?x=a.m3u8'), 'mp4', 'query does not change the kind');
  eq(A.mediaKindOf('https://cdn.example/m.mpd'), 'dash', 'dash');
  eq(A.mediaKindOf('https://cdn.example/x', 'video/mp4'), 'mp4', 'mime only');
  eq(A.mediaKindOf('https://cdn.example/x'), 'unknown', 'no extension, no mime: unknown');
  eq(A.mediaKindOf('https://cdn.example/x.webm'), 'unsupported', 'webm not offered as MP4');
  eq(A.mediaKindOf('https://cdn.example/stream#kadri.m3u8'), 'hls', 'content-type tagged stream');
  // ---------- download state ----------
  const reg = c.mk(), el = new FakeVideo(), ctx = reg.contextFor(el);
  const signed = 'https://cdn.example/v/720.mp4?validto=9&hash=a%2Fb+c&x=2&x=1';
  const r1 = reg.observe(ctx, obs(signed, { quality: { status: 'claimed', value: { height: 720 }, evidenceIds: ['source-size'] } }));
  ok(r1.ok && r1.created, 'observed');
  const sel = reg.resolveSelection(ctx, r1.sourceId, r1.revision);
  eq(sel, { ok: true, url: signed }, 'exact URL bytes (query order, duplicates, escapes) preserved');
  const seg = reg.observe(ctx, obs('https://cdn.example/v/seg-1.mp4', { role: 'segment', provenance: { kind: 'manifest', origin: 'hls-media' } }));
  eq(reg.resolveSelection(ctx, seg.sourceId, seg.revision).reason, 'not-standalone', 'segment never offered as a file');
  const seg2 = reg.observe(ctx, obs('https://cdn.example/v/seg-1.mp4', { role: 'standalone' }));
  eq([seg2.sourceId, reg.resolveSelection(ctx, seg2.sourceId, seg2.revision).reason], [seg.sourceId, 'not-standalone'], 'later element claim cannot turn a segment into a file');
  const init = reg.observe(ctx, obs('https://cdn.example/v/init.mp4'));
  reg.observe(ctx, obs('https://cdn.example/v/init.mp4', { role: 'init', association: { state: 'unbound', evidence: [] }, provenance: { kind: 'manifest', origin: 'hls-map' } }));
  const initSnap = reg.snapshot(ctx).find((s) => s.sourceId === init.sourceId);
  eq([initSnap.role, initSnap.download.state], ['init', 'unavailable'], 'later manifest role wins over extension');
  eq(reg.resolveSelection(ctx, init.sourceId, init.revision).reason, 'stale-revision', 'changed source needs a fresh selection');
  const amb = reg.observe(ctx, obs('https://cdn.example/other.mp4', { association: { state: 'ambiguous', evidence: ['near'] }, provenance: { kind: 'page-metadata', origin: 'near' } }));
  eq(reg.resolveSelection(ctx, amb.sourceId, amb.revision).reason, 'ambiguous', 'ambiguous source not attemptable');
  const unb = reg.observe(ctx, obs('https://cdn.example/recent.mp4', { association: { state: 'unbound', evidence: [] }, provenance: { kind: 'network', origin: 'recent' } }));
  eq(reg.resolveSelection(ctx, unb.sourceId, unb.revision).reason, 'not-bound', 'recently seen MP4 alone is not bound');
  const hls = reg.observe(ctx, obs('https://cdn.example/master.m3u8', { role: 'master' }));
  eq(reg.resolveSelection(ctx, hls.sourceId, hls.revision).reason, 'stream-not-supported', 'HLS not offered before P4');
  const unk = reg.observe(ctx, obs('https://cdn.example/media?id=1'));
  eq(reg.resolveSelection(ctx, unk.sourceId, unk.revision).reason, 'type-unknown', 'unknown type stays unknown');
  const drm = reg.observe(ctx, obs('https://cdn.example/drm.mp4', { protection: 'drm' }));
  eq(reg.resolveSelection(ctx, drm.sourceId, drm.revision).reason, 'protected', 'protected source not offered');
  const snap = reg.snapshot(ctx);
  ok(!JSON.stringify(snap).includes('cdn.example'), 'snapshot carries no URL');
  ok(Object.isFrozen(snap) && Object.isFrozen(snap[0]), 'snapshot is read-only');
  const opts = A.selectDownloads(snap, { supported: true });
  eq(opts.filter((o) => o.state === 'attemptable').map((o) => o.sourceId), [r1.sourceId], 'only the bound standalone MP4 is attemptable');
  ok(opts.every((o) => snap.find((s) => s.sourceId === o.sourceId).kind === 'mp4'), 'download options are MP4 only');
  eq(A.selectDownloads(snap, { supported: false }).filter((o) => o.state === 'attemptable').length, 0, 'no helper: nothing attemptable');
  eq(A.selectDownloads(snap, { supported: true, active: r1.sourceId }).find((o) => o.sourceId === r1.sourceId).state, 'active', 'active job marked');
  // R2-Nachtest: am Element genannt ≠ belegt dasselbe Video. Nur was der Browser in diesem Player geladen hat, gilt als
  // „diese Wiedergabe“; alles andere bleibt „laut Seite“ (Länge/Inhalt ungeprüft) – ohne zusätzlichen Abruf.
  eq(opts.find((o) => o.sourceId === r1.sourceId).identity, 'declared', 'element-declared MP4 is not claimed to be the played video');
  const pl = reg.observe(ctx, obs('https://cdn.example/played.mp4', { browser: 'loaded', provenance: { kind: 'player', origin: 'own-player' },
    association: { state: 'bound', evidence: ['own-player-loaded'] } }));
  eq(A.selectDownloads(reg.snapshot(ctx), { supported: true }).find((o) => o.sourceId === pl.sourceId).identity, 'played', 'browser-loaded MP4 is this playback');
  // ---------- merge never downgrades evidence; knowledge never jumps ----------
  const b2 = reg.observe(ctx, obs(signed, { association: { state: 'unbound', evidence: [] }, provenance: { kind: 'network', origin: 'recent' } }));
  eq([b2.sourceId, reg.snapshot(ctx).find((s) => s.sourceId === r1.sourceId).association.state], [r1.sourceId, 'bound'], 'same URL in same player merges; binding kept');
  // ---------- context separation ----------
  const el2 = new FakeVideo(), ctx2 = reg.contextFor(el2);
  ok(ctx2.playerId !== ctx.playerId, 'separate players');
  const same = reg.observe(ctx2, obs(signed));
  ok(same.sourceId !== r1.sourceId, 'same URL in another player: separate entry');
  eq(reg.resolveSelection(ctx2, r1.sourceId, r1.revision).reason, 'unknown-source', 'source of another player cannot be selected');
  eq(reg.observe(Object.assign({}, ctx, { documentKey: 'forged' }), obs('https://cdn.example/z.mp4')).reason, 'stale-context', 'forged document key rejected');
  eq(reg.observe(Object.assign({}, ctx, { playerId: 'nope' }), obs('https://cdn.example/z.mp4')).reason, 'stale-context', 'unknown player rejected');
  // epoch: new medium in the same element
  el.fire('emptied');
  eq(reg.resolveSelection(ctx, r1.sourceId, r1.revision).reason, 'stale-context', 'selection from the previous medium refused');
  const ctxNew = reg.contextFor(el);
  eq([ctxNew.playerId, ctxNew.mediaEpoch], [ctx.playerId, ctx.mediaEpoch + 1], 'same player, new epoch');
  eq(reg.snapshot(ctxNew).length, 0, 'no ghost sources after emptied');
  eq(reg.observe(ctx, obs('https://cdn.example/late.mp4')).reason, 'stale-context', 'late observation for the old epoch rejected');
  ok(reg.snapshot(ctx2).length === 1, 'other player untouched');
  // subscribe / invalidate
  let calls = [];
  const un = reg.subscribe(ctx2, (cause) => calls.push(cause));
  reg.invalidate(ctx2, 'source-change');
  eq(calls, ['source-change'], 'subscriber informed');
  un();
  // navigation (SPA): new document key, all old contexts stale
  const ctx3 = reg.contextFor(el2);
  const nav = reg.observe(ctx3, obs('https://cdn.example/n.mp4'));
  c.location.href = 'https://site.example/watch/2';
  eq(reg.resolveSelection(ctx3, nav.sourceId, nav.revision).reason, 'stale-context', 'navigation invalidates');
  const ctx4 = reg.contextFor(el2);
  ok(ctx4.documentKey !== ctx3.documentKey, 'new document key after navigation');
  c.location.href = 'https://site.example/watch/2#t=3';
  ok(reg.contextFor(el2).documentKey === ctx4.documentKey, 'hash change is not a navigation');
  // ---------- budgets ----------
  const rb = c.mk(), eb = new FakeVideo(), cb = rb.contextFor(eb);
  for (let i = 0; i < A.MEDIA_LIMITS.perPlayer; i++) ok(rb.observe(cb, obs('https://cdn.example/' + i + '.mp4')).ok, 'within budget');
  eq(rb.observe(cb, obs('https://cdn.example/over.mp4')).reason, 'budget', 'per-player budget');
  let doc = rb.stats().sources;
  for (let p = 0; doc < A.MEDIA_LIMITS.perDocument; p++) {
    const cx = rb.contextFor(new FakeVideo());
    for (let i = 0; i < A.MEDIA_LIMITS.perPlayer && doc < A.MEDIA_LIMITS.perDocument; i++) { rb.observe(cx, obs('https://cdn.example/p' + p + '/' + i + '.mp4')); doc++; }
  }
  eq(rb.observe(rb.contextFor(new FakeVideo()), obs('https://cdn.example/doc-over.mp4')).reason, 'budget', 'per-document budget');
  for (let i = 0; i < 40; i++) rb.contextFor(new FakeVideo());
  ok(rb.stats().players <= A.MEDIA_LIMITS.players, 'bounded number of players');
  // ---------- playback projection: legacy ordering unchanged ----------
  const rp = c.mk(), ep = new FakeVideo(), cp = rp.contextFor(ep);
  const legacy = ['https://cdn.example/m.m3u8', 'https://cdn.example/b.mp4', 'https://cdn.example/a.mp4'];
  rp.observe(cp, obs(legacy[2])); rp.observe(cp, obs(legacy[0]));
  const proj = rp.selectPlayback(cp, legacy);
  eq(proj.sources, legacy, 'legacy ordering reproduced exactly');
  ok(proj.sources !== legacy, 'projection is a copy');
  eq(proj.ids.map(Boolean), [true, false, true], 'ids attached where known');
}

verify(model, registrySrc);
console.log('PASS media registry: ' + passed + ' checks (schema, kinds, roles, unknown, binding, contexts, epochs, navigation, budgets, projection)');
if (process.argv.includes('--mutations')) {
  const muts = [
    [model, "if (as.state === 'bound' && !as.evidence.length) return no('bound-without-evidence');", ''],          // binding without evidence
    [model, "if (!mediaOnlyKeys(o, MEDIA_OBS_KEYS)) return no('unknown-field');", ''],                            // free fields
    [model, "if (s.role === 'segment' || s.role === 'init' || s.role === 'track') return { state: 'unavailable', reason: 'not-standalone' };", ''], // role check removed
    [model, "if (s.association.state !== 'bound')", 'if (false)'],                                               // binding ignored
    [model, "if (s.kind !== 'mp4') return { state: 'candidate', reason: 'type-unknown' };", ''],                  // unknown as mp4
    [model, "&& pv.kind !== 'player') return no('unverifiable-claim');", "&& false) return no('unverifiable-claim');"], // page data accepted as verified
    [model, "if (/\\.m3u8?$/.test(p)", "if (/\\.mp4/.test(p)) return 'mp4';\n    if (/\\.m3u8?$/.test(p)"],    // extension over path end
    [model, "if (s.protection === 'encrypted' || s.protection === 'drm')", 'if (false)'],
    [registrySrc, "if (ROLE_RANK[v.role] > ROLE_RANK[s.role]) set('role', v.role);", "set('role', v.role);"], // later observation downgrades role
    [registrySrc, "if (s.revision !== revision) return { ok: false, reason: 'stale-revision' };", ''],          // stale selection accepted
    [registrySrc, "return p && p.epoch === ctx.mediaEpoch ? p : null;", 'return p || null;'],                   // stale epoch accepted
    [registrySrc, "if (!ctx || ctx.documentKey !== documentKey) return null;", 'if (!ctx) return null;'],       // forged document
    [registrySrc, "if (p.sources.size >= MEDIA_LIMITS.perPlayer || total >= MEDIA_LIMITS.perDocument) return { ok: false, reason: 'budget' };", ''],
    [registrySrc, "if (h === docHref) return;", 'return;'],                                                       // navigation ignored
    [registrySrc, "el.addEventListener('emptied', () => { if (!p.gone) newEpoch(p, 'emptied'); });", ''],       // new medium ignored
    [registrySrc, 'p.sources.set(sourceId, s); p.byUrl.set(v.url, sourceId); urls.set(sourceId, v.url);', 'p.sources.set(sourceId, s); p.byUrl.set(v.url, sourceId); urls.set(sourceId, v.url.split("?")[0]);'], // query cut
    [registrySrc, "if (ASSOC_RANK[v.association.state] > ASSOC_RANK[s.association.state])", 'if (true)'],       // binding downgraded
    [registrySrc, 'return { sources: list, ids:', 'list.sort(); return { sources: list, ids:'],                    // playback order changed
  ];
  let n = 0;
  for (const [text, a, b] of muts) {
    assert.equal(text.split(a).length, 2, 'unique mutation anchor: ' + a);
    const m = text.replace(a, b);
    let caught = false;
    try { verify(text === model ? m : model, text === registrySrc ? m : registrySrc); } catch (e) { caught = true; }
    assert.ok(caught, 'surviving mutation: ' + a);
    n++;
  }
  console.log('PASS media registry mutations: ' + n + '/' + n);
}
