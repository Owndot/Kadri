  // ================= DASH-Manifest (MPD) einordnen – nur lesen, nichts laden =================
  // Aus dem Text eines MPD, den die Seite ohnehin geladen hat (page.js reicht ihn weiter), wird eine kleine, rein
  // technische Zusammenfassung: VOD (static) oder Live (dynamic), Perioden, AdaptationSets und Darstellungen mit Art
  // (Bild/Ton/Text), Container, Codec-Familie, Auflösung, Datenrate, Sprache, Adressierung (SegmentTemplate mit/ohne
  // SegmentTimeline, SegmentList, SegmentBase, Einzeldatei) und angegebenem Schutz (ContentProtection).
  //  - Kein Netzabruf, keine Adresse, keine Kennung (Darstellungs-IDs, KIDs, BaseURLs) in der Zusammenfassung.
  //  - Sicher parsen: DOCTYPE/ENTITY (auch externe Entitäten) werden abgelehnt, bevor der Parser läuft; Größen- und
  //    Strukturgrenzen; Fehler → nur ein Fehlercode, keine erfundenen Angaben.
  //  - Fehlt ContentProtection, heißt das NUR „nicht angegeben“ – Verschlüsselung kann allein in den Init-Segmenten
  //    stecken. Daraus wird nie „unverschlüsselt“.
  //  - Nicht seitenspezifisch und offen für weitere Codecs/Container/Adressierungen (neue Werte → neue Kategorien; das
  //    Format v:1 bleibt). Geprüft wird die Zusammenfassung zusätzlich und unabhängig im Quellenmodell (mediaManifestOk).
  // Steht vor 040: page.js schickt aufgehobene Listen sofort beim Start von Kadri erneut (dann muss das hier schon da sein).
  const DASH_LIMITS = Object.freeze({ chars: 4e6, elements: 200000, periods: 64, sets: 1024, reps: 4096, tracks: 64 });
  const DASH_SYSTEMS = Object.freeze({
    'urn:mpeg:dash:mp4protection:2011': 'cenc',
    'urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed': 'widevine',
    'urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95': 'playready',
    'urn:uuid:79f0049a-4098-8642-ab92-e65be0885f95': 'playready',
    'urn:uuid:e2719d58-a985-b3c9-781a-b030af78d30e': 'clearkey',
    'urn:uuid:1077efec-c0b2-4d02-ace3-3c1e52e2fb4b': 'clearkey',
    'urn:uuid:94ce86fb-07ff-4f43-adb8-93d2fa968ca2': 'fairplay',
    'urn:uuid:5e629af5-38da-4063-8977-97ffbd9902d4': 'marlin',
  });
  // Codec-Familie aus einem RFC-6381-Kürzel (erster Teil vor dem Punkt)
  function dashCodecFamily(c) {
    const x = String(c || '').trim().toLowerCase().split('.')[0];
    if (!x) return 'unknown';
    if (x === 'avc1' || x === 'avc3') return 'avc';
    if (x === 'hvc1' || x === 'hev1' || x === 'dvh1' || x === 'dvhe') return 'hevc';
    if (x === 'vvc1' || x === 'vvi1') return 'vvc';
    if (x === 'vp08' || x === 'vp8') return 'vp8';
    if (x === 'vp09' || x === 'vp9') return 'vp9';
    if (x === 'av01') return 'av1';
    if (x === 'mp4a') { const o = String(c).toLowerCase().split('.')[1] || ''; return o === '40' || o === '67' || o === '66' || o === '68' ? 'aac' : o === '6b' || o === '69' ? 'mp3' : o === 'a5' ? 'ac3' : o === 'a6' ? 'ec3' : 'other'; }
    if (x === 'ac-3') return 'ac3';
    if (x === 'ec-3') return 'ec3';
    if (x === 'ac-4') return 'ac4';
    if (x === 'opus') return 'opus';
    if (x === 'vorbis') return 'vorbis';
    if (x === 'flac') return 'flac';
    if (x === 'dtsc' || x === 'dtse' || x === 'dtsh' || x === 'dtsl' || x === 'dtsx') return 'dts';
    if (x === 'stpp') return 'ttml';
    if (x === 'wvtt') return 'webvtt';
    return 'other';
  }
  const DASH_VIDEO_CODECS = ['avc', 'hevc', 'vvc', 'vp8', 'vp9', 'av1'];
  const DASH_AUDIO_CODECS = ['aac', 'mp3', 'ac3', 'ec3', 'ac4', 'opus', 'vorbis', 'flac', 'dts'];
  function dashContainer(mime) {
    const m = String(mime || '').toLowerCase().split(';')[0].trim();
    if (!m) return 'unknown';
    if (m === 'video/mp4' || m === 'audio/mp4' || m === 'application/mp4') return 'mp4';
    if (m === 'video/webm' || m === 'audio/webm') return 'webm';
    if (m === 'video/mp2t') return 'mp2t';
    if (m === 'text/vtt' || m === 'application/ttml+xml') return 'text';
    if (/^image\//.test(m)) return 'image';
    return 'other';
  }
  const dashInt = (s, lo, hi) => { if (s == null || !/^\d{1,10}$/.test(String(s).trim())) return null; const n = parseInt(s, 10); return n >= lo && n <= hi ? n : null; };
  function dashIsoDur(s) {
    const m = /^\s*P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?\s*$/.exec(String(s || ''));
    if (!m || !(m[1] || m[2] || m[3] || m[4])) return null;
    const v = (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
    return isFinite(v) && v >= 0 && v <= 1e7 ? Math.round(v * 1000) / 1000 : null;
  }
  const dashLang = (s) => { const x = String(s || '').trim().toLowerCase(); return /^[a-z]{2,3}(-[a-z0-9]{1,8}){0,2}$/.test(x) ? x : ''; };
  const dashKids = (el, name) => { const out = []; for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) out.push(c); return out; };
  const dashKid = (el, name) => (el ? dashKids(el, name)[0] || null : null);
  // Sicher parsen: { root } oder { error } – DOCTYPE/ENTITY nie an den Parser (Entitäten-Bomben, externe Entitäten)
  function dashParse(text) {
    if (typeof text !== 'string' || !text) return { error: 'parse' };
    if (text.length > DASH_LIMITS.chars) return { error: 'too-large' };
    if (/<!\s*(DOCTYPE|ENTITY)/i.test(text)) return { error: 'doctype' };
    let doc = null;
    try { doc = new DOMParser().parseFromString(text, 'application/xml'); } catch (e) { return { error: 'parse' }; }
    if (!doc || !doc.documentElement || doc.getElementsByTagName('parsererror').length) return { error: 'parse' };
    if (doc.documentElement.localName !== 'MPD') return { error: 'not-mpd' };
    if (doc.getElementsByTagName('*').length > DASH_LIMITS.elements) return { error: 'limits' };
    return { root: doc.documentElement };
  }
  function dashManifestSummary(text) { return dashSummaryFromParsed(dashParse(text)); }
  function dashSummaryFromParsed(parsed) {
    const out = { format: 'dash', v: 1, error: '', type: 'unknown', periods: 0, adaptationSets: 0, representations: 0, duration: null,
      addressing: [], protection: { signaled: false, systems: [], defaultKid: false }, tracks: [] };
    const fail = (e) => Object.assign(out, { error: e, type: 'unknown', periods: 0, adaptationSets: 0, representations: 0, duration: null,
      addressing: [], protection: { signaled: false, systems: [], defaultKid: false }, tracks: [] });
    if (!parsed || parsed.error || !parsed.root) return fail((parsed && parsed.error) || 'parse');
    const root = parsed.root;
    const type = (root.getAttribute('type') || 'static').trim();
    out.type = type === 'static' || type === 'dynamic' ? type : 'unknown';
    out.duration = dashIsoDur(root.getAttribute('mediaPresentationDuration'));
    const periods = dashKids(root, 'Period');
    if (periods.length > DASH_LIMITS.periods) return fail('limits');
    out.periods = periods.length;
    const addr = new Set(), systems = new Set();
    const noteProtection = (el) => {
      dashKids(el, 'ContentProtection').forEach((cp) => {
        out.protection.signaled = true;
        const scheme = String(cp.getAttribute('schemeIdUri') || '').trim().toLowerCase();
        systems.add(DASH_SYSTEMS[scheme] || 'other');
        if (scheme === 'urn:mpeg:dash:mp4protection:2011' && /^(cbcs|cbc1)$/i.test(String(cp.getAttribute('value') || '').trim())) systems.add('cbcs');
        for (let i = 0; i < cp.attributes.length; i++) if (cp.attributes[i].localName === 'default_KID') out.protection.defaultKid = true;
      });
      return dashKids(el, 'ContentProtection').length > 0;
    };
    // Adressierung: nächstgelegene Angabe (Darstellung → AdaptationSet → Periode); Vorlage mit Zeitleiste, wenn eine der
    // geerbten Vorlagen eine SegmentTimeline trägt
    const addressingOf = (chain) => {
      for (let i = 0; i < chain.length; i++) {
        const el = chain[i];
        const t = dashKid(el, 'SegmentTemplate');
        if (t) {
          const tl = chain.slice(i).some((e) => { const x = dashKid(e, 'SegmentTemplate'); return x && dashKid(x, 'SegmentTimeline'); });
          return tl ? 'template-timeline' : (t.getAttribute('duration') || chain.slice(i + 1).some((e) => { const x = dashKid(e, 'SegmentTemplate'); return x && x.getAttribute('duration'); }))
            ? 'template-duration' : 'template-other';
        }
        if (dashKid(el, 'SegmentList')) return 'list';
        if (dashKid(el, 'SegmentBase')) return 'base';
      }
      return chain.some((e) => dashKid(e, 'BaseURL')) || dashKid(root, 'BaseURL') ? 'single-file' : 'unknown';
    };
    let sets = 0, reps = 0;
    periods.forEach((per) => {
      const as = dashKids(per, 'AdaptationSet');
      sets += as.length;
      as.forEach((a) => {
        const aProt = noteProtection(a);
        const rs = dashKids(a, 'Representation');
        reps += rs.length;
        rs.forEach((r) => {
          const rProt = noteProtection(r);
          if (out.tracks.length >= DASH_LIMITS.tracks) return;   // gezählt wird weiter, gespeichert höchstens 64
          const attr = (k) => r.getAttribute(k) || a.getAttribute(k) || '';
          const mime = attr('mimeType');
          const codecs = Array.from(new Set(String(attr('codecs')).split(',').map((c) => dashCodecFamily(c)).filter((c) => c !== 'unknown'))).slice(0, 4);
          const ct = String(a.getAttribute('contentType') || '').toLowerCase();
          const kind = /^(video|audio|text|image)$/.test(ct) ? ct
            : /^video\//i.test(mime) ? 'video' : /^audio\//i.test(mime) ? 'audio' : /^(text\/|application\/ttml)/i.test(mime) ? 'text' : /^image\//i.test(mime) ? 'image'
              : codecs.some((c) => DASH_VIDEO_CODECS.indexOf(c) >= 0) ? 'video' : codecs.some((c) => DASH_AUDIO_CODECS.indexOf(c) >= 0) ? 'audio'
                : codecs.some((c) => c === 'ttml' || c === 'webvtt') ? 'text' : 'other';
          const ad = addressingOf([r, a, per]);
          addr.add(ad);
          out.tracks.push({ kind: kind, container: dashContainer(mime), codecs: codecs.length ? codecs : ['unknown'],
            width: dashInt(attr('width'), 1, 15360), height: dashInt(attr('height'), 1, 8640), bandwidth: dashInt(r.getAttribute('bandwidth'), 1, 1e9),
            lang: dashLang(a.getAttribute('lang') || r.getAttribute('lang')), addressing: ad, protected: aProt || rProt });
        });
      });
    });
    if (sets > DASH_LIMITS.sets || reps > DASH_LIMITS.reps) return fail('limits');
    out.adaptationSets = sets; out.representations = reps;
    out.addressing = Array.from(addr).slice(0, 8);
    out.protection.systems = Array.from(systems).slice(0, 8);
    return out;
  }
  // ---------- S2: erwartete Stück-Adressen je Darstellung (privat – nie in Registry, Diagnose oder Speicher) ----------
  // Aus einem gültigen MPD: je Darstellung die Adressen ihrer Medien-Stücke als Muster (Pfad, ohne Query), aufgelöst über
  // die BaseURL-Kette (MPD-Adresse → MPD → Periode → AdaptationSet → Darstellung) und mit geerbter SegmentTemplate
  // (Periode → AdaptationSet → Darstellung). Ein beobachteter Abruf, der genau auf ein Muster passt, wird zur Nummer des
  // Stücks in dieser Darstellung: $Number$ (− startNumber), $Time$ über die SegmentTimeline bzw. die feste Dauer,
  // SegmentList über die Reihenfolge der SegmentURL. SegmentBase/Einzeldatei (Byte-Bereiche derselben Datei) und
  // SegmentList nur mit mediaRange lassen keine Stückfolge erkennen → dort keine Bindung über Stücke (bleibt ambiguous).
  // Identität: verglichen wird die VOLLE Adresse ohne #-Teil (Schema, Host, Pfad UND Query) – Query-Parameter tragen oft die
  // Video-Identität (…/seg1.m4s?video=A ≠ ?video=B). Platzhalter dürfen auch in der Query stehen (…?n=$Number$). Fehlende,
  // abweichende, zusätzliche oder umsortierte Parameter → kein Treffer (Identität nicht nachweisbar → ambiguous).
  // Grenzen: höchstens 64 Darstellungen, 20000 Zeitleisten-Einträge je Darstellung, 20000 Listeneinträge.
  // S4b-6: mehrere BaseURL (CDN-Alternativen): je Darstellung ein Eintrag JE ERKLÄRTER Alternative (wie der Helfer: höchstens
  // 8 BaseURL je Element, 16 Kombinationen je Darstellung), höchstens 256 Einträge insgesamt – darüber ist das MPD nicht
  // prüfbar (overflow) statt unvollständig indiziert.
  const DASH_IDX = Object.freeze({ reps: 64, timeline: 20000, list: 20000, perElement: 8, combinations: 16, records: 256 });
  // S3c: Vorlagen wie der Helper (DashTemplate, ISO/IEC 23009-1 5.3.9.4.4) in EINEM Durchgang: $$, $RepresentationID$
  // (ohne Format, nur unschädliche Zeichen), $Bandwidth$ und $Bandwidth%0[w]d$ (mit führenden Nullen auf w Stellen – vorher
  // wurde das Format ignoriert), $Number$/$Time$ (je optional %0[w]d, w 1–20) → slot. Alles andere ($SubNumber$, unbekannte
  // Namen, offenes "$") → null. bw: Bandbreite als Dezimaltext ohne führende Nullen ("0", wenn nicht angegeben).
  // Ergebnis { text, kind: 'number' | 'time' | '', width } – eine Medienvorlage braucht genau einen Zahlenplatzhalter.
  const DASH_TPL_ID = /^[A-Za-z0-9._~=,;!*()+&:@-]{1,256}$/;
  function dashTplExpand(tpl, id, bw, media, slot) {
    const s = String(tpl);
    let out = '', kind = '', width = 0, i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c !== '$') { out += c; i++; continue; }
      const end = s.indexOf('$', i + 1);
      if (end < 0) return null;
      const ident = s.slice(i + 1, end);
      i = end + 1;
      if (!ident) { out += '$'; continue; }
      const pc = ident.indexOf('%');
      const name = pc >= 0 ? ident.slice(0, pc) : ident, fmt = pc >= 0 ? ident.slice(pc) : null;
      let w = 0;
      if (fmt !== null) { const m = /^%0([1-9][0-9]?)d$/.exec(fmt); if (!m || Number(m[1]) > 20) return null; w = Number(m[1]); }
      if (name === 'RepresentationID') { if (fmt !== null || typeof id !== 'string' || !DASH_TPL_ID.test(id)) return null; out += id; }
      else if (name === 'Bandwidth') out += String(bw).padStart(w, '0');
      else if (name === 'Number' || name === 'Time') { if (!media || kind) return null; kind = name === 'Number' ? 'number' : 'time'; width = w; out += slot; }
      else return null;
    }
    if (media && !kind) return null;
    return { text: out, kind: kind, width: width };
  }
  // Bandbreite wie beim Helper (DashNum.parseU): nur Ziffern (XML-Leerraum am Rand), ohne führende Nullen; fehlt → "0"; sonst null
  const dashBwText = (raw) => {
    if (raw == null) return '0';
    const t = String(raw).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
    if (!/^[0-9]{1,40}$/.test(t)) return null;
    const v = t.replace(/^0+(?=\d)/, '');
    return v.length <= 10 ? v : null;
  };
  // Marke an der Stelle des Zahlenplatzhalters für die Auflösung: nur Ziffern ("8", (längste 9er-Folge + 1) × "9", "8") –
  // kann in Vorlage, eingesetzten Werten und Basis nicht vorkommen (anders als eine feste Wortmarke, die in einer
  // Darstellungs-ID oder Adresse stehen könnte); die Auflösung ändert keine Ziffern. Gefunden wird sie über die 9er-Folge.
  function dashMark(text, base) {
    const run = (x) => { let b = 0, c = 0; for (let i = 0; i < x.length; i++) { c = x[i] === '9' ? c + 1 : 0; if (c > b) b = c; } return b; };
    return '8' + '9'.repeat(Math.max(run(text), run(base)) + 1) + '8';
  }
  // Vergleichsschlüssel einer Adresse für DASH: alles außer dem #-Teil (nur intern; nie in Registry-Zusammenfassung/Diagnose)
  const dashUrlKey = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.origin + x.pathname + x.search : ''; } catch (e) { return ''; } };
  const dashEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // S4b-8: Annex-I-Descriptor (urlparam, jede Form) irgendwo im MPD?
  const DASH_UP_RE = /^urn:mpeg:dash:(urlparam|state):/;
  function dashHasUrlParam(root) {
    const all = root.getElementsByTagNameNS('*', '*');
    for (let i = 0; i < all.length; i++) {
      const e = all[i];
      if ((e.localName === 'EssentialProperty' || e.localName === 'SupplementalProperty') && DASH_UP_RE.test(e.getAttribute('schemeIdUri') || '')) return true;
    }
    return false;
  }
  // S4b-8: Query an eine absolute Adresse hängen („?“ bzw. „&“ hinter einer vorhandenen Query) – wie dfpUpAppend/DashUrlParam
  const dashUpAppend = (u, q) => (q ? u + (u.indexOf('?') >= 0 ? '&' : '?') + q : u);
  // uq (S4b-8): Ergebnis von dashFingerprint(…).urlq – { reps: [wirkt ein Annex-I-Descriptor? je Darstellung] } bzw. { error } –
  // aus derselben Auswertung wie Abdruck und Helfer (src/039, dort auch die Prüfung der Query). Angehängt wird die Query der
  // MPD-Adresse (mpdUrl: die endgültige nach Weiterleitungen, wie dort). Nennt das MPD einen Annex-I-Descriptor und liegt keine
  // gültige Auswertung vor, wird nichts indiziert (urlparam: fester Grund) – nie ohne die Query.
  function dashSegmentIndex(parsed, mpdUrl, uq) {
    const out = { reps: [], single: 0, overflow: false, multi: false, urlparam: '' };
    if (!parsed || !parsed.root || typeof mpdUrl !== 'string') return out;
    const root = parsed.root;
    let upq = null, upQuery = '';
    if (dashHasUrlParam(root)) {
      if (!uq || uq.error || !Array.isArray(uq.reps)) { out.urlparam = (uq && uq.error) || 'urlparam-unchecked'; return out; }
      upq = uq.reps;
      try { upQuery = new URL(mpdUrl).search.slice(1); } catch (e) { out.urlparam = 'urlparam-unchecked'; return out; }
    }
    // Alternativen einer Ebene: [{ base, sel: ['m:1', …] }] – Auswahlschlüssel wie beim Helfer (BaseSelection), nur für
    // Elemente mit mehreren BaseURL; null = Grenze überschritten (dann wird nichts indiziert, overflow)
    const altsOf = (el, outer, key) => {
      if (outer === null) return null;
      const bs = dashKids(el, 'BaseURL');
      if (!bs.length) return outer;
      if (bs.length > DASH_IDX.perElement) return null;
      if (bs.length > 1) out.multi = true;
      const next = [];
      for (const o of outer) bs.forEach((b, i) => { try { next.push({ base: new URL(String(b.textContent || '').trim(), o.base).href, sel: bs.length > 1 ? o.sel.concat([key + ':' + i]) : o.sel }); } catch (e) {} });
      return next.length > DASH_IDX.combinations ? null : next;
    };
    const tplAttr = (chain, k) => { for (let i = 0; i < chain.length; i++) { const t = dashKid(chain[i], 'SegmentTemplate'); if (t && t.getAttribute(k) != null) return t.getAttribute(k); } return null; };
    const tplTimeline = (chain) => { for (let i = 0; i < chain.length; i++) { const t = dashKid(chain[i], 'SegmentTemplate'); const tl = t && dashKid(t, 'SegmentTimeline'); if (tl) return tl; } return null; };
    let mpdAlts;
    try { mpdAlts = altsOf(root, [{ base: new URL(mpdUrl).href, sel: [] }], 'm'); } catch (e) { return out; }
    // S3c: Nummer jeder Darstellung in Dokumentreihenfolge über alle Perioden – dieselbe wie beim Helper (Plan, "played");
    // S4b-6: ebenso Perioden und Sets (Schlüssel der Auswahl p<n>, s<n>, r<n>)
    let g = -1, gs = -1, gp = -1, built = 0;
    dashKids(root, 'Period').forEach((per) => {
      gp++;
      const perAlts = altsOf(per, mpdAlts, 'p' + gp);
      dashKids(per, 'AdaptationSet').forEach((a) => {
        gs++;
        const aAlts = altsOf(a, perAlts, 's' + gs);
        dashKids(a, 'Representation').forEach((r) => {
          g++;
          if (built >= DASH_IDX.reps) return;
          const rAlts = altsOf(r, aAlts, 'r' + g);
          if (!rAlts) { out.overflow = true; return; }
          built++;
          const seen = new Set();
          rAlts.forEach((alt) => {
            if (out.reps.length >= DASH_IDX.records) { out.overflow = true; return; }
            const rec = dashIndexRep(r, a, per, alt.base, g, gs, alt.sel.join(';'), out, upq && upq[g] === true ? upQuery : null);
            if (!rec) return;
            // gleiche Adressen über verschiedene Alternativen: einmal (die erste Alternative in Dokumentreihenfolge)
            const sig = rec.mode === 'list' ? 'L|' + Array.from(rec.list.keys()).join('\n') + '|' + rec.init : rec.re.source + '|' + rec.init;
            if (seen.has(sig)) return;
            seen.add(sig);
            out.reps.push(rec);
          });
        });
      });
    });
    return out;
  }
  // Eintrag einer Darstellung für EINE Basis (src/038 vor S4b-6: die einzige) – null, wenn keine Stückfolge erkennbar
  function dashIndexRep(r, a, per, base, g, gs, alt, out, q) {
    const tplAttr = (chain, k) => { for (let i = 0; i < chain.length; i++) { const t = dashKid(chain[i], 'SegmentTemplate'); if (t && t.getAttribute(k) != null) return t.getAttribute(k); } return null; };
    const tplTimeline = (chain) => { for (let i = 0; i < chain.length; i++) { const t = dashKid(chain[i], 'SegmentTemplate'); const tl = t && dashKid(t, 'SegmentTimeline'); if (tl) return tl; } return null; };
    {
      {
        {
          const chain = [r, a, per];
          const id = r.getAttribute('id'), bw = dashBwText(r.getAttribute('bandwidth'));
          const rep = { i: g, set: gs, alt: alt, kind: '', mode: '', prefix: '', re: null, width: 0, start: 1, times: null, dur: 0, list: null, init: '' };
          // S3c: eine Vorlage, die der Helper ablehnen würde (ungültige ID, Format, unbekannter Platzhalter), ergibt keine Muster
          const fill = (tpl) => { const x = bw === null ? null : dashTplExpand(tpl, id, bw, false, ''); return x ? x.text : null; };
          const media = tplAttr(chain, 'media');
          if (media != null) {
            // genau EIN Zahlen-Platzhalter (sonst ist die Stücknummer nicht eindeutig ablesbar)
            const ex = bw === null ? null : dashTplExpand(media, id, bw, true, '\u0001');
            if (!ex) { out.single++; return null; }
            const hasNum = ex.kind === 'number', hasTime = ex.kind === 'time';
            // Marke nur aus Ziffern, kollisionsfrei gegen Vorlage, eingesetzte Werte und Basis (siehe dashMark)
            // (S4b-8: die Marke darf auch in der angehängten Annex-I-Query nicht vorkommen)
            const tok = dashMark(ex.text + '\n' + (q || ''), base);
            let abs = '';
            try { abs = dashUrlKey(new URL(dashUpAppend(new URL(ex.text.replace('\u0001', tok), base).href, q)).href); } catch (e) { abs = ''; }
            if (!abs || abs.split(tok).length !== 2) { out.single++; return null; }
            const parts = abs.split(tok);
            try { if (new URL(abs).origin.indexOf(tok) >= 0) { out.single++; return null; } } catch (e) { out.single++; return null; }   // Marke im Host
            rep.width = ex.width;
            rep.prefix = parts[0];
            rep.re = new RegExp('^' + dashEsc(parts[0]) + '(\\d{1,20})' + dashEsc(parts[1]) + '$');
            // nur für die Diagnose (dashDiagClassify): Herkunft, Pfad und Query getrennt – nie für die Bindung
            try {
              const ux = new URL(abs);
              if (ux.origin.indexOf(tok) < 0) { rep.dOrigin = ux.origin; rep.dPath = new RegExp('^' + dashEsc(ux.pathname).replace(tok, '(\\d{1,20})') + '$'); rep.dQuery = new RegExp('^' + dashEsc(ux.search).replace(tok, '(\\d{1,20})') + '$'); }
            } catch (e) {}
            rep.mode = hasNum ? 'number' : 'time';
            rep.start = hasNum ? (dashInt(tplAttr(chain, 'startNumber'), 0, 1e9) ?? 1) : 0;
            if (hasTime) {
              const tl = tplTimeline(chain);
              if (tl) {
                rep.times = new Map();
                let t = 0, n = 0;
                const ss = dashKids(tl, 'S');
                for (let k = 0; k < ss.length && n < DASH_IDX.timeline; k++) {
                  const S = ss[k], d = Number(S.getAttribute('d'));
                  if (S.getAttribute('t') != null) t = Number(S.getAttribute('t'));
                  let rr = Number(S.getAttribute('r') || 0);
                  if (!(d > 0) || !isFinite(t)) break;
                  if (rr < 0) { const nx = ss[k + 1] && ss[k + 1].getAttribute('t') != null ? Number(ss[k + 1].getAttribute('t')) : NaN; rr = isFinite(nx) ? Math.max(0, Math.ceil((nx - t) / d) - 1) : DASH_IDX.timeline; }
                  for (let j = 0; j <= rr && n < DASH_IDX.timeline; j++) { rep.times.set(String(t), n++); t += d; }
                }
              } else rep.dur = Number(tplAttr(chain, 'duration')) || 0;
              if (!rep.times && !(rep.dur > 0)) { out.single++; return null; }
            }
            const ini = tplAttr(chain, 'initialization');
            const iniText = ini ? fill(ini) : null;
            if (iniText) { try { rep.init = dashUrlKey(new URL(dashUpAppend(new URL(iniText, base).href, q)).href); } catch (e) {} }
          } else {
            let sl = null;
            for (let i = 0; i < chain.length && !sl; i++) sl = dashKid(chain[i], 'SegmentList');
            const urls = sl ? dashKids(sl, 'SegmentURL').map((x) => x.getAttribute('media')).filter((x) => x) : [];
            if (!urls.length) { out.single++; return null; }   // SegmentBase/Einzeldatei/nur mediaRange: keine Stückfolge
            rep.mode = 'list'; rep.list = new Map();
            urls.slice(0, DASH_IDX.list).forEach((m, k) => { try { const key = dashUrlKey(new URL(dashUpAppend(new URL(m, base).href, q)).href); if (key && !rep.list.has(key)) rep.list.set(key, k); } catch (e) {} });
            if (rep.list.size < 2) { out.single++; return null; }   // alle auf dieselbe Datei (Byte-Bereiche): keine Folge erkennbar
            // nur für die Diagnose: dieselben Stücke ohne Query (Herkunft+Pfad) und nur nach Pfad
            rep.dList = new Set(); rep.dListPath = new Set();
            rep.list.forEach((k, key) => { try { const ux = new URL(key); rep.dList.add(ux.origin + ux.pathname); rep.dListPath.add(ux.pathname); } catch (e) {} });
            const ini = dashKid(sl, 'Initialization');
            if (ini && ini.getAttribute('sourceURL')) { try { rep.init = dashUrlKey(new URL(dashUpAppend(new URL(ini.getAttribute('sourceURL'), base).href, q)).href); } catch (e) {} }
          }
          if (rep.init) { try { const ux = new URL(rep.init); rep.dInitOP = ux.origin + ux.pathname; rep.dInitPath = ux.pathname; } catch (e) {} }
          const ct = String(a.getAttribute('contentType') || '').toLowerCase(), mime = String(r.getAttribute('mimeType') || a.getAttribute('mimeType') || '').toLowerCase();
          rep.kind = /^(video|audio|text|image)$/.test(ct) ? ct : /^video\//.test(mime) ? 'video' : /^audio\//.test(mime) ? 'audio' : 'other';
          return rep;
        }
      }
    }
  }
  // Ein beobachteter Abruf (Schlüssel dashUrlKey: volle Adresse ohne #) → { rep, idx } oder null; init → { rep, init: true }
  // S4b-6: jede Alternative ist ein eigener Eintrag. Passt eine Adresse zu Einträgen VERSCHIEDENER Alternativen, die
  // verschiedene Darstellungen bzw. Stücke beschreiben, ist sie kein Beleg (null – keine eindeutige Alternative). Dieselbe
  // Darstellung/dasselbe Stück über mehrere Alternativen: die erste (Dokumentreihenfolge). Innerhalb derselben Alternative wie
  // bisher der erste Eintrag (unverändert gegenüber S3c).
  function dashMatchSegment(index, key) {
    if (!index || !key) return null;
    let hit = null;
    for (let i = 0; i < index.reps.length; i++) {
      const m = dashMatchOne(index.reps[i], key);
      if (!m) continue;
      if (!hit) { hit = m; continue; }
      if ((hit.alt || '') === (m.alt || '')) continue;
      if (hit.rep !== m.rep || hit.idx !== m.idx || !!hit.init !== !!m.init) return null;
    }
    return hit;
  }
  function dashMatchOne(r, key) {
    {
      const w = (x) => (r.alt ? Object.assign(x, { alt: r.alt }) : x);   // (Alternative nur, wenn das MPD welche hat)
      if (r.init && r.init === key) return w({ rep: r.i, init: true });
      if (r.mode === 'list') { const k = r.list.get(key); if (k !== undefined) return w({ rep: r.i, idx: k }); return null; }
      if (!r.re || key.indexOf(r.prefix) !== 0) return null;
      const m = r.re.exec(key);
      if (!m) return null;
      // S3c: genau die Schreibweise, die die Vorlage erzeugt (%0[w]d: auf w Stellen mit Nullen; ohne Format: keine
      // führenden Nullen) – "seg-7" ist nicht das Stück "seg-00007"; Werte nur bis 2^53−1 (exakt wie beim Helper)
      const nv = m[1].length <= 16 ? Number(m[1]) : NaN;
      if (!Number.isSafeInteger(nv) || String(nv).padStart(r.width || 0, '0') !== m[1]) return null;
      if (r.mode === 'number') { const n = Number(m[1]) - r.start; return n >= 0 ? w({ rep: r.i, idx: n }) : null; }
      if (r.times) { const k = r.times.get(String(Number(m[1]))); return k !== undefined ? w({ rep: r.i, idx: k }) : null; }
      if (r.dur > 0) { const q = Number(m[1]) / r.dur; if (Number.isInteger(q)) return w({ rep: r.i, idx: q }); }
    }
    return null;
  }
  // NUR DIAGNOSE (DASH-Diagnose Stufe 1): ordnet einen beobachteten Abruf stufenweise einem gelesenen MPD zu, damit die
  // anonymisierte Diagnose zeigt, WARUM es keine Treffer gibt. 'exact'/'init' ist genau die Evidenz von dashMatchSegment
  // (Bindung); alle anderen Stufen sind unscharf und fließen NIE in dashHit/dashBindDecision ein – nur als Zählung:
  //   'number'      Herkunft, Pfad und Query passen zum Muster, aber die Nummer/Zeit liegt nicht in der Folge/Zeitleiste
  //   'query'       gleiche Herkunft, Pfad passt zum Muster, Query weicht ab   ('init-query' ebenso für das Init)
  //   'host'        Pfad passt zum Muster, andere Herkunft (Host)               ('init-host' ebenso für das Init)
  //   'none'        kein struktureller Treffer
  const DASH_DIAG_RANK = { none: 0, 'init-host': 1, host: 2, 'init-query': 3, query: 4, number: 5 };
  function dashDiagClassify(index, key) {
    const m = dashMatchSegment(index, key);
    if (m) return m.init ? 'init' : 'exact';
    let u;
    try { u = new URL(key); } catch (e) { return 'none'; }
    const o = u.origin, p = u.pathname, q = u.search;
    let best = 'none';
    const take = (c) => { if (DASH_DIAG_RANK[c] > DASH_DIAG_RANK[best]) best = c; };
    ((index && index.reps) || []).forEach((r) => {
      if (r.dInitPath && r.dInitPath === p) take(r.dInitOP === o + p ? 'init-query' : 'init-host');
      if (r.dPath && r.dPath.test(p)) take(r.dOrigin !== o ? 'host' : r.dQuery.test(q) ? 'number' : 'query');
      if (r.dList) { if (r.dList.has(o + p)) take('query'); else if (r.dListPath.has(p)) take('host'); }
    });
    return best;
  }
  // Reine Entscheidung „ist dieses Manifest an das laufende Video gebunden?“ – nur aus beobachteten Stückabrufen.
  // c = { manifests: [{ key, hits: [{ rep, idx, t }], duration, checkable }], from, now, video: { duration, othersPlaying } }
  // bound nur, wenn GENAU EIN Manifest in diesem Fenster seit dem Start dieses Mediums mindestens DASH_RUN aufeinander-
  // folgende Stücke derselben Darstellung als ZUSAMMENHÄNGENDE Abrufserie geladen hat: alle Abrufe der Folge innerhalb von
  // DASH_SPAN ms (Reihenfolge der Abrufe egal, Wiederholungen einzelner Stücke zählen einmal) und die Serie endet vor höchstens
  // DASH_RECENT ms. Drei irgendwann beobachtete benachbarte Nummern (alt + neu) binden nicht. Sonst ambiguous mit Grund.
  // Zeitliche Nähe allein bindet nie. (Sehr lange Stücke – über ~20 s – können so ambiguous bleiben: bewusst vorsichtig.)
  const DASH_RUN = 3, DASH_RECENT = 20000, DASH_SPAN = 45000;
  function dashBindDecision(c) {
    const res = {}, now = c.now, from = c.from || 0, vid = c.video || {};
    const runOf = (xs) => { let best = 0, cur = 0, prev = -2; xs.forEach((x) => { cur = x === prev + 1 ? cur + 1 : 1; prev = x; if (cur > best) best = cur; }); return best; };
    // längste Folge je Darstellung innerhalb eines Zeitfensters [Ende − DASH_SPAN, Ende]; Enden = Abrufzeiten.
    // any: über alle Fenster; recent: nur Fenster, deren Ende höchstens DASH_RECENT zurückliegt
    const coherent = (hs) => {
      const byT = hs.slice().sort((a, b) => a.t - b.t).slice(-600);
      let any = 0, recent = 0, s = 0;
      for (let e = 0; e < byT.length; e++) {
        while (byT[e].t - byT[s].t > DASH_SPAN) s++;
        const sets = new Map();
        for (let i = s; i <= e; i++) { const h = byT[i]; if (!sets.has(h.rep)) sets.set(h.rep, new Set()); sets.get(h.rep).add(h.idx); }
        let run = 0;
        sets.forEach((set) => { run = Math.max(run, runOf(Array.from(set).sort((a, b) => a - b))); });
        any = Math.max(any, run);
        if (now - byT[e].t <= DASH_RECENT) recent = Math.max(recent, run);
      }
      return { any: any, recent: recent };
    };
    const qual = [];
    (c.manifests || []).forEach((m) => {
      // S4b-4: zur Medien-Epoche gehört ein Abruf, der nach ihrem Beginn ANGEFRAGT wurde (s). S4b-6 P1: ohne bekannten
      // Anfragebeginn (s fehlt/null) ist die Zugehörigkeit nicht belegt – solche Abrufe zählen NIE (nur als start-unknown)
      const known = (h) => typeof h.s === 'number' && isFinite(h.s) && h.s > 0;
      const valid = (m.hits || []).filter((h) => Number.isInteger(h.idx));
      const hs = valid.filter((h) => known(h) && h.s >= from);
      const unknown = valid.filter((h) => !known(h) && h.t >= from).length;
      const by = new Map();
      hs.forEach((h) => { if (!by.has(h.rep)) by.set(h.rep, new Set()); by.get(h.rep).add(h.idx); });
      let n = 0;
      by.forEach((set) => { n += set.size; });
      const last = hs.reduce((x, h) => Math.max(x, h.t), 0);
      const co = coherent(hs);
      const r = { state: 'ambiguous', reason: '', hits: n, reps: by.size, run: co.recent, last: last, unknownStart: unknown };
      res[m.key] = r;
      if (m.urlparam) { r.reason = 'urlparam'; return; }   // S4b-8: Annex I nicht (sicher) auswertbar – keine Bindung
      if (!m.checkable || m.overflow) { r.reason = 'nicht-pruefbar'; return; }
      if (!n) { r.reason = unknown ? 'start-unknown' : 'keine-treffer'; return; }
      // S4b-6: Alternative (BaseURL) der Treffer – je Darstellung genau eine (kein stiller CDN-Wechsel in einer Folge),
      // über alle Darstellungen widerspruchsfrei (gleiche Wahl für gemeinsame Ebenen); daraus die Auswahl für den Helfer
      const altBy = new Map(), pick = new Map();
      let mixed = false, competing = false;
      hs.forEach((h) => {
        const a = typeof h.alt === 'string' ? h.alt : '';
        if (!altBy.has(h.rep)) altBy.set(h.rep, a); else if (altBy.get(h.rep) !== a) mixed = true;
        a.split(';').filter(Boolean).forEach((t) => { const i = t.indexOf(':'), k = t.slice(0, i), v = t.slice(i + 1); if (pick.has(k) && pick.get(k) !== v) competing = true; pick.set(k, v); });
      });
      if (mixed) { r.reason = 'alt-mixed'; return; }
      if (competing) { r.reason = 'alt-competing'; return; }
      const order = (x, y) => { const kx = 'mpsr'.indexOf(x[0]), ky = 'mpsr'.indexOf(y[0]); return kx !== ky ? kx - ky : (Number(x.slice(1)) || 0) - (Number(y.slice(1)) || 0); };
      r.alt = Array.from(pick.keys()).sort(order).map((k) => k + ':' + pick.get(k)).join(';');
      // keine zusammenhängende Serie: entweder nie (zu-wenig-folge) oder nur früher (nicht-aktiv, z. B. Werbung vorher)
      if (co.any < DASH_RUN) { r.reason = 'zu-wenig-folge'; return; }
      if (vid.othersPlaying) { r.reason = 'mehrere-videos'; return; }
      if (m.duration > 0 && vid.duration > 0 && isFinite(vid.duration) && Math.abs(m.duration - vid.duration) > Math.max(4, m.duration * 0.015)) { r.reason = 'dauer-abweicht'; return; }
      if (co.recent < DASH_RUN) { r.reason = 'nicht-aktiv'; return; }
      qual.push(m.key);
    });
    if (qual.length === 1) Object.assign(res[qual[0]], { state: 'bound', reason: 'stueckfolge' });
    else qual.forEach((k) => { res[k].reason = 'konkurrenz'; });
    return res;
  }
  // =================================================
