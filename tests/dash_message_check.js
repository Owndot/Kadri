'use strict';
// S0 DASH: Hinweis im schwebenden Download-Menü (pageDlReason, src/105) mit den echten Auswahlfunktionen (src/045).
//  - S4b: DASH-Meldungen kommen aus den Ebenen E1–E5 (src/046 dashLevels): gebunden bzw. mit gelesenem MPD die erste
//    blockierende Ebene vor den allgemeinen Gründen; nur vermutet ohne gelesenes MPD erst nach allen sicheren Gründen.
//    Nie mehr „derzeit nicht unterstützt“, wenn nur die Zuordnung fehlt.
//  - ein nur irgendwo gesehenes (unbound) Manifest ändert nichts; DASH wird nie angeboten
//  - alle MP4-/HLS-Fälle: derselbe Hinweis wie bisher, dieselben Angebote
//   node tests/dash_message_check.js [ROOT]
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
let passed = 0;
function check(name, value, info) { assert.ok(value, name + (info === undefined ? '' : ' – ' + JSON.stringify(info))); passed++; console.log('PASS ' + name); }

const ctx = { console, tr: x => x, IN_FRAME: false, META: false, addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, history: {}, location: { href: 'https://site.example/' } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'src/045-media-source.js'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'src/046-dash-ebenen.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(root, 'src/105-download-knopf.js'), 'utf8') +
  '\nglobalThis.T = { selectDownloads, selectStreams, mediaDashState, pageDlReason, pageDlReasonSub, dashLevels, dashOptionItems };', ctx);
const T = ctx.T;

let n = 0;
const entry = (kind, role, assoc, extra) => Object.assign({ sourceId: 's' + (++n), revision: 1, kind, role,
  association: { state: assoc, evidence: assoc === 'bound' ? ['segments-loaded'] : assoc === 'ambiguous' ? ['start-timing'] : [] },
  quality: { status: 'unknown' }, browser: 'unknown', protection: 'unknown', provenance: [{ kind: 'network', origin: 'x' }] }, extra || {});
// wie pageDlOptions: dieselben Auswahlfunktionen über einem Schnappschuss
function opts(snap, caps, lv) {
  caps = caps || { supported: true, hls: true };
  const all = T.selectDownloads(snap, { supported: true }), allS = T.selectStreams(snap, { hls: !!caps.hls });
  const dash = T.mediaDashState([snap]);
  // (Ebenen wie dashLevelsFor: ohne DASH-Quelle keine; lv = Eingaben der Ebenen, Bindung aus der Registry)
  const hasDash = snap.some((s) => s.kind === 'dash' && (s.role === 'manifest' || s.role === 'unknown'));
  const dashLv = hasDash ? T.dashLevels(Object.assign({ read: false, caps: { known: true, reachable: true, supported: true, dash: true } }, lv || {})) : null;
  return { mp4: all.filter((o) => o.state === 'attemptable'), hls: allS.filter((o) => o.state === 'attemptable'), all, allS, dash, dashLv };
}
const UNREAD = 'DASH vermutet – Manifest nicht lesbar';
const E2 = 'DASH-Stream erkannt – Zuordnung zum Video nicht nachgewiesen';
const NOTSUP = /derzeit nicht unterstützt/;
const NONE = 'Keine speicherbare Videodatei erkannt – Video abspielen und erneut tippen';
const AMB = 'Quelle nicht sicher diesem Video zugeordnet – Video kurz abspielen und erneut tippen';
const HELPER = 'Stream erkannt – diese Helfer-App-Version speichert keine Streams';
const PROT = 'Video geschützt (DRM/verschlüsselt) – nicht speicherbar';
const PART = 'Nur Teilstücke eines Streams erkannt – Video abspielen und erneut tippen';
const READ_HOST = { read: true, bindReason: 'keine-treffer', cls: { host: 6 }, gate: { ok: true } };
const READ_OK = { read: true, gate: { ok: true } };
const VP9 = { read: true, bindReason: 'stueckfolge', gate: { ok: false, reason: 'dash-codec' }, fmt: { video: ['VP9'], audio: ['Opus'], container: ['WebM'] } };

// ---------- DASH ----------
for (const [name, snap, lv, want, sub] of [
  ['Feldbefund: nur DASH vermutet, Manifest nicht gelesen', [entry('dash', 'manifest', 'ambiguous')], {}, UNREAD, /neu laden/],
  ['nur DASH vermutet, MPD gelesen, Stücke von anderem Server', [entry('dash', 'manifest', 'ambiguous')], READ_HOST, E2, /anderen Server/],
  ['Alte DASH-Zuordnung, VP9/Opus/WebM', [entry('dash', 'manifest', 'bound')], VP9, E2, /Passende Stücke im Netzwerk/],
  ['Manifest noch ohne bekannte Rolle, alte Zuordnung, HE-AAC', [entry('dash', 'unknown', 'bound')], { read: true, bindReason: 'stueckfolge', gate: { ok: false, reason: 'dash-audio-codec' }, fmt: { video: ['H.264'], audio: ['HE-AAC'], container: ['MP4'] } }, E2, /DASH-Download gesperrt/],
  ['nur DASH-Stück (Rolle segment), gebunden: kein DASH-Hinweis', [entry('dash', 'segment', 'bound')], {}, NONE, null],
  ['nur DASH-Init-Datei, gebunden: kein DASH-Hinweis', [entry('dash', 'init', 'bound')], {}, NONE, null],
  ['nur DASH-Einzelspur, vermutet: kein DASH-Hinweis', [entry('dash', 'track', 'ambiguous')], {}, NONE, null],
  ['DASH nur irgendwo gesehen (unbound), nicht gelesen: E1 statt Behauptung', [entry('dash', 'manifest', 'unbound')], {}, UNREAD, null],
  ['gebunden schlägt vermutet (zwei Manifeste), Format', [entry('dash', 'manifest', 'ambiguous'), entry('dash', 'manifest', 'bound')], VP9, E2, null],
  ['DASH gebunden + HLS nur vermutet: DASH-Ebene', [entry('dash', 'manifest', 'bound'), entry('hls', 'master', 'ambiguous')], VP9, E2, null],
  ['DASH vermutet (nicht gelesen) + HLS vermutet: wie bisher „nicht sicher zugeordnet“', [entry('dash', 'manifest', 'ambiguous'), entry('hls', 'master', 'ambiguous')], {}, AMB, null],
  ['DASH mit gelesenem MPD + HLS vermutet: die konkrete DASH-Ebene', [entry('dash', 'manifest', 'ambiguous'), entry('hls', 'master', 'ambiguous')], READ_HOST, E2, null],
  ['DASH vermutet + HLS geschützt: wie bisher „geschützt“', [entry('dash', 'manifest', 'ambiguous'), entry('hls', 'master', 'bound', { protection: 'drm' })], {}, PROT, null],
  ['DASH vermutet + MP4 nicht gebunden: wie bisher „nicht sicher zugeordnet“', [entry('dash', 'manifest', 'ambiguous'), entry('mp4', 'standalone', 'unbound')], {}, AMB, null],
  ['DASH vermutet + Stück: wie bisher „Teilstücke“', [entry('dash', 'manifest', 'ambiguous'), entry('mp4', 'segment', 'bound')], {}, PART, null],
  ['Byte-Bereiche (nicht prüfbar): kein Rat zum erneuten Abspielen', [entry('dash', 'manifest', 'ambiguous'), entry('mp4', 'standalone', 'ambiguous')], { read: true, bindReason: 'nicht-pruefbar', gate: { ok: false, reason: 'dash-addressing' } }, 'DASH-Stream erkannt – Zuordnung hier nicht möglich', /Byte-Bereiche/],
  ['Worker/srcdoc: MPD nicht lesbar, Ladevorgänge unsichtbar – kein Codecfehler', [entry('dash', 'unknown', 'ambiguous')], { invisible: true }, UNREAD, /verdeckt/],
]) {
  const o = opts(snap, null, lv);
  const got = T.pageDlReason(o, { supported: true, hls: true }), gs = T.pageDlReasonSub(o);
  check(name + ' → ' + want.slice(0, 40) + '…', got === want && !NOTSUP.test(got), [got, gs]);
  if (sub) check('… Unterzeile ' + sub, sub.test(gs) && !/abspielen/.test(name.indexOf('Byte') >= 0 ? gs : ''), gs);
  check('… nichts angeboten (ohne Helfer-Plan nie auswählbar)', !o.mp4.length && !o.hls.length && !o.all.some((x) => x.state === 'attemptable') && !o.allS.some((x) => x.state === 'attemptable'));
}
// Ebenen: DRM, Live, Mehrperioden getrennt; Helfer-Fähigkeit; Codes
{
  const L = (i) => T.dashLevels(Object.assign({ read: true, bound: true, caps: { known: true, reachable: true, supported: true, dash: true } }, i));
  const prot = L({ gate: { ok: false, reason: 'dash-protected' } }), live = L({ gate: { ok: false, reason: 'dash-live' } }), mp = L({ gate: { ok: false, reason: 'dash-multiperiod' } });
  check('DRM, Live und Mehrperioden: verschiedene Codes und Unterzeilen', prot.code === 'E3/protected' && live.code === 'E3/live' && mp.code === 'E3/multiperiod' &&
    prot.sub === 'Geschützt (DRM)' && live.sub === 'Live-Stream' && /Perioden/.test(mp.sub), [prot.code, live.code, mp.code]);
  const reg = L({ read: false, protectedSource: true, bound: false });
  check('Schutz laut Registry wird auch ohne gelesenes MPD als E3 geführt (Diagnose), Hauptmeldung bleibt die erste Ebene', reg.e3.code === 'protected' && reg.first === 'E1');
  const ok = L({ gate: { ok: true } });
  check('alles erfüllt: keine blockierende Ebene, keine Meldung', ok.first === '' && ok.main === '' && ok.e1.ok && ok.e2.ok && ok.e3.ok && ok.e4.ok);
  const network = L({ bindReason: 'stueckfolge', gate: { ok: true } });
  check('Auch ein altes bound mit passender Netzfolge sperrt E2 bei positivem Gate und fähigem Helfer',
    network.code === 'E2/element-unproven' && network.e3.ok && network.e4.ok);
  const nod = L({ gate: { ok: true }, caps: { known: true, reachable: true, supported: true, dash: false } });
  check('Helfer ohne DASH: E4/no-dash', nod.code === 'E4/no-dash' && /kein DASH/.test(nod.sub));
  const unk = L({ gate: { ok: true }, caps: { known: false } });
  check('Helfer-Fähigkeit noch nicht abgefragt: kein Hindernis (E4 unknown)', unk.first === '' && unk.e4.code === 'unknown');
  const both = L({ bound: false, bindReason: 'keine-treffer', cls: { query: 3 }, gate: { ok: false, reason: 'dash-codec' }, fmt: { video: ['VP9'], audio: ['Opus'], container: ['WebM'] } });
  check('mehrere Hindernisse: Hauptmeldung = erste (E2/query), E3 trotzdem in den Codes', both.code === 'E2/query' && both.e3.code === 'format' && /Zusatzparameter/.test(both.sub));
  const en = T.dashLevels({ read: true, bound: true, gate: { ok: false, reason: 'dash-codec' }, fmt: { video: ['VP9'], audio: ['Opus'], container: ['WebM'] }, caps: { known: false } },
    (x) => ({ 'DASH-Stream zugeordnet – Format wird noch nicht gespeichert': 'DASH stream matched – format cannot be saved yet', Video: 'Video', Ton: 'Audio', 'gespeichert wird bisher nur H.264 mit AAC-LC (MP4)': 'only H.264 with AAC-LC (MP4) can be saved so far' })[x] || x);
  check('Übersetzung: Hauptzeile und Unterzeile aus übersetzten Teilen', en.main === 'DASH stream matched – format cannot be saved yet' && en.sub === 'Video VP9 · Audio Opus · WebM – only H.264 with AAC-LC (MP4) can be saved so far', en);
}
check('DASH erscheint weder in der MP4- noch in der Stream-Auswahl', T.selectDownloads([entry('dash', 'manifest', 'bound')], { supported: true }).length === 0 &&
  T.selectStreams([entry('dash', 'manifest', 'bound')], { hls: true }).length === 0);
check('nur Manifest-Einträge zählen (Stück/Init/Spur nie, auch nicht mit Bindung)',
  T.mediaDashState([[entry('dash', 'segment', 'bound'), entry('dash', 'init', 'bound'), entry('dash', 'track', 'bound'), entry('dash', 'standalone', 'bound')]]) === '' &&
  T.mediaDashState([[entry('dash', 'segment', 'bound'), entry('dash', 'manifest', 'ambiguous')]]) === 'suspected');
check('Mehrere Schnappschüsse: Auch ein alter bound-Eintrag bleibt ein Kandidat',
  T.mediaDashState([[entry('dash', 'manifest', 'ambiguous')], [entry('dash', 'manifest', 'bound')]]) === 'suspected' &&
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
// Positive Optionszuordnung unterhalb der P0-A-Sperre.
{
  const video = [{height: 360, width: 640, bandwidth: 300}, {height: 180, width: 320, bandwidth: 100}];
  const audio = [{lang: 'de', bandwidth: 40}, {lang: 'en', bandwidth: 60}];
  const options = video.flatMap(v => audio.map(a => ({height: v.height, width: v.width, lang: a.lang,
    bandwidth: v.bandwidth + a.bandwidth, played: v.height === 360 && a.lang === 'de'})));
  const items = T.dashOptionItems({options}, {video, audio});
  check('DASH-Planoptionen ordnen Bildhöhe und Tonsprache zu, gespielte Kombination steht zuerst',
    items.length === 4 && items[0].o.played && items[0].a.lang === 'de' &&
    new Set(items.map(x => x.label)).size === 4);
  const noLanguage = audio.map(a => ({...a, lang: ''}));
  const noLanguageOptions = [40, 60].map(b => ({height: 360, width: 640, lang: '', bandwidth: 300 + b}));
  const unnamed = T.dashOptionItems({options: noLanguageOptions}, {video, audio: noLanguage});
  check('Spuren ohne Sprache erhalten zwei unterschiedliche Namen', unnamed.length === 2 &&
    unnamed[0].label.includes('Tonspur 1') && unnamed[1].label.includes('Tonspur 2'));
  check('Identische unbenannte Spuren bleiben unterhalb der Produktsperre mehrdeutig',
    T.dashOptionItems({options: noLanguageOptions}, {video, audio: [noLanguage[0], {...noLanguage[0]}]}).length === 0);
}
// Player, Seitenknopf und Diagnose zeigen dieselbe Ebenen-Auswertung.
{
  const p = fs.readFileSync(path.join(root, 'src/180-player-bedienung.js'), 'utf8');
  check('Player verwendet die gemeinsame Ebenen-Auswertung und markiert den E2-Hinweis ohne Aktion',
    /const lv = dashLevelsFor\(orig,/.test(p) && /label: lv.main, sub: lv.sub, stay: true, fn: \(\) => \{\}/.test(p));
}
console.log('RESULT dash-message PASS ' + passed + '/' + passed);
