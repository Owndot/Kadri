// Kadri S4a – kleiner, konfigurierbarer DASH-Testplayer, nur für den Prüfstand tests/s4a_dash_player_matrix.py.
// Er bildet Player-ARCHITEKTUREN nach, nicht eine bestimmte Website:
//   mode 'main'    MPD und Stücke per fetch im Hauptthread, MSE im Hauptthread (wie die S3d-Testseite)
//   mode 'worker'  MPD und Stücke per fetch in einem Dedicated Worker, Anhängen an MSE im Hauptthread
//   mode 'wmse'    MediaSource im Dedicated Worker (MediaSourceHandle), Worker lädt und hängt selbst an
//   resolve 'final' (Response.url, wie dash.js/Shaka) | 'initial' (angefragte MPD-Adresse – früherer Fehler der S3d-Seite)
//   addQuery       Query, die an jedes Init/Stück angehängt wird (Token-Weitergabe wie bei UrlQueryInfo)
//   base           welches von mehreren BaseURL-Elementen benutzt wird (Ausweich-CDN)
//   inline         MPD-Text aus einer JSON-Antwort (kein .mpd-Abruf), Basis aus derselben Antwort
//   S4b-4: preload n  Init + die ersten n Stücke VOR dem Anlegen der MediaSource laden (Vorladen)
//          parallel   die ersten maxSegs Stücke gleichzeitig anfragen (verspätet eintreffende Antworten)
//   S4b-6: switchAt k  ab dem k-ten Stück dieselbe Folge von der NÄCHSTEN BaseURL laden (CDN-Wechsel mitten in der Folge)
//          zombie     nach einem neueren start() am selben Video weiter Stücke laden (ohne anzuhängen) – schlecht
//                     aufgeräumter alter Lader; ohne zombie hört ein älterer Lauf dann auf
// Nur die hier benutzte Fixture-Form: eine Periode, SegmentTemplate + SegmentTimeline, $Number[%0wd]$ oder $Time$.
(() => {
  'use strict';
  const NS = 'urn:mpeg:dash:schema:mpd:2011', AHEAD = 8;
  const ME = (document.currentScript && document.currentScript.src) || location.href;   // (später ist currentScript null)
  const kid = (e, n) => (e ? Array.from(e.children) : []).filter((x) => x.localName === n && x.namespaceURI === NS);
  const iso = (x) => { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(x || ''); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : NaN; };
  function plan(text, mpdUrl, cfg) {
    const doc = new DOMParser().parseFromString(text, 'application/xml'), root = doc.documentElement;
    const pick = (el, base) => { const bs = kid(el, 'BaseURL'); if (!bs.length) return base; return new URL(bs[Math.min(cfg.base || 0, bs.length - 1)].textContent.trim(), base).href; };
    const q = (u) => cfg.addQuery ? u + (u.indexOf('?') >= 0 ? '&' : '?') + cfg.addQuery : u;
    const per = kid(root, 'Period')[0], pb = pick(per, pick(root, mpdUrl));
    const out = { dur: iso(root.getAttribute('mediaPresentationDuration')), reps: {} };
    kid(per, 'AdaptationSet').forEach((a) => {
      const ab = pick(a, pb);
      kid(a, 'Representation').forEach((r) => {
        const rb = pick(r, ab), t = kid(r, 'SegmentTemplate')[0] || kid(a, 'SegmentTemplate')[0], id = r.getAttribute('id');
        const ts = Number(t.getAttribute('timescale') || 1);
        const fill = (x, n, tm) => x.replace(/\$RepresentationID\$/g, id).replace(/\$Number(?:%0(\d+)d)?\$/, (m, w) => String(n).padStart(+w || 0, '0')).replace(/\$Time\$/, String(tm));
        const segs = []; let time = 0, n = Number(t.getAttribute('startNumber') || 1);
        kid(kid(t, 'SegmentTimeline')[0], 'S').forEach((x) => {
          if (x.getAttribute('t') !== null) time = Number(x.getAttribute('t'));
          for (let k = 0; k <= Number(x.getAttribute('r') || 0); k++) { segs.push({ url: q(new URL(fill(t.getAttribute('media'), n++, time), rb).href), t0: time / ts }); time += Number(x.getAttribute('d')); }
        });
        out.reps[id] = { id: id, mime: r.getAttribute('mimeType') || a.getAttribute('mimeType'), codecs: r.getAttribute('codecs'), h: Number(r.getAttribute('height') || 0),
          kind: a.getAttribute('contentType'), init: q(new URL(fill(t.getAttribute('initialization'), 0, 0), rb).href), segs: segs };
      });
    });
    return out;
  }
  let worker = null, wid = 0;
  const pending = new Map();
  function getWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('own-worker.js', ME).href);
    worker.onmessage = (e) => { const d = e.data; if (d && d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d && d.ev && S4A.onWorker) S4A.onWorker(d); };
    return worker;
  }
  const wcall = (msg, tr) => new Promise((res) => { const id = ++wid; pending.set(id, res); getWorker().postMessage(Object.assign({ id: id }, msg), tr || []); });
  async function getText(u, cfg) {
    if (cfg.mode === 'worker' || cfg.mode === 'wmse') { const d = await wcall({ op: 'text', url: u }); if (d.err) throw new Error(d.err); return { text: d.text, url: d.url }; }
    const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return { text: await r.text(), url: r.url };
  }
  async function getBuf(u, cfg) {
    if (cfg.mode === 'worker') { const d = await wcall({ op: 'buf', url: u }); if (d.err) throw new Error(d.err); return d.buf; }
    const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer();
  }
  const S4A = window.S4A = { players: [] };
  // cfg: { video, mpd, vid, aid, mode, resolve, addQuery, base, inline, maxSegs }
  S4A.start = async function (cfg) {
    const st = { cfg: cfg, segs: 0, err: '', done: false, ready: false };
    S4A.players.push(st);
    try {
      let text, base;
      if (cfg.inline) {   // MPD steckt in einer API-Antwort (JSON), kein .mpd-Abruf
        const j = JSON.parse((await getText(cfg.inline, cfg)).text); text = j.mpd; base = new URL(j.base, location.href).href;
      } else {
        const g = await getText(cfg.mpd, cfg); text = g.text;
        base = cfg.resolve === 'initial' ? new URL(cfg.mpd, location.href).href : (g.url || new URL(cfg.mpd, location.href).href);
      }
      const P = plan(text, base, cfg), v = cfg.video;
      const P2 = cfg.switchAt ? plan(text, base, Object.assign({}, cfg, { base: (cfg.base || 0) + 1 })) : null;
      const segUrl = (t, k) => (P2 && k >= cfg.switchAt ? P2.reps[t.id].segs[k].url : t.segs[k].url);
      const myGen = (v.__s4aGen = (v.__s4aGen || 0) + 1), gone = () => v.__s4aGen !== myGen;
      const tracks = [P.reps[cfg.vid || '1'], P.reps[cfg.aid || '2']].filter(Boolean);
      const max = cfg.maxSegs || Infinity;
      if (cfg.mode === 'wmse') {
        if (!(window.MediaSource && MediaSource.canConstructInDedicatedWorker)) throw new Error('MSE im Worker nicht verfügbar');
        S4A.onWorker = (d) => { if (d.ev === 'handle') { v.srcObject = d.handle; v.play().catch(() => {}); } else if (d.ev === 'seg') st.segs = d.n; else if (d.ev === 'err') st.err = d.err; else if (d.ev === 'done') st.done = true; };
        setInterval(() => { try { worker.postMessage({ op: 'time', t: v.currentTime }); } catch (e) {} }, 250);
        getWorker().postMessage({ op: 'play', tracks: tracks, dur: P.dur, ahead: AHEAD });
        st.ready = true;
        return st;
      }
      const pre = cfg.preload ? await Promise.all(tracks.map(async (t) => [await getBuf(t.init, cfg)].concat(await Promise.all(t.segs.slice(0, cfg.preload).map((x) => getBuf(x.url, cfg)))))) : null;
      const ms = new MediaSource();
      v.src = URL.createObjectURL(ms);
      await new Promise((res) => ms.addEventListener('sourceopen', res, { once: true }));
      const sbs = tracks.map((t) => ms.addSourceBuffer(t.mime + '; codecs="' + t.codecs + '"'));
      ms.duration = P.dur;
      const app = (sb, b) => new Promise((res, rej) => { sb.addEventListener('updateend', res, { once: true }); sb.addEventListener('error', rej, { once: true }); sb.appendBuffer(b); });
      st.ready = true;
      await Promise.all(tracks.map(async (t, i) => {
        let k = 0;
        if (pre) { for (const b of pre[i]) await app(sbs[i], b); k = pre[i].length - 1; if (i === 0) { st.segs = k; v.play().catch(() => {}); } }
        else await app(sbs[i], await getBuf(t.init, cfg));
        if (cfg.parallel) {
          const bufs = await Promise.all(t.segs.slice(0, Math.min(max, t.segs.length)).map((x) => getBuf(x.url, cfg)));
          for (const b of bufs) { if (gone()) break; await app(sbs[i], b); k++; if (i === 0) st.segs = k; }
        }
        while (k < t.segs.length && k < max) {
          if (gone()) {
            if (!cfg.zombie) break;
            await getBuf(t.segs[k].url, cfg); k++; await new Promise((res) => setTimeout(res, 300)); continue;   // lädt weiter, hängt nichts mehr an
          }
          if (t.segs[k].t0 < v.currentTime + AHEAD || cfg.burst) { await app(sbs[i], await getBuf(segUrl(t, k), cfg)); k++; if (i === 0) st.segs = k; }
          else await new Promise((res) => setTimeout(res, 250));
          if (i === 0 && k === 1) v.play().catch(() => {});
        }
      }));
      st.done = true;
      if (!gone() && ms.readyState === 'open' && max === Infinity) ms.endOfStream();
    } catch (e) { st.err = String(e && e.message || e); }
    return st;
  };
})();
