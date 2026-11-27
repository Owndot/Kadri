"""P1: Typprobe und Ladetimer, Schließen, Fehler, Redirect sowie Längenentscheidung mit Fragment.

Zwei echte HTTP-Server mit serverseitiger Verzögerung (delay: jeder Abruf der Adresse, delay1: nur der erste, also die Probe). Gezählt werden native
Medienabrufe (Sec-Fetch-Dest: video), Kadris eigene src-Zuweisungen, hls.js-Instanzen und Abrufe an bekannte MPD-Kinder."""
import os

import nocors_servers as S
from common import check, done, results, shutdown, sync_playwright
from type_evidence_lib import kids, mark_kids, setup, snap, wait

M = S.MEDIA


def run(page):
    # Langsame, gültige Probe (9,5 s): kein nativer Start durch den 9-s-Timer, danach bewachter hls.js-Weg und Dekodierung
    S.MASTERS['slowok.mp4'] = [M + 'v/b/index.m3u8?src=slow']
    src = M + 'm/slowok.mp4?cors=1&delay1=9500'
    setup(page, src)
    since = len(S.LOG)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_timeout(9200)
    early = snap(page)
    ok = wait(page, 'decoded() && !!k.state().hls', timeout=30000)
    native = S.count('/m/slowok.mp4', since, 'video')
    page.evaluate('() => k.state() && k.closePlayer()')
    check('Probe 9,5 s: vor dem Typentscheid kein nativer Start, danach hls.js-Weg und Dekodierung',
          early['ownSrc'] == 0 and native == 0 and ok, dict(ownSrcBefore=early['ownSrc'], nativeMedia=native, hlsDecoded=ok, openBefore=early['open']))

    # Probe länger als die Probegrenze (15 s): unbekannt -> kein nativer Start, keine unendliche Wartezeit
    src = M + 'm/slowmpd.mp4?cors=1&delay=15000'
    setup(page, src)
    mark_kids(page)
    since = len(S.LOG)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_timeout(13000)
    s = snap(page)
    native = S.count('/m/slowmpd.mp4', since, 'video')
    check('Probe 15 s: nach der Probegrenze kontrolliert beendet, kein nativer Start, 0 MPD-Kind-Abrufe',
          not s['open'] and s['ownSrc'] == 0 and native == 0 and kids(since) == 0 and s['plays'] == 0,
          dict(open=s['open'], ownSrc=s['ownSrc'], nativeMedia=native, kids=kids(since), plays=s['plays']))
    page.wait_for_timeout(3000)

    # Probe 500: kein nativer Start
    setup(page, M + 'm/err.mp4?status=500')
    since = len(S.LOG)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_timeout(2500)
    s = snap(page)
    native = S.count('/m/err.mp4', since, 'video')
    check('Probe mit HTTP 500: kein nativer Start, kein Originalstart', s['ownSrc'] == 0 and native == 0 and s['plays'] == 0, dict(nativeMedia=native, **s))

    # Schließen während der Probe: späte Antwort startet nichts
    setup(page, M + 'm/closeprobe.mp4?cors=1&delay=5000')
    mark_kids(page)
    since = len(S.LOG)
    page.evaluate('() => { k.openBrowserPlayer(v); }')
    page.wait_for_timeout(1000)
    page.evaluate('() => { log.plays = 0; k.closePlayer(); }')
    page.wait_for_timeout(6000)
    s = snap(page)
    native = S.count('/m/closeprobe.mp4', since, 'video')
    check('Schließen während der Probe: keine hls.js-Instanz, kein nativer Start, kein Originalstart',
          s['hlsMade'] == 0 and s['ownSrc'] == 0 and native == 0 and s['plays'] == 0 and kids(since) == 0, dict(nativeMedia=native, **s))

    # Verzögerter Redirect (Ursprung .mp4 -> endungsloser Master, 3 s)
    S.MASTERS['redfin'] = [M + 'v/b/index.m3u8?src=red']
    setup(page, M + 'r/d.mp4?cors=1&delay=3000&to=' + M + 'm/redfin?cors=1')
    since = len(S.LOG)
    page.evaluate('k.openBrowserPlayer(v)')
    ok = wait(page, 'decoded() && !!k.state().hls', timeout=30000)
    native = S.count('/r/d.mp4', since, 'video') + S.count('/m/redfin', since, 'video')
    page.evaluate('() => k.state() && k.closePlayer()')
    check('Verzögerter Redirect auf lesbaren Master: hls.js-Weg, kein nativer Abruf', ok and native == 0, dict(hlsDecoded=ok, nativeMedia=native))

    # ---------- Länge: eine Entscheidung für Beleg, Probe und Freigabe (vollständige Eingabe samt Fragment ≤ 4096) ----------
    def padded(key_len, frag=0):
        base = M + 'm/len.mp4?cors=1&pad='
        u = base + 'x' * (key_len - len(base))
        assert len(u) == key_len
        return u + ('#' + 'f' * (frag - 1) if frag else '')

    for key_len, frag, positive in ((4095, 0, True), (4096, 0, True), (4097, 0, False), (4066, 30, True), (4066, 31, False), (4096, 800, False)):
        src = padded(key_len, frag)
        setup(page, src)
        mark_kids(page)
        since = len(S.LOG)
        page.evaluate('k.openBrowserPlayer(v)')
        page.wait_for_timeout(3000)
        s = snap(page)
        native = S.count('/m/len.mp4', since, 'video')
        probes = S.count('/m/len.mp4', since, 'empty')
        page.evaluate('() => { log.plays = 0; k.state() && k.closePlayer(); }')
        page.wait_for_timeout(1200)
        s2 = snap(page)
        label = 'Eingabe %d Zeichen (Schlüssel %d%s): %s' % (len(src), key_len, ', Fragment %d' % frag if frag else '',
                                                        'Probe und bewachter hls.js-Weg' if positive else 'keine Probe, keine Freigabe')
        ok = native == 0 and kids(since) == 0 and s2['plays'] == 0 and (s['hlsMade'] >= 1 if positive else (s['hlsMade'] == 0 and probes == 0))
        check(label, ok, dict(nativeMedia=native, probes=probes, kids=kids(since), hlsMade=s['hlsMade'], plays=s2['plays']))

    # Restriktiver Beleg mit langem Fragment geht nicht verloren: belegte Datei, danach von der Seite als HLS gelesen
    setup(page, None)
    u = M + 'f/fragdemote.mp4?cors=1'
    r = page.evaluate('''async ([u, frag]) => {
      const first = await k.mediaProbe(u);
      const text = '#EXTM3U\\n#EXT-X-STREAM-INF:BANDWIDTH=1\\n' + location.origin + '/k/a.m3u8\\n';
      k.notePlaylist(u + '#' + frag, u + '#' + frag, text);
      return {first, type: k.mediaTypeOf(u), withFrag: k.mediaTypeOf(u + '#x'), start: k.hlsNativeStartAllowed({}, u)};
    }''', [u, 'f' * 5000])
    check('HLS-Beleg mit Fragment (Eingabe > 4096) für den Schlüssel wirksam: belegte Datei wird HLS, keine Freigabe',
          r == dict(first='file', type='hls', withFrag='hls', start=False), r)

    # Überlanger Schlüssel nie positiv, auch nicht über gesetzte Belege
    r = page.evaluate('''u => { k.noteMediaType(u, 'file'); return {type: k.mediaTypeOf(u), start: k.hlsNativeStartAllowed({}, u)}; }''',
                      M + 'f/x.mp4?cors=1&pad=' + 'x' * 4100)
    check('Überlanger Schlüssel: kein Dateibeleg, keine Freigabe', r == dict(type='claimed-file', start=False), r)

    # Redirect: kurze Adresse -> Master mit überlanger Endadresse; Probe der kurzen Adresse, hls.js, keine native Rückgabe
    fin = M + 'm/longfin?cors=1&pad=' + 'y' * 4100
    S.MASTERS['longfin'] = [M + 'v/b/index.m3u8?src=lf']
    S.REDIRS['lf.mp4'] = fin
    setup(page, M + 'r/lf.mp4?cors=1')
    since = len(S.LOG)
    page.evaluate('k.openBrowserPlayer(v)')
    ok = wait(page, 'decoded() && !!k.state().hls', timeout=20000)
    page.evaluate('() => { log.plays = 0; k.state() && k.closePlayer(); }')
    page.wait_for_timeout(1500)
    s = snap(page)
    native = S.count('/r/lf.mp4', since, 'video') + S.count('/m/longfin', since, 'video')
    check('Redirect auf überlange Master-Endadresse: bewachter hls.js-Weg, kein nativer Abruf, keine native Rückgabe',
          ok and native == 0 and s['plays'] == 0, dict(hlsDecoded=ok, nativeMedia=native, plays=s['plays']))

try:
    S.start()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or '/usr/bin/chromium')
        page = browser.new_page()
        page.set_default_timeout(40000)
        run(page)
        browser.close()
finally:
    S.stop()
    shutdown()
done()
raise SystemExit(0 if all(results) else 1)
