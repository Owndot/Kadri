#!/usr/bin/env node
// Baut die Erweiterung Kadri aus
//   src/*.js        – das Skript (dieselben Teile wie im Userscript „Video-Assistent“, siehe tools/sync-src.sh)
//   ext/prelude.js  – Ersatz für die Werkzeuge des Userscript-Managers (GM_…), ext/epilogue.js – Start
//   ext/background.js, vendor/hls.min.js, ext/icons/
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

function content(test) {
  let b = body;
  if (test) {
    // nur für die Tests: Oberfläche von außen erreichbar (wie PRE im Userscript-Test) und markiert
    b = swap(b, "root = hostEl.attachShadow({ mode: 'closed' });", "root = hostEl.attachShadow({ mode: 'open' }); hostEl.setAttribute('data-kadri-test', '');", 'Shadow-DOM (Test)');
  }
  const pre = fs.readFileSync(path.join(ROOT, 'ext', 'prelude.js'), 'utf8').replace("(function () {\n  'use strict';", "(function () {\n  'use strict';\n  const KADRI_VERSION = " + JSON.stringify(VERSION) + ';');
  const epi = fs.readFileSync(path.join(ROOT, 'ext', 'epilogue.js'), 'utf8');
  return '// Kadri ' + VERSION + ' – gebaut aus dem Skript ' + base + ' (siehe Repository). Lizenz: GPL-3.0\n' + pre + b + epi;
}

// ---------- Manifeste ----------
const desc = 'Eingebauter Vollbild-Player mit Wischgesten für Videos auf Webseiten – mit Download (YTDLnis), Untertiteln, Ambient-Licht.';
const icons = { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' };
const cs = [{ matches: ['<all_urls>'], js: ['hls.min.js', 'content.js'], run_at: 'document_start', all_frames: true }];
// Chrome/Vivaldi: zusätzlich ein winziges Skript IN der Seite, das Stream-Listen und API-Antworten mitliest (ext/page.js)
const csChrome = [{ matches: ['<all_urls>'], js: ['page.js'], run_at: 'document_start', all_frames: true, world: 'MAIN' }].concat(cs);
const chrome = {
  manifest_version: 3, name: 'Kadri', version: VERSION, description: desc, icons,
  action: { default_title: 'Kadri', default_icon: icons, default_popup: 'popup.html' },
  options_ui: { page: 'options.html', open_in_tab: true },
  background: { service_worker: 'background.js' },
  permissions: ['storage', 'declarativeNetRequestWithHostAccess', 'webRequest'],
  host_permissions: ['<all_urls>'],
  content_scripts: csChrome,
  minimum_chrome_version: '116',
};
// Firefox: Manifest V2 – dort gelten die Rechte für alle Seiten gleich bei der Installation (bei V3 müsste man sie
// erst von Hand erlauben)
const firefox = {
  manifest_version: 2, name: 'Kadri', version: VERSION, description: desc, icons,
  browser_action: { default_title: 'Kadri', default_icon: icons, default_popup: 'popup.html' },
  options_ui: { page: 'options.html', open_in_tab: true },
  background: { scripts: ['background.js'] },
  permissions: ['storage', 'declarativeNetRequestWithHostAccess', 'webRequest', '<all_urls>'],
  content_scripts: cs,
  browser_specific_settings: { gecko: { id: 'kadri@owndot', strict_min_version: '128.0' }, gecko_android: { strict_min_version: '128.0' } },
};

// ---------- schreiben ----------
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function write(dir, manifest, test) {
  rmrf(dir); fs.mkdirSync(path.join(dir, 'icons'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'content.js'), content(test));
  fs.copyFileSync(path.join(ROOT, 'ext', 'background.js'), path.join(dir, 'background.js'));
  if (manifest.manifest_version === 3) fs.copyFileSync(path.join(ROOT, 'ext', 'page.js'), path.join(dir, 'page.js'));
  for (const f of ['popup.html', 'popup.js', 'options.html', 'options.js', 'common-ui.js', 'ui.css']) fs.copyFileSync(path.join(ROOT, 'ext', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'defaults.js'), DEFAULTS);
  fs.copyFileSync(path.join(ROOT, 'vendor', 'hls.min.js'), path.join(dir, 'hls.min.js'));
  fs.copyFileSync(path.join(ROOT, 'vendor', 'hls.LICENSE'), path.join(dir, 'hls.LICENSE'));
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(dir, 'LICENSE'));
  for (const s of [16, 32, 48, 128]) fs.copyFileSync(path.join(ROOT, 'ext', 'icons', s + '.png'), path.join(dir, 'icons', s + '.png'));
  // Syntax prüfen
  for (const f of ['content.js', 'background.js', 'popup.js', 'options.js', 'common-ui.js', 'defaults.js'].concat(manifest.manifest_version === 3 ? ['page.js'] : [])) {
    try { execFileSync(process.execPath, ['--check', path.join(dir, f)], { stdio: 'pipe' }); }
    catch (e) { console.error('Syntaxfehler in ' + f + ':\n' + String(e.stderr || e.message)); process.exit(1); }
  }
}
function zip(dir, out) {
  rmrf(out);
  execFileSync('zip', ['-qr9X', out, '.'], { cwd: dir });
}
const DEFAULTS = defaults();
fs.mkdirSync(DIST, { recursive: true });
write(path.join(DIST, 'chrome'), chrome, false);
write(path.join(DIST, 'firefox'), firefox, false);
zip(path.join(DIST, 'chrome'), path.join(DIST, 'kadri-chrome-' + VERSION + '.zip'));
zip(path.join(DIST, 'firefox'), path.join(DIST, 'kadri-firefox-' + VERSION + '.zip'));
if (process.argv.includes('--test')) write(path.join(DIST, 'test'), chrome, true);
console.log('Gebaut: Kadri ' + VERSION + ' (Skript ' + base + ', ' + parts.length + ' Teile) → dist/chrome, dist/firefox' + (process.argv.includes('--test') ? ', dist/test' : ''));
