// Kadri – Helfer-Kanal im Hintergrund (Service Worker) der Chrome-/Vivaldi-Fassung.
//
//  - Lädt den geprüften WASM-Kern (wasm_bindgen, no-modules) aus der Erweiterung selbst.
//  - Netzwerk: nur über Kadris Schutzregeln (NS.networkPrecondition = netGuard in background.js). Dort gibt Regel 40
//    genau POST an die vier Protokollpfade auf 127.0.0.1:47899 frei, nur für Kadris eigene Anfragen; alles andere im
//    eigenen Netz bleibt gesperrt (auch der alte Port 47811). Stehen die Regeln nicht, geht keine Anfrage hinaus.
//  - Nachrichten:
//      {t:'kadri-helper', op, v}  – die fünf Steuerbefehle (status, beat, end, vol, bright) aus Kadris Inhaltsskript.
//                                   Ungültige Befehle verlassen den Browser nicht. Antwort {ok, value} oder {ok:false}.
//      {t:'kadri-channel', op}    – Verwaltung: status/check aus Einstellungsseite und Menü, pair/forget NUR aus der
//                                   Einstellungsseite. Webseiten können der Erweiterung keine Nachrichten schicken.
//  - Kein Weg zum alten Helfer-Protokoll (X-EVP-Key, Port 47811); keine Cookies, URLs oder Medien im Kanal.
(function (root) {
  'use strict';
  const NS = root.KadriChannel;
  const api = root.chrome;
  const PORT = 47899;

  // Der no-modules-Glue legt `let wasm_bindgen` als globale lexikalische Bindung an – sie ist KEINE Eigenschaft von self.
  // eslint-disable-next-line no-undef
  const core = wasm_bindgen;
  let wasmReady = null;
  const loadCore = () => (wasmReady = wasmReady || core({ module_or_path: api.runtime.getURL('channel/kadri_pairing_poc_bg.wasm') })
    .catch((e) => { wasmReady = null; throw e; }));

  const precondition = () => (typeof NS.networkPrecondition === 'function' ? Promise.resolve(NS.networkPrecondition()).catch(() => false) : Promise.resolve(false));
  const transport = NS.createTransport({
    port: PORT,
    fetchImpl: async (url, init) => {
      if (!(await precondition())) throw new Error('network rules unavailable');
      return fetch(url, init);
    },
  });
  const store = NS.createStore(NS.idbBackend('kadri-helper-channel'), () => core.identity_generate());
  const channel = NS.createChannel({ core, store, transport });
  const ready = () => loadCore().then(() => channel);

  const own = (sender) => !!sender && sender.id === api.runtime.id;
  const pageOf = (sender) => (sender && typeof sender.url === 'string' ? sender.url.split(/[?#]/)[0] : '');
  const isPage = (sender, file) => own(sender) && pageOf(sender) === api.runtime.getURL(file) &&
    (!sender.origin || sender.origin === new URL(api.runtime.getURL(file)).origin);

  const ADMIN = {
    status: { pages: ['options.html', 'popup.html'], run: (c) => c.status() },
    check: { pages: ['options.html', 'popup.html'], run: (c) => c.command('status') },
    pair: { pages: ['options.html'], run: (c, m) => c.pair(m.code) },
    forget: { pages: ['options.html'], run: (c) => c.forget() },
  };

  api.runtime.onMessage.addListener((m, sender, reply) => {
    if (!m || (m.t !== 'kadri-helper' && m.t !== 'kadri-channel')) return;   // andere Nachrichten: Kadris übrige Empfänger
    let act;
    if (m.t === 'kadri-helper') {
      // Aus Kadris Inhaltsskript (oder einer eigenen Seite); nur die fünf Steuerbefehle in strenger Form.
      const keys = Object.keys(m);
      const msg = own(sender) && keys.every((k) => k === 't' || k === 'op' || k === 'v') ? NS.controlMessage(m.op, m.v) : null;
      if (!msg) { reply({ ok: false }); return; }
      act = (c) => c.command(msg.op, msg.v);
    } else {
      const a = Object.prototype.hasOwnProperty.call(ADMIN, m.op) ? ADMIN[m.op] : null;
      if (!a || !a.pages.some((p) => isPage(sender, p))) { reply({ ok: false, error: { kind: 'refused', message: 'refused' } }); return; }
      act = (c) => a.run(c, m);
    }
    ready().then(act).then(
      (value) => reply({ ok: true, value }),
      (e) => reply({ ok: false, error: { kind: (e && e.kind) || 'error', message: String((e && e.message) || e) } }));
    return true;
  });
})(self);
