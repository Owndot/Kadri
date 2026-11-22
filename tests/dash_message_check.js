'use strict';
// S0 DASH: Hinweis im schwebenden Download-Menü (pageDlReason, src/105) mit den echten Auswahlfunktionen (src/045).
//  - DASH sicher an das Video gebunden → „DASH-Stream erkannt – derzeit nicht unterstützt“
//  - DASH nur vermutet (ambiguous, z. B. zeitliche Nähe) → „Vermutlich DASH-Stream – nicht sicher zugeordnet …“
//  - ein nur irgendwo gesehenes (unbound) Manifest ändert nichts; DASH wird nie angeboten
//  - alle MP4-/HLS-Fälle: derselbe Hinweis wie bisher, dieselben Angebote
//   node tests/dash_message_check.js [ROOT]
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
let passed = 0;
function check(name, value, info) { assert.ok(value, name + (info === undefined ? '' : ' – ' + JSON.stringify(info))); passed++; console.log('PASS ' + name); }

const ctx = { console, IN_FRAME: false, META: false, addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, history: {}, location: { href: 'https://site.example/' } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'src/045-media-source.js'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'src/105-download-knopf.js'), 'utf8') +
  '\nglobalThis.T = { selectDownloads, selectStreams, mediaDashState, pageDlReason };', ctx);
const T = ctx.T;

let n = 0;
const entry = (kind, role, assoc, extra) => Object.assign({ sourceId: 's' + (++n), revision: 1, kind, role,
  association: { state: assoc, evidence: assoc === 'bound' ? ['segments-loaded'] : assoc === 'ambiguous' ? ['start-timing'] : [] },
  quality: { status: 'unknown' }, browser: 'unknown', protection: 'unknown', provenance: [{ kind: 'network', origin: 'x' }] }, extra || {});
// wie pageDlOptions: dieselben Auswahlfunktionen über einem Schnappschuss
function opts(snap, caps) {
  caps = caps || { supported: true, hls: true };
  const all = T.selectDownloads(snap, { supported: true }), allS = T.selectStreams(snap, { hls: !!caps.hls });
  return { mp4: all.filter((o) => o.state === 'attemptable'), hls: allS.filter((o) => o.state === 'attemptable'), all, allS, dash: T.mediaDashState([snap]) };
}
const DB = 'DASH-Stream erkannt – derzeit nicht unterstützt';
const DS = 'Vermutlich DASH-Stream – nicht sicher zugeordnet und derzeit nicht unterstützt';
const NONE = 'Keine speicherbare Videodatei erkannt – Video abspielen und erneut tippen';
const AMB = 'Quelle nicht sicher diesem Video zugeordnet – Video kurz abspielen und erneut tippen';
const HELPER = 'Stream erkannt – diese Helfer-App-Version speichert keine Streams';
const PROT = 'Video geschützt (DRM/verschlüsselt) – nicht speicherbar';
const PART = 'Nur Teilstücke eines Streams erkannt – Video abspielen und erneut tippen';

// ---------- DASH ----------
for (const [name, snap, want] of [
  ['Feldbefund: nur DASH, ambiguous(start-timing)', [entry('dash', 'manifest', 'ambiguous')], DS],
  ['nur DASH, sicher gebunden (segments-loaded)', [entry('dash', 'manifest', 'bound')], DB],
  ['DASH-Manifest noch ohne bekannte Rolle, gebunden', [entry('dash', 'unknown', 'bound')], DB],
  ['nur DASH-Stück (Rolle segment), gebunden: kein DASH-Hinweis', [entry('dash', 'segment', 'bound')], NONE],
  ['nur DASH-Init-Datei, gebunden: kein DASH-Hinweis', [entry('dash', 'init', 'bound')], NONE],
  ['nur DASH-Einzelspur, vermutet: kein DASH-Hinweis', [entry('dash', 'track', 'ambiguous')], NONE],
  ['DASH nur irgendwo gesehen (unbound): keine Behauptung', [entry('dash', 'manifest', 'unbound')], NONE],
  ['gebunden schlägt vermutet (zwei Manifeste)', [entry('dash', 'manifest', 'ambiguous'), entry('dash', 'manifest', 'bound')], DB],
  ['DASH gebunden + HLS nur vermutet: DASH-Hinweis', [entry('dash', 'manifest', 'bound'), entry('hls', 'master', 'ambiguous')], DB],
  ['DASH vermutet + HLS vermutet: wie bisher „nicht sicher zugeordnet“', [entry('dash', 'manifest', 'ambiguous'), entry('hls', 'master', 'ambiguous')], AMB],
  ['DASH vermutet + HLS geschützt: wie bisher „geschützt“', [entry('dash', 'manifest', 'ambiguous'), entry('hls', 'master', 'bound', { protection: 'drm' })], PROT],
  ['DASH vermutet + MP4 nicht gebunden: wie bisher „nicht sicher zugeordnet“', [entry('dash', 'manifest', 'ambiguous'), entry('mp4', 'standalone', 'unbound')], AMB],
  ['DASH vermutet + Stück: wie bisher „Teilstücke“', [entry('dash', 'manifest', 'ambiguous'), entry('mp4', 'segment', 'bound')], PART],
]) {
  const o = opts(snap);
  check(name + ' → ' + want.slice(0, 32) + '…', T.pageDlReason(o, { supported: true, hls: true }) === want, T.pageDlReason(o, { supported: true, hls: true }));
  check('… nichts angeboten (DASH nie auswählbar)', !o.mp4.length && !o.hls.length && !o.all.some((x) => x.state === 'attemptable') && !o.allS.some((x) => x.state === 'attemptable'));
}
check('DASH erscheint weder in der MP4- noch in der Stream-Auswahl', T.selectDownloads([entry('dash', 'manifest', 'bound')], { supported: true }).length === 0 &&
  T.selectStreams([entry('dash', 'manifest', 'bound')], { hls: true }).length === 0);
check('nur Manifest-Einträge zählen (Stück/Init/Spur nie, auch nicht mit Bindung)',
  T.mediaDashState([[entry('dash', 'segment', 'bound'), entry('dash', 'init', 'bound'), entry('dash', 'track', 'bound'), entry('dash', 'standalone', 'bound')]]) === '' &&
  T.mediaDashState([[entry('dash', 'segment', 'bound'), entry('dash', 'manifest', 'ambiguous')]]) === 'suspected');
check('mehrere Schnappschüsse (Originalvideo, eigener Player): der stärkste Beleg zählt',
  T.mediaDashState([[entry('dash', 'manifest', 'ambiguous')], [entry('dash', 'manifest', 'bound')]]) === 'bound' &&
  T.mediaDashState([[], [entry('dash', 'manifest', 'ambiguous')]]) === 'suspected' && T.mediaDashState([[], []]) === '' && T.mediaDashState() === '');

// ---------- MP4/HLS unverändert: dieselben Hinweise wie bisher, dieselben Angebote ----------
for (const [name, snap, caps, want] of [
  ['leer', [], null, NONE],
  ['HLS vermutet', [entry('hls', 'master', 'ambiguous')], null, AMB],
  ['HLS nicht gebunden', [entry('hls', 'master', 'unbound')], null, AMB],
  ['HLS gebunden, Helfer ohne HLS', [entry('hls', 'master', 'bound')], { supported: true, hls: false }, HELPER],
  ['HLS geschützt', [entry('hls', 'master', 'bound', { protection: 'encrypted' })], null, PROT],
  ['MP4 nicht gebunden', [entry('mp4', 'standalone', 'unbound')], null, AMB],
  ['MP4-Stück', [entry('mp4', 'segment', 'bound')], null, PART],
  ['unbekannter Typ', [entry('unknown', 'unknown', 'bound')], null, NONE],
]) {
  const o = opts(snap, caps || undefined);
  check('unverändert: ' + name, T.pageDlReason(o, caps || { supported: true, hls: true }) === want && o.dash === '', T.pageDlReason(o, caps || { supported: true, hls: true }));
}
{
  const o = opts([entry('hls', 'master', 'bound'), entry('mp4', 'standalone', 'bound', { browser: 'loaded' }), entry('dash', 'manifest', 'bound')]);
  check('Angebote unverändert: gebundene HLS-Liste und gebundene MP4 bleiben auswählbar, DASH kommt nicht dazu',
    o.hls.length === 1 && o.mp4.length === 1 && o.all.length === 1 && o.allS.length === 1, o);
}
// eigener Player (src/180): der DASH-Hinweis beruht allein auf den Belegen der Registry – eine Endung „.mpd“ der
// gespielten Adresse ist kein Beleg (Quellprüfung der Stelle, die den Hinweis bestimmt)
{
  const p = fs.readFileSync(path.join(root, 'src/180-player-bedienung.js'), 'utf8');
  // (S3c: die Bedingung danach nennt zusätzlich das geprüfte DASH-Angebot – dashOk, src/105 dashOfferFor)
  const i2 = p.indexOf('let dash = '), end = p.indexOf('if (j || can.length || streams.length || dashOk)', i2), block = p.slice(i2, end);
  check('eigener Player: DASH-Hinweis nur aus mediaDashState (Registry), keine Ableitung aus der Adresse',
    i2 > 0 && end > i2 && /dash = mediaDashState\(/.test(block) && !/\.mpd|st\.cur|'bound'/.test(block), block);
}
console.log('RESULT dash-message PASS ' + passed + '/' + passed);
