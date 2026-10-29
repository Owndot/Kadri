#!/usr/bin/env node
// Baut die Erweiterung Kadri aus
//   src/*.js        – das Skript (dieselben Teile wie im Userscript „Video-Assistent“, siehe tools/sync-src.sh)
//   chrome/, firefox/ – je Browser eine eigene, vollständige Erweiterung (manifest.json, background.js, prelude.js =
//                       Ersatz für die Werkzeuge des Userscript-Managers, epilogue.js = Start, Menü, Einstellungsseite …)
//   vendor/hls.min.js
// nach
//   dist/chrome/   (Vivaldi, Chrome, Edge … – Manifest V3)   + dist/kadri-chrome-<version>.zip
//   dist/firefox/  (Firefox, auch Android – Manifest V2)      + dist/kadri-firefox-<version>.zip
//
//   node tools/build.js          → bauen
//   node tools/build.js --test   → zusätzlich dist/test/ (offenes Shadow-DOM + Markierung, nur für die Tests)
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = PKG.version;
const DIST = path.join(ROOT, 'dist');

// ---------- Skript aus src/ ----------
const parts = fs.readdirSync(path.join(ROOT, 'src')).filter((f) => /^\d{3}-[\w-]+\.js$/.test(f)).sort();
if (!parts.length) { console.error('Keine Teile in src/'); process.exit(1); }
let body = parts.map((f) => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('');
const base = (body.match(/^\/\/ @version\s+(\S+)/m) || [])[1] || '?';

// Stellen, die in der Erweiterung anders sind. Jede MUSS genau einmal vorkommen – sonst bricht der Bau ab
// (dann hat sich src/ geändert und die Stelle muss hier angepasst werden).
function swap(text, from, to, what) {
  const n = from instanceof RegExp ? (text.match(new RegExp(from.source, from.flags.includes('g') ? from.flags : from.flags + 'g')) || []).length : text.split(from).length - 1;
  if (n !== 1) { console.error('Bau abgebrochen: Stelle „' + what + '“ kommt ' + n + '× vor (erwartet 1×).'); process.exit(1); }
  return text.replace(from, to);
}
body = swap(body, /^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\n/m, '', 'Kopf des Userscripts');
body = swap(body, "'Video-Assistent · Diagnose'", "'Kadri · Diagnose'", 'Titel der Diagnose');
body = swap(body, "'Video-Assistent " + base + "'", "'Kadri ' + KADRI_VERSION + ' (Basis " + base + ")'", 'Version in der Diagnose');

// ---------- Standardwerte für Menü und Einstellungsseite (aus dem Skript gelesen, damit nichts auseinanderläuft) ----------
function defaults() {
  const src = fs.readFileSync(path.join(ROOT, 'src', '020-einstellungen-sprache.js'), 'utf8');
  const a = src.indexOf('const CONFIG = {'), b = src.indexOf('\n  };', a);
  const keysM = /const SETTING_KEYS = \[([\s\S]*?)\];/.exec(src);
  if (a < 0 || b < 0 || !keysM) { console.error('Bau abgebrochen: CONFIG/SETTING_KEYS in src/020 nicht gefunden'); process.exit(1); }
  const cfg = require('vm').runInNewContext('(' + src.slice(a + 'const CONFIG = '.length, b + 4).replace(/;\s*$/, '') + ')', {});
  const keys = (keysM[1].match(/'([A-Za-z]+)'/g) || []).map((x) => x.slice(1, -1));
  const out = {};
  keys.forEach((k) => { if (!(k in cfg)) { console.error('Bau abgebrochen: Einstellung ' + k + ' ohne Standardwert'); process.exit(1); } out[k] = cfg[k]; });
  return '// beim Bau aus src/020-einstellungen-sprache.js erzeugt\nconst KADRI_DEFAULTS = ' + JSON.stringify(out, null, 1) + ';\n';
}

function content(target, test) {
  let b = body;
  if (test) {
    // nur für die Tests: Oberfläche von außen erreichbar (wie PRE im Userscript-Test) und markiert
    b = swap(b, "root = hostEl.attachShadow({ mode: 'closed' });", "root = hostEl.attachShadow({ mode: 'open' }); hostEl.setAttribute('data-kadri-test', '');", 'Shadow-DOM (Test)');
    // nur für die Tests: die Seite kann Anfragen über Kadri stellen lassen (wie das Skript es tut) – so prüfen die
    // Tests die Schutzregeln des Hintergrunds mit echten Anfragen aus einem Tab
    b += "\n    const __kadriTestRequests = new Map(); window.addEventListener('message', (e) => { const d = e.data; if (!d || e.source !== window) return; if (d.kadriTestAbort) { const q = __kadriTestRequests.get(d.kadriTestAbort); if (q) q.abort(); return; } if (!d.kadriTestXhr) return; const o = d.kadriTestXhr;" +
      " const back = (r) => { __kadriTestRequests.delete(o.id); window.postMessage({ kadriTestRes: Object.assign({ id: o.id }, r) }, '*'); };" +
      " const req = GM_xmlhttpRequest(Object.assign({}, o, { onload: (r) => back({ status: r.status, text: r.responseText, finalUrl: r.finalUrl })," +
      " onerror: (r) => back({ error: (r && (r.error || r.statusText)) || 'Fehler' }), ontimeout: () => back({ error: 'timeout' }), onabort: () => back({ error: 'aborted' }) })); __kadriTestRequests.set(o.id, req); });\n";
  }
  const pre = fs.readFileSync(path.join(ROOT, target, 'prelude.js'), 'utf8').replace("(function () {\n  'use strict';", "(function () {\n  'use strict';\n  const KADRI_VERSION = " + JSON.stringify(VERSION) + ';');
  const epi = fs.readFileSync(path.join(ROOT, target, 'epilogue.js'), 'utf8');
  return '// Kadri ' + VERSION + ' – gebaut aus dem Skript ' + base + ' (siehe Repository). Lizenz: GPL-3.0\n' + pre + b + epi;
}

// ---------- Manifeste: je Browser ein eigener Ordner mit eigener manifest.json (Version wird beim Bau eingesetzt) ----------
function manifestOf(target) {
  const t = fs.readFileSync(path.join(ROOT, target, 'manifest.json'), 'utf8');
  if (t.split('__VERSION__').length !== 2) { console.error('Bau abgebrochen: ' + target + '/manifest.json braucht genau einmal __VERSION__'); process.exit(1); }
  return JSON.parse(t.replace('__VERSION__', VERSION));
}

// ---------- schreiben ----------
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
// target: Quell-Ordner (chrome/ oder firefox/) – alles darin kommt mit, außer prelude.js/epilogue.js (→ content.js)
function write(dir, target, test) {
  const SRC = path.join(ROOT, target);
  rmrf(dir); fs.mkdirSync(path.join(dir, 'icons'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifestOf(target), null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'content.js'), content(target, test));
  const own = fs.readdirSync(SRC).filter((f) => !['manifest.json', 'prelude.js', 'epilogue.js', 'icons'].includes(f));
  for (const f of own) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'defaults.js'), DEFAULTS);
  fs.copyFileSync(path.join(ROOT, 'vendor', 'hls.min.js'), path.join(dir, 'hls.min.js'));
  fs.copyFileSync(path.join(ROOT, 'vendor', 'hls.LICENSE'), path.join(dir, 'hls.LICENSE'));
  fs.copyFileSync(path.join(ROOT, 'vendor', 'psl.js'), path.join(dir, 'psl.js'));
  fs.copyFileSync(path.join(ROOT, 'vendor', 'psl.LICENSE'), path.join(dir, 'psl.LICENSE'));
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(dir, 'LICENSE'));
  for (const s of [16, 32, 48, 128]) fs.copyFileSync(path.join(SRC, 'icons', s + '.png'), path.join(dir, 'icons', s + '.png'));
  if (target === 'chrome') copyChannel(dir);
  // Syntax prüfen (alle Skripte)
  for (const f of fs.readdirSync(dir).filter((x) => /\.js$/.test(x) && x !== 'hls.min.js').concat(target === 'chrome' ? CHANNEL_JS.map((x) => path.join('channel', x)) : [])) {
    try { execFileSync(process.execPath, ['--check', path.join(dir, f)], { stdio: 'pipe' }); }
    catch (e) { console.error('Syntaxfehler in ' + f + ':\n' + String(e.stderr || e.message)); process.exit(1); }
  }
}
// Sicherer Kanal zur Helfer-App (nur Chrome/Vivaldi): Kanal-Module und der geprüfte WASM-Kern (vendor/kadri-pairing-poc,
// Herkunft in PROVENANCE.md/SOURCE). background.js lädt sie mit importScripts. Firefox hat den Kanal noch nicht.
const CHANNEL_JS = ['channel-store.js', 'channel-transport.js', 'channel-session.js', 'channel-service.js', 'kadri_pairing_poc.js'];
function copyChannel(dir) {
  const CH = path.join(ROOT, 'channel'), VW = path.join(ROOT, 'vendor', 'kadri-pairing-poc');
  fs.mkdirSync(path.join(dir, 'channel'));
  for (const f of CHANNEL_JS.slice(0, 4)) fs.copyFileSync(path.join(CH, f), path.join(dir, 'channel', f));
  for (const f of ['kadri_pairing_poc.js', 'kadri_pairing_poc_bg.wasm', 'PROVENANCE.md']) fs.copyFileSync(path.join(VW, f), path.join(dir, 'channel', f));
}
function zip(dir, out) {
  rmrf(out);
  execFileSync('zip', ['-qr9X', out, '.'], { cwd: dir });
}
const DEFAULTS = defaults();
fs.mkdirSync(DIST, { recursive: true });
write(path.join(DIST, 'chrome'), 'chrome', false);
write(path.join(DIST, 'firefox'), 'firefox', false);
zip(path.join(DIST, 'chrome'), path.join(DIST, 'kadri-chrome-' + VERSION + '.zip'));
zip(path.join(DIST, 'firefox'), path.join(DIST, 'kadri-firefox-' + VERSION + '.zip'));
if (process.argv.includes('--test')) write(path.join(DIST, 'test'), 'chrome', true);

// Firefox-Fassung mit denselben Test-Öffnungen (nur für den Firefox-Test der Schutzregeln, tests/firefox_dnr_scope.py)
if (process.argv.includes('--test-firefox')) write(path.join(DIST, 'test-firefox'), 'firefox', true);
console.log('Gebaut: Kadri ' + VERSION + ' (Skript ' + base + ', ' + parts.length + ' Teile) → dist/chrome, dist/firefox' + (process.argv.includes('--test') ? ', dist/test' : ''));
