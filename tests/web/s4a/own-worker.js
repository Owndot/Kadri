// Kadri S4a – Worker des Testplayers own.js: lädt Texte/Stücke (mode 'worker') oder spielt selbst über MSE im Worker
// (mode 'wmse'). Abrufe hier erscheinen NICHT in der Resource-Timing-Zeitleiste des Fensters.
'use strict';
let now = 0;
self.onmessage = async (e) => {
  const d = e.data || {};
  if (d.op === 'time') { now = d.t; return; }
  if (d.op === 'text' || d.op === 'buf') {
    try {
      const r = await fetch(d.url, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (d.op === 'text') self.postMessage({ id: d.id, url: r.url, text: await r.text() });
      else { const b = await r.arrayBuffer(); self.postMessage({ id: d.id, url: r.url, buf: b }, [b]); }
    } catch (x) { self.postMessage({ id: d.id, err: String(x && x.message || x) }); }
    return;
  }
  if (d.op === 'play') {
    try {
      const ms = new MediaSource();
      self.postMessage({ ev: 'handle', handle: ms.handle }, [ms.handle]);
      await new Promise((res) => ms.addEventListener('sourceopen', res, { once: true }));
      const sbs = d.tracks.map((t) => ms.addSourceBuffer(t.mime + '; codecs="' + t.codecs + '"'));
      ms.duration = d.dur;
      const app = (sb, b) => new Promise((res, rej) => { sb.addEventListener('updateend', res, { once: true }); sb.addEventListener('error', rej, { once: true }); sb.appendBuffer(b); });
      const get = async (u) => { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); };
      await Promise.all(d.tracks.map(async (t, i) => {
        await app(sbs[i], await get(t.init));
        let k = 0;
        while (k < t.segs.length) {
          if (t.segs[k].t0 < now + d.ahead) { await app(sbs[i], await get(t.segs[k].url)); k++; if (i === 0) self.postMessage({ ev: 'seg', n: k }); }
          else await new Promise((res) => setTimeout(res, 250));
        }
      }));
      if (ms.readyState === 'open') ms.endOfStream();
      self.postMessage({ ev: 'done' });
    } catch (x) { self.postMessage({ ev: 'err', err: String(x && x.message || x) }); }
  }
};
