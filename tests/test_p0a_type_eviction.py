"""P0-A: Restriktive HLS-/DASH-Belege überdauern Budgetgrenzen; Verdrängung führt nie zu einer Freigabe.

Zwei echte HTTP-Server (Seite 127.0.0.1, Medien localhost). Funktionsprüfungen an den Produktfunktionen
(noteMediaType, mediaTypeOf, mediaProbe, hlsNativeStartAllowed, knownMpdIdentity) und End-zu-Ende-Fälle mit
serverseitig gezählten Abrufen an bekannte MPD-Kinder bzw. an ein per Probe erkanntes MPD."""
import os

import nocors_servers as S
from common import check, done, results, shutdown, sync_playwright
from type_evidence_lib import kids, mark_kids, setup, snap, wait

M = S.MEDIA


def flood(page, n):
    page.evaluate('n => { for (let i = 0; i < n; i++) k.noteMediaType(location.origin + "/flood/" + i + ".mp4?z=" + Math.random(), "hls"); }', n)


def run(page):
    # ---------- Typbelege 1023 / 1024 / 1025, HLS und DASH ----------
    for n in (1023, 1024, 1025):
        setup(page, None)
        r = page.evaluate('''n => {
          const U = location.origin + '/target/hls.mp4?q=1', D = location.origin + '/target/dash.mp4?q=1';
          k.noteMediaType(U, 'hls'); k.noteMediaType(D, 'dash');
          for (let i = 0; i < n; i++) k.noteMediaType(location.origin + '/f/' + i + '.mp4?r=' + i, 'hls');
          return {hls: k.mediaTypeOf(U), dash: k.mediaTypeOf(D), startU: k.hlsNativeStartAllowed({}, U), startD: k.hlsNativeStartAllowed({}, D)};
        }''', n)
        check('%d weitere Belege: HLS- und DASH-Beleg bleiben, keine native Freigabe' % n,
              r == dict(hls='hls', dash='dash', startU=False, startD=False), r)

    # Ein einziger von der Seite gelesener Master mit 1100 Varianten
    setup(page, None)
    r = page.evaluate('''() => {
      const U = location.origin + '/target/early.mp4';
      k.noteMediaType(U, 'hls');
      let t = '#EXTM3U\\n';
      for (let i = 0; i < 1100; i++) t += '#EXT-X-STREAM-INF:BANDWIDTH=' + (1000 + i) + '\\n' + location.origin + '/kids/' + i + '.mp4\\n';
      k.notePlaylist(location.origin + '/big/master.m3u8', location.origin + '/big/master.m3u8', t);
      return {early: k.mediaTypeOf(U), start: k.hlsNativeStartAllowed({}, U), lastKid: k.mediaTypeOf(location.origin + '/kids/1099.mp4')};
    }''')
    check('Master mit 1100 Varianten verdrängt keinen früheren HLS-Beleg', r == dict(early='hls', start=False, lastKid='hls'), r)

    # ---------- Probecache 255 / 256 / 257: bekannter Befund bleibt wirksam ----------
    for n in (255, 256, 257):
        setup(page, None)
        target = M + 'm/pc.mp4?cors=1&n=%d' % n
        since = len(S.LOG)
        r = page.evaluate('''async ([t, n, media]) => {
          const first = await k.mediaProbe(t);
          for (let i = 0; i < n; i++) await k.mediaProbe(media + 'f/clip.mp4?cors=1&p=' + i + '&n=' + n);
          for (let i = 0; i < 1100; i++) k.noteMediaType(location.origin + '/fl/' + i + '.mp4', 'hls');
          const again = await k.mediaProbe(t);
          return {first, again, type: k.mediaTypeOf(t), start: k.hlsNativeStartAllowed({}, t)};
        }''', [target, n, M])
        gets = S.count(target[len(M) - 1:], since)
        check('Probecache nach %d weiteren Proben: bekannter HLS-Befund bleibt wirksam, keine Freigabe' % n,
              r['first'] == 'hls' and r['type'] == 'hls' and not r['start'], dict(gets=gets, **r))

    # ---------- End-zu-Ende: lesbar als HLS erkanntes .mp4, Verdrängung, Wiederöffnen ----------
    setup(page, M + 'm/e.mp4?cors=1')
    mark_kids(page)
    since = len(S.LOG)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_timeout(3000)
    page.evaluate('() => { k.state() && k.closePlayer(); }')
    page.wait_for_timeout(1000)
    flood(page, 1025)
    page.evaluate('''() => { let t = '#EXTM3U\\n'; for (let i = 0; i < 1100; i++) t += '#EXT-X-STREAM-INF:BANDWIDTH=1\\n/k2/' + i + '.mp4\\n';
      k.notePlaylist(location.origin + '/b2/m.m3u8', location.origin + '/b2/m.m3u8', t); }''')
    mid = len(S.LOG)
    page.evaluate('() => { log.plays = 0; k.openBrowserPlayer(v); }')
    page.wait_for_timeout(3500)
    page.evaluate('() => { k.state() && k.closePlayer(); }')
    page.wait_for_timeout(1500)
    s = snap(page)
    native = S.count('/m/e.mp4', mid, 'video')
    check('E3 Wiederöffnen nach Verdrängung: 0 MPD-Kind-Abrufe, kein nativer Masterabruf, kein Originalstart',
          kids(since) == 0 and native == 0 and s['plays'] == 0, dict(kids=kids(since), nativeMaster=native, type=page.evaluate('k.mediaTypeOf(v.src)'), **s))

    # ---------- End-zu-Ende: per Probe als DASH erkanntes .mp4 ----------
    setup(page, M + 'd/manifest.mp4?cors=1')
    since = len(S.LOG)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_timeout(2500)
    page.evaluate('() => { k.state() && k.closePlayer(); }')
    page.wait_for_timeout(800)
    flood(page, 1025)
    page.evaluate('() => { log.plays = 0; k.openBrowserPlayer(v); }')
    page.wait_for_timeout(2500)
    page.evaluate('() => { k.state() && k.closePlayer(); }')
    page.wait_for_timeout(1500)
    s = snap(page)
    native = S.count('/d/manifest.mp4', since, 'video')
    ident = page.evaluate('k.knownMpdIdentity(v.src)')
    check('Probe-DASH: harte MPD-Identität, nach Verdrängung 0 native Abrufe des MPD, kein Originalstart',
          ident and native == 0 and s['plays'] == 0, dict(identity=ident, nativeMpd=native, **s))

    # ---------- Probe-DASH als Variante eines Masters: der hls.js-Guard sperrt sie ----------
    dkid = M + 'd/kid.mp4?cors=1'
    okkid = M + 'v/b/index.m3u8?src=ok'
    S.MASTERS['withdash'] = [okkid, dkid]
    setup(page, M + 'm/withdash?cors=1')
    assert page.evaluate('u => k.mediaProbe(u)', dkid) == 'dash'
    since = len(S.LOG)
    page.evaluate('k.openBrowserPlayer(v)')
    ok = wait(page, 'decoded()')
    gets = S.count('/d/kid.mp4', since)
    page.evaluate('() => { k.state() && k.closePlayer(); }')
    page.wait_for_timeout(800)
    check('Per Probe erkanntes MPD als Mastervariante: 0 Abrufe, erlaubte Variante dekodiert', gets == 0 and ok, dict(gets=gets, decoded=ok))

    # Redirect: Ursprung und Endadresse erhalten beide die MPD-Identität
    setup(page, None)
    red = M + 'r/x.mp4?cors=1&to=' + M + 'd/fin.mp4?cors=1'
    r = page.evaluate('''async ([u, f]) => ({type: await k.mediaProbe(u), origin: k.knownMpdIdentity(u), final: k.knownMpdIdentity(f)})''',
                      [red, M + 'd/fin.mp4?cors=1'])
    check('Redirect: Probe-DASH sperrt Ursprung und Endadresse', r == dict(type='dash', origin=True, final=True), r)

    # Wechsel auf eine unabhängige erlaubte MP4 nach gesperrter Quelle
    setup(page, M + 'd/manifest2.mp4?cors=1')
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_timeout(1500)
    page.evaluate('() => { k.state() && k.closePlayer(); }')
    page.evaluate("u => { v.src = u; v.preload = 'auto'; }", M + 'f/indep.mp4?cors=1')
    page.evaluate('k.openBrowserPlayer(v)')
    ok = wait(page, 'decoded()')
    page.evaluate('() => { log.plays = 0; k.state() && k.closePlayer(); }')
    page.wait_for_timeout(800)
    s = snap(page)
    check('Positiv: unabhängige MP4 nach gesperrter Quelle dekodiert und wird zurückgegeben', ok and s['plays'] == 1, dict(decoded=ok, **s))

    # Späte HLS-Klassifikation einer gerade gespielten Datei: Rückgabe gesperrt
    setup(page, M + 'f/late.mp4?cors=1', preload='auto')
    page.evaluate('k.openBrowserPlayer(v)')
    ok = wait(page, 'decoded()')
    page.evaluate("() => { k.noteMediaType(v.src, 'hls'); log.plays = 0; k.closePlayer(); }")
    page.wait_for_timeout(1200)
    s = snap(page)
    check('Späte HLS-Klassifikation während der Wiedergabe: kein Originalstart', ok and s['plays'] == 0, dict(decoded=ok, **s))


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
