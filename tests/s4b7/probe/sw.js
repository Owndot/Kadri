// S4b-7a Messsonde – Hintergrund. webRequest NUR beobachtend: kein Blocking, keine Header (kein extraInfoSpec), keine Bodies.
// Gespeichert wird nie eine Adresse oder ein Query-Wert, nur Klassen (Host-Klasse, Szenario, Dateiart, Darstellung/Nummer,
// „hat Query“) und die von Chromium gelieferten Herkunftsangaben. Begrenzter Ringpuffer im Speicher (flüchtig, kein storage).
'use strict';
const MAX = 6000, REC = [], REFETCH = new Set();
globalThis.__rec = REC;
const push = (x) => { REC.push(x); if (REC.length > MAX) REC.splice(0, REC.length - MAX); };
const hostCls = (h) => (h === '127.0.0.1' ? 'front' : h === 'cdn.example.org' ? 'cdn' : 'other');
function cls(u) {
  try {
    const x = new URL(u);
    const parts = x.pathname.split('/'), file = parts[parts.length - 1] || '';
    let kind = 'other';
    let m;
    if (/\.mpd$/.test(file)) kind = 'mpd';
    else if ((m = /^init-(\d+)\.m4s$/.exec(file))) kind = 'init:' + m[1];
    else if ((m = /^chunk-(\d+)-0*(\d+)\.m4s$/.exec(file))) kind = 'seg:' + m[1] + ':' + m[2];
    else if (parts[1] === 'clock') kind = 'clock:' + (x.searchParams.get('i') || '').replace(/[^a-z0-9-]/gi, '').slice(0, 16);
    else kind = 'res:' + (file.split('.').pop() || '').slice(0, 5);
    return { host: hostCls(x.hostname), scen: parts[1] === 'm' ? (parts[2] || '').slice(0, 16) : '', kind: kind, q: x.search.length > 1 };
  } catch (e) { return { host: '?', scen: '', kind: '?', q: false }; }
}
const orig = (o) => { if (!o) return o === undefined ? undefined : null; if (o === 'null') return 'null'; try { return hostCls(new URL(o).hostname); } catch (e) { return '?'; } };
const FILTER = { urls: ['http://127.0.0.1/*', 'http://cdn.example.org/*'] };
const base = (ev, d) => Object.assign({ ev: ev, rid: d.requestId, tab: d.tabId, frame: d.frameId, pframe: d.parentFrameId, doc: d.documentId,
  pdoc: d.parentDocumentId, ftype: d.frameType, life: d.documentLifecycle, init: orig(d.initiator), type: d.type, method: d.method, ts: d.timeStamp, rx: Date.now() }, cls(d.url));
chrome.webRequest.onBeforeRequest.addListener((d) => { push(base('req', d)); }, FILTER);
chrome.webRequest.onBeforeRedirect.addListener((d) => { push(Object.assign(base('redir', d), { status: d.statusCode, fromCache: d.fromCache, to: cls(d.redirectUrl) })); }, FILTER);
chrome.webRequest.onCompleted.addListener((d) => {
  const r = Object.assign(base('done', d), { status: d.statusCode, fromCache: d.fromCache });
  push(r);
  // Machbarkeit Manifest-Lesen: das beobachtete MPD EINMAL je (Tab, Dokument, Szenario) von genau dem Dokument, dem webRequest den
  // Abruf zuordnet, ohne Cookies neu laden lassen (cs.js). Die Adresse geht nur flüchtig als Nachricht dorthin, nie in __rec.
  if (r.kind !== 'mpd' || d.tabId < 0 || !d.documentId || d.statusCode !== 200) return;
  const key = d.tabId + '|' + d.documentId + '|' + r.scen;
  if (REFETCH.has(key) || REFETCH.size > 64) return;
  REFETCH.add(key);
  const note = (res) => push({ ev: 'refetch', tab: d.tabId, frame: d.frameId, doc: d.documentId, host: r.host, scen: r.scen, kind: r.kind, q: r.q, rx: Date.now(), res: res });
  chrome.tabs.sendMessage(d.tabId, { op: 'refetch', url: d.url }, { documentId: d.documentId }).then((res) => note(res || { err: 'leer' }),
    (e) => note({ err: 'msg:' + String((e && e.message) || e).slice(0, 60) }));
}, FILTER);
chrome.webRequest.onErrorOccurred.addListener((d) => { push(Object.assign(base('err', d), { error: String(d.error || '').slice(0, 40) })); }, FILTER);
// Meldungen der Inhaltsskripte: die Herkunft (Tab, Frame, Dokument) kommt aus sender – nie aus der Meldung selbst
chrome.runtime.onMessage.addListener((m, sender) => {
  if (!m || typeof m !== 'object') return;
  push({ ev: 'ctx', tab: sender.tab ? sender.tab.id : -1, frame: sender.frameId, doc: sender.documentId, life: sender.documentLifecycle,
    origin: orig(sender.origin), rx: Date.now(), m: m });
});
