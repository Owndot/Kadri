// Kadri – Service Worker des MINIMALEN Test-Builds dist/channel-only (Gerätetest Helfer-Kanal, nur Dummy-Daten).
// Lädt dieselben, unveränderten Kanal-Module wie dist/channel-poc – aber NICHT Kadris Hintergrund: kein „kadri-xhr“-
// Anfrage-Weg, keine Medienfunktionen, kein Weg zum alten Helfer (Port 47811). Der Build hat keine Content-Scripts.
//
// Netzwerk-Sandkasten (Ersatz für Kadris Schutzregeln, die hier fehlen): Regel 41 sperrt jede Anfrage der Erweiterung
// selbst (tabIds -1). Nur Regel 40 des Kanals (höhere Priorität) gibt POST an die vier Protokollpfade auf
// 127.0.0.1:47899 frei. Zusätzliche Absicherung – der Kanal-Code stellt ohnehin keine anderen Anfragen.
'use strict';
importScripts('channel/kadri_pairing_poc.js', 'channel/channel-store.js', 'channel/channel-transport.js',
  'channel/channel-session.js', 'channel/channel-service.js');
chrome.declarativeNetRequest.updateSessionRules({
  removeRuleIds: [41],
  addRules: [{ id: 41, priority: 1, action: { type: 'block' }, condition: { tabIds: [-1] } }],
}).catch(() => {});
