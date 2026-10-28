// Kadri – Helfer-Kanal (TEST-Stufe): Einbindung in den Hintergrund (Service Worker) des isolierten Test-Builds.
// Nur in dist/channel-poc enthalten (node tools/build.js --channel-poc); die normalen Builds kennen diese Datei nicht.
//
//  - Lädt den geprüften WASM-Kern (wasm_bindgen, no-modules) aus der Erweiterung selbst.
//  - Netzwerk: Kadris Schutzregeln sperren Anfragen der Erweiterung an 127.0.0.0/8 (Regel 51). Für den Kanal gibt es
//    genau eine zusätzliche Freigabe: POST an die vier Protokollpfade auf 127.0.0.1:47899, nur für Anfragen der
//    Erweiterung selbst (tabIds -1). Regel-ID 40 liegt außerhalb der Bereiche, die Kadri verwaltet oder entfernt.
//  - Nachrichten: nur von der eigenen Testseite channel/channel.html. Content-Scripts (auch Kadris eigene) und
//    Webseiten bekommen "refused". Andere Nachrichtentypen bleiben unberührt für Kadris eigene Empfänger.
//  - Kein Weg vom Kanal zum alten Helfer-Protokoll (X-EVP-Key, Port 47811) und umgekehrt.
//  - Optionale Vorbedingung des Builds (NS.networkPrecondition, im minimalen Test-Build: bestätigter Netzwerk-
//    Sandkasten): Solange sie nicht erfüllt ist, wird jede Aktion mit „sandbox-missing“ abgelehnt und keine Anfrage
//    gestellt (fail-closed).
(function (root) {
  'use strict';
  const NS = root.KadriChannel;
  const api = root.chrome;
  const PORT = 47899;
  const RULE_ID = 40;
  const PAGE = 'channel/channel.html';
  const RULE = {
    id: RULE_ID, priority: 10, action: { type: 'allow' },
    condition: { regexFilter: '^http://127\\.0\\.0\\.1:' + PORT + '/p1/(?:pair/m[02]|ch/(?:hs|rec))$', requestMethods: ['post'], tabIds: [-1] },
  };

  // Der no-modules-Glue legt `let wasm_bindgen` als globale lexikalische Bindung an – sie ist KEINE Eigenschaft von self.
  // eslint-disable-next-line no-undef
  const core = wasm_bindgen;
  const wasmReady = core({ module_or_path: api.runtime.getURL('channel/kadri_pairing_poc_bg.wasm') });

  const canonical = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x));
  let ruleReady = null;
  function networkRule() {
    if (!ruleReady) {
      const dnr = api.declarativeNetRequest;
      ruleReady = dnr.updateSessionRules({ removeRuleIds: [RULE_ID], addRules: [RULE] })
        .then(() => dnr.getSessionRules())
        .then((have) => have.some((r) => canonical(r) === canonical(RULE)))
        .catch(() => false)
        .then((ok) => { if (!ok) ruleReady = null; return ok; });
    }
    return ruleReady;
  }

  const transport = NS.createTransport({
    port: PORT,
    fetchImpl: async (url, init) => {
      if (!(await precondition())) throw new Error('network sandbox unavailable');
      if (!(await networkRule())) throw new Error('network rule unavailable');
      return fetch(url, init);
    },
  });
  const store = NS.createStore(NS.idbBackend('kadri-helper-channel'), () => core.identity_generate());
  const channel = NS.createChannel({ core, store, transport });
  const ready = () => wasmReady.then(() => channel);
  const precondition = () => (typeof NS.networkPrecondition === 'function' ? Promise.resolve(NS.networkPrecondition()).catch(() => false) : Promise.resolve(true));

  const ACTIONS = {
    status: (c) => c.status(),
    pair: (c, m) => c.pair(m.code),
    ping: (c) => c.ping(),
    dummy: (c, m) => c.dummy(Number(m.size)),
    forget: (c) => c.forget(),
  };

  api.runtime.onMessage.addListener((m, sender, reply) => {
    if (!m || m.t !== 'kadri-channel') return;   // fremde Nachrichtentypen: nicht beantworten (Kadris eigener Empfänger)
    const page = api.runtime.getURL(PAGE);
    const fromPage = sender && sender.id === api.runtime.id && typeof sender.url === 'string' && sender.url.split(/[?#]/)[0] === page &&
      (!sender.origin || sender.origin === new URL(page).origin);
    const act = fromPage && Object.prototype.hasOwnProperty.call(ACTIONS, m.op) ? ACTIONS[m.op] : null;
    if (!act) { reply({ ok: false, error: { kind: 'refused', message: 'refused' } }); return; }
    precondition().then((ok) => {
      if (!ok) { const e = new Error('Sicherheitsregel (Netzwerk-Sandkasten) fehlt – Test-Build gesperrt'); e.kind = 'sandbox-missing'; throw e; }
      return ready();
    }).then((c) => act(c, m)).then(
      (value) => reply({ ok: true, value }),
      (e) => reply({ ok: false, error: { kind: (e && e.kind) || 'error', message: String((e && e.message) || e) } }));
    return true;
  });

  networkRule();
})(self);
