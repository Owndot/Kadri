// S4b-7a Messsonde – Seitenwelt: Medienereignisse je Videoelement und MSE-Anhänge (Länge + SHA-256-Präfix), keine Adressen.
// Nur für die Machbarkeitsstudie; nicht Teil von Kadri. Zeiten: Date.now() und performance.timeOrigin + performance.now().
(() => {
  'use strict';
  if (window.__kprobe) return; window.__kprobe = 1;
  const emit = (d) => { try { document.dispatchEvent(new CustomEvent('kprobe', { detail: Object.assign({ t: Date.now(), tp: performance.timeOrigin + performance.now() }, d) })); } catch (e) {} };
  const vids = new WeakMap(); let nv = 0;
  const vid = (v) => { if (!vids.has(v)) vids.set(v, ++nv); return vids.get(v); };
  const msIds = new WeakMap(), blobMs = new Map(); let nms = 0;
  const msId = (ms) => { if (!msIds.has(ms)) msIds.set(ms, ++nms); return msIds.get(ms); };
  const C = URL.createObjectURL;
  URL.createObjectURL = function (o) { const u = C.apply(this, arguments); try { if (window.MediaSource && o instanceof MediaSource) blobMs.set(u, msId(o)); } catch (e) {} return u; };
  const srcKind = (v) => { try { if (v.srcObject) return 'obj:' + (v.srcObject.constructor && v.srcObject.constructor.name || '?'); const s = v.currentSrc || v.src || ''; return blobMs.has(s) ? 'ms:' + blobMs.get(s) : s.slice(0, 5); } catch (e) { return '?'; } };
  ['loadstart', 'emptied', 'playing', 'ended'].forEach((ty) => document.addEventListener(ty, (e) => {
    const v = e.target; if (!(v instanceof HTMLMediaElement)) return; emit({ ev: 'media', type: ty, vid: vid(v), el: /^v\d$/.test(v.id) ? v.id : '', src: srcKind(v), ct: Math.round(v.currentTime * 1000) });
  }, true));
  if (window.SourceBuffer && window.MediaSource) {
    const sbMs = new WeakMap(), A = MediaSource.prototype.addSourceBuffer, AB = SourceBuffer.prototype.appendBuffer;
    MediaSource.prototype.addSourceBuffer = function () { const sb = A.apply(this, arguments); sbMs.set(sb, msId(this)); return sb; };
    let seq = 0;
    SourceBuffer.prototype.appendBuffer = function (data) {
      try {
        const n = ++seq, ms = sbMs.get(this) || 0, t = Date.now();
        const view = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const t0 = performance.now();
        if (window.crypto && crypto.subtle) {   // nur in sicheren Kontexten (HTTPS, localhost)
          crypto.subtle.digest('SHA-256', view.slice()).then((h) => {
            const hex = Array.from(new Uint8Array(h).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
            emit({ ev: 'append', seq: n, ms: ms, len: view.byteLength, h: hex, hf: 'sha', at: t, hashMs: Math.round((performance.now() - t0) * 100) / 100 });
          }, () => {});
        } else {   // unsicherer Kontext (http-Rahmen): kein crypto.subtle – synchron FNV-1a (32 Bit) + Länge
          let x = 0x811c9dc5;
          for (let i = 0; i < view.length; i++) { x ^= view[i]; x = Math.imul(x, 0x01000193) >>> 0; }
          emit({ ev: 'append', seq: n, ms: ms, len: view.byteLength, h: 'f' + x.toString(16).padStart(8, '0') + ':' + view.byteLength, hf: 'fnv', at: t, hashMs: Math.round((performance.now() - t0) * 100) / 100 });
        }
      } catch (e) {}
      return AB.apply(this, arguments);
    };
  }
  // Abrufe dieses Dokuments mit Zeit des Absendens (für die Uhrenprüfung gegen webRequest-Zeitstempel): nur Marker-Abrufe /clock
  const F = window.fetch;
  window.fetch = function (u) { try { const s = String(u && u.url || u); if (/\/clock\?/.test(s)) emit({ ev: 'fetch', mark: (s.match(/i=([a-z0-9-]+)/i) || [])[1] || '' }); } catch (e) {} return F.apply(this, arguments); };
})();
