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
  'Helfer-App: verbunden': 'Helper app: connected', 'Helfer-App: nicht gekoppelt': 'Helper app: not paired',
  'Helfer-App: gekoppelt, nicht erreichbar': 'Helper app: paired, not reachable',
  'Helfer-App: in Firefox vorübergehend nicht verfügbar': 'Helper app: temporarily unavailable in Firefox',
  'Helfer koppeln': 'Pair helper', 'Code aus der Helfer-App (8 Ziffern)': 'Code from the helper app (8 digits)', 'Koppeln': 'Pair',
  'Verbindung prüfen': 'Check connection', 'Kopplung entfernen': 'Remove pairing', 'Kopplung wirklich entfernen?': 'Really remove the pairing?',
  'Gekoppelt mit Helfer': 'Paired with helper', 'Nicht gekoppelt': 'Not paired', 'Verbunden': 'Connected', 'Nicht erreichbar': 'Not reachable',
  'Kopplung entfernt': 'Pairing removed', 'Koppelt …': 'Pairing …',
  'In der Helfer-App „Code anzeigen“ tippen und den Code hier eingeben. Der Code gilt 2 Minuten und nur für einen Versuch.': 'In the helper app tap “Show code” and enter it here. The code is valid for 2 minutes and one attempt.',
  'Neue Helfer-Identität. Wenn du den Helper nicht selbst zurückgesetzt hast, entferne die Kopplung und überprüfe die Verbindung.': 'New helper identity. If you did not reset the helper yourself, remove the pairing and check the connection.',
  'Downloads über die Helfer-App': 'Downloads via the helper app',
  'Abbrechen': 'Cancel',
  'Helligkeit und Lautstärke über die Helfer-App; MP4-Dateien im Player über ⬇ direkt aufs Handy speichern': 'Brightness and volume via the helper app; save MP4 files straight to the phone with ⬇ in the player',
  'Startet …': 'Starting …',
  'Verbindung unterbrochen – Stand wird geprüft': 'Connection interrupted – checking status',
  'Lädt …': 'Downloading …',
  'Wird abgebrochen …': 'Cancelling …',
  'Gespeichert in Download/Video-Assistent': 'Saved to Download/Video-Assistent',
  'Abgebrochen': 'Cancelled',
  'Unterbrochen (Helfer neu gestartet) – erneut starten': 'Interrupted (helper restarted) – start again',
  'Server verlangt Anmeldung – direkter Download nicht möglich': 'The server requires a login – direct download not possible',
  'Datei nicht gefunden': 'File not found',
  'Weiterleitung nicht erlaubt': 'Redirect not allowed',
  'Adresse nicht erlaubt': 'Address not allowed',
  'Server antwortet nicht': 'The server is not responding',
  'Adresse nicht erlaubt (eigenes oder privates Netz)': 'Address not allowed (local or private network)',
  'Server nennt keine Dateigröße – direkter Download nicht möglich': 'The server gives no file size – direct download not possible',
  'Datei zu groß': 'File too large',
  'Keine MP4-Datei': 'Not an MP4 file',
  'Server liefert die Datei nur komprimiert': 'The server only sends the file compressed',
  'Zu wenig Speicher auf dem Handy': 'Not enough storage on the phone',
  'Helfer-App: Speicherzugriff fehlt – in der App erlauben': 'Helper app: storage access missing – allow it in the app',
  'Speichern auf dem Handy fehlgeschlagen': 'Saving on the phone failed',
  'Verbindung zum Server unterbrochen': 'Connection to the server lost',
  'Datei hat sich beim Laden geändert': 'The file changed while downloading',
  'Fortsetzen nicht möglich': 'Cannot resume',
  'Start nicht bestätigt – bitte erneut starten': 'Start not confirmed – please start again',
  'Helfer lädt schon zwei Dateien – später erneut': 'The helper is already downloading two files – try again later',
  'Helfer-App beendet': 'Helper app stopped',
  'Fehlerhafte Antwort des Servers': 'Invalid response from the server',
  'Download fehlgeschlagen': 'Download failed',
  'Unbekannt': 'Unknown',
  'Helfer-App nicht gekoppelt – in den Einstellungen koppeln': 'Helper app not paired – pair it in the settings',
  'Helfer-App nicht erreichbar': 'Helper app not reachable',
  'Helfer-App antwortet nicht': 'Helper app is not responding',
  'Der Helfer erkennt diese Kopplung nicht mehr an – neu koppeln': 'The helper no longer accepts this pairing – pair again',
  'Antwort nicht vom gekoppelten Helfer – nichts übertragen': 'Reply not from the paired helper – nothing sent',
  'Diese Helfer-App-Version kann keine direkten Downloads': 'This helper app version cannot do direct downloads',
  'Diese Adresse lässt sich nicht direkt laden': 'This address cannot be downloaded directly',
  'Helfer-App: Verbindung fehlgeschlagen': 'Helper app: connection failed',
  'in Firefox vorübergehend nicht verfügbar': 'temporarily unavailable in Firefox',
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
  'Beim Öffnen': 'On open', 'Nur Bild': 'Picture only', 'Mit Bedienung': 'With controls', 'Nur Bild: Bedienung erst nach dem ersten Antippen': 'Picture only: controls after the first tap',
  'Spul-Lupe': 'Seek zoom', 'beim Spulen Finger unter die Leiste = feiner': 'while seeking, finger below the bar = finer',
  'Vibration': 'Vibration', 'kurz beim Spulen: Lupe, Abbrechen, Anfang/Ende': 'briefly while seeking: zoom, cancel, start/end',
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
