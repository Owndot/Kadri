'use strict';
// DASH-Diagnose Stufe 1: der stufenweise Abgleich (src/038 dashDiagClassify) und die Beobachter-Zählung (src/040 obsRes)
// sind NUR Diagnose. Statisch geprüft: keine dieser Angaben erreicht die Bindungs- oder Auswahl-Logik; verwendet werden sie
// ausschließlich in der anonymisierten Diagnose (src/280). (Das Verhalten selbst prüfen test_dash_mpd.py / test_dash_bind.py.)
//   node tests/dash_diag_check.js [ROOT]
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
let passed = 0;
function check(name, value, info) { assert.ok(value, name + (info === undefined ? '' : ' – ' + JSON.stringify(info))); passed++; console.log('PASS ' + name); }
const SRC = path.join(root, 'src');
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
const text = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(SRC, f), 'utf8')]));
// Rumpf einer Funktion (function NAME( … { … }) per Klammerzählung (Quelltext ohne Klammern in Zeichenketten genügt hier)
function body(f, name) {
  const s = text[f], i = s.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name + ' in ' + f);
  let j = s.indexOf('{', s.indexOf(')', i)), d = 0;
  for (let k = j; k < s.length; k++) { if (s[k] === '{') d++; else if (s[k] === '}' && --d === 0) return s.slice(i, k + 1); }
  throw new Error('kein Ende: ' + name);
}
const DIAG = /dashDiagClassify|DASH_DIAG_RANK|\.dOrigin|\.dPath|\.dQuery|\.dList|\.dListPath|\.dInitOP|\.dInitPath|obsRes|obsNote/;
const users = (re) => files.filter((f) => re.test(text[f]));

check('dashDiagClassify nur in src/038 (Definition) und src/280 (Diagnose)', JSON.stringify(users(/dashDiagClassify/)) === JSON.stringify(['038-dash-manifest.js', '280-diagnose.js']), users(/dashDiagClassify/));
check('Diagnose-Felder des Index (dOrigin/dPath/dQuery/dList/dInit*) nur in src/038', JSON.stringify(users(/\.d(Origin|Path|Query|List|ListPath|InitOP|InitPath)\b/)) === JSON.stringify(['038-dash-manifest.js']));
check('Beobachter-Zählung obsRes nur in src/040 (Zählung) und src/280 (Diagnose)', JSON.stringify(users(/obsRes/)) === JSON.stringify(['040-quellen-netzwerk.js', '280-diagnose.js']), users(/obsRes/));
for (const [f, fn] of [['038-dash-manifest.js', 'dashMatchSegment'], ['038-dash-manifest.js', 'dashBindDecision'], ['040-quellen-netzwerk.js', 'dashHit'],
                       ['040-quellen-netzwerk.js', 'dashSee'], ['040-quellen-netzwerk.js', 'notePlaylist'], ['060-quellen-zuordnung.js', 'dashBindingFor']]) {
  check('Bindungspfad ' + fn + ' (' + f + ') nutzt keine Diagnose-Stufe', !DIAG.test(body(f, fn)));
}
check('in src/280 nur innerhalb von diagFrameSources', !DIAG.test(text['280-diagnose.js'].replace(body('280-diagnose.js', 'diagFrameSources'), '')));
check('dashDiagClassify ruft für „exakt“ dieselbe Prüfung wie die Bindung (dashMatchSegment) und liefert sonst nur Kategorien',
  /const m = dashMatchSegment\(index, key\);\s*if \(m\) return m\.init \? 'init' : 'exact';/.test(body('038-dash-manifest.js', 'dashDiagClassify')));
check('Bindung (dashBindingFor) und Diagnose verwenden denselben Startzeitpunkt (dashFromOf)',
  /from: dashFromOf\(v\)/.test(body('060-quellen-zuordnung.js', 'dashBindingFor')) && /dashFromOf\(v\)/.test(body('280-diagnose.js', 'diagFrameSources')));
// Auswahl/Angebote: keine Diagnose-Angabe in Quellenmodell, Registry, Auswahl, Menü, Hintergrund, Helfer-Kanal
for (const f of files.filter((x) => /^(045|050|065|070|1\d\d)-/.test(x))) check('keine Diagnose-Stufe in ' + f, !DIAG.test(text[f]));
console.log('ERGEBNIS: ' + passed + ' bestanden');
