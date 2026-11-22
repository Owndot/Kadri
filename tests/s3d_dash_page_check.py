#!/usr/bin/env python3
"""S3d-Gerätetest: die öffentliche DASH-Testseite tests/web/public/s3d-dash.html ist vollständig und unverändert.
Die Medien sind genau die in S3c/S3d geprüfte Fixture (tests/make_dash_source.sh, bitexact; identisch mit der Helper-
Fixture tests/java/dashdl/make-dash-fixtures.sh avc/). Geprüft: S3-Profil (statisch, eine Periode, ohne ContentProtection,
H.264 avc1 + AAC-LC mp4a.40.2 in fMP4, SegmentTemplate + SegmentTimeline, $Number%05d$), jede im MPD beschriebene Datei
vorhanden und gelistet, SHA256SUMS vollständig und korrekt, keine fremde Datei, die Seite lädt nur dieses MPD. Mit ffmpeg
(optional, KADRI_REGEN=1): Neuerzeugung mit tests/make_dash_source.sh ergibt bit-gleiche Dateien."""
import hashlib, os, re, subprocess, sys, tempfile
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, 'web', 'public')
FIX = os.path.join(ROOT, 's3d-dash')
NS = {'d': 'urn:mpeg:dash:schema:mpd:2011'}
page = open(os.path.join(ROOT, 's3d-dash.html'), encoding='utf-8').read()
assert re.findall(r"'(s3d-dash/[^']+)'", page) == ['s3d-dash/manifest.mpd'], 'Seite lädt genau dieses MPD'
assert not re.search(r'https?://', page.split('<script>')[1]), 'Seite lädt nichts von fremden Adressen'
mpd_text = open(os.path.join(FIX, 'manifest.mpd'), encoding='utf-8').read()
assert '<!DOCTYPE' not in mpd_text and 'ContentProtection' not in mpd_text and 'BaseURL' not in mpd_text
root = ET.fromstring(mpd_text)
assert root.get('type') == 'static' and root.get('mediaPresentationDuration') == 'PT20.0S'
periods = root.findall('d:Period', NS)
assert len(periods) == 1
used = {'manifest.mpd'}
kinds = {}
for a in periods[0].findall('d:AdaptationSet', NS):
    for r in a.findall('d:Representation', NS):
        mime, codecs, rid = r.get('mimeType'), r.get('codecs'), r.get('id')
        if mime == 'video/mp4': assert re.fullmatch(r'avc1\.[0-9a-f]{6}', codecs), codecs
        else: assert mime == 'audio/mp4' and codecs == 'mp4a.40.2', (mime, codecs)   # nur AAC-LC (S3)
        kinds.setdefault(mime, []).append(rid)
        t = r.find('d:SegmentTemplate', NS)
        assert t.get('media') == 'chunk-$RepresentationID$-$Number%05d$.m4s' and t.get('initialization') == 'init-$RepresentationID$.m4s'
        n = sum(int(s.get('r', '0')) + 1 for s in t.find('d:SegmentTimeline', NS).findall('d:S', NS))
        assert n >= 3, 'mindestens drei aufeinanderfolgende Stücke'
        used.add('init-%s.m4s' % rid)
        used.update('chunk-%s-%05d.m4s' % (rid, i) for i in range(int(t.get('startNumber')), int(t.get('startNumber')) + n))
assert kinds == {'video/mp4': ['0', '1'], 'audio/mp4': ['2']}, kinds
sums = dict(reversed(l.rstrip('\n').split('  ', 1)) for l in open(os.path.join(FIX, 'SHA256SUMS'), encoding='utf-8'))
files = {f for f in os.listdir(FIX) if f != 'SHA256SUMS'}
assert files == set(sums) == used, ('Dateien/SHA256SUMS/MPD', sorted(files ^ used), sorted(set(sums) ^ used))
for f, h in sums.items():
    assert hashlib.sha256(open(os.path.join(FIX, f), 'rb').read()).hexdigest() == h, f
if os.environ.get('KADRI_REGEN') == '1':
    out = tempfile.mkdtemp(prefix='s3d-dash-regen-')
    subprocess.run(['bash', os.path.join(HERE, 'make_dash_source.sh'), out], check=True)
    for f in files:
        assert open(os.path.join(out, f), 'rb').read() == open(os.path.join(FIX, f), 'rb').read(), 'nicht bit-gleich: ' + f
    print('PASS: Neuerzeugung mit tests/make_dash_source.sh bit-gleich (%d Dateien)' % len(files))
print('PASS: S3d-DASH-Testseite – S3-Profil, %d Dateien vollständig, gelistet und gehasht' % len(files))
