'use strict';
// Testdateien, die als „vollständige MP4“ zum Herunterladen dienen, müssen auf Android abspielbar sein (Gerätetest R2:
// gespeicherte Datei spielte nicht – sie war VP9 Profil 1, RGB 4:4:4, das nur Software-Decoder am Desktop können).
// Geprüft direkt in den MP4-Boxen (kein ffprobe nötig): avc1 → Profil Baseline/Main/High, 8 Bit 4:2:0 (avcC);
// vp09 → Profil 0, 8 Bit, 4:2:0 (vpcC). Andere Video-Codecs werden abgelehnt.
// Zusätzlich (Gerätetest R2-Nachtest: Datei hatte nur 12 s, der HLS-Stream 60 s): Jede MP4, die die öffentliche
// Testseite am selben Videoelement wie den HLS-Stream nennt, muss denselben vollständigen Clip enthalten – genau eine
// Bild- und eine Tonspur wie das HLS-Init, Dauer (mvhd und jede Spur) = Summe der EXTINF der Medienliste (±0,25 s),
// Seitenverhältnis wie RESOLUTION, Höhe wie das size-Attribut. Bildinhalt: tests/media_fixture_match.py (ffmpeg).
//   node tests/media_fixture_check.js
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, 'web');
const PAGE = 'public/c3-hls-mp4.html';
const pageHtml = fs.readFileSync(path.join(WEB, PAGE), 'utf8');
const declared = [...pageHtml.matchAll(/<source\s+src="([^"]+\.mp4)"[^>]*\bsize="(\d+)"/g)].map((m) => ({ f: path.posix.join('public', m[1]), size: +m[2] }));
// Lokale Download-Testdateien (12-s-Ausschnitte für Abruf-/Abbruchtests, nirgends als Alternative eines Streams genannt)
const files = ['clip.mp4', 'clip-180.mp4', ...declared.map((d) => d.f)];

function boxes(buf, start, end, cb) {
  for (let i = start; i + 8 <= end;) {
    let n = buf.readUInt32BE(i); const t = buf.toString('latin1', i + 4, i + 8); let h = 8;
    if (n === 1) { n = Number(buf.readBigUInt64BE(i + 8)); h = 16; } else if (n === 0) n = end - i;
    if (n < h || i + n > end) throw new Error('box ' + t + ' out of range');
    cb(t, i + h, i + n);
    i += n;
  }
}
function videoEntries(buf) {
  const out = [];
  const walk = (s, e) => boxes(buf, s, e, (t, a, b) => {
    if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(t)) walk(a, b);
    else if (t === 'stsd') {
      boxes(buf, a + 8, b, (et, ea, eb) => {   // (stsd: version/flags + Anzahl)
        if (et !== 'avc1' && et !== 'vp09' && et !== 'hvc1' && et !== 'av01' && et !== 'mp4v') return;
        const cfg = {};
        boxes(buf, ea + 78, eb, (ct, ca, cb2) => { cfg[ct] = buf.subarray(ca, cb2); });   // VisualSampleEntry: 78 Byte
        out.push({ type: et, cfg });
      });
    }
  });
  walk(0, buf.length);
  return out;
}
function check(f) {
  const buf = fs.readFileSync(path.join(WEB, f));
  if (buf.toString('latin1', 4, 8) !== 'ftyp') return 'no ftyp';
  const v = videoEntries(buf);
  if (v.length !== 1) return v.length + ' video tracks';
  const e = v[0];
  if (e.type === 'avc1') {
    const c = e.cfg.avcC; if (!c) return 'avc1 without avcC';
    if (![66, 77, 100].includes(c[1])) return 'H.264 profile ' + c[1];
    if (c[1] === 100 && c.length > 7) {   // High: chroma_format_idc / Bittiefe am Ende der avcC (falls vorhanden)
      const sps = 6 + 2 + c.readUInt16BE(6), pps = sps + 1 + 2 + c.readUInt16BE(sps + 1);
      if (c.length >= pps + 3 && ((c[pps] & 3) !== 1 || (c[pps + 1] & 7) !== 0)) return 'H.264 High not 8-bit 4:2:0';
    }
    return '';
  }
  if (e.type === 'vp09') {
    const c = e.cfg.vpcC; if (!c) return 'vp09 without vpcC';
    const profile = c[4], bitDepth = c[6] >> 4, chroma = (c[6] >> 1) & 7;
    if (profile !== 0) return 'VP9 profile ' + profile;
    if (bitDepth !== 8) return 'VP9 bit depth ' + bitDepth;
    if (chroma > 1) return 'VP9 chroma subsampling ' + chroma + ' (not 4:2:0)';
    return '';
  }
  return 'codec ' + e.type + ' not in the Android baseline';
}
// ---------- Dauer und Spuren (mvhd/tkhd/mdhd/hdlr) ----------
function structure(buf) {
  const out = { duration: -1, tracks: [] };
  let cur = null;
  const full = (a) => buf[a];   // Version einer FullBox
  const walk = (s, e) => boxes(buf, s, e, (t, a, b) => {
    if (t === 'moov' || t === 'mdia' || t === 'minf') walk(a, b);
    else if (t === 'trak') { cur = { handler: '', duration: -1, width: 0, height: 0 }; out.tracks.push(cur); walk(a, b); }
    else if (t === 'mvhd') {
      const v1 = full(a) === 1, ts = buf.readUInt32BE(a + (v1 ? 20 : 12));
      const d = v1 ? Number(buf.readBigUInt64BE(a + 24)) : buf.readUInt32BE(a + 16);
      out.duration = d / ts;
    } else if (t === 'tkhd' && cur) {
      const off = full(a) === 1 ? 88 : 76;   // Breite/Höhe 16.16 am Ende der tkhd
      cur.width = buf.readUInt32BE(a + off) / 65536; cur.height = buf.readUInt32BE(a + off + 4) / 65536;
    } else if (t === 'mdhd' && cur) {
      const v1 = full(a) === 1, ts = buf.readUInt32BE(a + (v1 ? 20 : 12));
      cur.duration = (v1 ? Number(buf.readBigUInt64BE(a + 24)) : buf.readUInt32BE(a + 16)) / ts;
    } else if (t === 'hdlr' && cur) cur.handler = buf.toString('latin1', a + 8, a + 12);
  });
  walk(0, buf.length);
  return out;
}
const kinds = (st) => st.tracks.map((x) => x.handler).filter((h) => h === 'vide' || h === 'soun').sort().join('+');
// HLS-Testmaterial der Seite: Master → Medienliste → Summe EXTINF, Init-Spuren, Auflösung
function hlsReference() {
  const src = /loadSource\('([^']+)'\)/.exec(pageHtml);
  if (!src) throw new Error('page has no HLS source');
  const masterPath = path.join(WEB, 'public', src[1]);
  const master = fs.readFileSync(masterPath, 'utf8');
  const inf = /#EXT-X-STREAM-INF:[^\n]*RESOLUTION=(\d+)x(\d+)[^\n]*\n([^\n#]+)/.exec(master);
  if (!inf) throw new Error('master without RESOLUTION/variant');
  const listPath = path.join(path.dirname(masterPath), inf[3].trim());
  const list = fs.readFileSync(listPath, 'utf8');
  if (!/#EXT-X-ENDLIST/.test(list)) throw new Error('media playlist is not VOD/complete');
  const total = [...list.matchAll(/#EXTINF:([\d.]+)/g)].reduce((a, m) => a + parseFloat(m[1]), 0);
  const map = /#EXT-X-MAP:URI="([^"]+)"/.exec(list);
  const init = structure(fs.readFileSync(path.join(path.dirname(listPath), map[1])));
  return { total, width: +inf[1], height: +inf[2], kinds: kinds(init) };
}
function matchHls(d, ref) {
  const st = structure(fs.readFileSync(path.join(WEB, d.f)));
  if (kinds(st) !== ref.kinds) return 'tracks ' + (kinds(st) || 'none') + ' (HLS: ' + ref.kinds + ')';
  if (Math.abs(st.duration - ref.total) > 0.25) return 'duration ' + st.duration.toFixed(3) + ' s (HLS: ' + ref.total.toFixed(3) + ' s)';
  for (const t of st.tracks) if (Math.abs(t.duration - ref.total) > 0.25) return t.handler + ' track ' + t.duration.toFixed(3) + ' s (HLS: ' + ref.total.toFixed(3) + ' s)';
  const v = st.tracks.find((t) => t.handler === 'vide');
  if (Math.round(v.height) !== d.size) return 'video height ' + v.height + ' but size="' + d.size + '"';
  if (Math.abs(v.width / v.height - ref.width / ref.height) > 0.02) return 'aspect ' + v.width + 'x' + v.height + ' (HLS ' + ref.width + 'x' + ref.height + ')';
  return '';
}
let bad = 0;
for (const f of files) { const r = check(f); if (r) { bad++; console.error('FAIL ' + f + ': ' + r); } else console.log('ok   ' + f); }
const ref = hlsReference();
if (declared.length < 2) { bad++; console.error('FAIL ' + PAGE + ': expected two declared MP4 alternatives, found ' + declared.length); }
for (const d of declared) { const r = matchHls(d, ref); if (r) { bad++; console.error('FAIL ' + d.f + ' vs HLS: ' + r); } else console.log('ok   ' + d.f + ' = HLS (' + ref.total.toFixed(2) + ' s, ' + ref.kinds + ', ' + d.size + 'p)'); }
// Gegenprobe: der alte 12-s-Ausschnitt muss an der Dauerprüfung scheitern
if (!/^duration|track/.test(matchHls({ f: 'clip.mp4', size: 360 }, ref))) { bad++; console.error('FAIL self-test: 12 s excerpt not rejected'); }
if (bad) process.exit(1);
console.log('PASS: downloadable MP4 fixtures are Android-playable; declared alternatives match the HLS clip (duration, tracks, size)');
