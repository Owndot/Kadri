#!/usr/bin/env python3
# Bildinhalt der öffentlichen Testseite (Gerätetest R2-Nachtest): Jede MP4, die c3-hls-mp4.html am selben Videoelement wie
# den HLS-Stream nennt, muss DENSELBEN vollständigen Clip zeigen. Verglichen werden Einzelbilder (Graustufen, 160x90, SSIM)
# der MP4 mit dem HLS-Material (Init + alle Stücke der Medienliste) über die ganze Laufzeit: gleiche Zeit → sehr ähnlich;
# Zeit um ±1 s und +5 s versetzt → deutlich unähnlicher (der Clip zeigt einen Sekundenzähler). Dazu Dauer und Spuren per
# ffprobe. Gegenprobe: der alte 12-s-Ausschnitt (tests/web/clip.mp4) muss scheitern. Braucht ffmpeg/ffprobe.
#   python3 tests/media_fixture_match.py
import json, os, posixpath, re, subprocess, sys, tempfile

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web')
PAGE = os.path.join(WEB, 'public', 'c3-hls-mp4.html')
MATCH_MIN, GAP_MIN = 0.92, 0.04


def probe(f):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,duration',
                          '-of', 'json', f], check=True, capture_output=True, text=True).stdout
    j = json.loads(out)
    return float(j['format']['duration']), sorted(s['codec_type'] for s in j['streams']), j['streams']


def ssim(a, ta, b, tb):
    r = subprocess.run(['ffmpeg', '-v', 'info', '-nostdin', '-ss', '%.3f' % ta, '-i', a, '-ss', '%.3f' % tb, '-i', b,
                        '-frames:v', '1', '-lavfi',
                        '[0:v]scale=160:90,format=gray[x];[1:v]scale=160:90,format=gray[y];[x][y]ssim', '-f', 'null', '-'],
                       capture_output=True, text=True)
    m = re.search(r'All:([0-9.]+)', r.stderr)
    return float(m.group(1)) if m else -1.0


def hls_reference(tmp):
    html = open(PAGE, encoding='utf-8').read()
    master = os.path.normpath(os.path.join(WEB, 'public', re.search(r"loadSource\('([^']+)'\)", html).group(1)))
    variant = re.search(r'#EXT-X-STREAM-INF:[^\n]*\n([^\n#]+)', open(master).read()).group(1).strip()
    lpath = os.path.join(os.path.dirname(master), variant)
    lst = open(lpath).read()
    total = sum(float(x) for x in re.findall(r'#EXTINF:([\d.]+)', lst))
    base = os.path.dirname(lpath)
    parts = [re.search(r'#EXT-X-MAP:URI="([^"]+)"', lst).group(1)] + [l.strip() for l in lst.splitlines() if l.strip() and not l.startswith('#')]
    joined = os.path.join(tmp, 'hls.mp4')
    with open(joined, 'wb') as o:
        for p in parts:
            o.write(open(os.path.join(base, p), 'rb').read())
    declared = [posixpath.normpath(posixpath.join('public', m)) for m in re.findall(r'<source\s+src="([^"]+\.mp4)"', html)]
    return total, joined, declared


def check(mp4, total, hls):
    errs = []
    dur, kinds, streams = probe(mp4)
    _, hkinds, _ = probe(hls)
    if kinds != hkinds:
        errs.append('streams %s (HLS %s)' % (kinds, hkinds))
    if abs(dur - total) > 0.25:
        errs.append('duration %.3f s (HLS %.3f s)' % (dur, total))
    for s in streams:
        if 'duration' in s and abs(float(s['duration']) - total) > 0.25:
            errs.append('%s stream %.3f s' % (s['codec_type'], float(s['duration'])))
    if errs:
        return errs
    t = 2.5
    while t < total - 0.5:
        same = ssim(mp4, t, hls, t)
        other = max(ssim(mp4, t, hls, t + o if t + o < total - 0.3 else t - abs(o)) for o in (-1, 1, 5))
        if same < MATCH_MIN or same - other < GAP_MIN:
            errs.append('t=%.1f s: SSIM same %.3f, shifted %.3f' % (t, same, other))
        t += 7.0
    return errs


def main():
    with tempfile.TemporaryDirectory() as tmp:
        total, hls, declared = hls_reference(tmp)
        bad = 0
        if len(declared) < 2:
            print('FAIL: expected two declared MP4 alternatives, found %d' % len(declared)); bad += 1
        for f in declared:
            errs = check(os.path.join(WEB, f), total, hls)
            print(('FAIL ' if errs else 'ok   ') + f + (': ' + '; '.join(errs) if errs else ' shows the same %.0f s clip as HLS' % total))
            bad += bool(errs)
        if not check(os.path.join(WEB, 'clip.mp4'), total, hls):
            print('FAIL self-test: 12 s excerpt accepted'); bad += 1
        if bad:
            sys.exit(1)
        print('PASS: declared MP4 alternatives contain the complete HLS clip (duration, streams, picture over the whole run)')


if __name__ == '__main__':
    main()
