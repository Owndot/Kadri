  // ---------- Quellen-Registry je Dokument (Phase C3, P1) ----------
  // Gehört dem isolierten Inhaltsskript dieses Dokuments (jedes Fenster hat seine eigene). Kontext = documentKey (zufällig
  // je Dokument, neu nach Navigation) + playerId (je Videoelement, nie eine DOM-ID) + mediaEpoch (neu bei emptied/
  // loadstart, also neuem Medium im selben Element). tabId/frameId kennt nur der Hintergrund (Runtime-sender); hier null.
  // Gleiche Adresse in zwei Playern/Fenstern = zwei getrennte Einträge (keine Verschmelzung über die URL).
  // Budgets: 64 Quellen je Player, 256 je Dokument, 16 Player – darüber wird abgelehnt, nichts wächst unbegrenzt.
  // Nichts davon wird gespeichert; die genaue Adresse verlässt die Registry nur über resolveSelection (Start nach Tipp).
  function createMediaRegistry(opt) {
    opt = opt || {};
    const now = opt.now || (() => Date.now());
    const rand = opt.random || (() => {
      const a = new Uint8Array(12);
      try { crypto.getRandomValues(a); } catch (e) { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); }
      return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
    });
    const docOf = opt.docKey || (() => location.href.split('#')[0]);
    let documentKey = rand(), docHref = docOf();
    let players = new WeakMap();       // Element -> Player
    let live = [];                     // Player in Reihenfolge (für Budgets und Aufräumen)
    let total = 0;
    const urls = new Map();            // sourceId -> genaue Adresse (privat)
    const subs = new Set();
    const ROLE_RANK = { unknown: 0, standalone: 1, master: 2, 'media-playlist': 2, track: 3, init: 3, segment: 3 };
    const ASSOC_RANK = { unbound: 0, ambiguous: 1, bound: 2 };
    const KNOW_RANK = { unknown: 0, claimed: 1, observed: 2, verified: 3 };
    const PROT_RANK = { unknown: 0, clear: 1, encrypted: 2, drm: 3 };
    function dropPlayer(p) {
      p.sources.forEach((s) => urls.delete(s.sourceId));
      total -= p.sources.size; p.sources.clear(); p.byUrl.clear();
    }
    // Navigation (auch SPA): neues Dokument → alles Alte ungültig
    function checkDoc() {
      const h = docOf();
      if (h === docHref) return;
      docHref = h; documentKey = rand();
      live.forEach(dropPlayer); live = []; players = new WeakMap(); total = 0; urls.clear();
      emit(null, 'navigation');
    }
    function emit(p, cause) { subs.forEach((x) => { if (!p || x.p === p) { try { x.cb(cause); } catch (e) {} } }); }
    function ctxOf(p) { return Object.freeze({ tabId: null, frameId: null, documentKey: documentKey, playerId: p.playerId, mediaEpoch: p.epoch }); }
    function playerOf(ctx) {
      checkDoc();
      if (!ctx || ctx.documentKey !== documentKey) return null;
      const p = live.find((x) => x.playerId === ctx.playerId);
      return p && p.epoch === ctx.mediaEpoch ? p : null;
    }
    function newEpoch(p, cause) {
      dropPlayer(p); p.epoch++; emit(p, cause);
    }
    // Kontext für ein Videoelement (legt den Player beim ersten Mal an)
    function contextFor(el) {
      checkDoc();
      if (!el || typeof el !== 'object') return null;
      let p = players.get(el);
      if (!p) {
        if (live.length >= MEDIA_LIMITS.players) { const old = live.shift(); dropPlayer(old); old.gone = true; emit(old, 'evicted'); }
        p = { playerId: rand(), epoch: 1, sources: new Map(), byUrl: new Map(), gone: false };
        players.set(el, p); live.push(p);
        if (el.addEventListener) {
          // Neues Medium im selben Element: alte Quellen und Auswahl gelten nicht mehr
          el.addEventListener('emptied', () => { if (!p.gone) newEpoch(p, 'emptied'); });
          el.addEventListener('loadstart', () => { if (!p.gone && p.sources.size) newEpoch(p, 'loadstart'); });
        }
      }
      return ctxOf(p);
    }
    function merge(s, v) {
      let ch = false;
      const set = (k, x) => { if (s[k] !== x) { s[k] = x; ch = true; } };
      if (s.kind === 'unknown' && v.kind !== 'unknown') set('kind', v.kind);
      else if (v.provenance.kind === 'manifest' && v.kind !== 'unknown') set('kind', v.kind);
      if (ROLE_RANK[v.role] > ROLE_RANK[s.role]) set('role', v.role);   // Rolle schlägt Endung: ein Stück bleibt ein Stück
      if (ASSOC_RANK[v.association.state] > ASSOC_RANK[s.association.state]) { s.association.state = v.association.state; ch = true; }
      v.association.evidence.forEach((e) => {
        if (s.association.evidence.indexOf(e) < 0 && s.association.evidence.length < MEDIA_LIMITS.evidence) { s.association.evidence.push(e); ch = true; }
      });
      ['mime', 'quality', 'duration', 'audio', 'video'].forEach((k) => {
        if (KNOW_RANK[v[k].status] > KNOW_RANK[s[k].status]) { s[k] = v[k]; ch = true; }
      });
      if (PROT_RANK[v.protection] > PROT_RANK[s.protection]) set('protection', v.protection);
      if (v.browser !== 'unknown' && v.browser !== s.browser) set('browser', v.browser);
      const pv = { kind: v.provenance.kind, origin: v.provenance.origin, observedAt: now() };
      if (!s.provenance.some((x) => x.kind === pv.kind && x.origin === pv.origin)) {
        if (s.provenance.length >= MEDIA_LIMITS.provenance) s.provenance.shift();
        s.provenance.push(pv); ch = true;
      }
      return ch;
    }
    function observe(ctx, obs) {
      const p = playerOf(ctx);
      if (!p) return { ok: false, reason: 'stale-context' };
      const r = mediaValidObservation(obs);
      if (!r.ok) return r;
      const v = r.value;
      const id = p.byUrl.get(v.url);
      if (id) {
        const s = p.sources.get(id);
        if (merge(s, v)) { s.revision++; emit(p, 'update'); }
        return { ok: true, sourceId: id, revision: s.revision, created: false };
      }
      if (p.sources.size >= MEDIA_LIMITS.perPlayer || total >= MEDIA_LIMITS.perDocument) return { ok: false, reason: 'budget' };
      const sourceId = rand();
      const s = { sourceId: sourceId, urlRef: sourceId, kind: v.kind, role: v.role, mime: v.mime, quality: v.quality, duration: v.duration,
        audio: v.audio, video: v.video, provenance: [{ kind: v.provenance.kind, origin: v.provenance.origin, observedAt: now() }],
        association: v.association, protection: v.protection, browser: v.browser, revision: 1 };
      p.sources.set(sourceId, s); p.byUrl.set(v.url, sourceId); urls.set(sourceId, v.url); total++;
      emit(p, 'add');
      return { ok: true, sourceId: sourceId, revision: 1, created: true };
    }
    const freeze = (s) => {
      const d = mediaDownloadState(s);
      return Object.freeze(Object.assign(JSON.parse(JSON.stringify(s)), { context: null, download: d }));
    };
    function snapshot(ctx) {
      const p = playerOf(ctx);
      if (!p) return [];
      const c = ctxOf(p);
      return Object.freeze(Array.from(p.sources.values()).map((s) => Object.freeze(Object.assign({}, freeze(s), { context: c }))));
    }
    function invalidate(ctx, cause) {
      const p = playerOf(ctx);
      if (p) newEpoch(p, cause || 'invalidated');
    }
    function subscribe(ctx, cb) {
      const p = playerOf(ctx);
      if (!p || typeof cb !== 'function') return () => {};
      const x = { p: p, cb: cb };
      subs.add(x);
      return () => subs.delete(x);
    }
    // Wiedergabe: dieselbe Reihenfolge wie bisher (legacyOrdering), dazu die Kennung jedes Eintrags. Die Auswahl der
    // Wiedergabe ändert sich dadurch nicht.
    function selectPlayback(ctx, legacyOrdering) {
      const p = playerOf(ctx);
      const list = (legacyOrdering || []).slice();
      return { sources: list, ids: list.map((u) => (p && p.byUrl.get(u)) || '') };
    }
    // Ausgewählte Quelle in eine Transferangabe auflösen – nur aktuell, gebunden und auswählbar
    function resolveSelection(ctx, sourceId, revision) {
      const p = playerOf(ctx);
      if (!p) return { ok: false, reason: 'stale-context' };
      const s = p.sources.get(sourceId);
      if (!s) return { ok: false, reason: 'unknown-source' };
      if (s.revision !== revision) return { ok: false, reason: 'stale-revision' };
      const d = mediaDownloadState(s);
      if (d.state !== 'attemptable') return { ok: false, reason: d.reason || 'not-attemptable' };
      return { ok: true, url: urls.get(sourceId) };
    }
    // P4b: gewählten Stream auflösen – nur aktuell, gebunden, auswählbar. Dazu die Bindung, die der Helfer prüft
    // (Player-Kennung, Medien-Epoche, Revision): ein Plan gilt nur für genau diesen Stand.
    function resolveStream(ctx, sourceId, revision) {
      const p = playerOf(ctx);
      if (!p) return { ok: false, reason: 'stale-context' };
      const s = p.sources.get(sourceId);
      if (!s) return { ok: false, reason: 'unknown-source' };
      if (revision !== s.revision) return { ok: false, reason: 'stale-revision' };
      const d = mediaStreamState(s);
      if (d.state !== 'attemptable') return { ok: false, reason: d.reason || 'not-attemptable' };
      return { ok: true, url: urls.get(sourceId), bind: { player: p.playerId, gen: p.epoch, rev: s.revision } };
    }
    // Ist diese genaue Adresse für den Player bekannt? (nur Kennung, keine Adresse heraus)
    function idOf(ctx, url) { const p = playerOf(ctx); return (p && p.byUrl.get(url)) || ''; }
    const stats = () => ({ players: live.length, sources: total });
    return { contextFor, observe, snapshot, invalidate, subscribe, selectPlayback, resolveSelection, resolveStream, idOf, stats };
  }
  const mediaRegistry = createMediaRegistry();
  // ---------- Adapter: vorhandene Erkennung liefert Beobachtungen (keine neue Site-Logik) ----------
  // Bindung an GENAU dieses Video nur mit Beleg: eigene Adresse des Elements, seine <source>-Kinder, Stücke dieses
  // Streams geladen, Video-ID (Facebook/Instagram) oder ein Varianten-Satz eines Site-Adapters bei nur einem Video.
  // Nähe, Zeitpunkt, Vorschaubild oder „zuletzt geladen“ allein bleiben ambiguous/unbound.
  const MEDIA_HOW = [
    [/^Video-Element/, 'element', 'element-src', 'bound', ['element-src']],
    [/^Stream \(läuft gerade, geprüft\)/, 'network', 'segments-loaded', 'bound', ['segments-loaded']],
    [/^Stream \(läuft gerade\)/, 'network', 'start-timing', 'ambiguous', ['start-timing']],
    [/^Stream \(Vorschaubild\)/, 'network', 'poster-token', 'ambiguous', ['poster-token']],
    [/^(Stream|Datei) \(Netzwerk\)/, 'network', 'recent', 'unbound', []],
  ];
  const mediaHeight = (x) => { const m = /(\d{3,4})\s*p?\b/i.exec(String(x || '')); const n = m ? parseInt(m[1], 10) : 0; return n >= 100 && n <= 8640 ? n : 0; };
  function mediaPut(ctx, u, prov, origin, state, evidence, extra) {
    if (!ctx || !mediaUrlOk(u)) return null;
    const o = { url: u, provenance: { kind: prov, origin: origin }, association: { state: state, evidence: evidence.slice() } };
    let role = 'unknown';
    try { role = mediaRoleHint(u); } catch (e) {}
    if (role !== 'unknown') o.role = role;
    Object.assign(o, extra || {});
    return mediaRegistry.observe(ctx, o);
  }
  // Leichte Adapter (auch beim Öffnen des Download-Menüs): Element, <source>-Kinder, vorhandener Site-Adapter
  function mediaObserveLight(v, ctx) {
    if (!v || !ctx) return;
    const es = srcOf(v);
    if (es) mediaPut(ctx, es, 'element', 'element-src', 'bound', ['element-src']);
    const kids = v.querySelectorAll ? Array.from(v.querySelectorAll('source[src]')).slice(0, 16) : [];
    kids.forEach((s) => {
      const extra = {};
      const type = (s.getAttribute('type') || '').split(';')[0].trim();
      if (/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(type) && type.length <= 100) extra.mime = { status: 'claimed', value: type, evidenceIds: ['source-type'] };
      const h = mediaHeight(s.getAttribute('size') || s.getAttribute('res') || s.getAttribute('data-res') || s.getAttribute('label') || s.getAttribute('data-quality'));
      if (h) extra.quality = { status: 'claimed', value: { height: h }, evidenceIds: ['source-attribute'] };
      mediaPut(ctx, s.src, 'element', 'element-source', 'bound', ['element-source'], extra);
    });
    if (PH && phCache && phCache.length) {
      const single = countEligible() <= 1;
      phCache.slice(0, 16).forEach((c) => mediaPut(ctx, c.u, 'adapter', 'site-adapter', single ? 'bound' : 'ambiguous',
        single ? ['adapter-variant-set', 'single-video'] : ['adapter-variant-set'],
        c.res ? { quality: { status: 'claimed', value: { height: c.res }, evidenceIds: ['adapter-quality'] } } : {}));
    }
  }
  // Alle Adapter beim Zusammenstellen der Playerliste (playerSources): Ergebnis von resolve() mit Herkunft
  function mediaObserveFor(v, r, resMap) {
    const ctx = mediaRegistry.contextFor(v);
    if (!ctx) return null;
    mediaObserveLight(v, ctx);
    const q = (u) => (resMap && resMap[u] > 0 ? { quality: { status: 'claimed', value: { height: Math.round(resMap[u]) }, evidenceIds: ['page-quality'] } } : {});
    if (META && r && r.best && (r.how === 'HD' || r.how === 'SD')) {   // Seitendaten genau dieser Video-ID
      [r.best, r.alt].forEach((u) => { if (u) mediaPut(ctx, u, 'page-metadata', 'asset-id', 'bound', ['asset-id'], q(u)); });
    }
    ((r && r.qualities) || []).forEach((c) => {
      const sure = META && lastVia === 'laufendes Video';
      mediaPut(ctx, c.u, 'page-metadata', sure ? 'asset-id' : 'near', sure ? 'bound' : 'ambiguous', sure ? ['asset-id'] : ['near'],
        c.res ? { quality: { status: 'claimed', value: { height: c.res }, evidenceIds: ['page-quality'] } } : {});
    });
    ((r && r.list) || []).forEach((x) => {
      const how = String(x.how || '');
      const m = MEDIA_HOW.find((e) => e[0].test(how));
      if (m) mediaPut(ctx, x.u, m[1], m[2], m[3], m[4], q(x.u));
      else if (!/^MP4 mit Ton/.test(how)) mediaPut(ctx, x.u, 'page-metadata', 'near', 'ambiguous', ['near'], q(x.u));
    });
    return ctx;
  }
