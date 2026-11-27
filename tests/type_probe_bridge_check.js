// Angemeldete Typprobe im Hintergrund (chrome/background.js, Port kadri-xhr, Zweck media-type-probe) ohne Browser:
// echter Hintergrundcode mit nachgebauter Browser-Schnittstelle (wie guard_check.js). Ergänzt den End-zu-Ende-Prüfer
// tests/test_p0a_auth_type_probe_ext.py um Vertragsdetails, die dort nicht beobachtbar sind: feste Anfrage, PSL-Grenzen,
// Absender, Lesegrenze im Hintergrund, Form der Antwortnachricht, Regeln nach Erfolg, Fehler und Zeitüberschreitung.
//   node tests/type_probe_bridge_check.js chrome/background.js
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const file = process.argv[2] || path.join(__dirname, '..', 'chrome', 'background.js');
let onConnect = null;
const ev = () => ({ addListener() {} });
const rules = new Map();
const calls = [];
let respond = null;   // (url, opts) => Antwort
const chrome = { runtime: { id: 'x', getURL: (p) => 'chrome-extension://x/' + p, onConnect: { addListener: (f) => { onConnect = f; } }, onMessage: ev(), onInstalled: ev(), onStartup: ev() },
  action: { onClicked: ev() }, tabs: { onRemoved: ev(), sendMessage() {} }, storage: { local: { get: async () => ({}), set: async () => {} }, session: { get: async () => ({}), set: async () => {} } },
  declarativeNetRequest: {
    updateSessionRules: async (o) => { (o.removeRuleIds || []).forEach((id) => rules.delete(id)); (o.addRules || []).forEach((r) => rules.set(r.id, JSON.parse(JSON.stringify(r)))); },
    getSessionRules: async () => Array.from(rules.values()).map((r) => JSON.parse(JSON.stringify(r))) }, scripting: {} };
const ctx = { chrome, globalThis: null, console, URL, AbortController, setTimeout, clearTimeout, btoa, atob, TextEncoder, TextDecoder,
  fetch: (u, o) => {
    const strip = rules.get(80);
    const c = { u, o: Object.assign({}, o, { signal: undefined }), excluded: (strip && strip.condition.excludedRequestDomains) || [], signal: o.signal };
    calls.push(c);
    return respond(u, o, c);
  } };
ctx.globalThis = ctx;
vm.createContext(ctx);
const PSL = path.join(path.dirname(file), '..', 'vendor', 'psl.js');
ctx.importScripts = (...fl) => fl.forEach((f) => { if (!/^channel\//.test(f)) vm.runInContext(fs.readFileSync(f === 'psl.js' ? PSL : f, 'utf8'), ctx); });
vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);

// Antwortkörper als Strom: n Stücke zu je size Bytes, Kopf head; zählt gelesene Stücke und Abbruch
function body(head, size, n, stats) {
  let i = 0;
  return { getReader: () => ({
    read: async () => {
      if (i >= n) return { done: true };
      const u8 = new Uint8Array(size);
      if (i === 0) u8.set(head.subarray(0, Math.min(size, head.length)));
      i++; stats.reads = i;
      return { done: false, value: u8 };
    },
    cancel: async () => { stats.cancelled = true; },
  }) };
}
const enc = (s) => new TextEncoder().encode(s);
const FTYP = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const EBML = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f]);
function answer(status, head, opt = {}) {
  return (u, o, c) => {
    c.stats = { reads: 0, cancelled: false };
    if (opt.never) return new Promise((res, rej) => { o.signal.addEventListener('abort', () => rej(new Error('abgebrochen'))); });
    if (opt.throws) return Promise.reject(new TypeError('Failed to fetch'));
    o.signal.addEventListener('abort', () => { c.stats.aborted = true; });
    return Promise.resolve({ status, statusText: '', url: opt.final || u, headers: new Map([['content-type', 'video/mp4']]),
      body: body(head, opt.size || 65536, opt.chunks || 1, c.stats), text: async () => { c.stats.full = true; return ''; },
      arrayBuffer: async () => { c.stats.full = true; return new ArrayBuffer(0); } });
  };
}
function req(sender, m, wait = 600) {
  return new Promise((res) => {
    const msgs = [];
    const port = { name: 'kadri-xhr', sender, postMessage: (x) => { msgs.push(x); if (x.t === 'type' || x.t === 'done' || x.t === 'error') res(msgs); },
      onDisconnect: { addListener() {} }, onMessage: { addListener: (f) => { port._f = f; } } };
    onConnect(port);
    port._f(m);
    setTimeout(() => res(msgs), wait);
  });
}
const tab = (url) => ({ url, tab: { id: 7, url }, id: 'x', frameId: 0 });
const probe = (url, extra) => Object.assign({ t: 'req', purpose: 'media-type-probe', url }, extra || {});
const out = [];
const ok = (name, cond, info) => { out.push(cond); console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond ? '' : '  – ' + JSON.stringify(info))); };
const temp = () => Array.from(rules.keys()).filter((id) => id >= 1000 && id <= 900000);
const NONE = { o: {}, excluded: [], stats: {} };
const lastSince = (n) => (calls.length > n ? calls[calls.length - 1] : NONE);
const strip = () => (rules.get(80) || { condition: {} }).condition.excludedRequestDomains || [];

(async () => {
  await new Promise((r) => setTimeout(r, 50));
  // ---------- Erfolg: fester Vertrag, nur Typ zurück ----------
  respond = answer(206, FTYP);
  let n0 = calls.length;
  let msgs = await req(tab('https://www.example.com/watch'), probe('https://cdn.example.com/v.mp4?sig=1',
    { method: 'POST', headers: { Cookie: 'a=1', Authorization: 'Bearer x', Referer: 'https://evil.example/', Range: 'bytes=0-' }, data: 'x', anonymous: false, site: 'evil.example', responseType: 'arraybuffer', timeout: 999999 }));
  let c = lastSince(n0);
  ok('gleiche Site (Subdomain): genau ein Abruf, GET, nur Range 0-4095, credentials include, redirect error, no-store, kein Referrer',
    calls.length === n0 + 1 && c.o.method === 'GET' && JSON.stringify(c.o.headers) === '{"Range":"bytes=0-4095"}' && c.o.body === undefined &&
    c.o.credentials === 'include' && c.o.redirect === 'error' && c.o.cache === 'no-store' && c.o.referrerPolicy === 'no-referrer', c && c.o);
  ok('während des Abrufs: Regel 80 nimmt nur genau diese Site aus', JSON.stringify(c.excluded) === '["example.com"]', c.excluded);
  ok('Antwort: genau eine Nachricht {t:"type", type:"file"} – keine Köpfe, Stücke, Texte oder Adressen',
    msgs.length === 1 && JSON.stringify(msgs[0]) === '{"t":"type","type":"file"}', msgs);
  ok('nach dem Abruf: keine temporären Regeln, Regel 80 ohne Ausnahme', temp().length === 0 && strip().length === 0, { temp: temp(), strip: strip() });

  // Typen
  for (const [label, status, head, want] of [['EBML', 206, EBML, 'file'], ['#EXTM3U', 206, enc('#EXTM3U\n#EXT-X-VERSION:3\n'), 'hls'],
    ['BOM + #EXTM3U', 200, enc('﻿#EXTM3U\n'), 'hls'], ['MPD', 206, enc('<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011">'), 'dash'],
    ['HTML', 200, enc('<!doctype html><html>'), 'unknown'], ['403', 403, FTYP, 'unknown'], ['500', 500, FTYP, 'unknown'], ['404', 404, FTYP, 'unknown']]) {
    respond = answer(status, head);
    msgs = await req(tab('https://www.example.com/'), probe('https://cdn.example.com/t.mp4?case=' + encodeURIComponent(label + status)));
    ok('Klassifikation %s (HTTP %d) → %s'.replace('%s', label).replace('%d', status).replace('%s', want), msgs.length === 1 && msgs[0].t === 'type' && msgs[0].type === want, msgs);
  }

  // ---------- Lesegrenze: Range ignoriert, großer Körper ----------
  respond = answer(200, FTYP, { size: 65536, chunks: 512 });
  n0 = calls.length;
  msgs = await req(tab('https://www.example.com/'), probe('https://cdn.example.com/big.mp4'));
  c = lastSince(n0);
  ok('Range ignoriert (32 MiB in 64-KiB-Stücken): nach dem ersten Stück abgebrochen, Leser beendet, kein Vollpuffer, Typ file',
    !!c.stats && c.stats.reads === 1 && c.stats.cancelled && c.stats.aborted && !c.stats.full && msgs.length === 1 && msgs[0].type === 'file', c.stats);
  respond = answer(206, FTYP, { size: 1000, chunks: 10 });
  n0 = calls.length;
  msgs = await req(tab('https://www.example.com/'), probe('https://cdn.example.com/small.mp4'));
  c = lastSince(n0);
  ok('kleine Stücke: höchstens 4096 Bytes gelesen (5 Stücke à 1000), dann Abbruch', c.stats.reads === 5 && c.stats.cancelled, c.stats);

  // ---------- Kein Abruf: andere Site, PSL, Schema, privat, Absender, Zugangsdaten ----------
  const refused = [
    ['andere Site', tab('https://www.example.com/'), 'https://cdn.other.net/v.mp4'],
    ['github.io: andere Unterseite', tab('https://opfer.github.io/v'), 'https://angreifer.github.io/v.mp4'],
    ['eu.org: andere Unterseite', tab('https://alice.eu.org/v'), 'https://bob.eu.org/v.mp4'],
    ['co.uk: andere Site', tab('https://www.bbc.co.uk/'), 'https://other.co.uk/v.mp4'],
    ['https-Seite, http-Quelle (Herabstufung)', tab('https://www.example.com/'), 'http://cdn.example.com/v.mp4'],
    ['http-Seite, https-Quelle (anderes Schema)', tab('http://www.example.com/'), 'https://cdn.example.com/v.mp4'],
    ['privates Ziel von öffentlicher Seite', tab('https://www.example.com/'), 'http://192.168.0.1/v.mp4'],
    ['127.0.0.1 von öffentlicher Seite', tab('https://www.example.com/'), 'http://127.0.0.1:8791/v.mp4'],
    ['Absender ohne Tab (Erweiterungsseite)', { url: 'chrome-extension://x/popup.html', id: 'x' }, 'https://cdn.example.com/v.mp4'],
    ['Absender einer anderen Erweiterung', { url: 'https://www.example.com/', tab: { id: 1 }, id: 'fremd' }, 'https://cdn.example.com/v.mp4'],
    ['Zugangsdaten in der Adresse', tab('https://www.example.com/'), 'https://u:p@cdn.example.com/v.mp4'],
    ['kein http(s)', tab('https://www.example.com/'), 'file:///etc/passwd'],
    ['Adresse ist kein Text', tab('https://www.example.com/'), { toString: () => 'https://cdn.example.com/v.mp4' }],
  ];
  for (const [label, sender, url] of refused) {
    respond = answer(206, FTYP);
    n0 = calls.length;
    msgs = await req(sender, probe(url));
    ok('kein Abruf: ' + label, calls.length === n0 && msgs.length === 1 && (msgs[0].t === 'type' ? msgs[0].type === 'unknown' : msgs[0].t === 'error') &&
      !JSON.stringify(msgs).includes('example') && !JSON.stringify(msgs).includes('github'), { fetched: calls.length - n0, msgs });
  }
  ok('nach den Ablehnungen: keine temporären Regeln, Regel 80 ohne Ausnahme', temp().length === 0 && strip().length === 0, { temp: temp(), strip: strip() });
  respond = answer(206, FTYP);
  n0 = calls.length;
  msgs = await req(tab('http://192.168.0.5:8096/web'), probe('http://192.168.0.5:8096/Videos/1.mp4'));
  ok('Seite selbst im eigenen Netz, gleiche Adresse: erlaubt (bestehende exakte Freigabe), danach zurückgesetzt',
    calls.length === n0 + 1 && msgs[0] && msgs[0].type === 'file' && temp().length === 0 && strip().length === 0, { msgs, temp: temp() });
  n0 = calls.length;
  msgs = await req(tab('http://127.0.0.1:8790/mp4.html'), probe('http://127.0.0.1:8791/videos/login.mp4?auth=1'));
  ok('IP-Seite, anderer Port derselben IP: gleiche Site, angemeldet', calls.length === n0 + 1 && lastSince(n0).o.credentials === 'include' && msgs[0] && msgs[0].type === 'file', msgs);

  // ---------- Fehler, Zeitgrenze: Regeln zurückgesetzt ----------
  respond = answer(0, FTYP, { throws: true });
  msgs = await req(tab('https://www.example.com/'), probe('https://cdn.example.com/x.mp4'));
  // (Fehlerweg: die Meldung geht vor dem finally-Zweig hinaus, der die Regeln zurücksetzt; headerGate bleibt bis dahin
  // belegt, kein anderer Abruf nutzt die Ausnahme. Darum kurz warten, dann den Endzustand prüfen.)
  await new Promise((r) => setTimeout(r, 100));
  ok('Abruf scheitert (z. B. Weiterleitung bei redirect:error): Fehlermeldung ohne Adresse, Regeln zurückgesetzt',
    msgs.length === 1 && msgs[0].t === 'error' && !/example/.test(JSON.stringify(msgs)) && temp().length === 0 && strip().length === 0, { msgs, strip: strip() });
  respond = answer(0, FTYP, { never: true });
  const t0 = Date.now();
  msgs = await req(tab('https://www.example.com/'), probe('https://cdn.example.com/slow.mp4'), 12000);
  const elapsed = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 100));
  ok('Zeitgrenze 10 s: abgebrochen (%d ms), Regeln zurückgesetzt'.replace('%d', elapsed),
    msgs.length === 1 && msgs[0].t === 'error' && msgs[0].timeout === true && elapsed < 11500 && temp().length === 0 && strip().length === 0, { msgs, strip: strip() });

  // ---------- Gedächtnis: höchstens ein angemeldeter Versuch je Adresse ----------
  for (const [label, resp, url] of [['nach Erfolg (file)', answer(206, FTYP), 'https://cdn.example.com/once-ok.mp4'],
    ['nach 403', answer(403, FTYP), 'https://cdn.example.com/once-403.mp4'], ['nach Fehler', answer(0, FTYP, { throws: true }), 'https://cdn.example.com/once-err.mp4']]) {
    respond = resp;
    n0 = calls.length;
    const first = await req(tab('https://www.example.com/'), probe(url));
    await new Promise((r) => setTimeout(r, 50));
    respond = answer(206, enc('#EXTM3U\n'));
    const again = await req(tab('https://other.example.com/'), probe(url + '#t=1'));
    const want = first[0] && first[0].t === 'type' ? first[0].type : 'unknown';
    ok('Gedächtnis %s: zweiter Versuch (anderes Dokument, Fragment) ohne Abruf, gleiches Ergebnis'.replace('%s', label),
      calls.length === n0 + 1 && again.length === 1 && !!again[0] && again[0].t === 'type' && again[0].type === want, { fetched: calls.length - n0, first, again });
  }
  respond = answer(206, FTYP);
  n0 = calls.length;
  await req(tab('https://www.other.net/'), probe('https://cdn.example.com/once-ok.mp4'));
  ok('Gedächtnis ersetzt nicht die Site-Prüfung: fremdes Dokument erhält keinen Abruf und keinen gemerkten Typ', calls.length === n0, {});

  // ---------- Normale Aufrufer unverändert ----------
  respond = (u, o, cc) => Promise.resolve({ status: 200, statusText: 'OK', url: u, headers: new Map([['content-type', 'text/plain']]), text: async () => 'ok' });
  n0 = calls.length;
  msgs = await req(tab('https://www.example.com/'), { t: 'req', method: 'GET', url: 'https://cdn.example.com/a.vtt', headers: {} });
  c = lastSince(n0);
  ok('normaler GM-Abruf unverändert: folgt Weiterleitungen, liefert head/done mit Text',
    c.o.redirect === 'follow' && msgs.some((x) => x.t === 'head') && msgs.some((x) => x.t === 'done' && x.text === 'ok'), { o: c.o, msgs: msgs.map((x) => x.t) });

  const pass = out.filter(Boolean).length;
  console.log('ERGEBNIS: %d von %d', pass, out.length);
  process.exit(pass === out.length ? 0 : 1);
})();
