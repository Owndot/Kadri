  // ================= Oberfläche eingebetteter Videos im Hauptfenster (nur Kadri für Chrome/Vivaldi) =================
  // Läuft das Video in einem eingebetteten Fenster (iframe), zeichnet die Kadri-Instanz dort Knopf (▶/⬇) und Auswahl
  // sonst in IHREN Kasten: „position:fixed“ und visualViewport beziehen sich auf das Fenster, die Auswahl wird
  // abgeschnitten, der Knopf bleibt darin gefangen. Darum zeigt das Hauptfenster beides am echten Bildschirm:
  //  - Video, Quellen (Registry) und jede Download-Aktion bleiben im Ursprungsfenster. Nach oben gehen nur Anzeige-Texte,
  //    eine Zufallskennung und Zahlen (Lage), nie Adressen, Cookies oder Header.
  //  - Weg: Erweiterung (KADRI_FRAMEUI → background.js „kadri-fui“). Der Browser nennt dort Tab, Fenster (frameId) und
  //    Dokument (documentId) des Absenders; nach oben geht es nur an das Hauptfenster desselben Tabs, zurück nur an genau
  //    das Dokument der Meldung. Seiten können diese Nachrichten weder lesen noch fälschen.
  //  - Lage: das Fenster schickt seine Kennung und das Rechteck des Videos per postMessage an sein Elternfenster
  //    (sub.js rechnet in jeder Zwischenebene um, auch über fremde Herkunft); das Hauptfenster ordnet sie über
  //    e.source genau einem seiner <iframe> zu. Eine Seite kann die Zahlen sehen oder verfälschen – mehr als einen
  //    falsch platzierten Knopf innerhalb ihres eigenen Fensters erreicht sie damit nicht.
  //  - Schutz vor Werbung: nur ein Video, das Kadri im Fenster selbst als laufend, hörbar und groß genug erkennt, nur ein
  //    sichtbar großes Fenster, genau ein Knopf (das Hauptfenster entscheidet), und eine Auswahl erscheint hier nur
  //    nach einem Tipp auf diesen Knopf (bzw. einen Eintrag) – nie von selbst.
  //  - Seitenlinks und anonymisierte Diagnose kann das Hauptfenster übernehmen. Medienadressen, die einen frischen
  //    Tipp brauchen, werden im Ursprungsfenster bestätigt, damit die Quellenprüfung dort bis zur Ausgabe gilt.
  //  - Fehlt etwas (Userscript, Firefox, keine Zuordnung, Vollbild im Fenster): Knopf und Auswahl wie bisher im Fenster.
  const FUI_ON = typeof KADRI_FRAMEUI === 'object' && !!KADRI_FRAMEUI && typeof KADRI_FRAMEUI.send === 'function';
  const FUI_GEO = '__kadriFg1';
  const FUI_N = /^[0-9a-f]{32}$/;
  const FUI_WAIT = 2000;   // so lange wartet das Fenster auf die Antwort des Hauptfensters, dann eigener Knopf
  function fuiSend(op, m) {
    if (!FUI_ON) return Promise.resolve(null);
    try { return Promise.resolve(KADRI_FRAMEUI.send(Object.assign({ op: op }, m || {}))).then((r) => (r && typeof r === 'object' ? r : null), () => null); }
    catch (e) { return Promise.resolve(null); }
  }
  const fuiCut = (a, b) => {
    const l = Math.max(a.l, b.l), t = Math.max(a.t, b.t), r = Math.min(a.l + a.w, b.l + b.w), u = Math.min(a.t + a.h, b.t + b.h);
    return { l: l, t: t, w: Math.max(0, r - l), h: Math.max(0, u - t) };
  };
  const fuiNum = (a) => Array.isArray(a) && a.length === 4 && a.every((x) => typeof x === 'number' && isFinite(x) && Math.abs(x) < 1e6);
  // S4b-3: Relay-Spur (nur Diagnose, anonym). Jeder Tipp im Hauptfenster (act/pick) bekommt eine Zufallskennung (8 Hex);
  // sie geht mit nach unten, das Fenster gibt sie bei Auswahl (menu) und Hinweis (toast) mit nach oben zurück. Beide Seiten
  // halten die letzten Schritte (Zeit, Kennung, fester Schritt-Name, kurzer fester Code) – nie Adressen oder Texte der Seite.
  const FUI_RID = /^[0-9a-f]{8}$/;
  const fuiTrace = [];
  function fuiLog(rid, step, info) {
    fuiTrace.push([Date.now(), FUI_RID.test(rid || '') ? rid : '-', String(step).slice(0, 40), String(info == null ? '' : info).replace(/[^\w.:=+\-/ ]/g, '').slice(0, 60)]);
    if (fuiTrace.length > 80) fuiTrace.shift();
  }
  const fuiNewRid = () => { try { const a = new Uint8Array(4); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); } catch (e) { return ''; } };

  // ---------- im eingebetteten Fenster (Video und Quellen bleiben hier) ----------
  const fui = { n: '', shown: false, mode: '', t0: 0, menu: null, seq: 0, local: false, relayUntil: 0, tries: 0, retryAt: 0, rid: '' };
  if (IN_FRAME && FUI_ON) { try { const a = new Uint8Array(16); crypto.getRandomValues(a); fui.n = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); } catch (e) {} }
  // Zeigt das Hauptfenster Knopf und Auswahl für dieses Video? (dann hier keinen eigenen Knopf)
  function fuiFrameHold(v) {
    if (!fui.n || fui.local) return false;
    if (fsElem()) { fuiFrameOff(); return false; }   // Vollbild im Fenster (Player der Seite): Oberfläche hier
    fuiGeoPost(v);
    if (!fui.shown && Date.now() >= fui.retryAt) {
      fui.shown = true; fui.t0 = Date.now();
      if (fui.mode !== 'local') fui.mode = '';
      fuiSend('show', { n: fui.n, on: true }).then((r) => {
        if (!fui.shown) return;
        // Hauptfenster (noch) nicht erreichbar – z. B. lädt Kadri dort gerade erst: hier zeigen und später erneut melden
        if (!r) { fui.shown = false; fui.tries++; fui.retryAt = fui.tries < 6 ? Date.now() + 1500 * fui.tries : Infinity; fuiMode('local'); return; }
        fui.tries = 0; fuiMode(r.mode);
      });
    }
    if (!fui.shown) return false;   // erneute Meldung steht aus: Oberfläche hier
    if (fui.mode === 'remote' || fui.mode === 'busy') return true;
    if (fui.mode === 'local') return false;
    return Date.now() - fui.t0 < FUI_WAIT;   // Antwort steht noch aus
  }
  function fuiMode(m) {
    if (['remote', 'busy', 'local'].indexOf(m) < 0 || m === fui.mode) return;
    fui.mode = m;
    setTimeout(tick, 0);
  }
  function fuiFrameOff() {
    if (!fui.shown) return;
    fui.shown = false; fui.mode = '';
    fuiSend('show', { n: fui.n, on: false });
  }
  const fuiRemote = () => !!fui.n && fui.shown && fui.mode === 'remote' && !vp;
  // Hinweise und Auswahl nach oben: solange der Knopf oben ist, und kurz nach einem Tipp von oben (Stream-Auswahl kommt
  // erst nach der Antwort der Helfer-App; das Video darf inzwischen pausiert sein)
  const fuiRelay = () => !!fui.n && !vp && !fui.local && (fuiRemote() || Date.now() < fui.relayUntil);
  function fuiGeoPost(v) {
    let r;
    try { r = rectOf(v); } catch (e) { return; }
    const m = { n: fui.n, r: [r.left, r.top, r.width, r.height], c: [0, 0, innerWidth, innerHeight], w: innerWidth, h: innerHeight };
    m[FUI_GEO] = 1;
    try { window.parent.postMessage(m, '*'); } catch (e) {}
    // verschachtelt: zusätzlich direkt an das Hauptfenster (falls eine Zwischenebene nicht weiterreicht – dann nimmt es
    // die Lage des äußeren Fensters)
    if (window.parent !== window.top) { const d = { n: fui.n, top: 1 }; d[FUI_GEO] = 1; try { window.top.postMessage(d, '*'); } catch (e) {} }
  }
  // Auswahl dieses Fensters im Hauptfenster zeigen: nur Texte; die Aktionen bleiben hier (fui.menu)
  // rid: Kennung des Tipps, zu dem diese Auswahl gehört (vom Aufrufer beim Start seines Ablaufs festgehalten – eine
  // inzwischen neuere Kennung gilt nicht für eine ältere, noch laufende Planung)
  function fuiFrameMenu(title, items, rid) {
    const seq = ++fui.seq;
    fui.menu = { seq: seq, items: items.slice(0, 24) };
    if (rid === undefined) rid = fui.rid;
    fuiLog(rid, 'frame:menu-send', 'seq=' + seq + ' n=' + fui.menu.items.length);
    fuiSend('menu', { n: fui.n, seq: seq, rid: rid, title: String(title), items: fui.menu.items.map((it) => ({ label: String(it.label || ''), sub: it.sub ? String(it.sub) : '', info: !!it.info, wait: !!it.wait })) })
      .then((r) => {
        fuiLog(rid, 'frame:menu-reply', r ? (r.ok === true ? 'ok' : r.stale === true ? 'veraltet' : 'abgelehnt') : 'keine-antwort');
        // S4b-3: Antwort auf einen älteren oder schon beantworteten Tipp ({stale:true}): verwerfen – weder oben noch hier
        // zeigen (sonst erschiene eine veraltete Auswahl im Fenster)
        if (r && r.stale === true) { if (fui.menu && fui.menu.seq === seq) fui.menu = null; return; }
        // nur eine ausdrücklich angezeigte Auswahl ({ok:true}) gilt; sonst – Hauptfenster nicht erreichbar, Fehler oder
        // abgelehnt ({ok:false}) – kontrolliert zurück auf die Oberfläche hier (statt einer Auswahl, die nie erscheint),
        // sofern diese Auswahl noch die aktuelle ist
        if ((r && r.ok === true) || !fui.menu || fui.menu.seq !== seq) return;
        fui.menu = null; fui.local = true; fuiFrameOff();
        pageDlMenu(title, items, true);
      });
  }
  function fuiFrameAct(a) {
    const v = active;
    if (!v || !v.isConnected || vp) return { ok: false, gone: true };
    fui.relayUntil = Date.now() + 60000;
    if (a === 'dl') { onPageDownload(); return { ok: true }; }
    if (a === 'player') {
      if (CONFIG.defaultPlayer === 'external' && !DOWNLOAD_ONLY) {   // externe App bräuchte hier einen Tipp: Knopf wieder hier
        fui.local = true; fuiFrameOff();
        return { ok: false, toast: 'Externer Player: bitte direkt im Video auf ▶ tippen' };
      }
      onPlayerTap();
      return { ok: true };
    }
    // Diagnose GENAU dieses Fensters (Video, Quellen, Auswahl) – anonymisiert, weil sie über das Hauptfenster geht
    if (a === 'diag') { let t = ''; try { t = diagAnon(); } catch (e) { t = 'Kadri – anonymisierte Diagnose: Fehler ' + ((e && e.name) || ''); } return { ok: true, ext: { k: 'copy', t: t } }; }
    if (a === 'share') {
      const u = postUrlFor(v);
      return mediaSourceAllowed(u) ? { ok: true, ext: { k: 'share', u: u } } : { ok: false, toast: 'Kein Link zu diesem Video gefunden – Beitrag öffnen und nochmal versuchen' };
    }
    return { ok: false };
  }
  // Tipp auf einen Eintrag oben: genau einmal je Auswahl, nur die aktuelle Auswahl
  function fuiFramePick(seq, i) {
    const mm = fui.menu;
    if (!mm || mm.seq !== seq) return { ok: false };
    const it = mm.items[i];
    if (!it || it.info || typeof it.fn !== 'function') return { ok: false };
    fui.menu = null;
    fui.relayUntil = Date.now() + 60000;
    if (it.allowed && !it.allowed()) return { ok: false };
    if (it.frameConfirm) {
      pageDlMenu('Speichern', [it], true);
      return { ok: true };
    }
    if (it.ext) return it.ext.u && !mediaSourceAllowed(it.ext.u) ? { ok: false } : { ok: true, ext: it.ext };
    try { it.fn(); } catch (e) {}
    return { ok: true };
  }
  function fuiFrameMsg(m) {
    if (!m || m.n !== fui.n || !fui.n) return { ok: false };
    if ((m.op === 'act' || m.op === 'pick') && FUI_RID.test(m.rid || '')) fui.rid = m.rid;
    if (m.op === 'act' || m.op === 'pick') fuiLog(m.rid, 'frame:' + m.op, m.op === 'act' ? m.a : 'seq=' + m.seq + ' i=' + m.i + (fui.menu ? ' akt=' + fui.menu.seq : ' akt=-'));
    if (m.op === 'ack') { if (fui.shown) fuiMode(m.mode); return { ok: true }; }
    if (m.op === 'pick') return fuiFramePick(m.seq, m.i);
    if (m.op === 'act') return fuiRemote() ? fuiFrameAct(m.a) : { ok: false, gone: true };
    return { ok: false };
  }

  // ---------- im Hauptfenster: Knopf und Auswahl für das Video eines eingebetteten Fensters ----------
  // regs: Fenster mit laufendem Video (Schlüssel = frameId:documentId, vom Browser); geo: Lage je Kennung; cur: das
  // Fenster, dessen Knopf gerade hier steht; credit: ein Tipp hier erlaubt genau eine Auswahl dieses Fensters
  const fuiTop = { regs: new Map(), geo: new Map(), cur: null, credit: null, recent: null, used: [], lastRid: '', cancelled: [] };
  // S4b: Ablauf bewusst abgebrochen (Warteblatt geschlossen, Frist abgelaufen; src/105): spätere Auswahl und Hinweise
  // mit dieser Kennung verwerfen
  function fuiTopCancel(rid) {
    if (!FUI_RID.test(rid || '')) return;
    if (fuiTop.cancelled.indexOf(rid) < 0) { fuiTop.cancelled.push(rid); if (fuiTop.cancelled.length > 16) fuiTop.cancelled.shift(); }
    if (fuiTop.credit && fuiTop.credit.rid === rid) fuiTop.credit = null;
    fuiLog(rid, 'top:abgebrochen', '');
  }
  // S4b-3: Eine Auswahl aus einem Fenster gilt nur als Antwort auf GENAU den Tipp, dessen Kennung sie trägt (credit.rid),
  // einmal, und höchstens so lange, wie die Planung beim Helfer dauern darf (Kanal: 25 s je Planaufruf, dazu Warteschlange).
  const FUI_MENU_WAIT = 45000;
  const fuiSame = (a, b) => !!a && !!b && a.key === b.key && a.n === b.n;   // dasselbe Dokument mit derselben Kennung
  function fuiOuter(w) {   // äußerstes <iframe> dieses Dokuments, in dem das Fenster w steckt
    let x = w;
    try { for (let i = 0; i < 12 && x && x !== window && x.parent !== window; i++) x = x.parent; } catch (e) { return null; }
    return x && x !== window ? frameOf(x) : null;
  }
  if (!IN_FRAME && FUI_ON) addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object' || d[FUI_GEO] !== 1 || typeof d.n !== 'string' || !FUI_N.test(d.n)) return;
    const direct = d.top !== 1;
    const f = direct ? frameOf(e.source) : fuiOuter(e.source);
    if (!f) return;
    if (direct && !(fuiNum(d.r) && fuiNum(d.c) && d.w > 0 && d.h > 0 && d.w < 1e5 && d.h < 1e5)) return;
    const now = Date.now(), g = fuiTop.geo.get(d.n);
    if (!direct && g && g.d && g.f === f && now - g.t < 1500) return;   // genaue Lage (über die Zwischenebenen) ist da
    fuiTop.geo.set(d.n, { f: f, d: direct ? { r: d.r.slice(), c: d.c.slice(), w: d.w, h: d.h } : null, t: now });
    if (fuiTop.geo.size > 32) fuiTop.geo.delete(fuiTop.geo.keys().next().value);
  });
  // Lage des Videos im Hauptfenster: {r: Video, c: sichtbarer Ausschnitt}, aus dem <iframe> jetzt und der gemeldeten Lage
  function fuiGeoRect(g) {
    const f = g.f;
    if (!f || !f.isConnected) return null;
    const fr = f.getBoundingClientRect();
    if (!fr.width || !fr.height) return null;
    let cs;
    try { cs = getComputedStyle(f); } catch (e) { return null; }
    if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return null;
    const sx = f.offsetWidth ? fr.width / f.offsetWidth : 1, sy = f.offsetHeight ? fr.height / f.offsetHeight : 1;
    const pl = parseFloat(cs.paddingLeft) || 0, pt = parseFloat(cs.paddingTop) || 0, pr = parseFloat(cs.paddingRight) || 0, pb = parseFloat(cs.paddingBottom) || 0;
    const box = { l: fr.left + (f.clientLeft + pl) * sx, t: fr.top + (f.clientTop + pt) * sy, w: (f.clientWidth - pl - pr) * sx, h: (f.clientHeight - pt - pb) * sy };
    if (box.w <= 0 || box.h <= 0) return null;
    if (!g.d) return { r: box, c: box };
    const kx = box.w / g.d.w, ky = box.h / g.d.h;
    const map = (a) => ({ l: box.l + a[0] * kx, t: box.t + a[1] * ky, w: a[2] * kx, h: a[3] * ky });
    return { r: map(g.d.r), c: fuiCut(map(g.d.c), box) };
  }
  // Sichtbarer Teil des Videos im Hauptfenster (Rechteck wie getBoundingClientRect) oder null
  function fuiTopRect(g) {
    const geo = g && fuiTop.geo.get(g.n);
    const q = geo && fuiGeoRect(geo);
    if (!q) return null;
    const s = fuiCut(fuiCut(q.r, q.c), { l: 0, t: 0, w: innerWidth, h: innerHeight });
    if (!s.w || !s.h) return null;
    return { left: s.l, top: s.t, width: s.w, height: s.h, right: s.l + s.w, bottom: s.t + s.h };
  }
  // Genau ein Knopf: das größte sichtbare Video – ein eigenes der Hauptseite oder das eines Fensters. Jedes Fenster
  // erfährt, ob der Knopf hier steht (remote), gar keiner nötig ist (busy) oder es ihn selbst zeigen soll (local).
  function fuiTopDecide(ownV) {
    if (IN_FRAME || !FUI_ON || !fuiTop.regs.size) return null;
    const now = Date.now(), fs = fsElem();
    let best = null, area = 0;
    fuiTop.regs.forEach((g, key) => {
      g.want = 'busy';
      if (g.hold > now) return;   // ▶ getippt: der Player öffnet im Fenster, bis dahin kein Knopf hier
      const geo = fuiTop.geo.get(g.n);
      if (!geo) { if (now - g.t0 > 1200) g.want = 'local'; return; }       // keine Zuordnung zu einem <iframe>
      if (now - geo.t > 2500) { if (now - geo.t > 120000) fuiTop.regs.delete(key); return; }   // meldet sich nicht mehr
      if (fs) { if (fs === geo.f) g.want = 'local'; return; }             // Vollbild (z. B. dieses Fenster): dort zeigen
      const s = fuiTopRect(g);
      if (!s || s.width < CONFIG.minWidth || s.height < 90) return;      // (fast) unsichtbar oder zu klein: nirgends
      const a = s.width * s.height;
      if (a > 15000 && a > area) { area = a; best = g; }
    });
    if (best && ownV && visibleArea(ownV) >= area) best = null;           // eigenes Video der Hauptseite ist größer
    if (best) best.want = 'remote';
    let local = !!best || !!ownV;                                          // höchstens ein Knopf auf dem Bildschirm
    fuiTop.regs.forEach((g) => {
      if (g.want === 'local') { if (local) g.want = 'busy'; local = true; }
      if (g.want !== g.mode) { g.mode = g.want; fuiTopSend('ack', g, { mode: g.mode }); }
    });
    return best;
  }
  function fuiTopSend(op, g, m) { return fuiSend(op, Object.assign({ to: g.src, n: g.n }, m || {})); }
  function fuiTopShow(g) {
    if (fuiTop.cur !== g) { fuiTop.cur = g; active = null; watchSize(null); }
    ui();
    attachHost();
    if (pill && !pill.__lens) { pill.__lens = true; lensWatch(pill); }
    pill.classList.add('on');
    schedulePlace();
  }
  function fuiTopDrop() {
    if (!fuiTop.cur) return;
    fuiTop.cur = null;
    hidePill();
  }
  // Tipp auf den Knopf hier oben → Aktion im Ursprungsfenster
  function fuiTopAct(a) {
    const g = fuiTop.cur;
    if (!g) return;
    const now = Date.now();
    fuiTop.recent = { g: g, t: now };
    const rid = fuiNewRid();
    if (a === 'dl' || a === 'player') { fuiTop.credit = { g: g, t: now, rid: rid }; fuiTop.lastRid = rid; }
    if (a === 'player') { g.hold = now + 4000; fuiTopDrop(); }
    fuiLog(rid, 'top:act', a);
    fuiTopSend('act', g, { a: a, rid: rid }).then((r) => { fuiLog(rid, 'top:act-reply', fuiTraceRes(r)); fuiTopResult(g, r, a); });
  }
  function fuiTopPick(g, seq, i) {
    const now = Date.now();
    fuiTop.recent = { g: g, t: now };
    const rid = fuiNewRid();
    fuiTop.credit = { g: g, t: now, rid: rid };   // ein Eintrag darf genau eine Folge-Auswahl öffnen (z. B. Qualität des Streams)
    fuiTop.lastRid = rid;
    fuiLog(rid, 'top:pick', 'seq=' + seq + ' i=' + i);
    fuiTopSend('pick', g, { seq: seq, i: i, rid: rid }).then((r) => { fuiLog(rid, 'top:pick-reply', fuiTraceRes(r)); fuiTopResult(g, r, 'pick'); });
    return rid;   // (Kennung des Warteblatts, src/105)
  }
  const fuiTraceRes = (r) => (!r ? 'keine-antwort' : (r.ok === true ? 'ok' : 'nicht-ok') + (r.gone ? '+weg' : '') + (r.toast ? '+hinweis' : '') + (r.ext ? '+' + r.ext.k : ''));
  // what: 'pick' (Eintrag der Auswahl) oder die Aktion des Knopfs ('dl', 'player', 'diag', 'share')
  function fuiTopResult(g, r, what) {
    if (!r) {
      toast('Video im eingebetteten Fenster nicht mehr erreichbar');
      fuiTop.regs.delete(g.key);
      if (fuiTop.cur === g) fuiTopDrop();
      return;
    }
    if (r.gone && fuiTop.cur === g) fuiTopDrop();
    if (r.toast) toast(String(r.toast));
    // abgelehnt ohne eigenen Hinweis: nicht stillschweigend als erledigt behandeln – sagen, dass nichts geschah und wie
    // es weitergeht (erneut tippen; nichts wird selbst wiederholt)
    else if (r.ok !== true) {
      toast(what === 'pick' ? 'Auswahl nicht mehr aktuell – nichts gestartet. Bitte erneut auf ⬇ tippen'
        : r.gone ? 'Video im eingebetteten Fenster gerade nicht bereit – nichts gestartet. Bitte erneut tippen, sobald der Knopf wieder erscheint'
          : 'Aktion im eingebetteten Fenster nicht ausgeführt – bitte erneut tippen');
    }
    if (r.ok === true && r.ext) fuiTopExt(r.ext);
  }
  // Aktionen, die einen frischen Tipp brauchen: hier ausführen (der Tipp war hier)
  function fuiTopExt(x) {
    if (!x || typeof x !== 'object') return;
    const u = typeof x.u === 'string' && /^https?:\/\//i.test(x.u) ? x.u : '';
    if (x.k === 'ytdlnis' && u) toYtdlnis(u);
    else if (x.k === 'open' && u) pageDlOpenTab(u);
    else if (x.k === 'share' && u) shareUrl(u);
    else if (x.k === 'copy' && typeof x.t === 'string') copyText(x.t, 'Anonymisierte Diagnose des Video-Fensters kopiert');
  }
  function fuiTopMsg(m) {
    if (!m || !m.src || !Number.isInteger(m.src.f) || m.src.f <= 0 || typeof m.src.d !== 'string' || !m.src.d || !FUI_N.test(m.n || '')) return { ok: false };
    const key = m.src.f + ':' + m.src.d;
    let g = fuiTop.regs.get(key);
    if (m.op === 'show') {
      if (!m.on) {
        if (g && g.n === m.n) { fuiTop.regs.delete(key); if (fuiTop.cur === g) fuiTopDrop(); }
        return { ok: true, mode: 'busy' };
      }
      if (g && g.n === m.n) g.hold = 0;   // erneut gemeldet (z. B. Player wieder zu)
      if (!g || g.n !== m.n) {
        if (g && fuiTop.cur === g) fuiTopDrop();
        g = { key: key, src: { f: m.src.f, d: m.src.d }, n: m.n, t0: Date.now(), mode: '', want: '', hold: 0 };
        fuiTop.regs.set(key, g);
        if (fuiTop.regs.size > 16) fuiTop.regs.delete(fuiTop.regs.keys().next().value);
      }
      quiet = 0;
      try { tick(); } catch (e) {}
      return { ok: true, mode: g.mode || 'wait' };
    }
    const rc = fuiTop.recent;
    const rid = FUI_RID.test(m.rid || '') ? m.rid : '';
    if (!g && rc && rc.g.key === key) g = rc.g;   // Fenster hat den Knopf inzwischen abgegeben (Video pausiert)
    if (!g || g.n !== m.n) { fuiLog(rid, 'top:' + m.op + '-abgelehnt', !g ? 'fenster-unbekannt' : 'kennung-anders'); return { ok: false }; }
    if (m.op === 'menu') {
      const c = fuiTop.credit;
      // veraltet: Antwort auf einen schon beantworteten Tipp oder auf einen, dem inzwischen ein neuerer Tipp (⬇, ▶ oder ein
      // Eintrag) gefolgt ist – auch wenn dessen Auswahl schon gezeigt wurde
      // S4b: auch abgebrochen (Warteblatt bewusst geschlossen) und nach Ablauf der Frist veraltet – kein Rückfall ins Fenster
      const late = !!c && c.rid === rid && Date.now() - c.t > FUI_MENU_WAIT;
      const stale = !!rid && (fuiTop.used.indexOf(rid) >= 0 || fuiTop.cancelled.indexOf(rid) >= 0 || rid !== fuiTop.lastRid || late);
      const why = !rid ? 'ohne-kennung' : late ? 'zu-spaet' : stale ? (fuiTop.cancelled.indexOf(rid) >= 0 ? 'abgebrochen' : 'veraltet') : !c ? 'kein-tipp'
        : !fuiSame(c.g, g) ? 'tipp-anderes-fenster' : !Array.isArray(m.items) ? 'eintraege' : '';
      fuiLog(rid, why ? 'top:menu-abgelehnt' : 'top:menu-gezeigt', why || 'seq=' + m.seq + ' n=' + (m.items || []).length);
      if (why) return stale ? { ok: false, stale: true } : { ok: false };
      fuiTop.credit = null;
      fuiTop.used.push(rid); if (fuiTop.used.length > 16) fuiTop.used.shift();
      pageDlMenu(String(m.title || ''), m.items.slice(0, 24).map((it, i) => (it.info
        ? { label: String(it.label || ''), sub: String(it.sub || ''), info: true }
        : { label: String(it.label || ''), sub: String(it.sub || ''), wait: it.wait === true, relay: true, fn: () => fuiTopPick(g, m.seq, i) })));
      return { ok: true };
    }
    if (m.op === 'toast') {
      const near = fuiSame(fuiTop.cur, g) || (rc && fuiSame(rc.g, g) && Date.now() - rc.t < 60000);
      // S4b: Hinweis mit Kennung nur zum LETZTEN, nicht abgebrochenen Tipp – ein später Hinweis eines älteren Ablaufs
      // überdeckt keine neuere Aktion
      const why = !near ? 'nicht-aktuell' : !rid ? '' : fuiTop.cancelled.indexOf(rid) >= 0 ? 'abgebrochen' : rid !== fuiTop.lastRid ? 'veraltet' : '';
      fuiLog(rid, why ? 'top:toast-abgelehnt' : 'top:toast-gezeigt', why || (m.prog ? 'fortschritt' : ''));
      if (why) return { ok: false };
      if (rid && m.prog !== true) pageDlWaitDone(rid);   // Ergebnis: Warteblatt dieses Tipps schließen
      if (typeof m.text === 'string' && m.text) toast(m.text);
      return { ok: true };
    }
    return { ok: false };
  }
  if (FUI_ON) { try { KADRI_FRAMEUI.onMsg = IN_FRAME ? fuiFrameMsg : fuiTopMsg; } catch (e) {} }
  // =================================================
