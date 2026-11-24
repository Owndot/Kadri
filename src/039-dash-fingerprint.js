  // ================= DASH S3c: Strukturfingerabdruck kadri-dash-fp/1 und S3-Vorprüfung – nur lesen, nichts laden =================
  // Zweck: Kadri übergibt dem Helfer beim Plan (dashplan) den Fingerabdruck des MPD, das es an GENAU dieses Video gebunden
  // hat (Bindung nur über beobachtete Stückfolgen, src/038/060). Der Helfer lädt das MPD selbst, berechnet denselben
  // Abdruck und lehnt jede Abweichung ab (manifest_mismatch). Der Abdruck ist KEINE Bindungsevidenz und kein Geheimnis.
  // Festgelegt im Helper (DASH-S3A.md, Abschnitt 3; de.evp.helfer.dash.DashFingerprint). Hier dieselbe Auswertung:
  //  - gehärtetes Lesen wie DashXml: nur Elemente im MPD-Namensraum, jedes "<!" außer Kommentar/CDATA abgelehnt,
  //    XInclude/XLink abgelehnt, DASH-Namen in fremdem Namensraum abgelehnt, dieselben Grenzen;
  //  - Zahlen/Dauern wie DashNum (ganze Zahlen ≤ 2^53−1, xs:duration exakt), Adressen wie DashUrl/HlsUri (RFC 3986,
  //    kanonisch, fail-closed bei allem, was WHATWG anders auflösen würde), Vorlagen wie DashTemplate;
  //  - Vererbung, BaseURL-Kette und Adressierung wie DashManifest (nur die Teile, die in den Abdruck eingehen).
  // Ergebnis { fp, gate } oder { error }. Fehler heißt: kein Abdruck → kein Angebot (lieber nichts als ein falsches).
  // Vorprüfung (gate): dasselbe S3-Profil wie der Helfer (DashProfile), soweit es ohne Stückfolge entscheidbar ist –
  // statisch, eine Periode, kein ContentProtection, Dauer bekannt/begrenzt, Video fMP4/H.264 (avc1/avc3), Ton nur AAC-LC
  // (mp4a.40.2, wie es der Helfer speichert). Der Helfer prüft beim Plan alles (auch Abdeckung und Stückfolge) erneut.
  // Keine Adresse, keine Kennung verlässt diese Funktionen außer dem Abdruck (Hex) und festen Gründen.
  const DFP = Object.freeze({
    VERSION: 'kadri-dash-fp/1', NS: 'urn:mpeg:dash:schema:mpd:2011', XLINK: 'http://www.w3.org/1999/xlink',
    XINCLUDE: 'http://www.w3.org/2001/XInclude', XMLNS: 'http://www.w3.org/2000/xmlns/', UP: 'urn:mpeg:dash:schema:urlparam:2014',
    MAX_URI: 4096, SAFE: 9007199254740991, MAX_TIMESCALE: 4294967295, MAX_BANDWIDTH: 1e9, MAX_FMT: 20,
    MAX_ELEMENTS: 200000, MAX_DEPTH: 32, MAX_ATTRS: 64, MAX_ATTR: 8192, MAX_TEXT: 4096, MAX_PERIODS: 64, MAX_SETS: 1024,
    MAX_REPS: 4096, MAX_TL: 100000, MAX_LIST: 100000, MAX_RESOLVED: 200000, MAX_TOTAL_SECONDS: 48 * 3600,
    // Kadri-eigene Rechengrenze: geerbte Listen/Zeitleisten erscheinen je Darstellung erneut; darüber kein Abdruck
    MAX_LINES: 2000000,
    // S4b-8: Annex I (UrlQueryInfo) wie DashLimits des Helfers
    MAX_UP_DESCRIPTORS: 16, MAX_UP_QUERY: 2048, MAX_UP_PARAMS: 64,
  });
  const DFP_NAMES = new Set(['MPD', 'Period', 'AdaptationSet', 'Representation', 'SubRepresentation', 'ContentComponent', 'BaseURL',
    'SegmentBase', 'SegmentList', 'SegmentTemplate', 'SegmentTimeline', 'S', 'SegmentURL', 'Initialization', 'RepresentationIndex',
    'BitstreamSwitching', 'ContentProtection', 'EssentialProperty', 'SupplementalProperty', 'Role', 'Accessibility', 'Label',
    'AudioChannelConfiguration', 'Location', 'PatchLocation', 'EventStream', 'InbandEventStream', 'FailoverContent', 'Preselection',
    'ProducerReferenceTime', 'UTCTiming']);
  const dfpFail = (reason) => { const e = new Error(reason); e.dfp = reason; throw e; };
  const dfpTrim = (s) => String(s).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');   // nur XML-Leerraum (nicht JS-trim)

  // ---------- Zahlen (DashNum) ----------
  function dfpU(raw) {
    const s = dfpTrim(raw == null ? '' : raw);
    if (!/^[0-9]{1,40}$/.test(s)) dfpFail('number');
    const v = s.replace(/^0+(?=\d)/, '');
    if (v.length > 16 || BigInt(v) > BigInt(DFP.SAFE)) dfpFail('number-range');
    return Number(v);
  }
  function dfpR(raw) {
    const s = dfpTrim(raw == null ? '' : raw);
    if (s === '-1') return -1;
    if (s[0] === '-') dfpFail('number');
    return dfpU(s);
  }
  // xs:duration → exakte Sekunden als { n: BigInt (× 10^15) }; kanonisch ohne Exponent und Nachkommanullen
  const DFP_SCALE = 10n ** 15n;
  function dfpDuration(raw) {
    const s = dfpTrim(raw == null ? '' : raw);
    const m = /^P(?:([0-9]{1,12})D)?(?:T(?:([0-9]{1,12})H)?(?:([0-9]{1,12})M)?(?:([0-9]{1,15})(?:\.([0-9]{1,15}))?S)?)?$/.exec(s);
    if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined && m[4] === undefined) || s.endsWith('T')) dfpFail('duration');
    let v = BigInt(m[1] || 0) * 86400n + BigInt(m[2] || 0) * 3600n + BigInt(m[3] || 0) * 60n + BigInt(m[4] || 0);
    v = v * DFP_SCALE + (m[5] ? BigInt(m[5].padEnd(15, '0')) : 0n);
    if (v > BigInt(DFP.SAFE) * DFP_SCALE) dfpFail('number-range');
    return v;
  }
  const dfpOptDuration = (el, k) => { const v = el ? el.attr(k) : null; return v == null ? null : dfpDuration(v); };
  function dfpDurCanon(v) {
    if (v === null) return null;
    if (v === 0n) return '0';
    const i = v / DFP_SCALE, f = (v % DFP_SCALE).toString().padStart(15, '0').replace(/0+$/, '');
    return i.toString() + (f ? '.' + f : '');
  }

  // ---------- Adressen (HlsUri + DashUrl) ----------
  function dfpFirstOf(s, chars, from) { for (let i = from; i < s.length; i++) if (chars.indexOf(s[i]) >= 0) return i; return -1; }
  function dfpSplit(s) {
    const p = { scheme: null, authority: null, path: '', query: null, fragment: null };
    let i = 0;
    const n = s.length, colon = s.indexOf(':'), fd = dfpFirstOf(s, '/?#', 0);
    if (colon > 0 && (fd < 0 || colon < fd) && /^[A-Za-z][A-Za-z0-9+.-]*$/.test(s.slice(0, colon))) { p.scheme = s.slice(0, colon).toLowerCase(); i = colon + 1; }
    if (s.startsWith('//', i)) { let end = dfpFirstOf(s, '/?#', i + 2); if (end < 0) end = n; p.authority = s.slice(i + 2, end); i = end; }
    let ep = dfpFirstOf(s, '?#', i);
    if (ep < 0) ep = n;
    p.path = s.slice(i, ep); i = ep;
    if (i < n && s[i] === '?') { let end = s.indexOf('#', i); if (end < 0) end = n; p.query = s.slice(i + 1, end); i = end; }
    if (i < n && s[i] === '#') p.fragment = s.slice(i + 1);
    return p;
  }
  function dfpDots(path) {
    let inp = path;
    const segs = [];
    while (inp) {
      if (inp.startsWith('../')) inp = inp.slice(3);
      else if (inp.startsWith('./')) inp = inp.slice(2);
      else if (inp.startsWith('/./')) inp = inp.slice(2);
      else if (inp === '/.') inp = '/';
      else if (inp.startsWith('/../')) { inp = inp.slice(3); segs.pop(); }
      else if (inp === '/..') { inp = '/'; segs.pop(); }
      else if (inp === '.' || inp === '..') inp = '';
      else { const st = inp[0] === '/' ? 1 : 0; let nx = inp.indexOf('/', st); if (nx < 0) nx = inp.length; segs.push(inp.slice(0, nx)); inp = inp.slice(nx); }
    }
    return segs.join('');
  }
  const dfpCtl = (u) => { for (let i = 0; i < u.length; i++) { const c = u.charCodeAt(i); if (c <= 0x20 || c >= 0x7f) return true; } return false; };
  function dfpCheck(u) {
    if (!u || u.length > DFP.MAX_URI) dfpFail('uri-length');
    if (dfpCtl(u)) dfpFail('uri-char');
    const p = dfpSplit(u);
    if (p.scheme !== 'http' && p.scheme !== 'https') dfpFail('uri-scheme');
    if (!p.authority) dfpFail('uri-host');
    if (p.authority.indexOf('@') >= 0) dfpFail('uri-userinfo');
    if (p.fragment !== null) dfpFail('uri-fragment');
    if (!p.path || p.path[0] !== '/') dfpFail('uri-path');
  }
  function dfpRfcResolve(base, ref) {
    dfpCheck(base);
    if (!ref || ref.length > DFP.MAX_URI) dfpFail('uri-length');
    if (dfpCtl(ref)) dfpFail('uri-char');
    const b = dfpSplit(base), r = dfpSplit(ref), t = { scheme: null, authority: null, path: '', query: null };
    if (r.scheme !== null) { t.scheme = r.scheme; t.authority = r.authority; t.path = dfpDots(r.path); t.query = r.query; }
    else {
      if (r.authority !== null) { t.authority = r.authority; t.path = dfpDots(r.path); t.query = r.query; }
      else {
        if (!r.path) { t.path = b.path; t.query = r.query !== null ? r.query : b.query; }
        else {
          let merged;
          if (r.path[0] === '/') merged = r.path;
          else if (b.authority !== null && !b.path) merged = '/' + r.path;
          else { const sl = b.path.lastIndexOf('/'); merged = (sl >= 0 ? b.path.slice(0, sl + 1) : '') + r.path; }
          t.path = dfpDots(merged); t.query = r.query;
        }
        t.authority = b.authority;
      }
      t.scheme = b.scheme;
    }
    if (r.fragment !== null) dfpFail('uri-fragment');
    const out = t.scheme + ':' + (t.authority !== null ? '//' + t.authority : '') + t.path + (t.query !== null ? '?' + t.query : '');
    dfpCheck(out);
    return out;
  }
  const DFP_BAD = '"<>\\^`{|}\'#[]';
  function dfpCheckRef(ref) {
    if (!ref) dfpFail('uri-empty');
    if (ref.length > DFP.MAX_URI) dfpFail('uri-length');
    for (let i = 0; i < ref.length; i++) {
      const c = ref[i], cc = ref.charCodeAt(i);
      if (cc <= 0x20 || cc >= 0x7f) dfpFail('uri-char');
      if (DFP_BAD.indexOf(c) >= 0) dfpFail('uri-ambiguous');
      if (c === '%') {
        if (i + 2 >= ref.length || !/^[0-9A-Fa-f]{2}$/.test(ref.slice(i + 1, i + 3))) dfpFail('uri-ambiguous');
        if (ref[i + 1] === '2' && (ref[i + 2] === 'e' || ref[i + 2] === 'E')) dfpFail('uri-ambiguous');
      }
    }
    const colon = ref.indexOf(':'), sl = ref.indexOf('/'), q = ref.indexOf('?');
    const first = sl < 0 ? q : q < 0 ? sl : Math.min(sl, q);
    if (colon > 0 && (first < 0 || colon < first) && /^[A-Za-z][A-Za-z0-9+.-]*$/.test(ref.slice(0, colon)) && !ref.startsWith('//', colon + 1)) dfpFail('uri-ambiguous');
  }
  const DFP_IPV4 = /^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])){3}$/;
  function dfpCanonical(abs) {
    dfpCheck(abs);
    for (let i = 0; i < abs.length; i++) if (DFP_BAD.indexOf(abs[i]) >= 0) dfpFail('uri-ambiguous');
    const colon = abs.indexOf(':');
    const scheme = abs.slice(0, colon).toLowerCase();
    const as = colon + 3;
    let ae = as;
    while (ae < abs.length && abs[ae] !== '/' && abs[ae] !== '?') ae++;
    const auth = abs.slice(as, ae).toLowerCase();
    let rest = abs.slice(ae), host = auth, port = null;
    const pc = auth.lastIndexOf(':');
    if (pc >= 0) { host = auth.slice(0, pc); port = auth.slice(pc + 1); }
    if (!host || !/^[a-z0-9.-]{1,253}$/.test(host) || host[0] === '.' || host.indexOf('..') >= 0 || host.indexOf('%') >= 0) dfpFail('uri-host');
    let last = host.endsWith('.') ? host.slice(0, -1) : host;
    last = last.slice(last.lastIndexOf('.') + 1);
    if (last && (/[0-9]/.test(last[0]) || last.startsWith('0x')) && !DFP_IPV4.test(host)) dfpFail('uri-host');
    if (port !== null) {
      if (!/^[0-9]{1,5}$/.test(port)) dfpFail('uri-port');
      const p = Number(port);
      if (p < 1 || p > 65535) dfpFail('uri-port');
      port = String(p);
      if ((scheme === 'http' && p === 80) || (scheme === 'https' && p === 443)) port = null;
    }
    if (!rest) rest = '/';
    if (rest[0] === '?') rest = '/' + rest;
    const out = scheme + '://' + host + (port === null ? '' : ':' + port) + rest;
    if (out.length > DFP.MAX_URI) dfpFail('uri-length');
    return out;
  }
  const dfpResolve = (base, ref) => { dfpCheckRef(ref); return dfpCanonical(dfpRfcResolve(base, ref)); };
  function dfpOrigin(c) {
    const from = c.indexOf('://') + 3, s = c.indexOf('/', from), q = c.indexOf('?', from);
    const end = s < 0 ? q : q < 0 ? s : Math.min(s, q);
    return end < 0 ? c : c.slice(0, end);
  }

  // ---------- Vorlagen (DashTemplate; die Ersetzung selbst ist dashTplExpand aus src/038) ----------
  function dfpMedia(tpl, id, bw, base) {
    const e = dashTplExpand(tpl, id, String(bw), true, '\u0001');
    if (!e) dfpFail(dfpTplReason(tpl, id, true));
    const mark = dashMark(e.text, base), nines = mark.slice(1, -1);
    const resolved = dfpResolve(base, e.text.replace('\u0001', mark));
    const n9 = resolved.indexOf(nines);
    if (n9 < 1 || !resolved.startsWith(mark, n9 - 1)) dfpFail('template');
    const at = n9 - 1;
    if (at < resolved.indexOf('://') + 3 || at < dfpOrigin(resolved).length) dfpFail('template');
    const pre = resolved.slice(0, at), suf = resolved.slice(at + mark.length);
    return { kind: e.kind, width: e.width, pre: pre, suf: suf, canon: pre + '{' + (e.kind === 'number' ? 'Number' : 'Time') + (e.width > 0 ? ':' + String(e.width).padStart(2, '0') : '') + '}' + suf };
  }
  function dfpInit(tpl, id, bw, base) {
    const e = dashTplExpand(tpl, id, String(bw), false, '');
    if (!e) dfpFail(dfpTplReason(tpl, id, false));
    return dfpResolve(base, e.text);
  }
  // Grund wie beim Helper: ungültige ID nur dann "rep-id", wenn die Vorlage sonst gültig wäre
  const dfpTplReason = (tpl, id, media) => (dashTplExpand(tpl, 'x', '0', media, '\u0001') ? 'rep-id' : 'template');

  // ---------- gehärtetes Lesen (DashXml) aus dem DOMParser-Baum ----------
  function dfpPrescan(text) {
    let i = -1;
    while ((i = text.indexOf('<!', i + 1)) >= 0) {
      if (text.startsWith('<!--', i)) { const e = text.indexOf('-->', i + 4); if (e < 0) dfpFail('xml'); i = e + 2; continue; }
      if (text.startsWith('<![CDATA[', i)) { const e = text.indexOf(']]>', i + 9); if (e < 0) dfpFail('xml'); i = e + 2; continue; }
      dfpFail('doctype');
    }
  }
  function dfpEl(name, attrs) {
    return { name: name, attrs: attrs, kids: [], text: null, s: null, sCount: 0, listMedia: null, listRange: null, entryExtra: false, foreignKids: false,
      attr(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
      all(n) { return this.kids.filter((k) => k.name === n); } };
  }
  function dfpTree(doc) {
    const top = doc.documentElement;
    if (!top || top.namespaceURI !== DFP.NS || top.localName !== 'MPD') dfpFail('not-mpd');
    const cnt = { elements: 0, timeline: 0, list: 0 };
    const attrsOf = (el) => {
      if (el.attributes.length > DFP.MAX_ATTRS) dfpFail('attrs');
      const m = new Map();
      for (let i = 0; i < el.attributes.length; i++) {
        const a = el.attributes[i], ns = a.namespaceURI, ln = a.localName || a.name, v = a.value;
        if (v.length > DFP.MAX_ATTR) dfpFail('attr-length');
        if (ns === DFP.XLINK) dfpFail('xlink');
        if (ns === DFP.XMLNS || ln.startsWith('xmlns')) continue;
        m.set(ns ? '{' + ns + '}' + ln : ln, v);
      }
      return m;
    };
    // parent: dfpEl oder null (fremdes Element); depth wie der Stapel des Helfers
    const visit = (el, parent, depth) => {
      if (++cnt.elements > DFP.MAX_ELEMENTS) dfpFail('limits');
      if (depth > DFP.MAX_DEPTH) dfpFail('depth');
      if (el.namespaceURI === DFP.XINCLUDE) dfpFail('xinclude');
      const attrs = attrsOf(el);
      const dash = el.namespaceURI === DFP.NS, local = el.localName;
      let me = null;
      if (!dash) {
        if (DFP_NAMES.has(local)) dfpFail('namespace');
        // S4b-8: Annex I – Elemente im urlparam-Namensraum als Kind eines Descriptors bleiben erhalten („{ns}lokal“, wie DashXml)
        if (el.namespaceURI === DFP.UP && parent && (parent.name === 'EssentialProperty' || parent.name === 'SupplementalProperty')) {
          me = dfpEl('{' + DFP.UP + '}' + local, attrs);
          parent.kids.push(me);
        } else if (parent) parent.foreignKids = true;
      }
      else if (!parent || parent.name.charAt(0) === '{') dfpFail('namespace');
      else if (local === 'S') {
        if (parent.name !== 'SegmentTimeline') dfpFail('structure');
        if (++cnt.timeline > DFP.MAX_TL) dfpFail('limits');
        attrs.forEach((v, k) => { if (k !== 't' && k !== 'd' && k !== 'r') parent.entryExtra = true; });
        const t = attrs.has('t') ? dfpU(attrs.get('t')) : null;
        if (!attrs.has('d')) dfpFail('timeline-attr');
        const d = dfpU(attrs.get('d')), r = attrs.has('r') ? dfpR(attrs.get('r')) : 0;
        (parent.s = parent.s || []).push(t, d, r);
        parent.sCount++;
        me = dfpEl('S', attrs);
      } else if (local === 'SegmentURL') {
        if (parent.name !== 'SegmentList') dfpFail('structure');
        if (++cnt.list > DFP.MAX_LIST) dfpFail('limits');
        attrs.forEach((v, k) => { if (k !== 'media' && k !== 'mediaRange') parent.entryExtra = true; });
        if (!parent.listMedia) { parent.listMedia = []; parent.listRange = []; }
        parent.listMedia.push(attrs.has('media') ? attrs.get('media') : null);
        parent.listRange.push(attrs.has('mediaRange') ? attrs.get('mediaRange') : null);
        me = dfpEl('SegmentURL', attrs);
      } else {
        if (parent.name === 'S' || parent.name === 'SegmentURL') dfpFail('structure');
        me = dfpEl(local, attrs);
        parent.kids.push(me);
      }
      if (me && (local === 'BaseURL' || local === 'Label') && dash) {
        let t = '';
        for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 || c.nodeType === 4) t += c.nodeValue;
        if (t.length > DFP.MAX_TEXT) dfpFail('text-length');
        me.text = t;
      }
      for (let c = el.firstElementChild; c; c = c.nextElementSibling) visit(c, me, depth + 1);
    };
    if (++cnt.elements > DFP.MAX_ELEMENTS) dfpFail('limits');
    const root = dfpEl('MPD', attrsOf(top));
    for (let c = top.firstElementChild; c; c = c.nextElementSibling) visit(c, root, 2);
    return root;
  }

  // ---------- Modell (DashManifest, soweit für Abdruck und Vorprüfung nötig) ----------
  const DFP_BASEURL_ATTRS = new Set(['serviceLocation', 'availabilityTimeOffset', 'availabilityTimeComplete']);
  const DFP_SEG_KNOWN = new Set(['media', 'initialization', 'timescale', 'presentationTimeOffset', 'startNumber', 'duration', 'availabilityTimeOffset', 'availabilityTimeComplete']);
  const DFP_SEG_UNSUPPORTED = new Set(['index', 'indexRange', 'indexRangeExact', 'bitstreamSwitching', 'presentationDuration', 'eptDelta', 'pdDelta', 'endNumber']);
  const DFP_SEG_KIDS_UNSUPPORTED = new Set(['RepresentationIndex', 'BitstreamSwitching', 'FailoverContent']);
  const DFP_SEG = ['SegmentBase', 'SegmentList', 'SegmentTemplate'];
  function dfpProps(e, name) {
    return e.all(name).map((p) => {
      let extra = null;
      p.attrs.forEach((v, k) => { if (k.charAt(0) === '{' && k.endsWith('}default_KID')) extra = v; });
      return { scheme: p.attr('schemeIdUri'), value: p.attr('value'), extra: extra };
    });
  }
  // ---------- S4b-8: Annex I (UrlQueryInfo) wie DashUrlParam des Helfers ----------
  // Minimalform: Essential-/SupplementalProperty (Period nur Supplemental) mit schemeIdUri urn:mpeg:dash:urlparam:2014, ohne @value,
  // genau ein Kind UrlQueryInfo mit genau queryTemplate="$querypart$" und useMPDUrlQuery="true"/"1". Wirkung: die Query der
  // endgültigen MPD-Adresse wird unverändert an jede Init-/Stückadresse der Darstellungen darunter gehängt. Alles andere aus der
  // Familie (2016/2025, urn:mpeg:dash:state:, ExtUrlQueryInfo, queryString, $query:…$, Kinder, fremde Attribute, andere Stellen,
  // mehrere entlang einer Kette) ist fatal mit festem Grund. Ohne Descriptor wird nie eine Query übernommen.
  const DFP_UP_SCHEME = 'urn:mpeg:dash:urlparam:2014';
  const dfpUpFamily = (s) => s !== null && (s.startsWith('urn:mpeg:dash:urlparam:') || s.startsWith('urn:mpeg:dash:state:'));
  const dfpUpIs = (e) => (e.name === 'EssentialProperty' || e.name === 'SupplementalProperty') && dfpUpFamily(e.attr('schemeIdUri'));
  const dfpUpOwn = (e) => e.kids.filter(dfpUpIs);
  function dfpUpCount(e) { let n = dfpUpIs(e) ? 1 : 0; e.kids.forEach((k) => { n += dfpUpCount(k); }); return n; }
  function dfpUpCheck(d) {
    if (d.attr('schemeIdUri') !== DFP_UP_SCHEME) dfpFail('urlparam-unsupported');
    d.attrs.forEach((v, k) => { if (k !== 'schemeIdUri' && k !== 'id') dfpFail('urlparam-unsupported'); });
    if (d.foreignKids || d.kids.length !== 1 || d.kids[0].name !== '{' + DFP.UP + '}UrlQueryInfo') dfpFail('urlparam-unsupported');
    const q = d.kids[0];
    if (q.foreignKids || q.kids.length) dfpFail('urlparam-unsupported');
    q.attrs.forEach((v, k) => { if (k !== 'queryTemplate' && k !== 'useMPDUrlQuery') dfpFail('urlparam-unsupported'); });
    const use = q.attr('useMPDUrlQuery');
    if (use !== 'true' && use !== '1') dfpFail('urlparam-unsupported');
    if (q.attr('queryTemplate') !== '$querypart$') dfpFail('urlparam-template');
  }
  // → { query, at: Set der Elemente mit wirksamem Descriptor } (at leer: keine Wirkung)
  function dfpUrlParam(root, doc) {
    const none = { query: '', at: new Set() };
    const total = dfpUpCount(root);
    if (!total) return none;
    if (total > DFP.MAX_UP_DESCRIPTORS) dfpFail('urlparam-limits');
    const placed = dfpUpOwn(root).map((d) => [d, root]);
    root.all('Period').forEach((pe) => {
      dfpUpOwn(pe).forEach((d) => { if (d.name === 'EssentialProperty') dfpFail('urlparam-unsupported'); placed.push([d, pe]); });
      pe.all('AdaptationSet').forEach((ae) => {
        dfpUpOwn(ae).forEach((d) => placed.push([d, ae]));
        ae.all('Representation').forEach((re) => dfpUpOwn(re).forEach((d) => placed.push([d, re])));
      });
    });
    if (placed.length !== total) dfpFail('urlparam-unsupported');
    placed.forEach((x) => dfpUpCheck(x[0]));
    const m = dfpUpOwn(root).length;
    if (m > 1) dfpFail('urlparam-conflict');
    root.all('Period').forEach((pe) => {
      const p = dfpUpOwn(pe).length;
      if (p > 1 || (m + p > 1 && p > 0)) dfpFail('urlparam-conflict');
      pe.all('AdaptationSet').forEach((ae) => {
        const a = dfpUpOwn(ae).length;
        if (a > 1 || (m + p + a > 1 && a > 0)) dfpFail('urlparam-conflict');
        ae.all('Representation').forEach((re) => {
          const r = dfpUpOwn(re).length;
          if (r > 1 || (m + p + a + r > 1 && r > 0)) dfpFail('urlparam-conflict');
        });
      });
    });
    const qm = doc.indexOf('?'), q = qm < 0 ? '' : doc.slice(qm + 1);
    if (q.length > DFP.MAX_UP_QUERY) dfpFail('urlparam-limits');
    if (q && q.split('&').length > DFP.MAX_UP_PARAMS) dfpFail('urlparam-limits');
    for (let i = 0; i < q.length; i++) {
      const c = q.charCodeAt(i);
      if (c <= 0x20 || c >= 0x7f || DFP_BAD.indexOf(q[i]) >= 0) dfpFail('urlparam-query');
      if (q[i] === '%' && !/^%[0-9A-Fa-f]{2}/.test(q.slice(i, i + 3))) dfpFail('urlparam-query');
    }
    return { query: q, at: new Set(placed.map((x) => x[1])) };
  }
  const dfpUpFor = (up, chain) => (up.at.size && chain.some((e) => up.at.has(e)) ? up.query : null);
  // Query an eine Adresse hängen: „?“, bzw. „&“ hinter einer vorhandenen Query; null/leer: unverändert (DashUrlParam.append)
  const dfpUpAppend = (u, q) => (q === null || q === '' || u === null ? u : u + (u.indexOf('?') >= 0 ? '&' : '?') + q);

  // ---------- S4b-6: mehrere BaseURL (Alternativen) wie DashManifest/BaseSelection des Helfers ----------
  // Auswahl: je Element mit MEHREREN BaseURL der Index der gewählten – „m:1;p0:0;s3:1;r7:0“ (Schlüssel m, p<Periode>, s<Set>,
  // r<Darstellung>, Nummern über alle Perioden in Dokumentreihenfolge; aufsteigend, je einmal). sel: null = mehrere BaseURL
  // fatal (wie bisher), DFP_FIRST = jeweils die erste (Abdruck, Vorprüfung vor der Bindung), sonst dfpSelection(alt).
  const DFP_ALT = Object.freeze({ PER_ELEMENT: 8, COMBINATIONS: 16, ENTRIES: 64, CHARS: 512 });
  const DFP_FIRST = Object.freeze({ first: true });
  const dfpSelOrder = (a, b) => { const ka = 'mpsr'.indexOf(a[0]), kb = 'mpsr'.indexOf(b[0]); return ka !== kb ? ka - kb : a.length === 1 ? 0 : Number(a.slice(1)) - Number(b.slice(1)); };
  function dfpSelection(alt) {
    if (typeof alt !== 'string' || !alt || alt.length > DFP_ALT.CHARS) dfpFail('alt-invalid');
    const pick = new Map();
    let prev = null;
    alt.split(';').forEach((e) => {
      const x = /^(m|[psr](?:0|[1-9][0-9]{0,3})):(0|[1-9])$/.exec(e);
      if (!x || pick.has(x[1]) || (prev !== null && dfpSelOrder(prev, x[1]) >= 0)) dfpFail('alt-invalid');
      pick.set(x[1], Number(x[2])); prev = x[1];
      if (pick.size > DFP_ALT.ENTRIES) dfpFail('alt-invalid');
    });
    return { first: false, pick: pick, used: new Set() };
  }
  function dfpChoose(sel, key, count) {
    if (sel.first) return 0;
    if (!sel.pick.has(key)) return -1;
    const i = sel.pick.get(key);
    if (i >= count) dfpFail('alt-invalid');
    sel.used.add(key);
    return i;
  }
  function dfpRawBases(e) {
    const b = e.all('BaseURL');
    if (b.length > DFP_ALT.PER_ELEMENT) dfpFail('baseurl-limits');
    return b.map((x) => {
      x.attrs.forEach((v, k) => { if (k.charAt(0) !== '{' && !DFP_BASEURL_ATTRS.has(k)) dfpFail('baseurl-attr'); });
      const t = dfpTrim(x.text || '');
      if (!t) dfpFail('baseurl-empty');
      return t;
    });
  }
  // Basis einer Ebene: keine → äußere; eine → aufgelöst; mehrere → ohne Auswahl fatal, sonst die gewählte (null = unbestimmt)
  function dfpBaseOf(outer, raw, key, sel) {
    if (!raw.length) return outer;
    if (raw.length === 1) return outer === null ? null : dfpResolve(outer, raw[0]);
    if (!sel) dfpFail('baseurl-multiple');
    const i = dfpChoose(sel, key, raw.length);
    if (i < 0 || outer === null) return null;
    return dfpResolve(outer, raw[i]);
  }
  // alle Kombinationen der Kette auflösen, begrenzt VOR dem Zusammenfassen; Ergebnis: Zahl verschiedener Basen
  function dfpCombinations(doc, chain) {
    let cur = [doc];
    chain.forEach((raw) => {
      if (!raw.length) return;
      if (cur.length * raw.length > DFP_ALT.COMBINATIONS) dfpFail('baseurl-limits');
      const next = [];
      cur.forEach((b) => raw.forEach((t) => next.push(dfpResolve(b, t))));
      cur = next;
    });
    return new Set(cur).size;
  }
  function dfpSegKinds(e) { if (DFP_SEG.reduce((n, k) => n + e.all(k).length, 0) > 1) dfpFail('addressing-multiple'); }
  const dfpSeg = (e) => e.kids.find((k) => DFP_SEG.indexOf(k.name) >= 0) || null;
  const dfpInherit = (segs, k) => { for (const s of segs) if (s && s.attr(k) !== null) return s.attr(k); return null; };
  const dfpNum = (v) => (v === null ? null : dfpU(v));

  function dfpAddressing(r, chain, ctx) {
    const segs = chain.map(dfpSeg), kinds = new Set(segs.filter(Boolean).map((s) => s.name));
    r.segLevels = 'rep:' + (segs[0] ? segs[0].name : '-') + ',set:' + (segs[1] ? segs[1].name : '-') + ',period:' + (segs[2] ? segs[2].name : '-');
    if (kinds.size > 1) dfpFail('addressing-mixed');
    const extra = [];
    for (const s of segs) {
      if (!s) continue;
      s.attrs.forEach((v, k) => {
        if (k.charAt(0) === '{') return;
        if (DFP_SEG_UNSUPPORTED.has(k)) { if (extra.indexOf(k) < 0) extra.push(k); return; }
        if (!DFP_SEG_KNOWN.has(k)) dfpFail('addressing-attr');
      });
      if (s.entryExtra) dfpFail('addressing-attr');
      s.kids.forEach((k) => { if (DFP_SEG_KIDS_UNSUPPORTED.has(k.name) && extra.indexOf(k.name) < 0) extra.push(k.name); });
      if (s.attr('initialization') !== null && s.all('Initialization').length) dfpFail('addressing-ambiguous');
      if (s.all('Initialization').length > 1 || s.all('SegmentTimeline').length > 1) dfpFail('addressing-multiple');
      s.all('Initialization').forEach((ini) => ini.attrs.forEach((v, k) => { if (k.charAt(0) !== '{' && k !== 'sourceURL' && k !== 'range') dfpFail('addressing-attr'); }));
    }
    r.templateExtra = extra;
    r.timescale = dfpNum(dfpInherit(segs, 'timescale'));
    r.pto = dfpNum(dfpInherit(segs, 'presentationTimeOffset'));
    r.startNumber = dfpNum(dfpInherit(segs, 'startNumber'));
    r.duration = dfpNum(dfpInherit(segs, 'duration'));
    if (r.timescale !== null && (r.timescale === 0 || r.timescale > DFP.MAX_TIMESCALE)) dfpFail('number-range');
    let initTpl = null, initSrc = null;
    for (const s of segs) {
      if (!s) continue;
      if (s.attr('initialization') !== null) { initTpl = s.attr('initialization'); break; }
      const ini = s.all('Initialization');
      if (ini.length) { initSrc = ini[0].attr('sourceURL'); r.initRange = ini[0].attr('range'); break; }
    }
    let tl = null;
    for (const s of segs) if (s && s.all('SegmentTimeline').length) { tl = s.all('SegmentTimeline')[0]; break; }
    if (tl && r.duration !== null) dfpFail('addressing-ambiguous');
    if (tl) {
      tl.attrs.forEach((v, k) => { if (k.charAt(0) !== '{') dfpFail('addressing-attr'); });
      if (tl.entryExtra) dfpFail('addressing-attr');
      r.tl = tl.s || []; r.tlCount = tl.sCount;
    }
    // (S4b-5: r.addressing wie DashManifest.Addressing – Teil des Schlüssels geteilter Stückfolgen, siehe dfpExpand)
    if (!kinds.size) { r.addressing = 'SINGLE'; r.excluded = 'addressing-single'; return; }
    const kind = kinds.values().next().value;
    if (kind === 'SegmentBase') { r.addressing = 'SEGMENT_BASE'; r.excluded = 'byte-range'; return; }
    if (kind === 'SegmentTemplate') {
      const media = dfpInherit(segs, 'media');
      if (initTpl !== null) r.initUrl = dfpUpAppend(dfpInit(initTpl, r.id, r.bandwidth, r.base), r.urlQuery);
      else if (initSrc !== null) r.initUrl = dfpUpAppend(dfpResolve(r.base, initSrc), r.urlQuery);
      if (media === null) { r.excluded = 'addressing-media'; return; }
      const m = dfpMedia(media, r.id, r.bandwidth, r.base);
      // S4b-8: Query hinter das Suffix (DashTemplate.Media.withQuery)
      const suf = r.urlQuery ? m.suf + ((m.pre + m.suf).indexOf('?') >= 0 ? '&' : '?') + r.urlQuery : m.suf;
      r.mediaCanon = m.pre + '{' + (m.kind === 'number' ? 'Number' : 'Time') + (m.width > 0 ? ':' + String(m.width).padStart(2, '0') : '') + '}' + suf;
      r.media = { kind: m.kind, width: m.width, pre: m.pre, suf: suf };
      if (m.kind === 'time') { r.addressing = 'TIME_TIMELINE'; if (!tl) { r.excluded = 'time-without-timeline'; return; } }
      else { r.addressing = tl ? 'NUMBER_TIMELINE' : 'NUMBER_DURATION'; if (!tl && r.duration === null) { r.excluded = 'addressing-duration'; return; } }
    } else {
      let holder = null;
      for (const s of segs) if (s && s.listMedia) { if (holder) dfpFail('addressing-ambiguous'); holder = s; }
      if (initSrc !== null) r.initUrl = dfpUpAppend(dfpResolve(r.base, initSrc), r.urlQuery);
      else if (initTpl !== null) dfpFail('addressing-attr');
      if (!holder) { r.addressing = 'SINGLE'; r.excluded = 'addressing-single'; return; }
      const lk = ctx.id(holder) + '|' + r.base + '|' + r.urlQuery;
      let c = ctx.lists.get(lk);
      if (!c) {
        ctx.listResolved += holder.listMedia.length;
        if (ctx.listResolved > DFP.MAX_RESOLVED) dfpFail('limits');
        const list = [], seen = new Set();
        let dup = false, ranges = false;
        holder.listMedia.forEach((m, i) => {
          if (holder.listRange[i] !== null || m === null) { ranges = true; list.push(dfpUpAppend(m === null ? r.base : dfpResolve(r.base, m), r.urlQuery)); return; }
          const u = dfpUpAppend(dfpResolve(r.base, m), r.urlQuery);
          if (seen.has(u)) dup = true;
          seen.add(u);
          list.push(u);
        });
        c = { list: list, range: holder.listRange, ranges: ranges, dup: dup };
        ctx.lists.set(lk, c);
      }
      r.list = c.list; r.listRange = c.range; r.listRanges = c.ranges;
      const single = !tl && r.duration === null;
      r.addressing = tl ? 'LIST_TIMELINE' : r.duration !== null ? 'LIST_DURATION' : 'LIST_SINGLE';
      if (c.ranges) { r.excluded = 'byte-range'; return; }
      if (c.dup) { r.excluded = 'list-duplicate'; return; }
      if (single && r.list.length !== 1) { r.excluded = 'addressing-duration'; return; }
    }
    if (r.initRange !== null) { r.excluded = 'byte-range'; return; }
    if (extra.length) { r.excluded = 'addressing-attr'; return; }
    // S4b-8: mit angehängter Query zu lange Init-/Listenadressen (Stückvorlagen prüft dfpExpand)
    if (r.urlQuery && ((r.initUrl !== null && r.initUrl.length > DFP.MAX_URI) || (r.list && r.list.some((u) => u.length > DFP.MAX_URI)))) r.excluded = 'uri-length';
  }
  function dfpCountAll(e, name) { let n = e.name === name ? 1 : 0; e.kids.forEach((k) => { n += dfpCountAll(k, name); }); return n; }

  function dfpModel(root, documentUrl, sel) {
    const h = documentUrl.indexOf('#');
    const doc = dfpCanonical(h >= 0 ? documentUrl.slice(0, h) : documentUrl);
    const ids = new Map();
    const ctx = { lists: new Map(), listResolved: 0, exps: new Map(), expanded: 0, id: (o) => { if (o === null || o === undefined) return '-'; if (!ids.has(o)) ids.set(o, ids.size); return String(ids.get(o)); } };
    // S4b-8: Annex I zuerst (wie DashManifest.parse)
    const up = dfpUrlParam(root, doc);
    const mRaw = dfpRawBases(root);
    const m = { typeRaw: root.attr('type'), mpd: dfpOptDuration(root, 'mediaPresentationDuration'), base: dfpBaseOf(doc, mRaw, 'm', sel), periods: [], sets: [], reps: [],
      baseAlts: mRaw.length > 1 ? mRaw : null };
    if (m.base === null) dfpFail('baseurl-undetermined');
    const pEls = root.all('Period');
    if (pEls.length > DFP.MAX_PERIODS) dfpFail('limits');
    pEls.forEach((pe) => {
      const pRaw = dfpRawBases(pe);
      const p = { index: m.periods.length, id: pe.attr('id'), start: dfpOptDuration(pe, 'start'), duration: dfpOptDuration(pe, 'duration'),
        base: dfpBaseOf(m.base, pRaw, 'p' + m.periods.length, sel), baseAlts: pRaw.length > 1 ? pRaw : null };
      if (p.base === null) dfpFail('baseurl-undetermined');
      m.periods.push(p);
      dfpSegKinds(pe);
      pe.all('AdaptationSet').forEach((ae) => {
        if (m.sets.length >= DFP.MAX_SETS) dfpFail('limits');
        const acp = dfpProps(ae, 'ContentProtection');
        const labels = ae.all('Label');
        const aRaw = dfpRawBases(ae);
        const a = { index: m.sets.length, period: p.index, id: ae.attr('id'), group: ae.attr('group'), contentType: ae.attr('contentType'),
          mimeType: ae.attr('mimeType'), codecs: ae.attr('codecs'), lang: ae.attr('lang'), label: labels.length ? dfpTrim(labels[0].text || '') : null,
          base: dfpBaseOf(p.base, aRaw, 's' + m.sets.length, sel), baseAlts: aRaw.length > 1 ? aRaw : null, cp: acp, ess: dfpProps(ae, 'EssentialProperty'), sup: dfpProps(ae, 'SupplementalProperty'),
          roles: dfpProps(ae, 'Role'), acc: dfpProps(ae, 'Accessibility'), ach: dfpProps(ae, 'AudioChannelConfiguration'), components: ae.all('ContentComponent').length };
        m.sets.push(a);
        dfpSegKinds(ae);
        ae.all('Representation').forEach((re) => {
          if (m.reps.length >= DFP.MAX_REPS) dfpFail('limits');
          const rcp = dfpProps(re, 'ContentProtection');
          const bwRaw = re.attr('bandwidth');
          const bw = bwRaw === null ? 0 : dfpU(bwRaw);
          if (bw > DFP.MAX_BANDWIDTH) dfpFail('number-range');
          const rRaw = dfpRawBases(re);
          const r = { index: m.reps.length, set: a.index, period: p.index, id: re.attr('id'), bandwidth: bw,
            mimeType: re.attr('mimeType') !== null ? re.attr('mimeType') : a.mimeType, codecs: re.attr('codecs') !== null ? re.attr('codecs') : a.codecs,
            width: re.attr('width'), height: re.attr('height'), frameRate: re.attr('frameRate'), audioSamplingRate: re.attr('audioSamplingRate'),
            base: a.base === null ? null : dfpBaseOf(a.base, rRaw, 'r' + m.reps.length, sel), baseAlts: rRaw.length > 1 ? rRaw : null, baseAlternatives: 1, cp: rcp, ess: dfpProps(re, 'EssentialProperty'), sup: dfpProps(re, 'SupplementalProperty'),
            ach: dfpProps(re, 'AudioChannelConfiguration'), subReps: re.all('SubRepresentation').length,
            segLevels: '', timescale: null, pto: null, startNumber: null, duration: null, mediaCanon: null, initUrl: null, initRange: null,
            templateExtra: [], tl: null, tlCount: 0, list: null, listRange: null, listRanges: false, excluded: null,
            addressing: 'NONE', media: null, first: 0, count: 0, covered: null, maxD: 0n, coverInfo: null };
          r.urlQuery = dfpUpFor(up, [root, pe, ae, re]);
          if (a.base === null && rRaw.length > 1 && sel && !sel.first) dfpChoose(sel, 'r' + m.reps.length, rRaw.length);   // (Index prüfen)
          if (sel && (mRaw.length > 1 || pRaw.length > 1 || aRaw.length > 1 || rRaw.length > 1)) r.baseAlternatives = dfpCombinations(doc, [mRaw, pRaw, aRaw, rRaw]);
          m.reps.push(r);
          dfpSegKinds(re);
          if (r.base === null) { r.excluded = 'baseurl-undetermined'; return; }
          dfpAddressing(r, [re, ae, pe], ctx);
        });
      });
    });
    const all = dfpCountAll(root, 'ContentProtection');
    let direct = root.all('ContentProtection').length;
    root.all('Period').forEach((pe) => pe.all('AdaptationSet').forEach((ae) => {
      direct += ae.all('ContentProtection').length;
      ae.all('Representation').forEach((re) => { direct += re.all('ContentProtection').length; });
    }));
    if (sel && !sel.first && !Array.from(sel.pick.keys()).every((k) => sel.used.has(k))) dfpFail('alt-invalid');
    m.cpTop = root.all('ContentProtection').length; m.cpAll = all; m.cpNested = all - direct;
    m.up = up;
    m.ctx = ctx;
    return m;
  }

  // ---------- kanonischer Text (DashFingerprint.write) ----------
  function dfpEsc(v) {
    if (v === null || v === undefined) return '-';
    if (v === '-') return '\\-';
    return String(v).replace(/[\\|\n\r]/g, (c) => (c === '\\' ? '\\\\' : c === '|' ? '\\|' : c === '\n' ? '\\n' : '\\r'));
  }
  function dfpWrite(m, out) {
    const line = (k, v) => out(k + '=' + dfpEsc(v) + '\n');
    const props = (k, ps) => ps.forEach((p) => out(k + '=' + dfpEsc(p.scheme) + '|' + dfpEsc(p.value) + '|' + dfpEsc(p.extra) + '\n'));
    const num = (v) => (v === null ? null : String(v));
    line('fp', DFP.VERSION);
    line('mpd.type', m.typeRaw);
    line('mpd.mediaPresentationDuration', dfpDurCanon(m.mpd));
    line('mpd.base', m.base);
    // S4b-6: mehrere BaseURL – Zahl und Roh-Texte (nur wenn vorhanden; Abdrücke ohne Alternativen bleiben gleich)
    const alts = (lv, xs) => { if (!xs) return; line(lv + '.baseAlternatives', String(xs.length)); xs.forEach((x) => line(lv + '.baseAlt', x)); };
    alts('mpd', m.baseAlts);
    line('mpd.contentProtection', String(m.cpTop));
    if (m.cpNested > 0) line('mpd.contentProtectionNested', String(m.cpNested));
    m.periods.forEach((p) => {
      line('period', String(p.index)); line('p.id', p.id); line('p.start', dfpDurCanon(p.start)); line('p.duration', dfpDurCanon(p.duration)); line('p.base', p.base); alts('p', p.baseAlts);
      m.sets.forEach((a) => {
        if (a.period !== p.index) return;
        line('set', String(a.index)); line('s.id', a.id); line('s.group', a.group); line('s.contentType', a.contentType); line('s.mimeType', a.mimeType);
        line('s.codecs', a.codecs); line('s.lang', a.lang); line('s.label', a.label); line('s.base', a.base); alts('s', a.baseAlts);
        props('s.contentProtection', a.cp); line('s.contentComponents', String(a.components)); props('s.essential', a.ess); props('s.supplemental', a.sup);
        props('s.role', a.roles); props('s.accessibility', a.acc); props('s.audioChannels', a.ach);
        m.reps.forEach((r) => {
          if (r.set !== a.index) return;
          line('rep', String(r.index)); line('r.id', r.id); line('r.bandwidth', String(r.bandwidth)); line('r.mimeType', r.mimeType); line('r.codecs', r.codecs);
          line('r.width', r.width); line('r.height', r.height); line('r.frameRate', r.frameRate); line('r.audioSamplingRate', r.audioSamplingRate); line('r.base', r.base); alts('r', r.baseAlts);
          props('r.contentProtection', r.cp); props('r.essential', r.ess); props('r.supplemental', r.sup); props('r.audioChannels', r.ach);
          line('r.subRepresentations', String(r.subReps)); line('r.segmentElements', r.segLevels);
          line('r.timescale', num(r.timescale)); line('r.presentationTimeOffset', num(r.pto)); line('r.startNumber', num(r.startNumber)); line('r.duration', num(r.duration));
          line('r.media', r.mediaCanon); line('r.init', r.initUrl); line('r.initRange', r.initRange);
          line('r.unsupported', r.templateExtra.length ? r.templateExtra.join(',') : null);
          if (r.tl) {
            line('r.timeline', String(r.tlCount));
            for (let k = 0; k < r.tlCount; k++) line('r.S', (r.tl[k * 3] === null ? '-' : String(r.tl[k * 3])) + ',' + r.tl[k * 3 + 1] + ',' + r.tl[k * 3 + 2]);
          }
          if (r.list) {
            line('r.list', String(r.list.length) + (r.listRanges ? ',ranges' : ''));
            for (let k = 0; k < r.list.length; k++) out('r.SegmentURL=' + dfpEsc(r.list[k]) + '|' + dfpEsc(r.listRange ? r.listRange[k] : null) + '\n');
          }
        });
      });
    });
  }

  // ---------- SHA-256 (fortlaufend, UTF-8; ohne crypto.subtle – auch in nicht sicheren Kontexten und synchron) ----------
  const DFP_K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
    0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138,
    0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624,
    0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f,
    0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function dfpSha256() {
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Uint32Array(64), blk = new Uint8Array(64);
    let fill = 0, total = 0;
    const block = () => {
      for (let i = 0; i < 16; i++) W[i] = (blk[i * 4] << 24) | (blk[i * 4 + 1] << 16) | (blk[i * 4 + 2] << 8) | blk[i * 4 + 3];
      for (let i = 16; i < 64; i++) {
        const a = W[i - 15], b = W[i - 2];
        const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3), s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const t1 = (h + S1 + ((e & f) ^ (~e & g)) + DFP_K[i] + W[i]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    };
    const byte = (x) => { blk[fill++] = x; total++; if (fill === 64) { block(); fill = 0; } };
    return {
      update(str) {
        for (let i = 0; i < str.length; i++) {
          let c = str.charCodeAt(i);
          if (c < 0x80) { byte(c); continue; }
          if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
            const d = str.charCodeAt(i + 1);
            if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
          }
          if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;   // einzelnes Surrogat (kommt aus dem XML-Parser nicht vor)
          if (c < 0x800) { byte(0xc0 | (c >> 6)); byte(0x80 | (c & 63)); }
          else if (c < 0x10000) { byte(0xe0 | (c >> 12)); byte(0x80 | ((c >> 6) & 63)); byte(0x80 | (c & 63)); }
          else { byte(0xf0 | (c >> 18)); byte(0x80 | ((c >> 12) & 63)); byte(0x80 | ((c >> 6) & 63)); byte(0x80 | (c & 63)); }
        }
      },
      hex() {
        const bits = total * 8;
        byte(0x80);
        while (fill !== 56) byte(0);
        const hi = Math.floor(bits / 4294967296), lo = bits >>> 0;
        [hi >>> 24, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, lo >>> 24, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255].forEach(byte);
        return Array.from(H, (x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
      },
    };
  }

  // ---------- S4b-5: Vorprüfung im Gleichlauf mit dem Helfer (dashplan) ----------
  // Dieselbe Entscheidung wie der Helfer für ein gelesenes MPD – ohne Netz, deterministisch, ohne Website-Regeln:
  //  1. Stückfolge, Fenster und Abdeckung jeder Darstellung (DashManifest.periodTiming/expand/compute),
  //  2. S3-Profil (DashProfile.check), 3. Plan (DashPlan.build), 4. Optionen (DashEngine.options: nur AAC-LC,
  //     Ressourcengrenze des Journals). Exakt gerechnet (BigInt, Dauern × 10^15) wie BigDecimal/long beim Helfer.
  // Ergebnis code = der Grund, den dashplan des Helfers für dieses MPD meldet ("ok" oder z. B. dash_addressing,
  // mpd_limits). Geprüft an den gemeinsamen Golden-Vektoren dash-gate/1 (tests/web/dash/gate, im Helfer identisch).
  const DFP_AVC = /^(avc1|avc3)\.[0-9A-Fa-f]{6}$/;
  const DFP_AAC = /^mp4a\.40\.(2|5|29)$/;   // DashProfile: AAC-LC/HE-AAC/HE-AACv2 sind Profil; gespeichert wird nur AAC-LC
  const DFP_LIM = Object.freeze({ SEG_TRACK: 20000, EXPANDED: 1000000, SEG_SECONDS: 3600n, OPTIONS: 256, MEDIA_BYTES: 16n << 30n,
    PLAN_SEGMENTS: 20000, URI: 4096, TOLERANCE: DFP_SCALE /* 1,0 s */ });
  const DFP_ADDRESSING = new Set(['addressing-single', 'byte-range', 'time-without-timeline', 'addressing-media', 'addressing-duration', 'addressing-attr',
    'list-duplicate', 'list-timeline', 'timeline-gap', 'timeline-overlap', 'timeline-repeat', 'timeline-empty', 'zero-duration',
    'coverage-mismatch', 'segments', 'segment-duration', 'duration-unknown', 'number-range', 'uri-length', 'init-missing']);
  const dfpCeilDiv = (a, b) => (a + b - 1n) / b;   // a ≥ 0, b > 0
  function dfpRoundHalfEven(n, d) { const q = n / d, r = n % d; return 2n * r > d || (2n * r === d && q % 2n === 1n) ? q + 1n : q; }
  // Dauer in 10^-9 s → kanonische Dezimalzahl ohne Nachkommanullen (wie BigDecimal.stripTrailingZeros().toPlainString())
  function dfpSec9(q) { const s = q.toString().padStart(10, '0'), i = s.slice(0, -9).replace(/^0+(?=\d)/, ''), f = s.slice(-9).replace(/0+$/, ''); return f ? i + '.' + f : i; }
  // Wirksamer Beginn und Dauer jeder Periode (DashManifest.periodTiming)
  function dfpPeriodTiming(m) {
    let prevEnd = 0n;
    m.periods.forEach((p, i) => {
      const start = p.start !== null ? p.start : prevEnd;
      let dur = p.duration;
      if (dur === null && start !== null && i + 1 < m.periods.length && m.periods[i + 1].start !== null) dur = m.periods[i + 1].start - start;
      if (dur === null && i + 1 === m.periods.length && m.mpd !== null && start !== null) dur = m.mpd - start;
      p.effDur = dur !== null && dur > 0n ? dur : null;
      prevEnd = start !== null && p.effDur !== null ? start + p.effDur : null;
    });
  }
  // Stückfolge einer Darstellung (DashManifest.compute) – { excluded } oder { first, count, covered (10^-9 s), maxD, info }
  function dfpCompute(m, r, ctx) {
    const p = m.periods[r.period], S = DFP_SCALE, SAFE = BigInt(DFP.SAFE);
    const ex = (why, info) => ({ excluded: why, info: info || null });
    if (p.effDur === null) return ex('duration-unknown');
    const ts = BigInt(r.timescale === null ? 1 : r.timescale), pto = r.pto === null ? 0 : r.pto, ptoB = BigInt(pto);
    const pdS = p.effDur * ts;   // Periodendauer in Ticks × 10^15
    const runs = [];   // [t, d, cnt] als Number (alle Werte ≤ 2^53−1, unten geprüft)
    let total = 0;
    if (r.tl !== null) {
      let end = -1;
      for (let k = 0; k < r.tlCount; k++) {
        let t = r.tl[k * 3];
        const d = r.tl[k * 3 + 1], rr = r.tl[k * 3 + 2];
        if (d <= 0) return ex('zero-duration');
        if (t === null) t = k === 0 ? 0 : end;
        else if (k > 0 && t !== end) return ex(t > end ? 'timeline-gap' : 'timeline-overlap');
        let cnt;
        if (rr >= 0) cnt = rr + 1;
        else if (k + 1 < r.tlCount) {
          const nt = r.tl[(k + 1) * 3];
          if (nt === null || nt <= t || (BigInt(nt) - BigInt(t)) % BigInt(d) !== 0n) return ex('timeline-repeat');
          cnt = Number((BigInt(nt) - BigInt(t)) / BigInt(d));
        } else {
          const left = pdS + ptoB * S - BigInt(t) * S;
          if (left <= 0n) return ex('timeline-repeat');
          const c = dfpCeilDiv(left, BigInt(d) * S);
          if (c > BigInt(DFP_LIM.SEG_TRACK)) return ex('segments');
          cnt = Number(c);
        }
        if (cnt > DFP_LIM.SEG_TRACK || total + cnt > DFP_LIM.SEG_TRACK) return ex('segments');
        const span = BigInt(d) * BigInt(cnt);
        if (span > SAFE || BigInt(t) + span > SAFE) return ex('number-range');
        end = t + d * cnt;
        runs.push([t, d, cnt]);
        total += cnt;
      }
      if (total === 0) return ex('timeline-empty');
      if (r.list !== null && r.list.length !== total) return ex('list-timeline');
    } else if (r.list !== null && r.addressing === 'LIST_SINGLE') {
      const d = dfpCeilDiv(pdS, S);
      if (d > SAFE) return ex('number-range');
      runs.push([pto, Math.max(1, Number(d)), 1]);
      total = 1;
    } else {
      const d = r.duration === null ? 0 : r.duration;
      if (d <= 0) return ex('zero-duration');
      const c = dfpCeilDiv(pdS, BigInt(d) * S);
      if (c <= 0n || c > BigInt(DFP_LIM.SEG_TRACK)) return ex('segments');
      const cnt = Number(c);
      // Liste mit fester Dauer: die Zahl der Einträge muss zur Periodendauer passen (beschrieben: Einträge × Dauer)
      if (r.list !== null && r.list.length !== cnt) return ex('coverage-mismatch', { described: BigInt(r.list.length) * BigInt(d) * 1000000000n / ts, period: p.effDur / 1000000n });
      if (BigInt(d) * c > SAFE || ptoB + BigInt(d) * c > SAFE) return ex('number-range');
      runs.push([pto, d, cnt]);
      total = cnt;
    }
    ctx.expanded += total;   // Gesamtgrenze über alle Darstellungen (geteilte Stückfolgen einmal) – darüber fatal wie beim Helfer
    if (ctx.expanded > DFP_LIM.EXPANDED) dfpFail('limits');
    if (BigInt(r.startNumber === null ? 1 : r.startNumber) + BigInt(total) > SAFE) return ex('number-range');
    // Fenster der Periode: Stück mit [t−pto, t−pto+d) überlappt [0, Dauer)
    const ceilT = dfpCeilDiv(pdS, S), floorT = pdS / S;
    let first = -1, last = -1, ord = 0, full = 0n, partS = 0n, maxD = 0;
    for (const [t, d, cnt] of runs) {
      maxD = Math.max(maxD, d);
      for (let j = 0; j < cnt; j++) {
        const s0 = t + j * d - pto, e0 = s0 + d;   // exakt: t + d·cnt ≤ 2^53−1 geprüft
        if (e0 <= 0 || s0 >= ceilT) continue;
        if (first < 0) first = ord + j;
        last = ord + j;
        const from = Math.max(s0, 0);
        if (e0 <= floorT) { full += BigInt(e0 - from); if (full > 9223372036854775807n) return ex('number-range'); }
        else partS += pdS - BigInt(from) * S;
      }
      ord += cnt;
    }
    if (first < 0) return ex('timeline-empty');
    const covered = dfpRoundHalfEven(full * S + partS, ts * 1000000n);   // 10^-9 s, HALF_EVEN wie BigDecimal.divide(…, 9, …)
    const miss = p.effDur - covered * 1000000n;
    if ((miss < 0n ? -miss : miss) > DFP_LIM.TOLERANCE) return ex('coverage-mismatch', { described: covered, period: p.effDur / 1000000n });
    if (BigInt(maxD) > DFP_LIM.SEG_SECONDS * ts) return ex('segment-duration');
    return { excluded: null, first: first, count: last - first + 1, covered: covered, maxD: maxD };
  }
  function dfpExpand(m, ctx) {
    dfpPeriodTiming(m);
    m.reps.forEach((r) => {
      if (r.excluded) return;
      const key = ctx.id(r.tl) + '|' + r.tlCount + '|' + ctx.id(r.list) + '|' + r.addressing + '|' + r.duration + '|' + r.timescale + '|' + r.pto + '|' + r.startNumber + '|' + r.period;
      let e = ctx.exps.get(key);
      if (!e) { e = dfpCompute(m, r, ctx); ctx.exps.set(key, e); }
      r.excluded = e.excluded;
      r.coverInfo = e.info || null;
      if (e.excluded) return;
      r.first = e.first; r.count = e.count; r.covered = e.covered; r.maxD = e.maxD;
      if (r.media && r.media.pre.length + r.media.suf.length + Math.max(r.media.width, 16) > DFP_LIM.URI) r.excluded = 'uri-length';
    });
  }
  function dfpKind(a, repMime) {
    const ct = a.contentType === null ? null : a.contentType.trim().toLowerCase();
    const mime = repMime === null ? '' : repMime.trim().toLowerCase();
    const fromMime = mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : mime.startsWith('text/') ? 'text'
      : mime.startsWith('image/') ? 'image' : mime === 'application/ttml+xml' ? 'text' : mime === 'application/mp4' ? 'other' : !mime ? null : 'other';
    if (ct !== null && fromMime !== null && ct !== fromMime && !(ct === 'text' && fromMime === 'other')) return 'conflict';
    return ct !== null ? ct : fromMime === null ? 'other' : fromMime;
  }
  function dfpWhy(a, r, kind) {
    if (kind === 'conflict') return 'set-kind';
    // S4b-8: ein (geprüfter, unterstützter) Annex-I-Descriptor ist kein unbekanntes EssentialProperty
    if (a.ess.some((p) => p.scheme !== DFP_UP_SCHEME)) return 'set-essential';
    if (r.ess.some((p) => p.scheme !== DFP_UP_SCHEME)) return 'rep-essential';
    if (r.subReps > 0 || a.components > 0) return 'subrepresentation';
    if (r.excluded) return r.excluded;
    const mime = r.mimeType === null ? '' : r.mimeType.trim().toLowerCase(), codecs = r.codecs === null ? '' : r.codecs.trim();
    if (codecs.indexOf(',') >= 0) return 'muxed';
    if (kind === 'video') { if (mime !== 'video/mp4') return 'container'; if (!DFP_AVC.test(codecs)) return 'codec'; }
    else { if (mime !== 'audio/mp4') return 'container'; if (!DFP_AAC.test(codecs)) return 'codec'; }
    if (r.bandwidth <= 0) return 'bandwidth';
    if (r.initUrl === null) return 'init-missing';
    return null;
  }
  // Können zwei angebotene Spuren dieselbe Adresse anfordern? (DashPlan.collides)
  function dfpCollides(tracks) {
    const fixed = new Set();
    for (const r of tracks) { if (fixed.has(r.initUrl)) return true; fixed.add(r.initUrl); }
    for (const r of tracks) {
      if (!r.list) continue;
      for (let i = 0; i < r.count; i++) { const u = r.list[r.first + i]; if (fixed.has(u)) return true; fixed.add(u); }
    }
    for (let a = 0; a < tracks.length; a++) {
      const ma = tracks[a].media;
      if (!ma) continue;
      for (let b = a + 1; b < tracks.length; b++) {
        const mb = tracks[b].media;
        if (!mb) continue;
        if ((ma.pre.startsWith(mb.pre) || mb.pre.startsWith(ma.pre)) && (ma.suf.endsWith(mb.suf) || mb.suf.endsWith(ma.suf))) return true;
      }
      for (const u of fixed) {
        if (u.length > ma.pre.length + ma.suf.length && u.startsWith(ma.pre) && u.endsWith(ma.suf)
          && /^[0-9]{1,20}$/.test(u.slice(ma.pre.length, u.length - ma.suf.length))) return true;
      }
    }
    return false;
  }
  // { ok, code, reason, track, detail, coverage, reps, video, audio }
  //  code: Grund wie dashplan des Helfers (Bindestrich statt Unterstrich): ok, dash-*, options-limit, track-collision,
  //    size-limit, segments-limit, audio-codec, mpd-limits; reason: Kadris Anzeigegrund (src/046, src/105) –
  //    dash-live, dash-type, dash-protected, dash-multiperiod, dash-duration-unknown, dash-duration-limit, dash-no-video,
  //    dash-no-audio, dash-codec, dash-audio-codec, dash-coverage, dash-timeline, dash-addressing, dash-limit, dash-unsupported
  //  track/detail: blockierende Spurart und die Gründe ihrer Darstellungen; coverage: { track, described, period } (Sekunden-Text)
  //  reps: je Video-/Tondarstellung { index, kind, excluded | count + covered } (für die Golden-Vektoren)
  function dfpGate(m, ctx) {
    const res = (code, reason, extra) => Object.assign({ ok: code === 'ok', code: code, reason: code === 'ok' ? '' : reason, track: '', detail: [], coverage: null,
      reps: [], video: [], audio: [] }, extra || {});
    try { dfpExpand(m, ctx); } catch (e) { return res('mpd-' + (e && e.dfp ? e.dfp : 'internal'), 'dash-unsupported'); }
    const reps = [];
    m.reps.forEach((r) => {
      const kind = dfpKind(m.sets[r.set], r.mimeType);
      if (kind !== 'video' && kind !== 'audio') return;
      const base = { index: r.index, id: r.id, kind: kind, addressing: r.addressing, alts: r.baseAlternatives || 1 };
      reps.push(Object.assign(base, r.excluded ? { excluded: r.excluded } : { count: r.count, covered: dfpSec9(r.covered) }));
    });
    const no = (code, reason, extra) => res(code, reason, Object.assign({ reps: reps }, extra || {}));
    if (m.typeRaw !== null && m.typeRaw.trim() === 'dynamic') return no('dash-live', 'dash-live');
    if (m.typeRaw !== null && m.typeRaw.trim() !== 'static') return no('dash-type', 'dash-type');
    if (m.periods.length !== 1) return no('dash-multiperiod', 'dash-multiperiod');
    if (m.cpAll > 0) return no('dash-protected', 'dash-protected');
    const pd = m.periods[0].effDur;
    if (pd === null) return no('dash-duration-unknown', 'dash-duration-unknown');
    if (pd > BigInt(DFP.MAX_TOTAL_SECONDS) * DFP_SCALE) return no('dash-duration-limit', 'dash-duration-limit');
    const video = [], audio = [], vWhy = [], aWhy = [], vEx = [], aEx = [];
    let anyVideo = false, anyAudio = false;
    m.reps.forEach((r) => {
      const a = m.sets[r.set], kind = dfpKind(a, r.mimeType);
      if (kind !== 'video' && kind !== 'audio' && kind !== 'conflict') return;
      const why = dfpWhy(a, r, kind);
      if (kind === 'video') anyVideo = true;
      if (kind === 'audio') anyAudio = true;
      if (why) { (kind === 'audio' ? aWhy : vWhy).push(why); (kind === 'audio' ? aEx : vEx).push(r); return; }
      (kind === 'video' ? video : audio).push(r);
    });
    const cat = (whys) => (whys.length && whys.every((w) => w === 'baseurl-undetermined') ? 'dash-baseurl-undetermined'
      : whys.some((w) => w === 'codec' || w === 'container' || w === 'muxed') ? 'dash-codec'
      : whys.some((w) => DFP_ADDRESSING.has(w)) ? 'dash-addressing' : 'dash-unsupported');
    const uniq = (a) => a.filter((x, i) => a.indexOf(x) === i).sort();
    // Anzeigegrund einer abgelehnten Spurart: Abdeckung/Zeitleiste konkret benennen, Ton-Codec eigens
    const blocked = (track, whys, exReps) => {
      const code = cat(whys), d = uniq(whys);
      let reason = code;
      let coverage = null;
      if (code === 'dash-codec' && track === 'audio') reason = 'dash-audio-codec';
      else if (code === 'dash-addressing' && d.every((w) => w === 'coverage-mismatch')) {
        reason = 'dash-coverage';
        const r = exReps.find((x) => x.coverInfo);
        if (r) coverage = { track: track, described: dfpSec9(r.coverInfo.described), period: dfpSec9(r.coverInfo.period) };
      } else if (code === 'dash-addressing' && d.every((w) => /^(timeline-(gap|overlap|repeat|empty)|zero-duration)$/.test(w))) reason = 'dash-timeline';
      return no(code, reason, { track: track, detail: d, coverage: coverage });
    };
    if (!anyVideo) return no('dash-no-video', 'dash-no-video');
    if (!video.length) return blocked('video', vWhy, vEx);
    if (anyAudio && !audio.length) return blocked('audio', aWhy, aEx);
    // Plan (DashPlan.build)
    const pairs = video.length * Math.max(1, audio.length);
    if (pairs > DFP_LIM.OPTIONS) return no('options-limit', 'dash-limit');
    if (dfpCollides(video.concat(audio))) return no('track-collision', 'dash-unsupported');
    const bytes = (v, a) => dfpCeilDiv(BigInt(v.bandwidth + (a ? a.bandwidth : 0)) * pd, 8n * DFP_SCALE);
    const options = [];
    video.forEach((v) => { if (!audio.length) { if (bytes(v, null) <= DFP_LIM.MEDIA_BYTES) options.push([v, null]); return; }
      audio.forEach((a) => { if (bytes(v, a) <= DFP_LIM.MEDIA_BYTES) options.push([v, a]); }); });
    if (!options.length) return no('size-limit', 'dash-limit');
    // Optionen des Helfers (DashEngine.options): Ton Pflicht, nur AAC-LC, Journalgrenze Video + Ton
    if (!audio.length) return no('dash-no-audio', 'dash-no-audio');
    let onlyHe = true;
    const usable = options.filter(([v, a]) => {
      if (!a || a.codecs.trim() !== 'mp4a.40.2') return false;
      onlyHe = false;
      return (v.count + 1) + (a.count + 1) <= DFP_LIM.PLAN_SEGMENTS + 2 && bytes(v, a) <= DFP_LIM.MEDIA_BYTES;
    });
    // (wie beim Helfer ohne Gründe je Darstellung: das Profil hat HE-AAC angenommen, erst die Optionen fallen weg)
    if (!usable.length) return onlyHe ? no('audio-codec', 'dash-audio-codec') : no('segments-limit', 'dash-limit');
    // (für die Zuordnung der Helfer-Optionen: Höhe/Breite wie beim Helfer gelesen, Sprache des Sets, Bandbreite)
    const dim = (x) => (x !== null && /^[0-9]{1,6}$/.test(x.trim()) && Number(x.trim()) <= 100000 ? Number(x.trim()) : 0);
    const out = (r) => ({ index: r.index, height: dim(r.height), width: dim(r.width), bandwidth: r.bandwidth, codecs: r.codecs.trim(),
      lang: m.sets[r.set].lang !== null && /^[A-Za-z0-9-]{1,16}$/.test(m.sets[r.set].lang) ? m.sets[r.set].lang : '' });
    const uv = video.filter((v) => usable.some((o) => o[0] === v)), ua = audio.filter((a) => usable.some((o) => o[1] === a));
    return res('ok', '', { reps: reps, video: uv.map(out), audio: ua.map(out) });
  }

  // Öffentlich: Abdruck und Vorprüfung aus dem gelesenen Text, dem DOMParser-Ergebnis (src/038 dashParse) und der finalen
  // Adresse des MPD. canonical: nur für Tests (kanonischer Text statt Hash).
  function dashFingerprint(text, parsed, documentUrl, canonical) {
    try {
      if (typeof text !== 'string' || !text || !parsed || !parsed.root || typeof documentUrl !== 'string') return { error: 'input' };
      if (text.length > 4e6) return { error: 'too-large' };
      if (text.indexOf('\u0000') >= 0) return { error: 'encoding' };
      const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
      const decl = /^<\?xml[^>]*?\sencoding\s*=\s*["']([^"']*)["']/.exec(t);
      if (decl && decl[1].toLowerCase() !== 'utf-8') return { error: 'encoding' };
      dfpPrescan(t);
      const root = dfpTree(parsed.root.ownerDocument);
      // S4b-6: Abdruck über das ganze MPD mit allen BaseURL-Alternativen (Projektion: jeweils die erste); multi: es gibt
      // Alternativen – dann gilt für das Angebot die Vorprüfung der gebundenen Auswahl (dashGateFor), nicht diese
      const m = dfpModel(root, documentUrl, DFP_FIRST);
      let lines = 0, txt = '';
      const sha = canonical ? null : dfpSha256();
      dfpWrite(m, (s) => { if (++lines > DFP.MAX_LINES) dfpFail('limits'); if (sha) sha.update(s); else txt += s; });
      const multi = !!(m.baseAlts || m.periods.some((x) => x.baseAlts) || m.sets.some((x) => x.baseAlts) || m.reps.some((x) => x.baseAlts));
      // S4b-8: wirkt ein Annex-I-Descriptor: je Darstellung (Nummer wie beim Helfer) nur OB die Query der MPD-Adresse angehängt
      // wird – für den Index (src/038); die Query selbst (oft ein Token) verlässt diese Funktion nicht
      const urlq = m.up.at.size ? { reps: m.reps.map((r) => r.urlQuery !== null) } : null;
      return { fp: sha ? sha.hex() : '', text: canonical ? txt : undefined, gate: dfpGate(m, m.ctx), multi: multi, urlq: urlq };
    } catch (e) {
      return { error: e && e.dfp ? e.dfp : 'internal' };
    }
  }
  // S4b-6: Vorprüfung der Projektion für eine Auswahl unter mehreren BaseURL (wie dashplan v2 des Helfers: dieselbe
  // Prüfung der Auswahl am MPD). alt null: wie dashplan v1 (mehrere BaseURL fatal). Ergebnis wie dfpGate; ein fataler
  // Grund als { ok: false, code: 'mpd-<grund>' }.
  function dashGateFor(text, parsed, documentUrl, alt) {
    const fatal = (c) => ({ ok: false, code: 'mpd-' + c, reason: c === 'baseurl-undetermined' ? 'dash-baseurl-undetermined' : c === 'baseurl-multiple' ? 'baseurl-multiple' : /^urlparam-/.test(c) ? 'dash-urlparam' : 'unchecked',
      track: '', detail: [], coverage: null, reps: [], video: [], audio: [] });
    try {
      if (typeof text !== 'string' || !text || !parsed || !parsed.root || typeof documentUrl !== 'string' || text.length > 4e6) return fatal('input');
      const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
      dfpPrescan(t);
      const tree = dfpTree(parsed.root.ownerDocument);
      if (alt === null || alt === undefined) { const m0 = dfpModel(tree, documentUrl, null); return dfpGate(m0, m0.ctx); }
      // wie dashplan v2: erst das ganze MPD (alle Alternativen), dann die Projektion der Auswahl
      dfpModel(tree, documentUrl, DFP_FIRST);
      const m = dfpModel(tree, documentUrl, dfpSelection(alt));
      return dfpGate(m, m.ctx);
    } catch (e) {
      return fatal(e && e.dfp ? e.dfp : 'internal');
    }
  }
  // =================================================
