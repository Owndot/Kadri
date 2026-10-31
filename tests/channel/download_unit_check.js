// Unit-Tests der direkten MP4-Downloads (Phase C3) OHNE Helfer: strenge Form der Download-Befehle
// (channel-session.js: downloadMessage) und die Download-Verwaltung im Hintergrund (channel-downloads.js) mit einem
// Schein-Kanal, der Verbindungsabbrüche, verlorene Antworten, Helfer-Neustarts und falsche Antworten spielt.
//   node tests/channel/download_unit_check.js
'use strict';
const crypto = require('crypto');
const { loadChannel, check, summary } = require('./lib');

const { NS } = loadChannel();
const ID = 'a'.repeat(32);
const URL1 = 'https://media.example/videos/clip.mp4?sig=SECRET123';

// ---------- downloadMessage: genau die Form, die der Helfer annimmt ----------
const dm = NS.downloadMessage;
check('dlstart mit id, url, name', JSON.stringify(dm('dlstart', { id: ID, url: URL1, name: 'Clip' })) === JSON.stringify({ op: 'dlstart', id: ID, url: URL1, name: 'Clip' }));
check('dlstart ohne Name', JSON.stringify(dm('dlstart', { id: ID, url: URL1 })) === JSON.stringify({ op: 'dlstart', id: ID, url: URL1 }));
check('dlstatus/dlcancel nur mit id', dm('dlstatus', { id: ID }).op === 'dlstatus' && dm('dlcancel', { id: ID }).op === 'dlcancel');
for (const [what, op, a] of [
  ['Cookie-Feld', 'dlstart', { id: ID, url: URL1, cookie: 'a=b' }],
  ['Header-Feld', 'dlstart', { id: ID, url: URL1, headers: { Authorization: 'x' } }],
  ['Referer-Feld', 'dlstart', { id: ID, url: URL1, referer: 'https://site.example/' }],
  ['User-Agent-Feld', 'dlstart', { id: ID, url: URL1, ua: 'x' }],
  ['dlstatus mit URL', 'dlstatus', { id: ID, url: URL1 }],
  ['dlcancel mit Name', 'dlcancel', { id: ID, name: 'x' }],
  ['Kennung groß geschrieben', 'dlstart', { id: 'A'.repeat(32), url: URL1 }],
  ['Kennung zu kurz', 'dlstatus', { id: 'a'.repeat(31) }],
  ['Leerzeichen in der URL', 'dlstart', { id: ID, url: 'https://media.example/a b.mp4' }],
  ['Zeilenumbruch in der URL', 'dlstart', { id: ID, url: 'https://media.example/a\r\nCookie: x' }],
  ['Anführungszeichen in der URL', 'dlstart', { id: ID, url: 'https://media.example/a"b' }],
  ['javascript:', 'dlstart', { id: ID, url: 'javascript:alert(1)' }],
  ['file:', 'dlstart', { id: ID, url: 'file:///etc/passwd' }],
  ['ftp:', 'dlstart', { id: ID, url: 'ftp://media.example/a.mp4' }],
  ['URL > 2048', 'dlstart', { id: ID, url: 'https://media.example/' + 'a'.repeat(2030) }],
  ['Name mit Anführungszeichen', 'dlstart', { id: ID, url: URL1, name: 'a"b' }],
  ['Name mit Backslash', 'dlstart', { id: ID, url: URL1, name: 'a\\b' }],
  ['Name mit Steuerzeichen', 'dlstart', { id: ID, url: URL1, name: 'a\u0007b' }],
  ['Name mit U+2028', 'dlstart', { id: ID, url: URL1, name: 'a b' }],
  ['Name mit einzelnem Surrogat', 'dlstart', { id: ID, url: URL1, name: 'a\ud800b' }],
  ['Name > 120', 'dlstart', { id: ID, url: URL1, name: 'n'.repeat(121) }],
  ['unbekannter Befehl', 'download', { id: ID, url: URL1 }],
]) check('abgelehnt: ' + what, dm(op, a) === null);

// ---------- URL-Normalisierung und Name ----------
const nu = NS.normalizeDownloadUrl;
check('URL: Fragment entfernt', nu('https://media.example/a.mp4#t=10') === 'https://media.example/a.mp4');
check('URL: Zugangsdaten abgelehnt', nu('https://user:pw@media.example/a.mp4') === null);
check('URL: Nicht-ASCII kodiert', nu('https://media.example/vídeo.mp4') === 'https://media.example/v%C3%ADdeo.mp4');
check('URL: Anführungszeichen kodiert', nu('https://media.example/a.mp4?q="x"') === 'https://media.example/a.mp4?q=%22x%22');
check('URL: blob:/data: abgelehnt', nu('blob:https://media.example/x') === null && nu('data:video/mp4;base64,AAAA') === null);
check('Name: Steuerzeichen und Anführungszeichen ersetzt', NS.downloadName('a"b\\c\u0001d') === 'a b c d');
check('Name: leer → Video', NS.downloadName('  ') === 'Video');
check('Name: höchstens 120, Surrogat-Paar nicht zerschnitten', NS.downloadName('x'.repeat(119) + '😀').length === 119);

// ---------- Verwaltung mit Schein-Kanal ----------
function world(script, now) {
  const mem = { jobs: undefined, writes: [] };
  const sent = [];
  let n = 0;
  const helper = { jobs: new Map(), mode: script || {} };
  const channel = {
    async download(op, a) {
      sent.push({ op, a: JSON.parse(JSON.stringify(a)), stored: JSON.stringify(mem.jobs) });
      const m = NS.downloadMessage(op, a);
      if (!m) { const e = new Error('input'); e.kind = 'input'; throw e; }
      const hook = helper.mode[op];
      if (hook) { const r = hook(m, helper); if (r !== undefined) { if (r instanceof Error) throw r; return r; } }
      if (op === 'dlstart') {
        if (!helper.jobs.has(m.id)) helper.jobs.set(m.id, { state: 'running', bytes: 0, total: 1000 });
      }
      if (op === 'dlcancel' && helper.jobs.has(m.id)) helper.jobs.get(m.id).state = 'cancelled';
      const j = helper.jobs.get(m.id);
      return j ? Object.assign({ ok: true, id: m.id, reason: '' }, j) : { ok: true, id: m.id, state: 'unknown' };
    },
  };
  const storage = { get: async () => mem.jobs && JSON.parse(JSON.stringify(mem.jobs)), set: async (v) => { mem.jobs = JSON.parse(JSON.stringify(v)); mem.writes.push(JSON.stringify(v)); } };
  const digest = async (u) => crypto.createHash('sha256').update('salt\n' + u).digest('hex');
  const make = () => NS.createDownloads({ channel, storage, digest, random: () => (++n).toString(16).padStart(32, '0'), now: now || (() => Date.now()) });
  return { mem, sent, helper, make, dl: make() };
}
const err = (kind, notSent) => { const e = new Error(kind); e.kind = kind; if (notSent) e.notSent = true; return e; };
const starts = (w) => w.sent.filter((s) => s.op === 'dlstart');

(async () => {
  {
    const w = world();
    const r = await w.dl.start(URL1, 'Mein "Clip"');
    check('Start: läuft beim Helfer', r.job.state === 'running' && !r.existing, JSON.stringify(r));
    const s = starts(w)[0];
    check('Start: nur id, url, name gesendet', JSON.stringify(Object.keys(s.a)) === '["id","url","name"]' && s.a.url === URL1 && s.a.name === 'Mein Clip', JSON.stringify(s.a));
    check('Start: Kennung VOR dem Senden gespeichert', s.stored && JSON.parse(s.stored).some((j) => j.id === s.a.id && j.state === 'starting'), s.stored);
    check('Speicher: keine URL, kein Host, keine Abfrage', w.mem.writes.every((x) => !x.includes('media.example') && !x.includes('SECRET123') && !x.includes('clip.mp4')), w.mem.writes.join('\n'));
    const again = await w.dl.start(URL1 + '#t=5', 'anders');
    check('Doppelter Start (gleiche Datei, läuft): derselbe Auftrag, kein zweiter dlstart', again.existing && again.job.id === r.job.id && starts(w).length === 1);
    const f = await w.dl.find(URL1);
    check('find: Auftrag zur Datei (z. B. nach Neustart des Players)', f && f.id === r.job.id);
    check('find: andere Datei → nichts', (await w.dl.find('https://media.example/other.mp4')) === null);
    w.helper.jobs.get(r.job.id).bytes = 500;
    const st = await w.dl.status(r.job.id);
    check('Fortschritt aus dlstatus', st.job.bytes === 500 && st.job.total === 1000 && NS.describeDownload(st.job).progress.startsWith('50 %'), JSON.stringify(st));
    w.helper.jobs.get(r.job.id).state = 'done';
    const fin = await w.dl.status(r.job.id);
    check('Fertig: Zustand done, Text ohne URL', fin.job.state === 'done' && !JSON.stringify(NS.describeDownload(fin.job)).includes('media'), JSON.stringify(fin));
    const before = w.sent.length;
    await w.dl.status(r.job.id);
    check('Beendeter Auftrag: keine weitere Abfrage beim Helfer', w.sent.length === before);
    const third = await w.dl.start(URL1);
    check('Nach Abschluss: bewusster neuer Start = neuer Auftrag (neue Kennung)', !third.existing && third.job.id !== r.job.id && starts(w).length === 2);
  }
  {
    const w = world();
    const [a, b] = await Promise.all([w.dl.start(URL1), w.dl.start(URL1)]);
    check('Gleichzeitiger Doppeltipp: ein dlstart, ein Auftrag', starts(w).length === 1 && a.job.id === b.job.id && b.existing && w.mem.jobs.length === 1);
  }
  {
    // Antwort verloren (Record kann angekommen sein): unbestätigt → dlstatus → unbekannt → dlstart mit DERSELBEN Kennung
    let drop = true;
    const w = world({ dlstart: (m, h) => { if (drop) { drop = false; h.jobs.set(m.id, { state: 'running', bytes: 0, total: 1000 }); return err('unreachable'); } } });
    const r = await w.dl.start(URL1);
    check('Antwort verloren: Auftrag „unbestätigt“, nicht verworfen', r.job.state === 'unconfirmed', JSON.stringify(r));
    const s = await w.dl.status(r.job.id);
    check('… dlstatus klärt: Helfer hatte gestartet → läuft, kein zweiter dlstart', s.job.state === 'running' && starts(w).length === 1, JSON.stringify(s));
  }
  {
    let drop = true;
    const w = world({ dlstart: () => { if (drop) { drop = false; return err('timeout'); } } });
    const r = await w.dl.start(URL1);
    const s = await w.dl.status(r.job.id);
    const ids = starts(w).map((x) => x.a.id);
    check('Nicht angekommen (Helfer kennt Kennung nicht): erneut mit derselben Kennung', s.job.state === 'running' && ids.length === 2 && ids[0] === ids[1], JSON.stringify(ids));
  }
  {
    const w = world({ dlstart: () => err('timeout') });
    const r = await w.dl.start(URL1);
    const fresh = w.make();   // Service Worker neu gestartet: URL nicht mehr im Speicher
    w.helper.mode = {};
    const s = await fresh.status(r.job.id);
    check('Nach Neustart des Hintergrunds, Start unbekannt: „nicht bestätigt“, KEIN neuer dlstart', s.job.state === 'failed' && s.job.reason === 'not_started' && starts(w).length === 1, JSON.stringify(s));
  }
  {
    const w = world({ dlstart: (m, h) => { h.jobs.set(m.id, { state: 'running', bytes: 1, total: 9 }); return err('unreachable'); } });
    const r = await w.dl.start(URL1);
    w.helper.mode = {};
    const s = await w.make().status(r.job.id);
    check('Nach Neustart des Hintergrunds, Helfer lädt: Stand übernommen', s.job.state === 'running' && starts(w).length === 1);
  }
  {
    const w = world({ dlstart: () => err('unreachable', true) });
    let e = null;
    try { await w.dl.start(URL1); } catch (x) { e = x; }
    check('Helfer nicht erreichbar (kein Handshake): Fehler, kein Auftrag gespeichert', e && e.kind === 'unreachable' && w.mem.jobs.length === 0);
  }
  {
    const w = world({ dlstart: () => err('unpaired', true) });
    let e = null;
    try { await w.dl.start(URL1); } catch (x) { e = x; }
    check('Nicht gekoppelt: Fehler „unpaired“, kein Auftrag, nur dieser eine Versuch (kein anderer Weg)', e && e.kind === 'unpaired' && w.mem.jobs.length === 0 && w.sent.length === 1);
    check('… fester Hinweistext', NS.downloadErrorText('unpaired').includes('nicht gekoppelt'));
  }
  {
    let stale = true;
    const w = world({ dlstart: () => { if (stale) { stale = false; return err('stale-session', true); } } });
    const r = await w.dl.start(URL1);
    const ids = starts(w).map((x) => x.a.id);
    check('Sitzung beim Helfer abgelaufen (Neustart der App): genau einmal neu, dieselbe Kennung', r.job.state === 'running' && ids.length === 2 && ids[0] === ids[1]);
  }
  {
    const w = world({ dlstart: () => ({ ok: false, state: 'busy' }) });
    let e = null;
    try { await w.dl.start(URL1); } catch (x) { e = x; }
    check('Helfer ausgelastet: Fehler „helper-busy“, kein Auftrag', e && e.kind === 'helper-busy' && w.mem.jobs.length === 0);
  }
  {
    const w = world({ dlstart: () => ({ ok: false }) });
    let e = null;
    try { await w.dl.start(URL1); } catch (x) { e = x; }
    check('Alter Helfer ohne Downloads: „unsupported“', e && e.kind === 'unsupported');
  }
  {
    const w = world();
    let e = null;
    try { await w.dl.start('http://user:pw@media.example/a.mp4'); } catch (x) { e = x; }
    check('URL mit Zugangsdaten: nichts gesendet', e && e.kind === 'input' && w.sent.length === 0);
  }
  {
    const w = world({ dlstart: (m) => ({ ok: true, id: 'b'.repeat(32), state: 'running', bytes: 0, total: 1 }) });
    const r = await w.dl.start(URL1);
    check('Antwort für fremde Kennung: nicht übernommen (unbestätigt)', r.job.state === 'unconfirmed');
  }
  {
    const w = world({ dlstatus: (m) => ({ ok: true, id: m.id, state: 'failed', bytes: 0, total: -1, reason: 'http_403 <img src=x>' }) });
    const r = await w.dl.start(URL1);
    const s = await w.dl.status(r.job.id);
    check('Fremder Grund-Text wird nicht übernommen', s.job.state === 'failed' && s.job.reason === '');
  }
  {
    const w = world();
    const r = await w.dl.start(URL1);
    const c = await w.dl.cancel(r.job.id);
    check('Abbruch: dlcancel gesendet, Zustand abgebrochen', w.sent.some((x) => x.op === 'dlcancel' && x.a.id === r.job.id) && ['cancelled', 'cancelling'].includes(c.job.state), JSON.stringify(c));
    const s = await w.dl.status(r.job.id);
    check('… dlstatus bestätigt „cancelled“', s.job.state === 'cancelled');
  }
  {
    // Abbruch während Verbindungsabbruch: wird nachgeholt
    const w = world();
    const r = await w.dl.start(URL1);
    w.helper.mode = { dlcancel: () => err('unreachable') };
    const c = await w.dl.cancel(r.job.id);
    check('Abbruch, Helfer nicht erreichbar: Absicht dauerhaft gespeichert', !c.reachable && c.job.state === 'cancelling' && w.mem.jobs[0].state === 'cancelling');
    check('Abbruchabsicht VOR dem Netzwerkaufruf gespeichert', JSON.parse(w.sent.find((x) => x.op === 'dlcancel').stored)[0].state === 'cancelling');
    // Neuer Manager = Worker-/Browser-Neustart: nur persistierter Speicher, keine pending-URL.
    const restarted = w.make();
    const again = await restarted.start(URL1);
    check('Erneuter Tipp überholt ausstehenden Abbruch nicht', again.existing && again.job.state === 'cancelling' && starts(w).length === 1);
    w.helper.mode = {};
    const before = w.sent.length;
    const recovered = await restarted.status(r.job.id);
    check('Nach Neustart zuerst Status, dann erforderlichen Abbruch zustellen', w.sent.slice(before).map((x) => x.op).join(',') === 'dlstatus,dlcancel' && recovered.job.state === 'cancelled');
    // Unbestätigter Start abgebrochen und Helfer hatte doch gestartet
    const w2 = world({ dlstart: (m, h) => { h.jobs.set(m.id, { state: 'running', bytes: 0, total: 9 }); return err('unreachable'); } });
    const r2 = await w2.dl.start(URL1);
    w2.helper.mode = { dlcancel: () => err('unreachable') };
    const c2 = await w2.dl.cancel(r2.job.id);
    check('Abbruch eines unbestätigten Starts ohne Verbindung: „wird abgebrochen“', c2.job.state === 'cancelling');
    w2.helper.mode = {};
    const s2 = await w2.dl.status(r2.job.id);
    check('… Verbindung wieder da, Helfer lädt: dlcancel nachgeholt, abgebrochen', w2.sent.filter((x) => x.op === 'dlcancel').length === 2 && s2.job.state === 'cancelled' && w2.helper.jobs.get(r2.job.id).state === 'cancelled', JSON.stringify(s2));
    check('… und kein erneuter dlstart', starts(w2).length === 1);
  }
  {
    // Eine verlorene Startantwort kann einem noch nicht ausgeführten Start vorausgehen.
    // unknown bestätigt keinen Abbruch: Absicht behalten, auch nach erneutem Tipp und Neustart.
    const w = world({ dlstart: () => err('timeout') });
    const r = await w.dl.start(URL1);
    const c = await w.dl.cancel(r.job.id);
    check('Unbekannte Kennung ist keine Abbruchbestätigung', c.job.state === 'cancelling');
    const fresh = w.make();
    await fresh.start(URL1);
    const s = await fresh.status(r.job.id);
    check('unknown nach Neustart: Abbruch bleibt, kein dlstart trotz erneuter URL', s.job.state === 'cancelling' && starts(w).length === 1);
    w.helper.jobs.set(r.job.id, { state: 'running', bytes: 0, total: 9 });
    w.helper.mode = {};
    const late = await fresh.status(r.job.id);
    check('Verspäteter Start wird beim nächsten Abgleich abgebrochen', late.job.state === 'cancelled' && starts(w).length === 1);
  }
  {
    const w = world();
    const r = await w.dl.start(URL1);
    w.helper.mode = { dlcancel: (m, h) => { h.jobs.get(m.id).state = 'cancelled'; return err('timeout'); } };
    await w.dl.cancel(r.job.id);
    const before = w.sent.length;
    w.helper.mode = {};
    const s = await w.make().status(r.job.id);
    check('Abbruchantwort verloren: terminalen Helperstatus übernehmen, kein zweiter Abbruch nötig', s.job.state === 'cancelled' && w.sent.length === before + 1);
  }
  for (const terminal of ['done', 'failed', 'interrupted']) {
    const w = world();
    const r = await w.dl.start(URL1);
    w.helper.mode = { dlcancel: () => err('unreachable') };
    await w.dl.cancel(r.job.id);
    w.helper.mode = {};
    w.helper.jobs.get(r.job.id).state = terminal;
    const before = w.sent.length;
    const s = await w.make().status(r.job.id);
    check('Ausstehender Abbruch: eindeutiger Terminalzustand ' + terminal + ' gewinnt', s.job.state === terminal && w.sent.length === before + 1);
  }
  {
    const w = world();
    const r = await w.dl.start(URL1);
    w.helper.mode = { dlcancel: (m) => ({ ok: true, id: m.id, state: 'running', bytes: 10, total: 1000 }) };
    await w.dl.cancel(r.job.id);
    await w.make().status(r.job.id);
    check('Noch running nach dlcancel bestätigt keinen Abbruch', w.mem.jobs[0].state === 'cancelling');
    w.helper.mode = { dlstatus: () => err('timeout') };
    await w.make().status(r.job.id);
    check('Wiederholter Statusfehler löscht Abbruchabsicht nicht', w.mem.jobs[0].state === 'cancelling');
  }
  {
    const w = world(null, () => 1000);   // alle zur selben Zeit: die Reihenfolge muss trotzdem stimmen
    const ids = [];
    for (let i = 0; i < 25; i++) {
      const r = await w.dl.start('https://media.example/v' + i + '.mp4');
      ids.push(r.job.id);
      w.helper.jobs.get(r.job.id).state = 'done';
      await w.dl.status(r.job.id);
    }
    check('Höchstens 20 Aufträge gespeichert (älteste beendete fallen heraus)', w.mem.jobs.length === 20 && !w.mem.jobs.some((j) => j.id === ids[0]));
  }
  {
    const w = world({ dlstatus: (m) => (m.id === '0'.repeat(32) ? { ok: true, id: m.id, state: 'unknown' } : undefined) });
    check('Fähigkeit: Helfer mit Downloads', (await w.dl.capabilities()).supported === true);
    const w2 = world({ dlstatus: () => ({ ok: false }) });
    check('Fähigkeit: alter Helfer → nicht unterstützt', (await w2.dl.capabilities()).supported === false);
    const w3 = world({ dlstatus: () => err('unpaired', true) });
    const c3 = await w3.dl.capabilities();
    check('Fähigkeit: nicht gekoppelt → nicht erreichbar, nicht unterstützt', c3.supported === false && c3.reachable === false && c3.error === 'unpaired');
  }
  // Texte: fest, ohne URL; Anmeldung verlangt
  check('Text: 401/403 → Anmeldung verlangt, kein anderer Weg', NS.downloadReasonText('http_403').includes('Anmeldung') && NS.downloadReasonText('http_401').includes('Anmeldung'));
  check('Text: private Adresse', NS.downloadReasonText('blocked_address').includes('privates Netz'));
  check('Text: Speicherberechtigung (Android 8–9)', NS.downloadReasonText('storage_permission').includes('Speicherzugriff'));
  check('Text: unbekannter Grund → allgemein', NS.downloadReasonText('xyz') === 'Download fehlgeschlagen');
  summary('download_unit');
})().catch((e) => { console.log('FAIL crash — ' + (e && e.stack)); process.exitCode = 1; });
