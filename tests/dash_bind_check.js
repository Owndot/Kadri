'use strict';
// S2 DASH: reine Bindungsentscheidung (src/038 dashBindDecision) – „bound“ nur über beobachtete Stückfolgen.
//   node tests/dash_bind_check.js [ROOT]
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
let passed = 0;
function check(name, value, info) { assert.ok(value, name + (info === undefined ? '' : ' – ' + JSON.stringify(info))); passed++; console.log('PASS ' + name); }
const ctx = { console, URL, Map, Set, Math, Number, String, Array, Object, JSON, isFinite };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'src/038-dash-manifest.js'), 'utf8') + '\nglobalThis.D = dashBindDecision;', ctx);
const D = ctx.D, NOW = 1e6;
const hits = (rep, idxs, t) => idxs.map((i, k) => ({ rep, idx: i, t: (t || NOW - 5000) + k * 100 }));
const man = (key, hs, extra) => Object.assign({ key, hits: hs, duration: 600, checkable: true }, extra || {});
const run = (ms, video, from) => D({ manifests: ms, from: from === undefined ? NOW - 60000 : from, now: NOW, video: Object.assign({ duration: 600, othersPlaying: false }, video || {}) });

let r = run([man('A', hits(0, [10, 11, 12]))]);
check('3 aufeinanderfolgende Stücke derselben Darstellung, kürzlich: bound (stueckfolge)', r.A.state === 'bound' && r.A.reason === 'stueckfolge' && r.A.run === 3 && r.A.hits === 3, r.A);
r = run([man('A', hits(0, [10, 11, 12, 13, 20]))]);
check('… längere Folge mit Lücke: bound, längste Folge 4', r.A.state === 'bound' && r.A.run === 4, r.A);
r = run([man('A', [])]);
check('keine Stück-Treffer (nur zeitliche Nähe): ambiguous (keine-treffer)', r.A.state === 'ambiguous' && r.A.reason === 'keine-treffer', r.A);
r = run([man('A', hits(0, [10, 11]))]);
check('nur 2 Folgestücke: ambiguous (zu-wenig-folge)', r.A.state === 'ambiguous' && r.A.reason === 'zu-wenig-folge', r.A);
r = run([man('A', hits(0, [10, 12, 14, 16]))]);
check('Treffer ohne Folge (10, 12, 14, 16): ambiguous (zu-wenig-folge)', r.A.state === 'ambiguous' && r.A.reason === 'zu-wenig-folge', r.A);
r = run([man('A', hits(0, [10, 12]).concat(hits(1, [11, 13])))]);
check('Folge nur über zwei Darstellungen verteilt: ambiguous (je Darstellung keine Folge)', r.A.state === 'ambiguous' && r.A.reps === 2, r.A);
r = run([man('A', hits(0, [10, 11]).concat(hits(1, [12, 13, 14])))]);
check('Qualitätswechsel: Folge in der neuen Darstellung zählt: bound', r.A.state === 'bound', r.A);
r = run([man('A', hits(0, [10, 11, 12], NOW - 90000))], {}, NOW - 60000);
check('Treffer vor dem Start dieses Mediums (Medienwechsel/Seitenwechsel): nicht gezählt', r.A.state === 'ambiguous' && r.A.hits === 0, r.A);
r = run([man('A', hits(0, [10, 11, 12])), man('B', hits(0, [3, 4, 5]))]);
check('zwei Manifeste mit aktueller Folge (konkurrierend): beide ambiguous (konkurrenz)', r.A.state === 'ambiguous' && r.B.state === 'ambiguous' && r.A.reason === 'konkurrenz' && r.B.reason === 'konkurrenz', r);
r = run([man('AD', hits(0, [0, 1, 2], NOW - 50000)), man('MAIN', hits(0, [7, 8, 9]))]);
check('Werbung zuvor (Folge, aber seit über 20 s nichts mehr) und Hauptfilm jetzt: nur der Hauptfilm bound',
  r.MAIN.state === 'bound' && r.AD.state === 'ambiguous' && r.AD.reason === 'nicht-aktiv', r);
r = run([man('A', hits(0, [10, 11, 12], NOW - 40000))]);
check('einzige Folge, aber seit 40 s keine Stücke mehr: ambiguous (nicht-aktiv)', r.A.state === 'ambiguous' && r.A.reason === 'nicht-aktiv', r.A);
r = run([man('A', hits(0, [10, 11, 12]))], { duration: 300 });
check('Dauer des Videos weicht deutlich von der des MPD ab: ambiguous (dauer-abweicht)', r.A.state === 'ambiguous' && r.A.reason === 'dauer-abweicht', r.A);
r = run([man('A', hits(0, [10, 11, 12]))], { duration: 602 });
check('… kleine Abweichung (Rundung): bound', r.A.state === 'bound', r.A);
r = run([man('A', hits(0, [10, 11, 12]))], { duration: Infinity });
check('… Videodauer unbekannt (Infinity): keine Dauerprüfung, bound', r.A.state === 'bound', r.A);
r = run([man('A', hits(0, [10, 11, 12]))], { othersPlaying: true });
check('weiteres Video spielt (MSE): ambiguous (mehrere-videos)', r.A.state === 'ambiguous' && r.A.reason === 'mehrere-videos', r.A);
r = run([man('A', hits(0, [10, 11, 12]), { checkable: false })]);
check('Stückfolge nicht prüfbar (SegmentBase/Einzeldatei): ambiguous (nicht-pruefbar)', r.A.state === 'ambiguous' && r.A.reason === 'nicht-pruefbar', r.A);
r = run([man('A', hits(0, [10, 11, 12]).concat(hits(0, [10, 11, 12])))]);
check('doppelte Abrufe derselben Stücke zählen einmal', r.A.hits === 3 && r.A.state === 'bound', r.A);
r = run([man('A', hits(0, [10, 11, 12])), man('B', [])]);
check('zweites Manifest ohne Treffer stört nicht: A bound, B keine-treffer', r.A.state === 'bound' && r.B.reason === 'keine-treffer', r);
// ---------- zeitliche Kohärenz der Folge (S2-Korrektur) ----------
const at = (rep, pairs) => pairs.map(([idx, t]) => ({ rep, idx, t }));
const runAt = (hs, now, from) => D({ manifests: [man('A', hs)], from: from || 0, now: now, video: { duration: 600, othersPlaying: false } }).A;
r = runAt(at(0, [[0, 5000], [1, 6000], [2, 98000]]), 100000);
check('Stück 0 bei 5 s, 1 bei 6 s, 2 bei 98 s (jetzt 100 s): KEINE Bindung – keine zusammenhängende Serie (zu-wenig-folge)', r.state === 'ambiguous' && r.reason === 'zu-wenig-folge' && r.run < 3, r);
r = run([man('A', at(0, [[11, NOW - 3000], [10, NOW - 2900], [12, NOW - 2800]]))]);
check('drei zusammengehörige Stücke, außer der Reihe geladen (11, 10, 12 binnen 0,2 s): bound', r.A.state === 'bound' && r.A.run === 3, r.A);
r = run([man('A', at(0, [[10, NOW - 50000], [11, NOW - 49000], [12, NOW - 1000]]))]);
check('zwei alte Stücke + ein neues benachbartes: keine Bindung aus alt + neu (zu-wenig-folge)', r.A.state === 'ambiguous' && r.A.reason === 'zu-wenig-folge', r.A);
r = run([man('A', at(0, [[10, NOW - 59000], [10, NOW - 3000], [11, NOW - 2000], [12, NOW - 1000]]))]);
check('Wiederholung eines alten Stücks (Retry) und dann zusammenhängende Serie: bound', r.A.state === 'bound', r.A);
r = run([man('A', at(0, [[10, NOW - 41000], [11, NOW - 21000], [12, NOW - 1000]]))]);
check('ruhiges Nachladen (alle 20 s, Serie 40 s): bound', r.A.state === 'bound', r.A);
r = run([man('A', at(0, [[10, NOW - 59000], [11, NOW - 29000], [12, NOW - 1000]]))]);
check('… alle 29 s (Serie 58 s, über 45 s): ambiguous – nicht als eine Serie nachweisbar', r.A.state === 'ambiguous' && r.A.reason === 'zu-wenig-folge', r.A);
r = run([man('A', at(0, [[10, NOW - 59000], [11, NOW - 58500], [12, NOW - 58000], [40, NOW - 1000]]))]);
check('zusammenhängende Serie nur früher, jetzt nur ein Einzelstück: ambiguous (nicht-aktiv)', r.A.state === 'ambiguous' && r.A.reason === 'nicht-aktiv', r.A);
// S4b-4: Zugehörigkeit zur Medien-Epoche nach ANFRAGEBEGINN (h.s): ein vor dem Epochenbeginn angefragter, aber erst danach
// eingetroffener Abruf zählt nicht; ohne Angabe (h.s fehlt) bleibt es bei der Ankunftszeit (bisheriges Verhalten)
{
  const FROM = NOW - 10000;
  const late = [0, 1, 2].map((i) => ({ rep: 0, idx: i, t: FROM + 500 + i * 10, s: FROM - 2000 }));   // vorher angefragt, danach angekommen
  const inEp = [0, 1, 2].map((i) => ({ rep: 0, idx: i, t: FROM + 900 + i * 300, s: FROM + 800 + i * 300 }));
  const noS = [0, 1, 2].map((i) => ({ rep: 0, idx: i, t: FROM + 500 + i * 10 }));
  const r1 = run([man('ALT', late)], {}, FROM), r2 = run([man('NEU', inEp)], {}, FROM), r3 = run([man('OHNE', noS)], {}, FROM);
  check('Epoche: vor Beginn angefragt, danach angekommen → zählt nicht (keine-treffer)', r1.ALT.state === 'ambiguous' && r1.ALT.reason === 'keine-treffer', r1);
  check('Epoche: nach Beginn angefragt → bound', r2.NEU.state === 'bound', r2);
  check('Epoche: ohne Anfragebeginn wie bisher nach Ankunft', r3.OHNE.state === 'bound', r3);
  const both = run([man('ALT', late), man('NEU', inEp)], {}, FROM);
  check('Epoche: Vorspann (vorher angefragt) konkurriert nicht mehr mit dem Hauptvideo', both.NEU.state === 'bound' && both.ALT.state === 'ambiguous', both);
}
console.log('RESULT dash-bind PASS ' + passed + '/' + passed);
