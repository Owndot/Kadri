"""P2: Wirkungen der eigenen Typprobe – gemessen, begrenzt und ohne Freigabewirkung.

Zwei echte HTTP-Server. Gemessen werden serverseitig die GETs je Adresse samt Range-Kopf. Die Probe ist ein zusätzlicher
Abruf; diese Prüfung belegt, wie oft er stattfindet und dass keine seiner Fehlerfolgen etwas freigibt. Sie behauptet
nicht, dass das Abbrechen nach 4096 Bytes eine Übertragung verhindert."""
import os

import nocors_servers as S
from common import check, done, results, shutdown, sync_playwright
from type_evidence_lib import setup

M = S.MEDIA


def gets(path, since):
    return [e for e in S.LOG[since:] if e[0] == path]


def run(page):
    setup(page, None)
    # Genau ein Probe-GET je Adresse, mit Range 0-4095, auch bei wiederholter Anfrage
    u = M + 'f/one.mp4?cors=1'
    since = len(S.LOG)
    r = page.evaluate('async u => [await k.mediaProbe(u), await k.mediaProbe(u), await k.mediaProbe(u + "#t=3")]', u)
    g = gets('/f/one.mp4?cors=1', since)
    check('Ein Probe-GET je Adresse (Fragment ohne Wirkung), Range bytes=0-4095', r == ['file'] * 3 and len(g) == 1 and g[0][1] == 'bytes=0-4095',
          dict(result=r, gets=len(g), range=g[0][1] if g else None))

    # Einmaladresse: die Probe verbraucht sie (dokumentierte Wirkung); ein danach abgelehnter Abruf gibt nichts frei
    u = M + 'm/once.mp4?cors=1&once=1'
    since = len(S.LOG)
    r = page.evaluate('async u => ({probe: await k.mediaProbe(u), type: k.mediaTypeOf(u), start: k.hlsNativeStartAllowed({}, u),'
                      ' second: (await fetch(u)).status})', u)
    check('Einmaladresse: Probe ist der erste Abruf und verbraucht sie (gemessen), Befund HLS, keine native Freigabe',
          r == dict(probe='hls', type='hls', start=False, second=403) and len(gets('/m/once.mp4?cors=1&once=1', since)) == 2,
          dict(gets=len(gets('/m/once.mp4?cors=1&once=1', since)), **r))

    # Server ignoriert Range: Antwort 200 mit ganzer Länge; Kadri liest höchstens 4096 Bytes und bricht ab
    u = M + 'f/norange.mp4?cors=1&norange=1'
    since = len(S.LOG)
    r = page.evaluate('async u => ({probe: await k.mediaProbe(u), type: k.mediaTypeOf(u)})', u)
    g = gets('/f/norange.mp4?cors=1&norange=1', since)
    check('Range ignoriert (Server sendet 200 mit %d Bytes): ein GET, Befund aus den ersten Bytes, Lesen danach abgebrochen' % len(S.CLIP),
          r == dict(probe='file', type='file') and len(g) == 1, dict(gets=len(g), contentLength=len(S.CLIP), **r))

    # Vorübergehender Fehler: 30 s unbelegt, keine Wiederholung in dieser Zeit, nie Freigabe – auch nicht nach Ablauf
    u = M + 'f/flaky.mp4?fail1=503'
    since = len(S.LOG)
    r = page.evaluate('''async u => { const a = await k.mediaProbe(u), b = await k.mediaProbe(u);
      return {a, b, type: k.mediaTypeOf(u), start: k.hlsNativeStartAllowed({}, u)}; }''', u)
    n1 = len(gets('/f/flaky.mp4?fail1=503', since))
    check('503 bei der Probe: unbelegt (claimed-file), 30 s keine Wiederholung, keine Freigabe',
          r == dict(a='', b='', type='claimed-file', start=False) and n1 == 1, dict(gets=n1, **r))
    page.wait_for_timeout(31000)
    r = page.evaluate('async u => ({c: await k.mediaProbe(u), type: k.mediaTypeOf(u), start: k.hlsNativeStartAllowed({}, u)})', u)
    n2 = len(gets('/f/flaky.mp4?fail1=503', since))
    check('Nach Ablauf (31 s): erneute Probe ohne CORS unlesbar, weiterhin claimed-file, keine Freigabe',
          r == dict(c='', type='claimed-file', start=False) and n2 == 2, dict(gets=n2, **r))

    # Verdrängung aus dem Probecache (257 weitere Adressen): erneute Probe derselben Adresse, Befund bleibt restriktiv
    u = M + 'm/evict.mp4?cors=1'
    since = len(S.LOG)
    r = page.evaluate('''async ([u, media]) => { const a = await k.mediaProbe(u);
      for (let i = 0; i < 257; i++) await k.mediaProbe(media + 'f/e.mp4?cors=1&i=' + i);
      const b = await k.mediaProbe(u); return {a, b, type: k.mediaTypeOf(u), start: k.hlsNativeStartAllowed({}, u)}; }''', [u, M])
    n = len(gets('/m/evict.mp4?cors=1', since))
    check('Nach Verdrängung aus dem Probecache: zweite Probe derselben Adresse (gemessen), Befund HLS bleibt, keine Freigabe',
          r == dict(a='hls', b='hls', type='hls', start=False) and n == 2, dict(gets=n, **r))


try:
    S.start()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or '/usr/bin/chromium')
        page = browser.new_page()
        page.set_default_timeout(60000)
        run(page)
        browser.close()
finally:
    S.stop()
    shutdown()
done()
raise SystemExit(0 if all(results) else 1)
