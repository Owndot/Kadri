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
  function dashManifestSummary(text) {
    const out = { format: 'dash', v: 1, error: '', type: 'unknown', periods: 0, adaptationSets: 0, representations: 0, duration: null,
      addressing: [], protection: { signaled: false, systems: [], defaultKid: false }, tracks: [] };
    const fail = (e) => Object.assign(out, { error: e, type: 'unknown', periods: 0, adaptationSets: 0, representations: 0, duration: null,
      addressing: [], protection: { signaled: false, systems: [], defaultKid: false }, tracks: [] });
    if (typeof text !== 'string' || !text) return fail('parse');
    if (text.length > DASH_LIMITS.chars) return fail('too-large');
    // DOCTYPE/ENTITY nie an den Parser (interne Entitäten-Bomben, externe Entitäten)
    if (/<!\s*(DOCTYPE|ENTITY)/i.test(text)) return fail('doctype');
    let doc = null;
    try { doc = new DOMParser().parseFromString(text, 'application/xml'); } catch (e) { return fail('parse'); }
    if (!doc || !doc.documentElement || doc.getElementsByTagName('parsererror').length) return fail('parse');
    const root = doc.documentElement;
    if (root.localName !== 'MPD') return fail('not-mpd');
    if (doc.getElementsByTagName('*').length > DASH_LIMITS.elements) return fail('limits');
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
  // =================================================
