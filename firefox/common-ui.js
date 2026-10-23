// Kadri – Gemeinsames für Menü und Einstellungsseite: Speicher, Sprache, Standardwerte (vom Bau aus dem Skript).
'use strict';
const api = globalThis.browser || globalThis.chrome;
// KADRI_DEFAULTS kommt aus defaults.js (beim Bau aus src/020-einstellungen-sprache.js gelesen)
const store = {
  async all() { try { return (await api.storage.local.get(null)) || {}; } catch (e) { return {}; } },
  async settings() { const a = await store.all(); const s = a['gm:settings']; return s && typeof s === 'object' ? s : {}; },
  async saveSettings(s) { await api.storage.local.set({ 'gm:settings': s }); },
};
function eff(s, k) { return k in s && s[k] !== null ? s[k] : KADRI_DEFAULTS[k]; }
let EN = !/^de\b/i.test(navigator.language || '');
const T = {
  'Kadri auf dieser Seite': 'Kadri on this site', 'An': 'On', 'Aus': 'Off', 'Diagnose anzeigen': 'Show diagnostics',
  'Einstellungen': 'Settings', 'Seite neu laden, damit es gilt': 'Reload the page to apply', 'Seite neu laden': 'Reload page',
  'Helfer-App: verbunden': 'Helper app: connected', 'Helfer-App: nicht gefunden': 'Helper app: not found',
  'Hier läuft keine Webseite': 'No web page here', 'Player': 'Player', 'Gesten': 'Gestures', 'Download & Helfer': 'Download & helper',
  'Seiten': 'Sites', 'Design': 'Design', 'Glas': 'Glass', 'Schlicht': 'Plain', 'Ambient': 'Ambient', 'Fortschrittslinie': 'Progress line',
  'Vollbild': 'Fullscreen', 'Auto-Drehen': 'Auto-rotate', 'Sprungweite': 'Skip', 'Halten': 'Hold', 'Wischsperre oben': 'Top swipe guard',
  'Wischsperre unten': 'Bottom swipe guard', 'Beim Verlassen': 'When leaving', 'Weiter': 'Keep playing', 'Anhalten': 'Pause',
  'Download': 'Download', 'Teilen': 'Share', 'Helper-App': 'Helper app', 'Sprache': 'Language', 'Untertitel-Größe': 'Subtitle size',
  'Untertitel oben': 'Subtitles at top', 'Dialog-Verstärker': 'Dialogue boost', 'klein': 'small', 'mittel': 'medium', 'groß': 'large',
  'Schmal': 'Narrow', 'Mittel': 'Medium', 'Breit': 'Wide', 'Sehr breit': 'Very wide',
  'Kadri ganz aus auf': 'Kadri off on', 'Nur Download (YTDLnis) auf': 'Download only (YTDLnis) on', 'Download-Knopf (YTDLnis kennt die Seite) auf': 'Download button (YTDLnis supports the site) on',
  'eine Seite pro Zeile, gilt auch für Unterdomains': 'one site per line, includes subdomains',
  'Gespeichert – gilt ab dem nächsten Laden der Seite': 'Saved – applies the next time a page loads',
  'Alles zurücksetzen': 'Reset everything', 'Wirklich alle Einstellungen zurücksetzen?': 'Really reset all settings?',
  'Wird im Player auch unter ⋮ → Einstellungen geändert.': 'Can also be changed in the player under ⋮ → Settings.',
  'wenn die Helfer-App läuft': 'when the helper app is running',
  'Spul-Vorschau': 'Seek preview', 'Im Bild': 'In video', 'Kleines Bild': 'Thumbnail',
  'Im Bild: das Video springt beim Ziehen mit (geht überall)': 'In video: the video follows your finger (works everywhere)',
  'Spul-Lupe': 'Seek zoom', 'beim Spulen Finger unter die Leiste = feiner': 'while seeking, finger below the bar = finer',
  'Vibration': 'Vibration', 'kurz beim Wechsel der Lupen-Stufe': 'briefly when the zoom level changes',
};
const t = (s) => (EN && T[s]) || s;
function applyLang(s) { const l = eff(s, 'language'); EN = l === 'en' ? true : l === 'de' ? false : !/^de\b/i.test(navigator.language || ''); }
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const k in attrs || {}) { if (k === 'class') e.className = attrs[k]; else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]); }
  kids.flat().forEach((c) => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return e;
}
const hostMatches = (host, d) => { d = String(d).toLowerCase().replace(/^\*?\./, ''); return host === d || host.endsWith('.' + d); };
