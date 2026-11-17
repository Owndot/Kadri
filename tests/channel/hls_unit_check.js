// P4b: Unit-Tests „Stream speichern“ (HLS über die Helfer-App) OHNE Helfer: strenge Form von hlsplan/hlsstart
// (channel-session.js), die Download-Verwaltung (channel-downloads.js: Plan, Start, Fortsetzen, abgelaufener Plan,
// Abbruchabsicht, alte Helfer) mit einem Schein-Kanal sowie Auswahl und Bindung in der Quellen-Registry (045/065).
//   node tests/channel/hls_unit_check.js
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadChannel, check, summary } = require('./lib');

const { NS } = loadChannel();
const ID = 'a'.repeat(32), PLAN = 'b'.repeat(32), OPT = 'c'.repeat(24);
const BIND = { player: 'p0a1b2c3d4e5f6a7b8c9d0e1', gen: 2, rev: 5 };
const URL1 = 'https://media.example/stream/master.m3u8?token=SECRET123';

// ---------- hlsplan/hlsstart: genau die Form, die der Helfer annimmt ----------
const dm = NS.downloadMessage;
check('hlsplan: op, v:1, url, bind', JSON.stringify(dm('hlsplan', { url: URL1, bind: BIND })) === JSON.stringify({ op: 'hlsplan', v: 1, url: URL1, bind: BIND }));
check('hlsstart: op, v:1, id, planId, option, bind, name',
  JSON.stringify(dm('hlsstart', { id: ID, planId: PLAN, option: OPT, bind: BIND, name: 'Clip' })) ===
  JSON.stringify({ op: 'hlsstart', v: 1, id: ID, planId: PLAN, option: OPT, bind: BIND, name: 'Clip' }));
check('hlsstart ohne Name', !('name' in dm('hlsstart', { id: ID, planId: PLAN, option: OPT, bind: BIND })));
check('hlsplan wird nach Sitzungswechsel wiederholt, hlsstart nicht', NS.retryableAfterStaleSession('hlsplan') && !NS.retryableAfterStaleSession('hlsstart'));
for (const [what, op, a] of [
  ['hlsplan ohne Bindung', 'hlsplan', { url: URL1 }],
  ['hlsplan mit Cookie', 'hlsplan', { url: URL1, bind: BIND, cookie: 'a=b' }],
  ['hlsplan mit Referer', 'hlsplan', { url: URL1, bind: BIND, referer: 'https://site.example/' }],
  ['hlsplan mit Headern', 'hlsplan', { url: URL1, bind: BIND, headers: { Authorization: 'x' } }],
  ['hlsplan mit Kennung', 'hlsplan', { id: ID, url: URL1, bind: BIND }],
  ['hlsplan URL file:', 'hlsplan', { url: 'file:///x.m3u8', bind: BIND }],
  ['hlsplan URL mit Leerzeichen', 'hlsplan', { url: 'https://media.example/a b.m3u8', bind: BIND }],
  ['hlsplan URL > 2048', 'hlsplan', { url: 'https://media.example/' + 'a'.repeat(2030), bind: BIND }],
  ['Bindung mit Zusatzfeld', 'hlsplan', { url: URL1, bind: Object.assign({ x: 1 }, BIND) }],
  ['Bindung ohne rev', 'hlsplan', { url: URL1, bind: { player: 'p', gen: 1 } }],
  ['Bindung Player mit Leerzeichen', 'hlsplan', { url: URL1, bind: { player: 'p q', gen: 1, rev: 1 } }],
  ['Bindung Player leer', 'hlsplan', { url: URL1, bind: { player: '', gen: 1, rev: 1 } }],
  ['Bindung gen negativ', 'hlsplan', { url: URL1, bind: { player: 'p', gen: -1, rev: 1 } }],
  ['Bindung gen Bruchzahl', 'hlsplan', { url: URL1, bind: { player: 'p', gen: 1.5, rev: 1 } }],
  ['Bindung gen zu groß', 'hlsplan', { url: URL1, bind: { player: 'p', gen: 1e10, rev: 1 } }],
  ['Bindung als Text', 'hlsplan', { url: URL1, bind: 'p|1|1' }],
  ['hlsstart ohne Plan', 'hlsstart', { id: ID, option: OPT, bind: BIND }],
  ['hlsstart Plan zu kurz', 'hlsstart', { id: ID, planId: PLAN.slice(1), option: OPT, bind: BIND }],
  ['hlsstart Option groß', 'hlsstart', { id: ID, planId: PLAN, option: OPT.toUpperCase(), bind: BIND }],
  ['hlsstart mit URL', 'hlsstart', { id: ID, planId: PLAN, option: OPT, bind: BIND, url: URL1 }],
  ['hlsstart Name mit Anführungszeichen', 'hlsstart', { id: ID, planId: PLAN, option: OPT, bind: BIND, name: 'a"b' }],
  ['hlsstart Name > 120', 'hlsstart', { id: ID, planId: PLAN, option: OPT, bind: BIND, name: 'n'.repeat(121) }],
]) check('abgelehnt: ' + what, dm(op, a) === null);

// ---------- Verwaltung mit Schein-Helfer ----------
const OPTIONS = [
  { id: '1'.repeat(24), height: 720, width: 1280, bandwidth: 2000000, audio: { lang: 'de', name: 'Deutsch' }, codecs: 'ok' },
  { id: '2'.repeat(24), height: 360, width: 640, bandwidth: 600000, audio: 'muxed', codecs: 'unknown' },
];
function world(hooks) {
  const mem = { jobs: undefined, writes: [] };
  const sent = [];
  let n = 0, planNo = 0;
  const helper = { jobs: new Map(), plans: new Map(), hooks: hooks || {}, hlsCaps: true };
  const salted = (p, o) => crypto.createHash('sha256').update(p + o.id).digest('hex').slice(0, 24);
  const channel = {
    async download(op, a) {
      sent.push({ op, a: JSON.parse(JSON.stringify(a)), stored: JSON.stringify(mem.jobs) });
      const m = NS.downloadMessage(op, a);
      if (!m) { const e = new Error('input'); e.kind = 'input'; throw e; }
      const hook = helper.hooks[op];
      if (hook) { const r = hook(m, helper); if (r !== undefined) { if (r instanceof Error) throw r; return r; } }
      if (op === 'hlsplan') {
        const planId = crypto.createHash('sha256').update('plan' + (++planNo)).digest('hex').slice(0, 32);
        const opts = OPTIONS.map((o) => Object.assign({}, o, { id: salted(planId, o) }));
        helper.plans.set(planId, { bind: JSON.stringify(m.bind), opts });
        return { ok: true, planId, expiresSec: 600, duration: 20.0, options: opts };
      }
      if (op === 'hlsstart') {
        const p = helper.plans.get(m.planId);
        if (!p || p.bind !== JSON.stringify(m.bind)) return { ok: false, id: m.id, state: 'rejected', reason: 'plan_stale' };
        if (!p.opts.some((o) => o.id === m.option)) return { ok: false, id: m.id, state: 'rejected', reason: 'option_unknown' };
        helper.plans.delete(m.planId);
        helper.chosen = (helper.chosen || []).concat([p.opts.find((o) => o.id === m.option).height]);
        const known = helper.jobs.get(m.id);
        if (!known || known.state === 'interrupted') helper.jobs.set(m.id, { kind: 'hls', state: 'running', bytes: 0, total: -1, done: known ? known.done : 0, of: 11, phase: 'fetch' });
      }
      if (op === 'dlcancel' && helper.jobs.has(m.id)) helper.jobs.get(m.id).state = 'cancelled';
      const j = helper.jobs.get(m.id);
      return j ? Object.assign({ ok: true, id: m.id, reason: '' }, j) : { ok: true, id: m.id, state: 'unknown' };
    },
    async status() { return helper.hlsCaps ? { ok: true, v: 3, hls: { v: 1, profiles: ['ts-avc-aac'], opus: false } } : { ok: true, v: 3 }; },
  };
  const storage = { get: async () => mem.jobs && JSON.parse(JSON.stringify(mem.jobs)), set: async (v) => { mem.jobs = JSON.parse(JSON.stringify(v)); mem.writes.push(JSON.stringify(v)); } };
  const digest = async (u) => crypto.createHash('sha256').update('salt\n' + u).digest('hex');
  const timers = [];   // P4c: Nachprüfungen des Hintergrunds (von Hand ausgelöst)
  const make = () => NS.createDownloads({ channel, storage, digest, setTimer: (f, ms) => timers.push({ f, ms }), random: () => (++n).toString(16).padStart(32, '0') });
  return { mem, sent, helper, make, timers, dl: make() };
}
const err = (kind, notSent) => { const e = new Error(kind); e.kind = kind; if (notSent) e.notSent = true; return e; };
const ops = (w, op) => w.sent.filter((s) => s.op === op);
const rejectWith = async (p) => { try { await p; return null; } catch (e) { return e; } };

(async () => {
  {
    const diag = { v: 1, phase: 'audio_fetch', playlists: 2, url: URL1, cookie: 'PRIVATE', path: '/PRIVATE' };
    const w = world({ hlsplan: () => ({ ok: false, reason: 'http_412', diag }) });
    const e = await rejectWith(w.dl.hlsPlan(URL1, BIND));
    check('HLS plan diagnostic preserves bounded phase/count and strips all extra fields',
      e?.kind === 'plan' && e.reason === 'http_412' && JSON.stringify(e.diag) === '{"v":1,"phase":"audio_fetch","playlists":2}');
    check('HLS plan rejection stores no job and causes no media request', !w.mem.jobs && w.sent.length === 1);
    for (const bad of [null, {}, { v: 2, phase: 'source_fetch', playlists: 0 },
      { v: 1, phase: URL1, playlists: 0 }, { v: 1, phase: 'source_fetch', playlists: -1 },
      { v: 1, phase: 'source_fetch', playlists: 4 }, { v: 1, phase: 'source_fetch', playlists: 0.5 },
      { v: 1, phase: 'source_fetch', playlists: '0' }]) {
      const old = world({ hlsplan: () => ({ ok: false, reason: 'http_404', diag: bad }) });
      const error = await rejectWith(old.dl.hlsPlan(URL1, BIND));
      check('Old/malformed plan diagnostic omitted, existing failure retained', error?.reason === 'http_404' && !error.diag);
    }
    // Actual service response boundary, with the existing download manager and a synthetic channel.
    let receive;
    const serviceNS = Object.assign({}, NS, { createDownloads: () => w.dl, createTransport: () => ({}),
      createStore: () => ({}), createChannel: () => ({}), idbBackend: () => ({}) });
    const context = { KadriChannel: serviceNS, wasm_bindgen: () => Promise.resolve(), URL,
      chrome: { runtime: { id: 'test-extension', getURL: p => 'chrome-extension://test-extension/' + p,
        onMessage: { addListener: f => { receive = f; } } }, storage: { local: {} } } };
    context.self = context;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../channel/channel-service.js'), 'utf8'), context);
    const reply = await new Promise(resolve => receive({ t: 'kadri-download', op: 'hlsplan', url: URL1, bind: BIND },
      { id: 'test-extension', tab: { id: 1 }, url: 'https://page.example/' }, resolve));
    check('Actual service delivers only sanitized planning diagnostic to the content script',
      reply.ok === false && reply.error.reason === 'http_412' && JSON.stringify(reply.error.diag) === JSON.stringify(e.diag) &&
      !JSON.stringify(reply).includes('PRIVATE') && !JSON.stringify(reply).includes('https:'));
  }
  {
    // P4c: fertiger Stream (Stand im Speicher veraltet, Player war zu): neuer Plan nennt keinen „laufenden“ Auftrag,
    // ein neuer Start ist möglich
    const w = world();
    const p = await w.dl.hlsPlan(URL1, BIND);
    const r = await w.dl.hlsStart(p.planId, p.options[0].id, 'x');
    w.helper.jobs.get(r.job.id).state = 'done';
    const p2 = await w.dl.hlsPlan(URL1, BIND);
    check('P4c HLS: veralteter Stand – Plan nennt keinen laufenden Auftrag', !p2.job || p2.job.state === 'done', JSON.stringify(p2.job));
    const r2 = await w.dl.hlsStart(p2.planId, p2.options[0].id, 'x');
    check('P4c HLS: neuer Start derselben Quelle nach dem Ende', !r2.existing && r2.job.id !== r.job.id && ops(w, 'hlsstart').length === 2, JSON.stringify(r2));
  }
  {
    // P4c: Player sofort nach dem Tipp geschlossen, hlsstart-Antwort verloren: Nachprüfung ohne Player mit DERSELBEN
    // Kennung und demselben Plan; hatte der Helfer gestartet, kein zweiter hlsstart.
    for (const arrived of [false, true]) {
      let drop = true;
      const w = world({ hlsstart: (m, h) => {
        if (!drop) return undefined;
        drop = false;
        if (arrived) { h.plans.delete(m.planId); h.jobs.set(m.id, { kind: 'hls', state: 'running', bytes: 0, total: -1, done: 0, of: 11, phase: 'fetch' }); }
        return err('timeout');
      } });
      const p = await w.dl.hlsPlan(URL1, BIND);
      const r = await w.dl.hlsStart(p.planId, p.options[0].id, 'x');
      check('P4c HLS (' + (arrived ? 'angekommen' : 'nicht angekommen') + '): unbestätigt, Nachprüfung geplant', r.job.state === 'unconfirmed' && w.timers.length === 1, JSON.stringify(r));
      { const t = w.timers.shift(); if (t) t.f(); } await new Promise((res) => setTimeout(res, 20));
      const j = w.mem.jobs.find((x) => x.id === r.job.id);
      const ids = ops(w, 'hlsstart').map((x) => x.a.id);
      check('P4c HLS (' + (arrived ? 'angekommen' : 'nicht angekommen') + '): läuft, ' + (arrived ? 'kein zweiter hlsstart' : 'genau ein erneuter hlsstart mit derselben Kennung und demselben Plan'),
        j.state === 'running' && ids.length === (arrived ? 1 : 2) && ids.every((x) => x === r.job.id)
        && (arrived || ops(w, 'hlsstart')[1].a.planId === p.planId), JSON.stringify({ j, ids }));
      check('P4c HLS: Speicher weiterhin ohne Plan, URL oder Token', w.mem.writes.every((x) => !x.includes('media.example') && !x.includes('SECRET123') && !x.includes(p.planId)));
    }
  }
  {
    const w = world();
    const caps = await w.dl.capabilities();
    check('Fähigkeit: HLS nur, wenn der Status es meldet', caps.supported && caps.hls === true, JSON.stringify(caps));
    const p = await w.dl.hlsPlan(URL1, BIND);
    check('Plan: Optionen ohne Adressen, Dauer', p.options.length === 2 && p.duration === 20 && !JSON.stringify(p).includes('media.example'), JSON.stringify(p));
    check('Plan: gesendet nur url + bind', JSON.stringify(Object.keys(ops(w, 'hlsplan')[0].a)) === '["url","bind"]');
    const r = await w.dl.hlsStart(p.planId, p.options[0].id, 'Mein Stream');
    check('Start: läuft, Art hls, Fortschritt Teile', r.job.state === 'running' && r.job.kind === 'hls' && r.job.of === 11, JSON.stringify(r));
    const s = ops(w, 'hlsstart')[0];
    check('Start: Kennung VOR dem Senden gespeichert', s.stored && JSON.parse(s.stored).some((j) => j.id === s.a.id && j.state === 'starting'));
    check('Start: nur id, planId, option, bind, name gesendet', JSON.stringify(Object.keys(s.a)) === '["id","planId","option","bind","name"]', JSON.stringify(s.a));
    check('Speicher: keine URL, kein Token, kein Plan', w.mem.writes.every((x) => !x.includes('media.example') && !x.includes('SECRET123') && !x.includes('m3u8') && !x.includes(p.planId)), w.mem.writes.join('\n'));
    const p2 = await w.dl.hlsPlan(URL1, BIND);
    check('Gleiche Quelle läuft: Plan nennt den Auftrag', p2.job && p2.job.id === r.job.id);
    const again = await w.dl.hlsStart(p2.planId, p2.options[1].id, 'x');
    check('Doppelter Start derselben Quelle: derselbe Auftrag, kein zweiter hlsstart', again.existing && again.job.id === r.job.id && ops(w, 'hlsstart').length === 1);
    w.helper.jobs.get(r.job.id).phase = 'mux';
    const st = await w.dl.status(r.job.id);
    check('Status über dlstatus, Phase sichtbar', st.job.phase === 'mux' && NS.describeDownload(st.job).progress === 'Wird zusammengesetzt …', JSON.stringify(st));
    w.helper.jobs.get(r.job.id).kind = undefined;
    const bad = await w.dl.status(r.job.id);
    check('Art wechselt in der Antwort (MP4 statt HLS): verworfen, nicht übernommen', bad.reachable === false, JSON.stringify(bad));
  }
  {
    // Plan beim Helfer abgelaufen (z. B. neue Kanal-Sitzung): genau einmal neu planen, dieselbe Auswahl, dieselbe Kennung
    let first = true;
    const w = world({ hlsstart: (m) => { if (first) { first = false; return { ok: false, id: m.id, state: 'rejected', reason: 'plan_stale' }; } } });
    const p = await w.dl.hlsPlan(URL1, BIND);
    const r = await w.dl.hlsStart(p.planId, p.options[1].id, 'x');
    const s = ops(w, 'hlsstart');
    check('Abgelaufener Plan: neu geplant und gestartet', r.job.state === 'running' && ops(w, 'hlsplan').length === 2 && s.length === 2, JSON.stringify(r));
    check('Abgelaufener Plan: dieselbe Kennung, gleichwertige Option des neuen Plans (gleiche Qualität)', s[0].a.id === s[1].a.id && s[1].a.option !== s[0].a.option &&
      w.helper.jobs.get(s[1].a.id) !== undefined && JSON.stringify(w.helper.chosen) === '[360]', JSON.stringify(w.helper.chosen));
  }
  {
    // Abgelehnt mit Grund (Plan geändert): kein Auftrag bleibt, Grund kommt an
    const w = world({ hlsstart: (m) => ({ ok: false, id: m.id, state: 'rejected', reason: 'option_unknown' }) });
    const p = await w.dl.hlsPlan(URL1, BIND);
    const e = await rejectWith(w.dl.hlsStart(p.planId, p.options[0].id, 'x'));
    check('Ablehnung: Fehler plan-rejected mit Grund, kein gespeicherter Auftrag', e && e.kind === 'plan-rejected' && e.reason === 'option_unknown' && JSON.parse(w.mem.writes.pop()).length === 0, e && e.reason);
    const e2 = await rejectWith(w.dl.hlsStart(PLAN, OPT, 'x'));
    check('Unbekannter Plan (z. B. Hintergrund neu gestartet): nichts gesendet', e2 && e2.kind === 'plan-rejected' && ops(w, 'hlsstart').length === 1);
  }
  {
    // Helfer lehnt den Plan ab (Live, verschlüsselt, Netz) bzw. alter Helfer ohne HLS
    const w = world({ hlsplan: () => ({ ok: false, reason: 'encrypted' }) });
    const e = await rejectWith(w.dl.hlsPlan(URL1, BIND));
    check('Plan abgelehnt: Grund weitergegeben', e && e.kind === 'plan' && e.reason === 'encrypted' && NS.downloadReasonText('encrypted').includes('verschlüsselt'));
    const old = world({ hlsplan: () => ({ ok: false }) });
    old.helper.hlsCaps = false;
    const caps = await old.dl.capabilities();
    check('Alter Helfer: MP4 ja, HLS nein', caps.supported === true && caps.hls === false, JSON.stringify(caps));
    const e2 = await rejectWith(old.dl.hlsPlan(URL1, BIND));
    check('Alter Helfer: hlsplan → unsupported', e2 && e2.kind === 'unsupported');
    const junk = world({ hlsplan: () => ({ ok: true, planId: PLAN, options: [{ id: 'x', height: 1 }] }) });
    const e3 = await rejectWith(junk.dl.hlsPlan(URL1, BIND));
    check('Ungültige Planantwort (Optionskennung) → protocol', e3 && e3.kind === 'protocol');
    const many = world({ hlsplan: () => ({ ok: true, planId: PLAN, options: new Array(65).fill(0).map((_, i) => ({ id: (i % 10).toString().repeat(24), audio: 'muxed' })) }) });
    check('Mehr als 64 Optionen → protocol', ((await rejectWith(many.dl.hlsPlan(URL1, BIND))) || {}).kind === 'protocol');
  }
  {
    // Unterbrochen (z. B. abgelaufene Quelle) → neuer Plan → Fortsetzen mit DERSELBEN Kennung
    const w = world();
    const p = await w.dl.hlsPlan(URL1, BIND);
    const r = await w.dl.hlsStart(p.planId, p.options[0].id, 'x');
    Object.assign(w.helper.jobs.get(r.job.id), { state: 'interrupted', reason: 'http_403', done: 4 });
    const st = await w.dl.status(r.job.id);
    check('Unterbrochen: Hinweis auf Fortsetzen', st.job.state === 'interrupted' && NS.describeDownload(st.job).label.includes('fortsetzen'), JSON.stringify(st));
    const URL2 = URL1.replace('SECRET123', 'NEWTOKEN');
    const p2 = await w.dl.hlsPlan(URL1, BIND);
    check('Neuer Plan derselben Quelle nennt den unterbrochenen Auftrag', p2.job && p2.job.id === r.job.id && p2.job.state === 'interrupted');
    const res = await w.dl.hlsResume(r.job.id, p2.planId, p2.options[0].id);
    const s = ops(w, 'hlsstart');
    check('Fortsetzen: dieselbe Kennung, läuft wieder', res.job.state === 'running' && s.length === 2 && s[1].a.id === r.job.id, JSON.stringify(res));
    const other = await w.dl.hlsPlan(URL2, BIND);
    const e = await rejectWith(w.dl.hlsResume(r.job.id, other.planId, other.options[0].id));
    check('Fortsetzen nur bei unterbrochenem Auftrag (läuft schon → abgelehnt)', e && e.kind === 'input');
    w.helper.jobs.get(r.job.id).state = 'interrupted';
    await w.dl.status(r.job.id);
    const foreign = await w.dl.hlsPlan('https://media.example/anderer/master.m3u8?token=X', BIND);
    const e2 = await rejectWith(w.dl.hlsResume(r.job.id, foreign.planId, foreign.options[0].id));
    check('Fortsetzen mit dem Plan einer anderen Quelle (anderer Pfad) → abgelehnt, nichts gesendet', e2 && e2.kind === 'plan-rejected' && ops(w, 'hlsstart').length === 2);
  }
  {
    // Abbruch: Absicht vor dem Netzwerk gespeichert; danach kein Fortsetzen
    const w = world({ dlcancel: () => { const e = new Error('unreachable'); e.kind = 'unreachable'; return e; } });
    const p = await w.dl.hlsPlan(URL1, BIND);
    const r = await w.dl.hlsStart(p.planId, p.options[0].id, 'x');
    const c = await w.dl.cancel(r.job.id);
    check('Abbruch: Absicht gespeichert, auch wenn der Helfer gerade nicht antwortet', c.job.state === 'cancelling' && JSON.parse(w.mem.writes[w.mem.writes.length - 1]).some((j) => j.id === r.job.id && j.state === 'cancelling'));
    const p2 = await w.dl.hlsPlan(URL1, BIND);
    const e = await rejectWith(w.dl.hlsResume(r.job.id, p2.planId, p2.options[0].id));
    check('Abgebrochener Auftrag lässt sich nicht fortsetzen', e && e.kind === 'input');
  }

  // ---------- Quellen-Registry: Auswahl und Bindung ----------
  const SRC = (f) => fs.readFileSync(path.join(__dirname, '../../src', f), 'utf8');
  const ctx = { URL, Uint8Array, JSON, Object, Array, Math, Number, String, Map, Set, WeakMap, Date, isFinite, Promise,
    location: { href: 'https://site.example/watch/1' }, crypto: { getRandomValues: (a) => a } };
  vm.createContext(ctx);
  vm.runInContext(SRC('045-media-source.js') + '\n' + SRC('065-media-registry.js').replace('const mediaRegistry = createMediaRegistry();', '') +
    '\nthis.api = { createMediaRegistry, mediaStreamState, selectStreams };', ctx);
  let n = 0;
  const reg = ctx.api.createMediaRegistry({ random: () => 'id' + (++n).toString(16).padStart(6, '0'), docKey: () => 'https://site.example/watch/1' });
  const el = { addEventListener() {} };
  const c = reg.contextFor(el);
  const put = (url, extra) => reg.observe(c, Object.assign({ url, provenance: { kind: 'player', origin: 'own-player' }, association: { state: 'bound', evidence: ['own-player-loaded'] }, browser: 'loaded' }, extra || {}));
  const a = put('https://cdn.example/live/master.m3u8?t=1');
  put('https://cdn.example/other/master.m3u8', { association: { state: 'ambiguous', evidence: ['near'] }, provenance: { kind: 'page-metadata', origin: 'near' }, browser: 'unknown' });
  put('https://cdn.example/enc/master.m3u8', { protection: 'encrypted' });
  put('https://cdn.example/d/manifest.mpd');
  const snap = reg.snapshot(c);
  const withCaps = ctx.api.selectStreams(snap, { hls: true });
  const byState = (st) => withCaps.filter((x) => x.state === st).length;
  check('Auswahl: genau die gebundene, unverschlüsselte HLS-Liste ist auswählbar', byState('attemptable') === 1 && withCaps[0].sourceId === a.sourceId && withCaps[0].identity === 'played', JSON.stringify(withCaps));
  check('Auswahl: unsicher zugeordnet → nur Kandidat; verschlüsselt → nicht verfügbar; DASH nicht in der HLS-Auswahl', byState('candidate') === 1 && withCaps.some((x) => x.reason === 'protected') && withCaps.length === 3);
  check('Auswahl: ohne HLS-Fähigkeit des Helfers nichts auswählbar', ctx.api.selectStreams(snap, { hls: false }).every((x) => x.state !== 'attemptable'));
  check('DASH: nur erkannt, nie angeboten', ctx.api.mediaStreamState(snap.find((x) => x.kind === 'dash')).reason === 'dash-not-supported');
  const rs = reg.resolveStream(c, a.sourceId, a.revision);
  check('Auflösung: Adresse unverändert und Bindung {player, gen, rev}', rs.ok && rs.url === 'https://cdn.example/live/master.m3u8?t=1' && rs.bind.player === c.playerId && rs.bind.gen === c.mediaEpoch && rs.bind.rev === a.revision, JSON.stringify(rs));
  check('Bindung passt zur strengen Nachrichtenform', !!NS.downloadMessage('hlsplan', { url: rs.url, bind: rs.bind }));
  check('Auflösung: veraltete Revision abgelehnt', reg.resolveStream(c, a.sourceId, a.revision + 1).reason === 'stale-revision');
  check('Auflösung: verschlüsselter Stream abgelehnt', reg.resolveStream(c, snap.find((x) => x.protection === 'encrypted').sourceId, 1).reason === 'protected');
  summary('hls-unit');
})().catch((e) => { console.error(e); process.exit(1); });
