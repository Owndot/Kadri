// Integration der direkten MP4-Downloads (Phase C3): Kanal-Module + Download-Verwaltung + vendorter WASM-Kern in Node
// gegen den echten ChannelServer UND die echte Download-Engine der Helper-App (DirectDownloads mit SafeHttpClient,
// Desktop-Harness; nur die Android-Ablage ist ein Ordner). Medien kommen von einem lokalen Testserver.
//   HELPER_HOST_DIR=<Helper-Repo: tests/java/channel/build.sh OUT> node tests/channel/download_integration_check.js
'use strict';
const crypto = require('crypto');
const { loadChannel, startHelper, check, summary } = require('./lib');
const media = require('./media_server');

const { NS, core } = loadChannel();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setup(backend) {
  backend = backend || NS.memoryBackend();
  const store = NS.createStore(backend, () => core.identity_generate());
  // Unterbricht nur den Browser-Kanal; der echte Helper und sein Medienabruf laufen weiter.
  const wire = { offline: false };
  const transport = NS.createTransport({ fetchImpl: (...args) => {
    if (wire.offline) return Promise.reject(new Error('test channel offline'));
    return fetch(...args);
  }, port: 47899, timeoutMs: 5000 });
  const channel = NS.createChannel({ core, store, transport });
  const mem = { jobs: undefined, writes: [] };
  const make = () => NS.createDownloads({
    channel,
    storage: { get: async () => mem.jobs && JSON.parse(JSON.stringify(mem.jobs)), set: async (v) => { mem.jobs = JSON.parse(JSON.stringify(v)); mem.writes.push(JSON.stringify(v)); } },
    digest: async (u) => crypto.createHash('sha256').update('salt\n' + u).digest('hex'),
    random: () => crypto.randomBytes(16).toString('hex'),
  });
  return { backend, channel, mem, make, wire, dl: make() };
}

async function until(dl, id, pred, ms = 30000) {
  const end = Date.now() + ms;
  let last = null;
  while (Date.now() < end) {
    last = await dl.status(id);
    if (last && pred(last.job, last)) return last;
    await sleep(250);
  }
  return last;
}
const files = async (h) => (await h.cmd('dl-files')).split(' ').slice(1);

async function main() {
  const m = await media.start();
  let h = startHelper();
  check('Desktop-Helfer gestartet', /^READY/.test(await h.ready));
  try {
    check('Download-Modus mit echter Engine (nur 127.0.0.1:' + m.port + ' erlaubt)', (await h.cmd('downloads ' + m.port)) === 'DOWNLOADS on');

    // ---------- ohne Kopplung: kein Weg ----------
    {
      const u = setup();
      let e = null;
      try { await u.dl.start(m.url('/a.mp4')); } catch (x) { e = x; }
      check('Nicht gekoppelt: Fehler „unpaired“, kein Auftrag, keine Anfrage an den Medienserver', e && e.kind === 'unpaired' && u.mem.jobs.length === 0 && m.hits.length === 0, e && e.kind);
      const c = await u.dl.capabilities();
      check('… Fähigkeit: nicht erreichbar/unterstützt', !c.supported && c.error === 'unpaired');
    }

    const s = setup();
    await s.channel.pair(await h.code());
    check('Gekoppelt; Helfer kann direkte Downloads', (await s.dl.capabilities()).supported === true);

    // ---------- öffentliche MP4 ----------
    const pub = m.url('/videos/pub.mp4', 'sig=SECRET-TOKEN-1');
    const r1 = await s.dl.start(pub, 'Öffentlicher Clip');
    check('Start: Auftrag läuft (oder ist schon fertig)', ['running', 'done'].includes(r1.job.state), JSON.stringify(r1.job));
    const d1 = await until(s.dl, r1.job.id, (j) => j.state === 'done');
    check('Öffentliche MP4: fertig, volle Größe', d1.job.state === 'done' && d1.job.bytes === m.size, JSON.stringify(d1.job));
    const f1 = await files(h);
    check('… Datei beim Helfer veröffentlicht (Name aus Kadri, Größe stimmt)', f1.some((f) => f === 'Öffentlicher_Clip.mp4:' + m.size), f1.join(' '));
    check('… keine Teil-Datei übrig', (await h.cmd('dl-parts')) === 'PARTS 0');
    const helperHits = m.hits.filter((x) => !x.browser);
    check('Helfer sendet weder Cookie noch Authorization noch Referer', helperHits.length > 0 && helperHits.every((x) => !x.cookie && !x.auth && !x.referer), JSON.stringify(helperHits.slice(0, 2)));

    // ---------- Fortschritt ----------
    const slow = m.url('/videos/slow.mp4', 'rate=60000');
    const r2 = await s.dl.start(slow, 'Langsam');
    const p2 = await until(s.dl, r2.job.id, (j) => j.state === 'running' && j.bytes > 0 && j.bytes < j.total, 15000);
    check('Fortschritt: Bytes wachsen, Gesamtgröße bekannt', p2.job.bytes > 0 && p2.job.total === m.size, JSON.stringify(p2.job));
    check('… Text mit Prozent', /^\d+ % · /.test(NS.describeDownload(p2.job).progress), NS.describeDownload(p2.job).progress);

    // ---------- doppelter Start ----------
    const before = m.hits.filter((x) => x.path === '/videos/slow.mp4').length;
    const [a, b] = await Promise.all([s.dl.start(slow), s.dl.start(slow + '#t=3')]);
    check('Doppelter Start derselben Datei: derselbe Auftrag', a.existing && b.existing && a.job.id === r2.job.id && b.job.id === r2.job.id);
    await sleep(300);
    check('… keine zweite Anfrage an den Medienserver', m.hits.filter((x) => x.path === '/videos/slow.mp4').length === before);

    // ---------- Verbindungsabbruch (Kanal-Server neu, Sitzungen weg; die Engine lädt weiter) ----------
    check('Kanal neu gestartet (alle Sitzungen ungültig)', /^READY/.test(await h.cmd('restart')));
    const p3 = await s.dl.status(r2.job.id);
    check('… dlstatus nach Neuaufbau der Sitzung: echter Stand', p3.reachable && ['running', 'done'].includes(p3.job.state), JSON.stringify(p3));

    // ---------- Abbruch ----------
    s.wire.offline = true;
    const c2 = await s.dl.cancel(r2.job.id);
    check('Kanal getrennt: Abbruchabsicht gespeichert, Helper lädt unabhängig weiter', !c2.reachable && c2.job.state === 'cancelling', JSON.stringify(c2.job));
    s.dl = s.make();   // Worker-/Browser-Neustart ohne flüchtige pending-URLs
    const retry = await s.dl.start(slow);
    check('Neustart und erneuter Tipp überholen den Abbruch nicht', retry.existing && retry.job.id === r2.job.id && retry.job.state === 'cancelling');
    s.wire.offline = false;
    const c3 = await until(s.dl, r2.job.id, (j) => j.state === 'cancelled', 10000);
    check('… Helfer meldet „cancelled“', c3.job.state === 'cancelled', JSON.stringify(c3.job));
    check('… weiterhin nur ein Medienabruf', m.hits.filter((x) => x.path === '/videos/slow.mp4').length === before);
    await sleep(500);
    check('… Teil-Datei entfernt, keine Datei veröffentlicht', (await h.cmd('dl-parts')) === 'PARTS 0' && !(await files(h)).some((f) => f.startsWith('Langsam')));

    // ---------- höchstens zwei gleichzeitig ----------
    const x1 = await s.dl.start(m.url('/v/x1.mp4', 'rate=20000'));
    const x2 = await s.dl.start(m.url('/v/x2.mp4', 'rate=20000'));
    let busy = null;
    try { await s.dl.start(m.url('/v/x3.mp4', 'rate=20000')); } catch (e) { busy = e; }
    check('Dritter gleichzeitiger Download: Helfer ausgelastet, kein Auftrag', busy && busy.kind === 'helper-busy' && !(await s.dl.list()).some((j) => j.state === 'starting'), busy && busy.kind);
    await s.dl.cancel(x2.job.id);

    // ---------- Neustart des Helfer-Prozesses während eines Downloads ----------
    await until(s.dl, x1.job.id, (j) => j.bytes > 0, 10000);
    await h.stop({ kill: true, keep: true });
    const off = await s.dl.status(x1.job.id);
    check('Helfer weg: Stand bleibt, „nicht erreichbar“ (kein anderer Weg)', !off.reachable && off.job.state === 'running', JSON.stringify(off));
    h = startHelper({ state: h.state });
    check('Helfer-Prozess neu gestartet (Kopplung und Journal im Zustand)', /^READY/.test(await h.ready));
    const back = await until(s.dl, x1.job.id, (j) => j.state !== 'running', 15000);
    check('… dlstatus: „interrupted“ aus dem Journal (Abbruch durch Prozessende)', back.job.state === 'interrupted', JSON.stringify(back.job));
    check('… Teil-Datei aufgeräumt', (await h.cmd('dl-parts')) === 'PARTS 0');
    check('… fertige Datei von vorher noch da', (await files(h)).some((f) => f === 'Öffentlicher_Clip.mp4:' + m.size));
    const again = await s.dl.start(m.url('/v/x1.mp4', 'rate=20000'));
    check('… bewusster Neustart der Datei: neuer Auftrag', !again.existing && again.job.id !== x1.job.id);
    await s.dl.cancel(again.job.id);
    await until(s.dl, again.job.id, (j) => j.state === 'cancelled', 10000);

    // ---------- Speicherberechtigung fehlt (Android 8–9) ----------
    await h.cmd('storage-permission off');
    const r4 = await s.dl.start(m.url('/videos/perm.mp4'));
    const f4 = await until(s.dl, r4.job.id, (j) => j.state === 'failed');
    check('Ohne Speicherberechtigung: kontrolliert fehlgeschlagen (storage_permission)', f4.job.state === 'failed' && f4.job.reason === 'storage_permission', JSON.stringify(f4.job));
    check('… Hinweis verständlich', NS.describeDownload(f4.job).label.includes('Speicherzugriff'));
    await h.cmd('storage-permission on');

    // ---------- Anmeldung verlangt (Cookies/Sitzung) ----------
    const r5 = await s.dl.start(m.url('/videos/login.mp4', 'auth=1&token=SECRET-TOKEN-2'));
    const f5 = await until(s.dl, r5.job.id, (j) => j.state === 'failed');
    check('Server verlangt Anmeldung: kontrolliert fehlgeschlagen (http_403), kein anderer Weg', f5.job.state === 'failed' && f5.job.reason === 'http_403', JSON.stringify(f5.job));
    check('… Hinweis „Anmeldung“', NS.describeDownload(f5.job).label.includes('Anmeldung'));
    check('… Anfragen an die geschützte Datei nur ohne Cookie', m.hits.filter((x) => x.path === '/videos/login.mp4').every((x) => !x.cookie));

    // ---------- private bzw. nicht erlaubte Adressen ----------
    const r6 = await s.dl.start('http://10.1.2.3/video.mp4?key=SECRET-TOKEN-3');
    const f6 = await until(s.dl, r6.job.id, (j) => j.state === 'failed');
    check('Private Adresse (10.0.0.0/8): gesperrt', f6.job.state === 'failed' && /^blocked_/.test(f6.job.reason), JSON.stringify(f6.job));
    const r7 = await s.dl.start('http://127.0.0.1:47899/p1/ch/hs.mp4');
    const f7 = await until(s.dl, r7.job.id, (j) => j.state === 'failed');
    check('Eigener Rechner, anderer Port (Helfer selbst): gesperrt', f7.job.state === 'failed' && /^blocked_/.test(f7.job.reason), JSON.stringify(f7.job));
    let e8 = null;
    try { await s.dl.start('http://user:pw@127.0.0.1:' + m.port + '/a.mp4'); } catch (x) { e8 = x; }
    check('URL mit Zugangsdaten: in Kadri abgelehnt, nichts gesendet', e8 && e8.kind === 'input');

    // ---------- keine URL-Teile in Speicher, Texten, Ereignissen ----------
    const all = s.mem.writes.join('\n') + JSON.stringify((await s.dl.list()).map(NS.describeDownload)) + h.events.join('\n');
    check('Weder Speicher noch Texte noch Helfer-Ereignisse enthalten URL, Pfad oder Token',
      !/SECRET-TOKEN|pub\.mp4|login\.mp4|10\.1\.2\.3|127\.0\.0\.1/.test(all), all.match(/SECRET-TOKEN[^"]*|pub\.mp4|10\.1\.2\.3/g));
    check('Journal: höchstens 20 Aufträge, Kennungen statt URLs', s.mem.jobs.length <= 20 && s.mem.jobs.every((j) => /^[0-9a-f]{32}$/.test(j.id) && /^[0-9a-f]{64}$/.test(j.key) && !('url' in j)));
  } finally {
    await h.stop();
    await m.close();
  }
  summary('download-integration');
}
main().catch((e) => { console.log('FAIL crash — ' + (e && e.stack)); process.exitCode = 1; });
