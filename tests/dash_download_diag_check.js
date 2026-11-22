'use strict';
// S3g: Download-Diagnose für DASH (src/080) – Typ „dash“ statt „hls“, DASH-Felder, kein Ersatz-Abruf (das MPD ist nie die
// fehlerhafte Ressource), Statusabfrage und Endzustände unverändert; zuletzt gemeldete Helfer-Fähigkeiten (caps) ohne
// Einfluss auf die Antwort. HLS und MP4 unverändert. Synthetische Antworten, keine echten Medien.
//   node tests/dash_download_diag_check.js [ROOT]   (ROOT: anderer Stand, z. B. zum Nachweis, dass der alte Stand fehlschlägt)
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
let passed = 0, failed = 0;
function check(name, value, info) {
  if (value) { passed++; console.log('PASS ' + name); } else { failed++; console.log('FAIL ' + name + (info === undefined ? '' : ' – ' + JSON.stringify(info))); }
}
const MPD = 'https://private.invalid/dash/manifest.mpd?token=PRIVATE-SENTINEL';
function setup(reply) {
  const timers = [], requests = [], probes = [];
  const ctx = { URL, Date, WeakMap, TextDecoder, Uint8Array, CONFIG: {}, document: { hidden: false }, addEventListener() {}, removeEventListener() {},
    setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout() {}, toast() {}, tr: (x) => x,
    mediaRegistry: { snapshot: () => [] },
    gmXhr: () => (o) => { probes.push(o); o.onload({ status: 200 }); return { abort() {} }; },
    mediaReferrer: () => 'https://private.invalid/page', baseDomain: (h) => String(h).split('.').slice(-2).join('.'), location: { hostname: 'www.private.invalid' },
    confirm: () => true,
    KADRI_DOWNLOAD: async (op, args) => { requests.push({ op, args }); return reply(op, args); } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/080-helper-app.js'), 'utf8').split('  // Einen früher gespeicherten')[0] +
    '\nglobalThis.api={helperDl,hdlDiagNew,hdlDiagUpdate,hdlDiagFailure,hdlDiagText,diags:hdlDiags,caps:()=>typeof hdlCapsSeen==="undefined"?undefined:hdlCapsSeen};', ctx);
  return { ctx, api: ctx.api, timers, requests, probes };
}
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
const scrubbed = (t) => !/private|PRIVATE|token=|https?:|\.invalid|manifest\.mpd/.test(t);
(async () => {
  // ---------- caps: Antwort unverändert, Diagnose kennt den tatsächlichen Stand ----------
  const capsValue = { reachable: true, supported: true, hls: true, dash: true, version: 7 };
  let s = setup((op) => (op === 'caps' ? { ok: true, value: capsValue } : { ok: false }));
  const r = await s.api.helperDl('caps');
  check('caps: Antwort an den Aufrufer unverändert (dasselbe Objekt)', r && r.value === capsValue);
  const c = s.api.caps();
  check('caps: zuletzt gemeldete Fähigkeiten festgehalten (MP4/HLS/DASH, Zeit)', c && c.reachable && c.supported && c.hls && c.dash && c.at > 0, c);
  s = setup((op) => (op === 'caps' ? { ok: true, value: { reachable: true, supported: true, hls: true } } : { ok: false }));
  await s.api.helperDl('caps');
  check('caps: Helfer ohne DASH (alte Version) → dash nein', s.api.caps() && s.api.caps().dash === false && s.api.caps().hls === true, s.api.caps());
  s = setup(() => ({ ok: false, error: { kind: 'unpaired' } }));
  await s.api.helperDl('caps');
  check('caps: nicht gekoppelt → nicht erreichbar, nur fester Code', s.api.caps() && s.api.caps().reachable === false && s.api.caps().error === 'unpaired', s.api.caps());
  s = setup(() => ({ ok: true, value: { job: { id: 'j' } } }));
  await s.api.helperDl('status', { id: 'j' });
  check('caps: andere Aufrufe ändern den festgehaltenen Stand nicht', s.api.caps() === null || s.api.caps() === undefined ? s.api.caps() !== undefined : false, s.api.caps());

  // ---------- DASH-Auftrag: Typ dash, Ressourcen, Planung ----------
  s = setup(() => ({ ok: true, value: { job: { id: 'job-private-id', kind: 'dash', state: 'running', done: 4, of: 13, phase: 'fetch', reason: '' } } }));
  const info = { at: Date.now(), stream: true, dash: true, planned: true, stage: 'dashstart', kind: 'dash', role: 'manifest', origin: 'network/dash-segments',
    binding: 'bound:dash-segments', identity: 'played', ageSec: 3, current: true };
  const d = s.api.hdlDiagNew(info, MPD, { id: 'job-private-id', kind: 'dash', state: 'running', done: 3, of: 13, phase: 'fetch', reason: '' });
  let text = s.api.hdlDiagText(d);
  check('DASH-Auftrag: Typ dash (nicht hls)', d.type === 'dash' && /^Typ dash · Zustand running/.test(text), text);
  check('DASH-Auftrag: Aufruf dashstart, Planung erfolgreich (gewählte Option), Ressourcen 3/13 (inkl. Init), Phase fetch',
    /Aufruf dashstart/.test(text) && /Planung erfolgreich \(gewählte Option\)/.test(text) && /Ressourcen 3\/13 \(inkl\. Init\)/.test(text) && /Phase fetch/.test(text), text);
  check('DASH-Auftrag: keine HLS-Angaben (erste Option, Segmentzahl/Fehlerort unbekannt)', !/erste Option/.test(text) && !/Fehlerressource\/Segmentzahl/.test(text), text);
  check('DASH-Auftrag: Quelle und Bindung bleiben angegeben', /Quelle dash\/manifest/.test(text) && /Bindung bound:dash-segments/.test(text), text);
  check('DASH-Auftrag: anonym (keine Adresse, kein Token)', scrubbed(text), text);
  // Statusabfrage läuft wie bei HLS weiter und übernimmt den Fortschritt
  s.timers.shift()(); await flush();
  check('Statusabfrage: fragt den Helfer nach genau diesem Auftrag und übernimmt den Stand (4/13)',
    s.requests.some((x) => x.op === 'status' && x.args.id === 'job-private-id') && d.done === 4 && d.of === 13, s.requests);
  // Fehler mit HTTP-Grund: kein Ersatzabruf des MPD (früher: als HLS ohne Fehlerort ebenfalls nicht)
  s.api.hdlDiagUpdate({ id: 'job-private-id', kind: 'dash', state: 'interrupted', reason: 'http_404', done: 5, of: 13, phase: '' });
  await flush();
  text = s.api.hdlDiagText(d);
  check('DASH-Fehler http_404: kein Browser-Vergleichsabruf (das MPD ist nicht die fehlerhafte Ressource)', s.probes.length === 0, s.probes.length);
  check('DASH-Fehler http_404: Grund, HTTP-Status und „DASH-Ressource unbekannt“ angegeben',
    /Zustand interrupted · Grund http_404/.test(text) && /HTTP 404/.test(text) && /nicht durchgeführt \(DASH-Ressource unbekannt\)/.test(text) && /Ressourcen 5\/13/.test(text), text);
  // Abbruch: Endzustand bleibt endgültig, auch bei später Antwort
  s.api.hdlDiagUpdate({ id: 'job-private-id', kind: 'dash', state: 'cancelled', reason: '', done: 5, of: 13 });
  s.api.hdlDiagUpdate({ id: 'job-private-id', kind: 'dash', state: 'running', reason: '' });
  check('Abbruch: „cancelled“ bleibt endgültig (späte Statusantwort ändert nichts)', d.state === 'cancelled', d.state);
  const before = s.requests.length;
  while (s.timers.length) { s.timers.shift()(); await flush(); }
  check('Abbruch: danach keine weitere Statusabfrage', s.requests.length === before, s.requests.length - before);
  // Typ auch dann dash, wenn der Helfer (noch) keinen kind-Wert meldet – Kadri hat den Auftrag als DASH gestartet
  const d2 = s.api.hdlDiagNew(Object.assign({}, info), MPD, { id: 'job-2', state: 'starting' });
  check('DASH-Auftrag ohne kind in der Antwort: Typ dash (aus dem Start über dashstart)', d2.type === 'dash', d2.type);

  // ---------- dashplan abgelehnt (vor jeder Auftragskennung) ----------
  s = setup(() => ({ ok: false }));
  const f = s.api.hdlDiagFailure({ at: Date.now(), stream: true, dash: true, stage: 'dashplan', kind: 'dash', role: 'manifest' },
    { ok: false, error: { kind: 'plan', reason: 'manifest_mismatch' } });
  text = s.api.hdlDiagText(f);
  check('dashplan abgelehnt: Typ dash · Zustand rejected · Grund manifest_mismatch · Phase dashplan · Aufruf dashplan · Planung abgelehnt',
    /^Typ dash · Zustand rejected · Grund manifest_mismatch/.test(text) && /Phase dashplan/.test(text) && /Aufruf dashplan/.test(text) && /Planung abgelehnt/.test(text) && !/Ressourcen/.test(text), text);

  // ---------- HLS und MP4 unverändert ----------
  s = setup(() => ({ ok: true, value: { job: { id: 'h', kind: 'hls', state: 'running', done: 2, of: 9 } } }));
  const h = s.api.hdlDiagNew({ stream: true, planned: true, stage: 'hlsstart' }, 'https://private.invalid/m.m3u8', { id: 'h', kind: 'hls', state: 'running', done: 2, of: 9 });
  text = s.api.hdlDiagText(h);
  check('HLS unverändert: Typ hls, Planung erfolgreich (erste Option), Ressourcen 2/9', h.type === 'hls' && /^Typ hls/.test(text) && /erste Option/.test(text) && /Ressourcen 2\/9/.test(text), text);
  const m = s.api.hdlDiagNew({ stage: 'start' }, 'https://private.invalid/v.mp4', { id: 'm', state: 'running' });
  check('MP4 unverändert: Typ mp4', m.type === 'mp4' && /^Typ mp4/.test(s.api.hdlDiagText(m)));
  console.log('RESULT dash_download_diag ' + (failed ? 'FAIL' : 'PASS') + ' ' + passed + '/' + (passed + failed));
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
