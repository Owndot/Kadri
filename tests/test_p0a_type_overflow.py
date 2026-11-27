"""P0-A: Überlauf der restriktiven Typbelege (exakt bis 2048 Schlüssel, darüber fester Bitfilter) – nie Verlust, nie Freigabe.

Ergänzt test_p0a_type_eviction.py (1023/1024/1025 und 1100 Varianten liegen unter der exakten Grenze) um die Grenze
selbst: 2047/2048/2049 und 6000 weitere Belege, HLS und DASH, die zuerst und die zuletzt notierten Adressen, ein
End-zu-Ende-Fall mit serverseitig gezählten Abrufen an bekannte MPD-Kinder sowie eine positive Datei nach dem Überlauf."""
import os

import nocors_servers as S
from common import check, done, results, shutdown, sync_playwright
from type_evidence_lib import kids, mark_kids, setup, snap, wait

M = S.MEDIA


def run(page):
    for n in (2047, 2048, 2049, 6000):
        setup(page, None)
        r = page.evaluate('''n => {
          const U = location.origin + '/first/hls.mp4?q=1', D = location.origin + '/first/dash.mp4?q=1';
          k.noteMediaType(U, 'hls'); k.noteMediaType(D, 'dash');
          for (let i = 0; i < n; i++) k.noteMediaType(location.origin + '/o/' + i + '.mp4?r=' + i, 'hls');
          const last = location.origin + '/o/' + (n - 1) + '.mp4?r=' + (n - 1);
          const L = location.origin + '/late/hls.mp4';
          k.noteMediaType(L, 'hls');
          return {first: k.mediaTypeOf(U), dash: k.mediaTypeOf(D), last: k.mediaTypeOf(last), late: k.mediaTypeOf(L),
                  start: [U, D, last, L].some((u) => k.hlsNativeStartAllowed({}, u)), mpd: k.knownMpdIdentity(D)};
        }''', n)
        check('%d weitere restriktive Belege: erste, letzte und spätere Belege bleiben, keine native Freigabe' % n,
              r == dict(first='hls', dash='dash', last='hls', late='hls', start=False, mpd=True), r)

    # Nach dem Überlauf eingetragener HLS-Beleg schlägt einen früheren Dateibeleg (Probe)
    setup(page, None)
    u = M + 'f/before.mp4?cors=1'
    r = page.evaluate('''async u => { const a = await k.mediaProbe(u);
      for (let i = 0; i < 2100; i++) k.noteMediaType(location.origin + '/p/' + i + '.mp4', 'hls');
      k.noteMediaType(u, 'hls');
      return {a, type: k.mediaTypeOf(u), start: k.hlsNativeStartAllowed({}, u)}; }''', u)
    check('Nach dem Überlauf: später HLS-Beleg sticht den Dateibeleg, keine Freigabe', r == dict(a='file', type='hls', start=False), r)

    # End-zu-Ende: lesbar als HLS erkanntes .mp4, danach Überlauf durch die Seite, Wiederöffnen
    setup(page, M + 'm/ovf.mp4?cors=1')
    mark_kids(page)
    since = len(S.LOG)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_timeout(3000)
    page.evaluate('() => { k.state() && k.closePlayer(); }')
    page.wait_for_timeout(1000)
    page.evaluate('() => { for (let i = 0; i < 6000; i++) k.noteMediaType(location.origin + "/fl/" + i + ".mp4?z=" + i, "hls"); }')
    mid = len(S.LOG)
    page.evaluate('() => { log.plays = 0; k.openBrowserPlayer(v); }')
    page.wait_for_timeout(3500)
    page.evaluate('() => { k.state() && k.closePlayer(); }')
    page.wait_for_timeout(1500)
    s = snap(page)
    native = S.count('/m/ovf.mp4', mid, 'video')
    check('Wiederöffnen nach 6000 Belegen: 0 MPD-Kind-Abrufe, kein nativer Masterabruf, kein Originalstart',
          kids(since) == 0 and native == 0 and s['plays'] == 0, dict(kids=kids(since), nativeMaster=native, **s))

    # Positiv nach dem Überlauf: eine unabhängige, per Probe belegte MP4 (Filterkollision bei 6000 Einträgen möglich,
    # aber für diese Adresse gemessen nicht gegeben) dekodiert und wird zurückgegeben
    page.evaluate("u => { v.src = u; v.preload = 'auto'; }", M + 'f/afterovf.mp4?cors=1')
    page.evaluate('k.openBrowserPlayer(v)')
    ok = wait(page, 'decoded()')
    page.evaluate('() => { log.plays = 0; k.state() && k.closePlayer(); }')
    page.wait_for_timeout(800)
    s = snap(page)
    check('Positiv nach dem Überlauf: belegte MP4 dekodiert und wird zurückgegeben', ok and s['plays'] == 1, dict(decoded=ok, **s))


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
