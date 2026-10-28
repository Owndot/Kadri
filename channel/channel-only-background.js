// Kadri – Service Worker des MINIMALEN Test-Builds dist/channel-only (Gerätetest Helfer-Kanal, nur Dummy-Daten).
// Lädt dieselben Kanal-Module wie dist/channel-poc – aber NICHT Kadris Hintergrund: kein „kadri-xhr“-Anfrage-Weg,
// keine Medienfunktionen, kein Weg zum alten Helfer. Der Build hat keine Content-Scripts.
//
// Netzwerk-Sandkasten (Ersatz für Kadris Schutzregeln, die hier fehlen): Regel 41 sperrt jede Anfrage, die DIESE
// Erweiterung selbst stellt (tabIds -1 UND initiatorDomains = eigene ID – ohne letztere träfe die Regel auch die
// Service Worker fremder Webseiten, Review N1). Nur Regel 40 des Kanals (höhere Priorität) gibt POST an die vier
// Protokollpfade auf 127.0.0.1:47899 frei.
//
// Fail-closed: Erst wenn Regel 41 gesetzt UND per getSessionRules bestätigt ist, nimmt der Kanal Befehle an und
// stellt Anfragen (networkPrecondition, ausgewertet in channel-service.js). Scheitert das, meldet jede Aktion
// „sandbox-missing“, und der Fehler steht in der Konsole des Service Workers.
'use strict';
(function (root) {
  const dnr = chrome.declarativeNetRequest;
  const SANDBOX = { id: 41, priority: 1, action: { type: 'block' }, condition: { tabIds: [-1], initiatorDomains: [chrome.runtime.id] } };
  const canonical = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x));
  let ready = null;
  function sandbox() {
    if (!ready) {
      ready = dnr.updateSessionRules({ removeRuleIds: [SANDBOX.id], addRules: [SANDBOX] })
        .then(() => dnr.getSessionRules())
        .then((have) => have.some((r) => canonical(r) === canonical(SANDBOX)))
        .catch((e) => { console.error('Kadri TEST: Netzwerk-Sandkasten konnte nicht gesetzt werden:', e); return false; })
        .then((ok) => {
          if (!ok) { console.error('Kadri TEST: Regel 41 fehlt – Helfer-Kanal gesperrt'); ready = null; }
          return ok;
        });
    }
    return ready;
  }
  (root.KadriChannel = root.KadriChannel || {}).networkPrecondition = sandbox;
  sandbox();
})(self);
importScripts('channel/kadri_pairing_poc.js', 'channel/channel-store.js', 'channel/channel-transport.js',
  'channel/channel-session.js', 'channel/channel-service.js');
