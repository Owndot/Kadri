'use strict';
// S1 DASH: Manifest-Rolle und Zusammenfassung im Quellenmodell (src/045) und in der Registry (src/065) – echte Quellen.
// Geprüft: Validierung (nur DASH-Manifeste, strenges Schema), Merge (Rolle manifest ersetzt geratene Listen-Rolle,
// neueste Zusammenfassung, Schutz nur nach oben), Downloadstatus/Auswahl unverändert (kein Angebot), mediaDashState nur
// für Manifeste, MP4/HLS unverändert.
//   node tests/dash_manifest_model_check.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert/strict');
const SRC = (f) => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8');
let passed = 0;
function check(name, value, info) { assert.ok(value, name + (info === undefined ? '' : ' – ' + JSON.stringify(info))); passed++; console.log('PASS ' + name); }

const ctx = { URL, Uint8Array, JSON, Object, Array, Math, Number, String, Map, Set, WeakMap, Date, isFinite, Promise,
  location: { href: 'https://site.example/watch/1' }, crypto: { getRandomValues: (a) => a } };
vm.createContext(ctx);
vm.runInContext(SRC('045-media-source.js') + '\n' + SRC('065-media-registry.js').replace('const mediaRegistry = createMediaRegistry();', '') +
  '\nthis.A = { createMediaRegistry, mediaValidObservation, mediaManifestOk, mediaDownloadState, selectDownloads, selectStreams, mediaDashState, MEDIA_ROLES };', ctx);
const A = ctx.A;
let n = 0;
const reg = A.createMediaRegistry({ random: () => 'id' + (++n).toString(16).padStart(6, '0'), docKey: () => 'doc' });
const video = { addEventListener() {} };
const c = reg.contextFor(video);

const sum = (over) => Object.assign({ format: 'dash', v: 1, error: '', type: 'static', periods: 1, adaptationSets: 2, representations: 2, duration: 600,
  addressing: ['template-timeline'], protection: { signaled: false, systems: [], defaultKid: false },
  tracks: [{ kind: 'video', container: 'mp4', codecs: ['avc'], width: 1280, height: 720, bandwidth: 2000000, lang: '', addressing: 'template-timeline', protected: false },
    { kind: 'audio', container: 'mp4', codecs: ['aac'], width: null, height: null, bandwidth: 128000, lang: 'de', addressing: 'template-timeline', protected: false }] }, over || {});
const obs = (url, extra) => Object.assign({ url, provenance: { kind: 'network', origin: 'start-timing' }, association: { state: 'ambiguous', evidence: ['start-timing'] } }, extra || {});
const V = (o) => A.mediaValidObservation(o);

// ---------- Validierung ----------
check('Rolle „manifest“ gehört zum Modell', A.MEDIA_ROLES.indexOf('manifest') >= 0);
check('MPD (*.mpd) mit Rolle manifest und Zusammenfassung: gültig', V(obs('https://cdn.example/v/manifest.mpd', { role: 'manifest', manifest: sum() })).ok);
check('MPD nur per Content-Type erkannt (#kadri.mpd): gültig', V(obs('https://cdn.example/v/stream#kadri.mpd', { role: 'manifest', manifest: sum() })).ok);
check('Adresse ohne Endung, Art dash aus dem gelesenen Inhalt: gültig', V(obs('https://cdn.example/v/stream', { kind: 'dash', role: 'manifest', manifest: sum() })).ok);
for (const [name, o] of [
  ['an einer HLS-Liste', obs('https://cdn.example/v/master.m3u8', { role: 'manifest', manifest: sum() })],
  ['an einer MP4-Datei', obs('https://cdn.example/v/a.mp4', { role: 'manifest', manifest: sum() })],
  ['ohne Rolle manifest', obs('https://cdn.example/v/manifest.mpd', { role: 'media-playlist', manifest: sum() })],
  ['an einem Stück (Rolle segment)', obs('https://cdn.example/v/manifest.mpd', { role: 'segment', manifest: sum() })],
  ['mit unbekanntem Feld', obs('https://cdn.example/v/manifest.mpd', { role: 'manifest', manifest: sum({ baseUrl: 'https://cdn.example/' }) })],
  ['mit Adresse in einer Spur', obs('https://cdn.example/v/manifest.mpd', { role: 'manifest', manifest: sum({ tracks: [Object.assign({}, sum().tracks[0], { url: 'x' })] }) })],
  ['mit „unverschlüsselt“-Behauptung (Feld clear)', obs('https://cdn.example/v/manifest.mpd', { role: 'manifest', manifest: sum({ protection: { signaled: false, systems: [], defaultKid: false, clear: true } }) })],
  ['Fehlercode mit Angaben', obs('https://cdn.example/v/manifest.mpd', { role: 'manifest', manifest: sum({ error: 'doctype' }) })],
  ['als Text statt Objekt', obs('https://cdn.example/v/manifest.mpd', { role: 'manifest', manifest: '<MPD/>' })],
]) check('Zusammenfassung abgelehnt ' + name, V(o).ok === false && V(o).reason === 'manifest', V(o));
check('Fehlercode ohne Angaben (nicht auswertbar): gültig', V(obs('https://cdn.example/v/x.mpd', { role: 'manifest', manifest: sum({ error: 'doctype', type: 'unknown', periods: 0,
  adaptationSets: 0, representations: 0, duration: null, addressing: [], tracks: [] }) })).ok);
check('Beobachtung ohne Zusammenfassung: wie bisher gültig (Feld manifest bleibt leer)', V(obs('https://cdn.example/v/a.mpd')).ok && V(obs('https://cdn.example/v/a.mpd')).value.manifest === null);

// ---------- Registry: Merge ----------
const U = 'https://cdn.example/v/manifest.mpd';
let r = reg.observe(c, obs(U, { role: 'media-playlist' }));   // alter Stand: nach HLS-Muster geratene Rolle
check('alte Beobachtung (Rolle media-playlist) angelegt', r.ok && reg.snapshot(c)[0].role === 'media-playlist');
r = reg.observe(c, obs(U, { role: 'manifest', manifest: sum(), duration: { status: 'claimed', value: 600, evidenceIds: ['mpd-duration'] } }));
let s = reg.snapshot(c)[0];
check('gelesenes Manifest ersetzt die geratene Rolle; Zusammenfassung und Dauer (claimed) übernommen',
  s.role === 'manifest' && s.manifest && s.manifest.tracks.length === 2 && s.duration.status === 'claimed' && s.duration.value === 600 && s.revision === 2, s);
reg.observe(c, obs(U, { role: 'manifest', manifest: sum({ type: 'dynamic', duration: null }) }));
s = reg.snapshot(c)[0];
check('neu geladenes Manifest: neueste Zusammenfassung gilt', s.manifest.type === 'dynamic' && s.revision === 3);
reg.observe(c, obs(U, { role: 'manifest', manifest: sum({ type: 'dynamic', duration: null }) }));
check('… dieselbe Zusammenfassung erneut: keine neue Revision', reg.snapshot(c)[0].revision === 3);
reg.observe(c, obs(U, { role: 'manifest', manifest: sum({ protection: { signaled: true, systems: ['cenc', 'widevine'], defaultKid: true } }), protection: 'drm' }));
reg.observe(c, obs(U, { role: 'manifest', manifest: sum(), protection: 'unknown' }));
s = reg.snapshot(c)[0];
check('angegebener Schutz bleibt (drm), auch wenn eine spätere Fassung keinen angibt – nie herabgestuft', s.protection === 'drm', s.protection);
reg.observe(c, obs(U, { role: 'segment' }));
check('Rolle: ein späteres „Stück“ schlägt das Manifest (bestehende Regel „Rolle schlägt Endung“) – Manifest-Daten bleiben gespeichert',
  reg.snapshot(c)[0].role === 'segment' && !!reg.snapshot(c)[0].manifest);

// ---------- kein Angebot, Hinweis nur für Manifeste ----------
const reg2 = A.createMediaRegistry({ random: () => 'jd' + (++n).toString(16).padStart(6, '0'), docKey: () => 'doc2' });
const c2 = reg2.contextFor({ addEventListener() {} });
reg2.observe(c2, obs('https://cdn.example/w/manifest.mpd', { role: 'manifest', manifest: sum(), association: { state: 'bound', evidence: ['segments-loaded'] } }));
const snap2 = reg2.snapshot(c2);
check('Manifest (auch gebunden): Downloadstatus unavailable(stream-not-supported)', snap2[0].download.state === 'unavailable' && snap2[0].download.reason === 'stream-not-supported', snap2[0].download);
check('… weder in der MP4- noch in der Stream-Auswahl (kein neues Angebot)', A.selectDownloads(snap2, { supported: true }).length === 0 && A.selectStreams(snap2, { hls: true }).length === 0);
check('… DASH-Hinweis meldet einen Kandidaten, auch bei altem bound-Eintrag', A.mediaDashState([snap2]) === 'suspected', A.mediaDashState([snap2]));
check('Stück mit Art dash (ehemals Manifest, jetzt Rolle segment): kein DASH-Hinweis', A.mediaDashState([reg.snapshot(c)]) === '');

// ---------- Korrektur: Inhalt (gültiges MPD) überstimmt eine aus der Adresse geratene HLS-Einstufung ----------
{
  const r4 = A.createMediaRegistry({ random: () => 'md' + (++n).toString(16).padStart(6, '0'), docKey: () => 'doc4' });
  const c4 = r4.contextFor({ addEventListener() {} });
  const HU = 'https://cdn.example/x/stream.m3u8';
  r4.observe(c4, { url: HU, role: 'master', protection: 'drm', provenance: { kind: 'network', origin: 'start-timing' }, association: { state: 'ambiguous', evidence: ['start-timing'] } });
  let x = r4.snapshot(c4)[0];
  check('zuerst nach Adresse vermutet: hls:master (Stream-Auswahl sähe eine HLS-Liste)', x.kind === 'hls' && x.role === 'master' && A.selectStreams(r4.snapshot(c4), { hls: true }).length === 1, x);
  const rr = r4.observe(c4, { url: HU, kind: 'dash', role: 'manifest', manifest: sum(), provenance: { kind: 'network', origin: 'start-timing' }, association: { state: 'ambiguous', evidence: ['start-timing'] } });
  x = r4.snapshot(c4)[0];
  check('… dann gültiges MPD unter derselben Adresse gelesen: dash:manifest mit Zusammenfassung (Art und Rolle konsistent)', rr.ok && x.kind === 'dash' && x.role === 'manifest' && !!x.manifest, [rr, x.kind, x.role]);
  check('… kein HLS-/MP4-Angebot mehr, Download unavailable(stream-not-supported), Schutz drm bleibt', A.selectStreams(r4.snapshot(c4), { hls: true }).length === 0 &&
    A.selectDownloads(r4.snapshot(c4), { supported: true }).length === 0 && x.download.reason === 'stream-not-supported' && x.protection === 'drm', x);
  r4.observe(c4, { url: HU, role: 'master', provenance: { kind: 'network', origin: 'start-timing' }, association: { state: 'ambiguous', evidence: ['start-timing'] } });
  x = r4.snapshot(c4)[0];
  check('… eine spätere bloße Adress-Vermutung (HLS) macht das gelesene MPD nicht wieder zu HLS', x.kind === 'dash' && x.role === 'manifest', x);
  const SU = 'https://cdn.example/x/seg-1.m4s';
  r4.observe(c4, { url: SU, role: 'segment', provenance: { kind: 'manifest', origin: 'hls-media' }, association: { state: 'unbound', evidence: [] } });
  const rs = r4.observe(c4, { url: SU, kind: 'dash', role: 'manifest', manifest: sum(), provenance: { kind: 'network', origin: 'x' }, association: { state: 'unbound', evidence: [] } });
  const y = r4.snapshot(c4).find((e) => e.role === 'segment');
  check('Stück bleibt Stück: keine Manifest-Rolle, keine Zusammenfassung', rs.ok && y && y.role === 'segment' && y.kind !== 'dash' && y.manifest === null, y);
  const IU = 'https://cdn.example/x/init.mp4';
  r4.observe(c4, { url: IU, role: 'init', provenance: { kind: 'manifest', origin: 'hls-map' }, association: { state: 'unbound', evidence: [] } });
  r4.observe(c4, { url: IU, kind: 'dash', role: 'manifest', manifest: sum(), provenance: { kind: 'network', origin: 'x' }, association: { state: 'unbound', evidence: [] } });
  const z = r4.snapshot(c4).find((e) => e.role === 'init');
  check('Init-Datei bleibt Init-Datei', z && z.role === 'init' && z.kind === 'mp4' && z.manifest === null, z);
  const OU = 'https://cdn.example/x/other.m3u8';
  r4.observe(c4, { url: OU, role: 'master', provenance: { kind: 'network', origin: 'start-timing' }, association: { state: 'ambiguous', evidence: ['start-timing'] } });
  const bad = r4.observe(c4, { url: OU, kind: 'dash', role: 'manifest', manifest: sum({ error: 'parse', type: 'unknown', periods: 0, adaptationSets: 0,
    representations: 0, duration: null, addressing: [], tracks: [] }), provenance: { kind: 'network', origin: 'x' }, association: { state: 'unbound', evidence: [] } });
  const w = r4.snapshot(c4).find((e) => e.sourceId === bad.sourceId);
  check('nicht auswertbares MPD (nur Fehlercode) überstimmt eine HLS-Einstufung nicht', bad.ok && w.kind === 'hls' && w.role === 'master' && w.manifest === null, w);
}
// ---------- MP4/HLS unverändert ----------
const reg3 = A.createMediaRegistry({ random: () => 'kd' + (++n).toString(16).padStart(6, '0'), docKey: () => 'doc3' });
const c3 = reg3.contextFor({ addEventListener() {} });
reg3.observe(c3, { url: 'https://cdn.example/h/master.m3u8', role: 'master', provenance: { kind: 'network', origin: 'segments-loaded' }, association: { state: 'bound', evidence: ['segments-loaded'] } });
reg3.observe(c3, { url: 'https://cdn.example/h/a.mp4', provenance: { kind: 'element', origin: 'element-src' }, association: { state: 'bound', evidence: ['element-src'] } });
const snap3 = reg3.snapshot(c3);
check('HLS-Hauptliste und MP4 wie bisher: Rollen, keine Manifest-Daten, beide auswählbar',
  snap3[0].role === 'master' && snap3[0].manifest === null && snap3[1].manifest === null &&
  A.selectStreams(snap3, { hls: true }).filter((x) => x.state === 'attemptable').length === 1 &&
  A.selectDownloads(snap3, { supported: true }).filter((x) => x.state === 'attemptable').length === 1 && A.mediaDashState([snap3]) === '', snap3);
// Alte MP4-/HLS-Auswahlen: sobald der Inhalt als MPD erkannt ist, darf auch eine unveränderte Revision nicht weitergehen.
{
  const legacy = A.createMediaRegistry({ random: () => 'yd' + (++n).toString(16).padStart(6, '0'), docKey: () => 'doc5' });
  const context = legacy.contextFor({ addEventListener() {} });
  const mp4Url = 'https://cdn.example/mux.mp4', hlsUrl = 'https://cdn.example/stream.m3u8';
  const observe = (url, role) => legacy.observe(context, obs(url, {
    role, association: { state: 'bound', evidence: ['element-src'] },
  }));
  const mp4 = observe(mp4Url, 'standalone'), hls = observe(hlsUrl, 'master');
  const file = () => legacy.resolveSelection(context, mp4.sourceId, mp4.revision);
  const stream = () => legacy.resolveStream(context, hls.sourceId, hls.revision);
  check('Frühere direkte Datei und HLS-Liste bleiben mit gültigen Belegen auswählbar', file().ok && stream().ok);
  ctx.dashSummaryOf = (url) => [mp4Url, hlsUrl].includes(url) ? sum() : null;
  check('Nach Erkennung als MPD sind alte MP4- und HLS-Auswahlen lokal gesperrt', !file().ok && !stream().ok, [file().reason, stream().reason]);
}
console.log('RESULT dash-manifest-model PASS ' + passed + '/' + passed);
