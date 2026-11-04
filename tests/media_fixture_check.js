'use strict';
// Testdateien, die als „vollständige MP4“ zum Herunterladen dienen, müssen auf Android abspielbar sein (Gerätetest R2:
// gespeicherte Datei spielte nicht – sie war VP9 Profil 1, RGB 4:4:4, das nur Software-Decoder am Desktop können).
// Geprüft direkt in den MP4-Boxen (kein ffprobe nötig): avc1 → Profil Baseline/Main/High, 8 Bit 4:2:0 (avcC);
// vp09 → Profil 0, 8 Bit, 4:2:0 (vpcC). Andere Video-Codecs werden abgelehnt.
//   node tests/media_fixture_check.js
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, 'web');
const files = ['clip.mp4', 'clip-180.mp4', 'public/clip-360-h264.mp4'];

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
let bad = 0;
for (const f of files) { const r = check(f); if (r) { bad++; console.error('FAIL ' + f + ': ' + r); } else console.log('ok   ' + f); }
if (bad) process.exit(1);
console.log('PASS: downloadable MP4 fixtures are Android-playable (H.264 8-bit 4:2:0 or VP9 profile 0)');
