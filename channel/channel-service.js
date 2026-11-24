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
//      {t:'kadri-download', op, …} – direkte MP4-Downloads (Phase C3, channel/channel-downloads.js): start/find aus
//                                   Kadris Inhaltsskript (nur nach Tipp des Nutzers), status/cancel/caps auch aus dem
//                                   Menü, list nur aus dem Menü. Feste Felder; nur die URL der Datei und ein Name gehen
//                                   (verschlüsselt) zum Helfer, bei start/hlsplan dazu der Anfragekontext: Herkunft der
//                                   Seite (aus sender.url, nicht aus der Nachricht) als Referer und der User-Agent des
//                                   Browsers – keine Cookies, keine anderen Header. S3c: dashplan/dashstart ebenso, dazu
//                                   der Strukturfingerabdruck des gebundenen MPD (kadri-dash-fp/1) und ein Hinweis
//                                   auf die gespielten Darstellungen (nur Nummern).
//  - Kein Weg zum alten Helfer-Protokoll (X-EVP-Key, Port 47811); keine Cookies, Header oder Medien im Kanal. URLs im
//    Kanal: die der Datei bzw. des Streams, die der Nutzer selbst zum Speichern antippt (dlstart/hlsplan, verschlüsselt),
//    und als Referer nur die Herkunft der Seite (ohne Pfad/Query).
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

  // Download-Aufträge: storage.local OHNE URL (nur ein gesalzener SHA-256 zum Erkennen doppelter Starts).
  const local = api.storage.local;
  const SALT = 'kadri-dl-salt';
  let saltP = null;
  const salt = () => (saltP = saltP || local.get(SALT).then((o) => {
    if (typeof o[SALT] === 'string' && /^[0-9a-f]{64}$/.test(o[SALT])) return o[SALT];
    const v = hex(crypto.getRandomValues(new Uint8Array(32)));
    return local.set({ [SALT]: v }).then(() => v);
  }).catch((e) => { saltP = null; throw e; }));
  const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
  const downloads = NS.createDownloads({
    channel: { download: (op, a) => ready().then((c) => c.download(op, a)), status: () => ready().then((c) => c.command('status')) },
    storage: { get: () => local.get('kadri-dl-jobs').then((o) => o['kadri-dl-jobs']), set: (v) => local.set({ 'kadri-dl-jobs': v }) },
    digest: async (url) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode((await salt()) + '\n' + url)))),
    random: () => hex(crypto.getRandomValues(new Uint8Array(16))),
  });
  const ID = /^[0-9a-f]{32}$/;
  // Nur Kadris Inhaltsskript (in einem Tab) oder das Menü; je Befehl genau diese Felder.
  const fromTab = (sender) => own(sender) && !!sender.tab && typeof sender.url === 'string' && /^https?:/.test(sender.url);
  // Anfragekontext eines Auftrags: Seitenherkunft aus dem Absender (vom Browser gesetzt, nicht aus der Nachricht) und
  // der User-Agent dieses Browsers; streng geprüft (NS.requestContext), ungültige Teile entfallen.
  const pageContext = (s) => NS.requestContext(s.url, typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const DL = {
    start: { keys: ['url', 'name'], ok: (s) => fromTab(s), run: (m, s) => downloads.start(m.url, m.name, pageContext(s)) },
    find: { keys: ['url'], ok: (s) => fromTab(s), run: (m) => downloads.find(m.url) },
    status: { keys: ['id'], ok: (s) => fromTab(s) || isPage(s, 'popup.html'), run: (m) => downloads.status(m.id) },
    cancel: { keys: ['id'], ok: (s) => fromTab(s) || isPage(s, 'popup.html'), run: (m) => downloads.cancel(m.id) },
    caps: { keys: [], ok: (s) => fromTab(s) || isPage(s, 'popup.html'), run: () => downloads.capabilities() },
    list: { keys: [], ok: (s) => isPage(s, 'popup.html'), run: () => downloads.list() },
    // P4b: HLS-Streams – nur aus Kadris Inhaltsskript und nur nach Tipp (Plan, Start, Fortsetzen)
    hlsplan: { keys: ['url', 'bind'], ok: (s) => fromTab(s), run: (m, s) => downloads.hlsPlan(m.url, m.bind, pageContext(s)) },
    hlsstart: { keys: ['planId', 'option', 'name'], ok: (s) => fromTab(s), run: (m) => downloads.hlsStart(m.planId, m.option, m.name) },
    hlsresume: { keys: ['id', 'planId', 'option'], ok: (s) => fromTab(s), run: (m) => downloads.hlsResume(m.id, m.planId, m.option) },
    // P0-A: Ohne nachgewiesene Elementzuordnung darf kein Tab einen DASH-Plan oder -Start anfordern.
  };
  const HEX = (n) => new RegExp('^[0-9a-f]{' + n + '}$');
  const dlValid = (m, d) => Object.keys(m).every((k) => k === 't' || k === 'op' || d.keys.includes(k)) &&
    (!d.keys.includes('id') || (typeof m.id === 'string' && ID.test(m.id))) &&
    (!d.keys.includes('url') || (typeof m.url === 'string' && m.url.length <= 4096)) &&
    (m.name === undefined || (typeof m.name === 'string' && m.name.length <= 400)) &&
    (!d.keys.includes('planId') || (typeof m.planId === 'string' && HEX(32).test(m.planId))) &&
    (!d.keys.includes('option') || (typeof m.option === 'string' && HEX(24).test(m.option))) &&
    (!d.keys.includes('bind') || NS.hlsBindValid(m.bind));

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
    if (!m || (m.t !== 'kadri-helper' && m.t !== 'kadri-channel' && m.t !== 'kadri-download')) return;   // andere: Kadris übrige Empfänger
    let act;
    if (m.t === 'kadri-download') {
      const d = typeof m.op === 'string' && Object.prototype.hasOwnProperty.call(DL, m.op) ? DL[m.op] : null;
      if (!d || !d.ok(sender) || !dlValid(m, d)) { reply({ ok: false, error: { kind: 'refused', message: 'refused' } }); return; }
      // Antworten mit festen Texten (Zustand, Fortschritt, Fehler) – nie Server-Text oder die URL.
      const text = (j) => (j && j.id ? Object.assign(j, NS.describeDownload(j)) : j);
      d.run(m, sender).then((value) => {
        if (value && value.job) text(value.job); else if (Array.isArray(value)) value.forEach(text); else if (value && value.id) text(value);
        if (value && value.error) value.message = NS.downloadErrorText(value.error);
        reply({ ok: true, value });
      }, (e) => {
        const kind = (e && e.kind) || 'error';
        const reason = e && typeof e.reason === 'string' && /^[a-z0-9_]{1,40}$/.test(e.reason) ? e.reason : '';
        const diag = kind === 'plan' && m.op === 'hlsplan' ? NS.planDiagnostic(e.diag) : null;
        reply({ ok: false, error: Object.assign({ kind, message: reason ? NS.downloadReasonText(reason) : NS.downloadErrorText(kind) }, reason ? { reason } : {}, diag ? { diag } : {}) });
      });
      return true;
    }
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
