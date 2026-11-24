// S3c: Unit-Tests „DASH speichern“ OHNE Helfer: strenge Form von dashplan/dashstart (channel-session.js), die
// Download-Verwaltung (channel-downloads.js: Plan mit Fingerabdruck, nur speicherbares Profil, Start, abgelaufener Plan,
// Kennungen, Status, Fehlercodes, Fähigkeit "dashdl", Anfragekontext) mit einem Schein-Kanal, die Route im Hintergrund
// (channel-service.js) sowie Auswahl und Auflösung in der Quellen-Registry (045/065: nur bound + dash-segments, genau eines).
//   node tests/channel/dash_unit_check.js
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadChannel, check, summary } = require('./lib');

const { NS } = loadChannel();
const ID = 'a'.repeat(32), PLAN = 'b'.repeat(32), OPT = 'c'.repeat(24), FP = 'd'.repeat(64);
const BIND = { player: 'p0a1b2c3d4e5f6a7b8c9d0e1', gen: 2, rev: 5 };
const URL1 = 'https://media.example/v/manifest.mpd?token=SECRET123';
const dm = NS.downloadMessage;

// ---------- dashplan/dashstart: genau die Form, die der Helfer annimmt (ControlCommands.java) ----------
check('dashplan: op, v:1, url, fp, bind', JSON.stringify(dm('dashplan', { url: URL1, fp: FP, bind: BIND })) === JSON.stringify({ op: 'dashplan', v: 1, url: URL1, fp: FP, bind: BIND }));
check('dashplan mit played, ref, ua', JSON.stringify(dm('dashplan', { url: URL1, fp: FP, bind: BIND, played: '1,2', ref: 'https://site.example/', ua: 'Mozilla/5.0 (X11)' })) ===
  JSON.stringify({ op: 'dashplan', v: 1, url: URL1, fp: FP, bind: BIND, played: '1,2', ref: 'https://site.example/', ua: 'Mozilla/5.0 (X11)' }));
check('dashstart: op, v:1, id, planId, option, bind, name',
  JSON.stringify(dm('dashstart', { id: ID, planId: PLAN, option: OPT, bind: BIND, name: 'Clip' })) ===
  JSON.stringify({ op: 'dashstart', v: 1, id: ID, planId: PLAN, option: OPT, bind: BIND, name: 'Clip' }));
// S4b-6: Auswahl unter mehreren BaseURL → dashplan v2 mit alt (genau die BaseSelection-Form des Helfers)
check('dashplan mit alt → v:2 und alt', JSON.stringify(dm('dashplan', { url: URL1, fp: FP, bind: BIND, alt: 'm:1;s3:0' })) === JSON.stringify({ op: 'dashplan', v: 2, url: URL1, fp: FP, bind: BIND, alt: 'm:1;s3:0' }));
for (const bad of ['', 'm:1;', 'x:1', 'm:10', 'm:1 ', 'https://cdn.example/', 'm:1;'.repeat(70) + 'm:1', 1])
  check('abgelehnt: dashplan mit ungültigem alt ' + JSON.stringify(String(bad).slice(0, 20)), dm('dashplan', { url: URL1, fp: FP, bind: BIND, alt: bad }) === null);
check('abgelehnt: alt bei dashstart', dm('dashstart', { id: ID, planId: PLAN, option: OPT, bind: BIND, alt: 'm:1' }) === null);
check('dashplan wird nach Sitzungswechsel wiederholt, dashstart nicht', NS.retryableAfterStaleSession('dashplan') && !NS.retryableAfterStaleSession('dashstart'));
for (const [what, op, a] of [
  ['dashplan ohne Fingerabdruck', 'dashplan', { url: URL1, bind: BIND }],
  ['dashplan Fingerabdruck groß geschrieben', 'dashplan', { url: URL1, fp: FP.toUpperCase(), bind: BIND }],
  ['dashplan Fingerabdruck zu kurz', 'dashplan', { url: URL1, fp: FP.slice(1), bind: BIND }],
  ['dashplan ohne Bindung', 'dashplan', { url: URL1, fp: FP }],
  ['dashplan mit Cookie', 'dashplan', { url: URL1, fp: FP, bind: BIND, cookie: 'a=b' }],
  ['dashplan mit Headern', 'dashplan', { url: URL1, fp: FP, bind: BIND, headers: { Authorization: 'x' } }],
  ['dashplan mit Kennung', 'dashplan', { id: ID, url: URL1, fp: FP, bind: BIND }],
  ['dashplan URL file:', 'dashplan', { url: 'file:///x.mpd', fp: FP, bind: BIND }],
  ['dashplan URL > 2048', 'dashplan', { url: 'https://media.example/' + 'a'.repeat(2030), fp: FP, bind: BIND }],
  ['dashplan ref mit Pfad', 'dashplan', { url: URL1, fp: FP, bind: BIND, ref: 'https://site.example/watch' }],
  ['played mit Leerzeichen', 'dashplan', { url: URL1, fp: FP, bind: BIND, played: '1, 2' }],
  ['played mit Wiederholung', 'dashplan', { url: URL1, fp: FP, bind: BIND, played: '1,1' }],
  ['played über 4095', 'dashplan', { url: URL1, fp: FP, bind: BIND, played: '4096' }],
  ['played mehr als 8', 'dashplan', { url: URL1, fp: FP, bind: BIND, played: '0,1,2,3,4,5,6,7,8' }],
  ['played führende Null', 'dashplan', { url: URL1, fp: FP, bind: BIND, played: '01' }],
  ['played leer', 'dashplan', { url: URL1, fp: FP, bind: BIND, played: '' }],
  ['played als Zahl', 'dashplan', { url: URL1, fp: FP, bind: BIND, played: 1 }],
  ['dashstart ohne Plan', 'dashstart', { id: ID, option: OPT, bind: BIND }],
  ['dashstart mit URL', 'dashstart', { id: ID, planId: PLAN, option: OPT, bind: BIND, url: URL1 }],
  ['dashstart mit Fingerabdruck', 'dashstart', { id: ID, planId: PLAN, option: OPT, bind: BIND, fp: FP }],
  ['dashstart Option groß', 'dashstart', { id: ID, planId: PLAN, option: OPT.toUpperCase(), bind: BIND }],
  ['dashstart Name mit Anführungszeichen', 'dashstart', { id: ID, planId: PLAN, option: OPT, bind: BIND, name: 'a"b' }],
]) check('abgelehnt: ' + what, dm(op, a) === null);
check('played: gültige Formen', ['0', '4095', '0,3,7', '1,2,3,4,5,6,7,8'].every(NS.dashPlayedValid));

// ---------- Fähigkeit "dashdl" ----------
const capable = (d) => NS.dashCapable({ ok: true, v: 3, dashdl: d });
check('dashdl v1, Profil fmp4-avc-aac, fp kadri-dash-fp/1: fähig', capable({ v: 1, profiles: ['fmp4-avc-aac'], fp: 'kadri-dash-fp/1', ctx: 1 }));
check('ohne dashdl / v 2 / anderes Profil / anderer Abdruck: nicht fähig', !NS.dashCapable({ ok: true, v: 3 }) && !capable({ v: 2, profiles: ['fmp4-avc-aac'], fp: 'kadri-dash-fp/1' })
  && !capable({ v: 1, profiles: ['webm'], fp: 'kadri-dash-fp/1' }) && !capable({ v: 1, profiles: ['fmp4-avc-aac'], fp: 'kadri-dash-fp/2' }) && !NS.dashCapable({ dash: false }));

// ---------- Verwaltung mit Schein-Helfer ----------
const OPTS = [
  { id: '1'.repeat(24), height: 360, width: 640, bandwidth: 370838, video: 'avc1.4d401e', audio: 'mp4a.40.2', played: true },
  { id: '2'.repeat(24), height: 180, width: 320, bandwidth: 135856, video: 'avc1.4d400c', audio: 'mp4a.40.2', lang: 'de', played: false },
];
function world(hooks) {
  const mem = { jobs: undefined };
  const sent = [];
  let n = 0, planNo = 0;
  const helper = { jobs: new Map(), plans: new Map(), hooks: hooks || {}, dashCaps: true, ctx: false, alt: false, urlq: false, opts: OPTS };
  const salted = (p, o) => crypto.createHash('sha256').update(p + o.id).digest('hex').slice(0, 24);
  const channel = {
    async download(op, a) {
      sent.push({ op, a: JSON.parse(JSON.stringify(a)) });
      const m = NS.downloadMessage(op, a);
      if (!m) { const e = new Error('input'); e.kind = 'input'; throw e; }
      const hook = helper.hooks[op];
      if (hook) { const r = hook(m, helper); if (r !== undefined) { if (r instanceof Error) throw r; return r; } }
      if (op === 'dashplan') {
        if (m.fp !== FP) return { ok: false, reason: 'manifest_mismatch', diag: { v: 1, phase: 'fingerprint' } };
        const planId = crypto.createHash('sha256').update('plan' + (++planNo)).digest('hex').slice(0, 32);
        const opts = helper.opts.map((o) => Object.assign({}, o, { id: salted(planId, o) }));
        helper.plans.set(planId, { bind: JSON.stringify(m.bind), opts });
        return { ok: true, planId, expiresSec: 600, duration: 20.0, fp: 'kadri-dash-fp/1', options: opts };
      }
      if (op === 'dashstart') {
        const p = helper.plans.get(m.planId);
        if (!p || p.bind !== JSON.stringify(m.bind)) return { ok: false, id: m.id, state: 'rejected', reason: 'plan_stale' };
        if (!p.opts.some((o) => o.id === m.option)) return { ok: false, id: m.id, state: 'rejected', reason: 'option_unknown' };
        helper.plans.delete(m.planId);
        helper.chosen = (helper.chosen || []).concat([p.opts.find((o) => o.id === m.option).height]);
        if (!helper.jobs.has(m.id)) helper.jobs.set(m.id, { kind: 'dash', state: 'running', bytes: 0, total: -1, done: 0, of: 13, phase: 'fetch' });
      }
      if (op === 'dlcancel' && helper.jobs.has(m.id)) helper.jobs.get(m.id).state = 'cancelled';
      const j = helper.jobs.get(m.id);
      return j ? Object.assign({ ok: true, id: m.id, reason: '' }, j) : { ok: true, id: m.id, state: 'unknown' };
    },
    async status() {
      return Object.assign({ ok: true, v: 3, hls: { v: 1, profiles: ['ts-avc-aac'], opus: false, ctx: 1 } },
        helper.dashCaps ? { dashdl: Object.assign({ v: 1, profiles: ['fmp4-avc-aac'], fp: 'kadri-dash-fp/1' }, helper.ctx ? { ctx: 1 } : {}, helper.alt ? { alt: 1 } : {}, helper.urlq ? { urlq: 1 } : {}) } : {});
    },
  };
  const storage = { get: async () => mem.jobs && JSON.parse(JSON.stringify(mem.jobs)), set: async (v) => { mem.jobs = JSON.parse(JSON.stringify(v)); } };
  const digest = async (u) => crypto.createHash('sha256').update('salt\n' + u).digest('hex');
  const timers = [];
  const dl = NS.createDownloads({ channel, storage, digest, setTimer: (f, ms) => timers.push({ f, ms }), random: () => (++n).toString(16).padStart(32, '0') });
  return { mem, sent, helper, dl, timers };
}
const err = (kind, notSent) => { const e = new Error(kind); e.kind = kind; if (notSent) e.notSent = true; return e; };
const ops = (w, op) => w.sent.filter((s) => s.op === op);
const rejectWith = async (p) => { try { await p; return null; } catch (e) { return e; } };

(async () => {
  {
    const w = world();
    const p = await w.dl.dashPlan(URL1, FP, BIND, '1,2');
    check('Plan: Optionen ohne Adressen, played und Sprache übernommen, Fingerabdruck an den Helfer', p.options.length === 2 && p.options[0].played === true && p.options[1].lang === 'de'
      && !JSON.stringify(p).includes('https:') && ops(w, 'dashplan')[0].a.fp === FP && ops(w, 'dashplan')[0].a.played === '1,2', JSON.stringify(p));
    check('Plan: noch kein Auftrag gespeichert, kein Medienabruf', !w.mem.jobs && w.sent.length === 1);
    const r = await w.dl.dashStart(p.planId, p.options[0].id, 'Mein Film');
    check('Start: Auftrag kind dash, Kennung VOR dem Senden gespeichert, dieselbe Option beim Helfer', r.job.kind === 'dash' && r.job.state === 'running' && w.helper.chosen[0] === 360
      && w.mem.jobs.length === 1 && !JSON.stringify(w.mem.jobs).includes('https:') && !JSON.stringify(w.mem.jobs).includes(FP), JSON.stringify(w.mem.jobs));
    const r2 = await w.dl.dashStart(p.planId, p.options[0].id, 'Mein Film');
    check('Doppelter Start derselben Quelle: derselbe Auftrag (kein zweites dashstart)', r2.existing && r2.job.id === r.job.id && ops(w, 'dashstart').length === 1);
    w.helper.jobs.get(r.job.id).state = 'failed'; w.helper.jobs.get(r.job.id).reason = 'media_duration';
    const s = await w.dl.status(r.job.id);
    check('Status: failed mit festem Grund; Beschreibung ohne Adresse', s.job.state === 'failed' && s.job.reason === 'media_duration'
      && NS.describeDownload(s.job).label === 'Stücke passen nicht zur angegebenen Länge – nichts gespeichert', JSON.stringify(s.job));
  }
  {
    const w = world();
    const e = await rejectWith(w.dl.dashPlan(URL1, '0'.repeat(64), BIND));
    check('Abweichender Fingerabdruck beim Helfer: Fehler plan mit Grund manifest_mismatch und Phase fingerprint, kein Auftrag',
      e && e.kind === 'plan' && e.reason === 'manifest_mismatch' && JSON.stringify(e.diag) === '{"v":1,"phase":"fingerprint"}' && !w.mem.jobs, e && JSON.stringify(e));
    check('… Text für den Nutzer fest, ohne Adresse', NS.downloadReasonText('manifest_mismatch') === 'Das Manifest beim Helfer weicht vom gespielten ab – nicht gespeichert');
    const bad = await rejectWith(w.dl.dashPlan(URL1, 'x', BIND));
    check('Ungültiger Fingerabdruck verlässt den Browser nicht', bad && bad.kind === 'input' && ops(w, 'dashplan').length === 1);
    const ftp = await rejectWith(w.dl.dashPlan('ftp://x/m.mpd', FP, BIND));
    check('Ungültige Adresse verlässt den Browser nicht', ftp && ftp.kind === 'input' && ops(w, 'dashplan').length === 1);
  }
  {
    // nur das speicherbare Profil: Optionen mit anderem Ton/Bild entfallen; ohne übrige Option → Protokollfehler
    const w = world();
    w.helper.opts = OPTS.concat([{ id: '3'.repeat(24), height: 720, width: 1280, bandwidth: 1, video: 'avc1.640028', audio: 'mp4a.40.5' },
      { id: '4'.repeat(24), height: 720, width: 1280, bandwidth: 1, video: 'hvc1.1.6.L93', audio: 'mp4a.40.2' }]);
    const p = await w.dl.dashPlan(URL1, FP, BIND);
    check('Nur fMP4/H.264 + AAC-LC angeboten (HE-AAC- und HEVC-Optionen entfallen)', p.options.length === 2 && p.options.every((o) => o.audio === 'mp4a.40.2' && /^avc/.test(o.video)), JSON.stringify(p.options));
    w.helper.opts = [{ id: '3'.repeat(24), height: 720, width: 1280, bandwidth: 1, video: 'avc1.640028', audio: 'mp4a.40.5' }];
    const e = await rejectWith(w.dl.dashPlan(URL1, FP, BIND));
    check('Keine speicherbare Option: Protokollfehler, kein Angebot', e && e.kind === 'protocol');
    const w2 = world({ dashplan: (m) => ({ ok: true, planId: PLAN, expiresSec: 600, duration: 1, fp: 'kadri-dash-fp/2', options: OPTS }) });
    check('Plan mit anderer Fingerabdruck-Version: Protokollfehler', (await rejectWith(w2.dl.dashPlan(URL1, FP, BIND))).kind === 'protocol');
    const w3 = world({ dashplan: () => ({ ok: true, planId: PLAN, fp: 'kadri-dash-fp/1', options: [Object.assign({}, OPTS[0], { id: 'x' })] }) });
    check('Plan mit ungültiger Optionskennung: Protokollfehler', (await rejectWith(w3.dl.dashPlan(URL1, FP, BIND))).kind === 'protocol');
    const w4 = world({ dashplan: () => ({ ok: false }) });
    check('Helfer ohne DASH (ok:false ohne Grund): unsupported', (await rejectWith(w4.dl.dashPlan(URL1, FP, BIND))).kind === 'unsupported');
    for (const [reason, text] of [['dash_live', 'Live-Stream – nicht speicherbar'], ['dash_protected', 'Stream ist verschlüsselt (DRM) – nicht speicherbar'],
      ['dash_no_audio', 'Stream ohne Ton – nicht gespeichert'], ['audio_codec', 'Tonformat wird nicht unterstützt'], ['encrypted', 'Stream ist verschlüsselt (DRM/AES) – nicht speicherbar'],
      ['codec_mismatch', 'Format weicht von den Angaben ab – nicht speicherbar'], ['dash_multiperiod', 'Stream-Form nicht unterstützt'], ['verify_duration', 'Prüfung des Ergebnisses fehlgeschlagen – nichts gespeichert']]) {
      const ww = world({ dashplan: () => ({ ok: false, reason, diag: { v: 1, phase: 'profile', url: URL1 } }) });
      const ee = await rejectWith(ww.dl.dashPlan(URL1, FP, BIND));
      check('Plan abgelehnt (' + reason + '): fester Grund, Diagnose nur Phase', ee.kind === 'plan' && ee.reason === reason && JSON.stringify(ee.diag) === '{"v":1,"phase":"profile"}'
        && NS.downloadReasonText(reason) === text, NS.downloadReasonText(reason));
    }
  }
  {
    // Planablauf: Plan beim Helfer verfallen → genau einmal neu planen (gleicher Fingerabdruck), dieselbe Auswahl, dieselbe Kennung
    const w = world();
    const p = await w.dl.dashPlan(URL1, FP, BIND, '1,2');
    w.helper.plans.clear();
    const r = await w.dl.dashStart(p.planId, p.options[1].id, 'x');
    const starts = ops(w, 'dashstart');
    check('plan_stale: genau einmal neu geplant (gleiches fp, played), dieselbe Kennung, gleiche Option (180p)',
      ops(w, 'dashplan').length === 2 && ops(w, 'dashplan')[1].a.fp === FP && ops(w, 'dashplan')[1].a.played === '1,2' && starts.length === 2 && starts[0].a.id === starts[1].a.id
        && w.helper.chosen[0] === 180 && r.job.state === 'running', JSON.stringify(starts.map((x) => x.a)));
    const w2 = world();
    const q = await w2.dl.dashPlan(URL1, FP, BIND);
    w2.helper.plans.clear();
    w2.helper.opts = [OPTS[1], Object.assign({}, OPTS[1], { id: '9'.repeat(24) })];   // zweimal dieselben Merkmale: nicht eindeutig
    const e = await rejectWith(w2.dl.dashStart(q.planId, q.options[1].id, 'x'));
    check('Neuer Plan nicht eindeutig (zwei gleiche Optionen): plan_changed, kein Start, kein Auftrag', e && e.reason === 'plan_changed' && ops(w2, 'dashstart').length === 1
      && (!w2.mem.jobs || !w2.mem.jobs.length), JSON.stringify(e));
    const w3 = world();
    const z = await w3.dl.dashPlan(URL1, FP, BIND);
    const unknownPlan = await rejectWith(w3.dl.dashStart(PLAN, z.options[0].id, 'x'));
    check('Unbekannter Plan (nicht im Speicher): plan_stale ohne Senden', unknownPlan.reason === 'plan_stale' && ops(w3, 'dashstart').length === 0);
    const hp = await w3.dl.hlsPlan('https://media.example/s/master.m3u8', BIND).catch((x) => x);
    check('HLS-Plan nicht als DASH-Start verwendbar (Art des Plans geprüft)', (await rejectWith(w3.dl.dashStart(hp.planId || PLAN, OPT, 'x'))).reason === 'plan_stale');
  }
  {
    // Antwort verloren: Kennung gespeichert; Nachprüfung sendet denselben Start mit DERSELBEN Kennung
    let lose = 1;
    const w = world({ dashstart: () => (lose-- > 0 ? err('timeout') : undefined) });
    const p = await w.dl.dashPlan(URL1, FP, BIND);
    const r = await w.dl.dashStart(p.planId, p.options[0].id, 'x');
    check('Antwort verloren: Auftrag unbestätigt und gespeichert', r.job.state === 'unconfirmed' && w.mem.jobs.length === 1 && w.timers.length === 1);
    const s = await w.dl.status(r.job.id);
    check('Nachprüfung: Helfer kennt die Kennung nicht → derselbe Start erneut, DIESELBE Kennung → läuft', s.job.state === 'running' && ops(w, 'dashstart').length === 2
      && ops(w, 'dashstart')[0].a.id === ops(w, 'dashstart')[1].a.id, JSON.stringify(ops(w, 'dashstart').map((x) => x.a.id)));
    const c = await w.dl.cancel(r.job.id);
    check('Abbruch: dlcancel mit der Kennung → cancelled', c.job.state === 'cancelled' && ops(w, 'dlcancel').length === 1);
  }
  {
    // Status: Art bleibt dash; Fehlerort nur feste Codes
    const w = world();
    const p = await w.dl.dashPlan(URL1, FP, BIND);
    const r = await w.dl.dashStart(p.planId, p.options[0].id, 'x');
    Object.assign(w.helper.jobs.get(r.job.id), { state: 'interrupted', reason: 'http_404', at: 'video_segment', at_index: 3, done: 4, of: 13 });
    const s = await w.dl.status(r.job.id);
    check('Unterbrochen mit Fehlerort video_segment/3: übernommen, Text nennt Fortsetzen in der Helfer-App', s.job.kind === 'dash' && JSON.stringify(s.job.loc) === '{"at":"video_segment","index":3}'
      && /^Unterbrochen – in der Benachrichtigung der Helfer-App fortsetzen/.test(NS.describeDownload(s.job).label), JSON.stringify(s.job));
    Object.assign(w.helper.jobs.get(r.job.id), { state: 'running', at: 'master', at_index: 0, phase: 'mux', done: 13, of: 13 });
    const s2 = await w.dl.status(r.job.id);
    check('Fremder Fehlerort (HLS-Code) bei DASH: verworfen; Fortschritt wie bei Streams', s2.job.loc === undefined && NS.describeDownload(s2.job).progress === 'Wird zusammengesetzt …', JSON.stringify(s2.job));
    w.helper.jobs.get(r.job.id).kind = 'hls';
    const s3 = await w.dl.status(r.job.id);
    check('Helfer meldet für die Kennung eine andere Art: Protokollfehler (nie die Art wechseln)', s3.reachable === false && s3.error === 'protocol', JSON.stringify(s3));
  }
  {
    // Fähigkeit und Anfragekontext
    const w = world();
    const caps = await w.dl.capabilities();
    check('Fähigkeit: dash true bei gemeldetem dashdl', caps.dash === true && caps.hls === true, JSON.stringify(caps));
    const w2 = world(); w2.helper.dashCaps = false;
    check('Fähigkeit: dash false ohne dashdl (alter Helfer)', (await w2.dl.capabilities()).dash === false);
    const w3 = world(); w3.helper.ctx = false;
    await w3.dl.dashPlan(URL1, FP, BIND, undefined, { ref: 'https://site.example/', ua: 'Mozilla/5.0 (X11)' });
    check('Kontext nur an Helfer mit dashdl.ctx 1: ohne → ohne ref/ua', !('ref' in ops(w3, 'dashplan')[0].a) && !('ua' in ops(w3, 'dashplan')[0].a));
    // S4b-6: alt nur an einen Helfer, der "dashdl":{…,"alt":1} meldet – sonst lokal abgelehnt, nichts gesendet
    const w5 = world();
    check('Fähigkeit: dashAlt false ohne "alt" im dashdl', (await w5.dl.capabilities()).dashAlt === false);
    let e5 = null; try { await w5.dl.dashPlan(URL1, FP, BIND, undefined, null, 'm:1'); } catch (e) { e5 = e; }
    check('dashplan mit alt an Helfer ohne alt: abgelehnt (alt_unsupported), kein dashplan gesendet', e5 && e5.reason === 'alt_unsupported' && ops(w5, 'dashplan').length === 0, e5 && e5.reason);
    const w6 = world(); w6.helper.alt = true;
    check('Fähigkeit: dashAlt true mit "alt":1', (await w6.dl.capabilities()).dashAlt === true);
    // S4b-8: Annex I – Fähigkeit "urlq" (Helfer bildet UrlQueryInfo-Adressen selbst); ohne: dashUrlq false
    check('Fähigkeit: dashUrlq false ohne "urlq" im dashdl (Helfer vor S4b-8)', (await w6.dl.capabilities()).dashUrlq === false);
    const w7 = world(); w7.helper.alt = true; w7.helper.urlq = true;
    check('Fähigkeit: dashUrlq true mit "urlq":1', (await w7.dl.capabilities()).dashUrlq === true);
    const w8 = world(); w8.helper.dashCaps = false; w8.helper.urlq = true;
    check('Fähigkeit: dashUrlq nie ohne dashdl', (await w8.dl.capabilities()).dashUrlq === false);
    await w6.dl.dashPlan(URL1, FP, BIND, undefined, null, 'm:1');
    check('… dashplan mit alt gesendet (an den Helfer, der die Auswahl selbst prüft)', ops(w6, 'dashplan').length === 1 && ops(w6, 'dashplan')[0].a.alt === 'm:1', JSON.stringify(ops(w6, 'dashplan')));
    const w4 = world(); w4.helper.ctx = true;
    await w4.dl.dashPlan(URL1, FP, BIND, undefined, { ref: 'https://site.example/', ua: 'Mozilla/5.0 (X11)' });
    check('… mit dashdl.ctx 1: ref (nur Herkunft) und ua gesendet', ops(w4, 'dashplan')[0].a.ref === 'https://site.example/' && ops(w4, 'dashplan')[0].a.ua === 'Mozilla/5.0 (X11)');
  }
  {
    // Route im Hintergrund: Felder streng, Antwort ohne Adresse/Fingerabdruck
    const w = world();
    let receive;
    const serviceNS = Object.assign({}, NS, { createDownloads: () => w.dl, createTransport: () => ({}), createStore: () => ({}), createChannel: () => ({}), idbBackend: () => ({}) });
    const context = { KadriChannel: serviceNS, wasm_bindgen: () => Promise.resolve(), URL,
      chrome: { runtime: { id: 'test-extension', getURL: (p) => 'chrome-extension://test-extension/' + p, onMessage: { addListener: (f) => { receive = f; } } }, storage: { local: {} } } };
    context.self = context;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../channel/channel-service.js'), 'utf8'), context);
    const tab = { id: 'test-extension', tab: { id: 1 }, url: 'https://page.example/watch' };
    const call = (m, s) => new Promise((resolve) => receive(Object.assign({ t: 'kadri-download' }, m), s || tab, resolve));
    const ok = await call({ op: 'dashplan', url: URL1, fp: FP, bind: BIND, played: '1' });
    check('Route dashplan aus dem Tab: Optionen, Antwort ohne Adresse/Fingerabdruck', ok.ok && ok.value.options.length === 2 && !JSON.stringify(ok).includes('https:') && !JSON.stringify(ok).includes(FP), JSON.stringify(ok));
    const st = await call({ op: 'dashstart', planId: ok.value.planId, option: ok.value.options[0].id, name: 'x' });
    check('Route dashstart: Auftrag mit festem Text', st.ok && st.value.job.kind === 'dash' && st.value.job.label === 'Lädt …', JSON.stringify(st));
    for (const [what, m, s] of [
      ['ohne Tab (Menü)', { op: 'dashplan', url: URL1, fp: FP, bind: BIND }, { id: 'test-extension', url: 'chrome-extension://test-extension/popup.html' }],
      ['fremde Erweiterung', { op: 'dashplan', url: URL1, fp: FP, bind: BIND }, { id: 'other', tab: { id: 1 }, url: 'https://page.example/' }],
      ['Zusatzfeld cookie', { op: 'dashplan', url: URL1, fp: FP, bind: BIND, cookie: 'a' }],
      ['Fingerabdruck ungültig', { op: 'dashplan', url: URL1, fp: 'zz', bind: BIND }],
      ['played ungültig', { op: 'dashplan', url: URL1, fp: FP, bind: BIND, played: '1,1' }],
      ['dashstart mit URL', { op: 'dashstart', planId: PLAN, option: OPT, url: URL1 }],
    ]) { const r = await call(m, s); check('Route abgelehnt: ' + what, r.ok === false && r.error.kind === 'refused'); }
    const mm = await call({ op: 'dashplan', url: URL1, fp: '0'.repeat(64), bind: BIND });
    check('Route: manifest_mismatch als fester Text mit Grund und nur der Phase', mm.ok === false && mm.error.reason === 'manifest_mismatch' && JSON.stringify(mm.error.diag) === '{"v":1,"phase":"fingerprint"}'
      && mm.error.message === 'Das Manifest beim Helfer weicht vom gespielten ab – nicht gespeichert', JSON.stringify(mm));
  }
  {
    // Quellen-Registry: nur bound + dash-segments, genau eines; Auflösung mit Bindung
    const SRC = (f) => fs.readFileSync(path.join(__dirname, '../../src', f), 'utf8');
    const ctx = { URL, Uint8Array, JSON, Object, Array, Math, Number, String, Map, Set, WeakMap, Date, isFinite, Promise,
      location: { href: 'https://site.example/watch/1' }, crypto: { getRandomValues: (a) => a } };
    vm.createContext(ctx);
    vm.runInContext(SRC('045-media-source.js') + '\n' + SRC('065-media-registry.js').replace('const mediaRegistry = createMediaRegistry();', '') +
      '\nthis.A = { createMediaRegistry, selectDashStreams, mediaDashStreamState, selectStreams, selectDownloads };', ctx);
    const A = ctx.A;
    let k = 0;
    const reg = A.createMediaRegistry({ random: () => 'id' + (++k).toString(16).padStart(6, '0'), docKey: () => 'doc' });
    const c = reg.contextFor({ addEventListener() {} });
    const put = (u, state, ev, extra) => reg.observe(c, Object.assign({ url: u, provenance: { kind: 'network', origin: ev[0] || 'recent' }, association: { state, evidence: ev } }, extra || {}));
    put('https://cdn.example/a/manifest.mpd', 'ambiguous', ['start-timing']);
    let sel = A.selectDashStreams(reg.snapshot(c), { dash: true });
    check('Registry: nur zeitlich vermutetes MPD → candidate (ambiguous), kein Angebot', sel.length === 1 && sel[0].state === 'candidate' && sel[0].reason === 'ambiguous', JSON.stringify(sel));
    put('https://cdn.example/a/manifest.mpd', 'bound', ['dash-segments']);
    sel = A.selectDashStreams(reg.snapshot(c), { dash: true });
    check('… mit Beleg dash-segments gebunden → attemptable', sel.length === 1 && sel[0].state === 'attemptable', JSON.stringify(sel));
    check('… ohne Fähigkeit des Helfers → unavailable (helper-unavailable)', A.selectDashStreams(reg.snapshot(c), { dash: false })[0].reason === 'helper-unavailable');
    const res = reg.resolveDash(c, sel[0].sourceId, sel[0].revision);
    check('Auflösung: Adresse und Bindung {player, gen, rev}', res.ok && res.url === 'https://cdn.example/a/manifest.mpd' && NS.hlsBindValid(res.bind), JSON.stringify(res));
    check('Auflösung mit veralteter Revision abgelehnt', reg.resolveDash(c, sel[0].sourceId, sel[0].revision - 1).ok === false);
    put('https://cdn.example/b/manifest.mpd', 'bound', ['dash-segments']);
    sel = A.selectDashStreams(reg.snapshot(c), { dash: true });
    check('Zwei gebundene MPDs zugleich: nicht eindeutig → keines angeboten', sel.length === 2 && sel.every((x) => x.state === 'candidate' && x.reason === 'ambiguous'), JSON.stringify(sel));
    const c2 = reg.contextFor({ addEventListener() {} });
    reg.observe(c2, { url: 'https://cdn.example/c/manifest.mpd', provenance: { kind: 'element', origin: 'element-src' }, association: { state: 'bound', evidence: ['element-src'] } });
    check('MPD am Element (Beleg element-src, keine Stückfolge): nicht angeboten', A.selectDashStreams(reg.snapshot(c2), { dash: true }).every((x) => x.state !== 'attemptable'));
    const c3 = reg.contextFor({ addEventListener() {} });
    reg.observe(c3, { url: 'https://cdn.example/d/manifest.mpd', provenance: { kind: 'network', origin: 'dash-segments' }, association: { state: 'bound', evidence: ['dash-segments'] }, protection: 'drm' });
    check('Gebunden, aber als geschützt bekannt: nicht angeboten (protected)', A.selectDashStreams(reg.snapshot(c3), { dash: true })[0].reason === 'protected');
    check('HLS- und MP4-Auswahl bieten DASH weiterhin nie an', A.selectStreams(reg.snapshot(c), { hls: true }).length === 0 && A.selectDownloads(reg.snapshot(c), { supported: true }).length === 0);
  }
  summary('dash-unit');
})();
