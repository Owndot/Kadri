"""P0-A: Eine Dateiendung ist kein Dateibeleg – fremde Site ohne CORS, getarntes HLS, Redirects, Capture, Rückgabe.

Zwei echte HTTP-Server (Seite 127.0.0.1, Medien localhost, keine Playwright-Routen). Gezählt werden serverseitig die
Abrufe an die bekannten MPD-Kinder des Masters und die nativen Medienabrufe (Sec-Fetch-Dest: video) sowie am Original
play() und Seeks. Die Klassifikation der Kinder erfolgt ohne Netz; jeder Kind-Abruf folgt also einer Kadri-Entscheidung."""
import os

import nocors_servers as S
from common import check, done, results, shutdown, sync_playwright
from type_evidence_lib import kids, mark_kids, setup, snap, wait

M = S.MEDIA


def tap_close(page, src, label, wait_open=3500, resume=True, close_after=None, positive=False):
    """Original pausiert (preload=none), Kinder als MPD bekannt, öffnen, schließen; Kind-Abrufe offen und danach zählen."""
    setup(page, src)
    page.evaluate('r => { k.CONFIG.resumeAfterClose = r; }', resume)
    mark_kids(page)
    since = len(S.LOG)
    page.evaluate('() => { log.plays = 0; log.seeks = 0; k.openBrowserPlayer(v); }')
    page.wait_for_timeout(close_after if close_after is not None else wait_open)
    opened = kids(since)
    native = S.count(src[len(M) - 1:].split('#')[0], since, 'video')
    during = snap(page)
    page.evaluate('() => { k.state() && k.closePlayer(); }')
    page.wait_for_timeout(4000)
    s = snap(page)
    total = kids(since)
    obs = dict(kidsOpen=opened, kidsTotal=total, nativeMedia=native, playsOpen=during['plays'], plays=s['plays'],
               seeks=s['seeks'], hlsMade=s['hlsMade'], mode=during['mode'])
    check(label, total == 0 and s['plays'] == 0 and s['seeks'] == 0, obs)
    return obs


def run(page):
    # ---------- getarntes HLS (.mp4) ohne CORS und Varianten ----------
    tap_close(page, M + 'm/video.mp4', 'A1 .mp4-HLS ohne CORS: 0 MPD-Kind-Abrufe, kein Originalstart, kein Seek')
    tap_close(page, M + 'm/video.mp4?token=abc123', 'A6 .mp4?token ohne CORS: 0 MPD-Kind-Abrufe, kein Originalstart')
    tap_close(page, M + 'm/video.mp4', 'A1 Wiederaufnahme aus: 0 MPD-Kind-Abrufe', resume=False)
    tap_close(page, M + 'm/video.mp4?cors=1', 'A2 .mp4-HLS mit CORS: 0 MPD-Kind-Abrufe (hls.js, fail-closed)')
    tap_close(page, M + 'r/x.mp4?to=' + M + 'm/dir2/master', 'R1 .mp4 -> 302 -> endungsloser Master ohne CORS: 0 MPD-Kind-Abrufe')
    tap_close(page, M + 'r/x.mp4?to=' + M + 'm/y.mp4', 'R2 .mp4 -> 302 -> .mp4-Master ohne CORS: 0 MPD-Kind-Abrufe')
    tap_close(page, S.PAGE + 'r/same.mp4?to=' + M + 'm/z.mp4', 'R5 gleiche Herkunft .mp4 -> 302 -> fremde Site ohne CORS: 0 MPD-Kind-Abrufe')
    tap_close(page, M + 'r/a.mp4?a=1&to=' + M + 'm/b.mp4?b=2', 'R6 .mp4?a=1 -> 302 -> .mp4?b=2 ohne CORS: 0 MPD-Kind-Abrufe')
    tap_close(page, M + 'm/late.mp4?delay=3000', 'F2 Schließen vor der Masterantwort (3 s verzögert): 0 MPD-Kind-Abrufe, kein Originalstart',
              close_after=1000)

    # Wiederöffnen derselben Quelle
    setup(page, M + 'm/again.mp4')
    mark_kids(page)
    since = len(S.LOG)
    for _ in range(2):
        page.evaluate('() => { log.plays = 0; k.openBrowserPlayer(v); }')
        page.wait_for_timeout(2500)
        page.evaluate('() => { k.state() && k.closePlayer(); }')
        page.wait_for_timeout(1500)
    s = snap(page)
    check('Wiederöffnen der .mp4-HLS-Quelle ohne CORS: 0 MPD-Kind-Abrufe, kein Originalstart', kids(since) == 0 and s['plays'] == 0,
          dict(kids=kids(since), **s))

    # Bereits unabhängig laufendes Original (eine Variante, VOD): passives Spiegeln ohne neue Kadri-Abrufe
    S.MASTERS['single.mp4'] = [S.KID_A]
    setup(page, M + 'm/single.mp4', preload='auto', extra=' loop')
    page.evaluate('() => HTMLMediaElement.prototype.play.call(v)')
    running = wait(page, 'v.currentTime > 1.0')
    mark_kids(page, (S.KID_A,))
    page.wait_for_timeout(500)
    since = len(S.LOG)
    page.evaluate('() => { log.plays = 0; log.seeks = 0; k.openBrowserPlayer(v); }')
    page.wait_for_timeout(3000)
    during = snap(page)
    page.evaluate('() => { k.state() && k.closePlayer(); }')
    page.wait_for_timeout(1500)
    s = snap(page)
    # (Chromium verweigert captureStream für ein fremdherkunftiges Original ohne crossorigin: Spiegeln ist hier nicht
    # möglich. Erwartet: kein eigener nativer Abruf, kein Kadri-Start, das Original läuft unberührt weiter.)
    t = page.evaluate('v.currentTime')
    page.wait_for_timeout(600)
    still = page.evaluate('t => !v.paused && v.currentTime > t', t)
    check('Laufendes fremdherkunftiges Original ohne CORS: 0 neue Abrufe an die MPD-Variante, kein Kadri-Start, läuft weiter',
          running and kids(since) == 0 and s['plays'] == 0 and still,
          dict(running=running, kids=kids(since), modeOpen=during['mode'], plays=s['plays'], stillRunning=still))

    # ---------- Echte MP4: positiv mit Dateibeleg, Funktionsverlust ohne lesbaren Beleg ----------
    for src, label in ((M + 'f/clip.mp4?cors=1', 'MP4 mit CORS'), (M + 'f/clipfile?cors=1', 'endungslose MP4 mit CORS')):
        setup(page, src, preload='auto')
        page.evaluate('k.openBrowserPlayer(v)')
        ok = wait(page, 'decoded()')
        page.evaluate('() => { log.plays = 0; k.state() && k.closePlayer(); }')
        page.wait_for_timeout(800)
        s = snap(page)
        check('Positiv: %s dekodiert per eigenem Dateibeleg, Rückgabe' % label, ok and s['plays'] == 1, dict(decoded=ok, **s))
    for src, label in ((M + 'f/clip.mp4', 'MP4 ohne CORS'), (M + 'f/clipfile', 'endungslose MP4 ohne CORS')):
        setup(page, src)
        since = len(S.LOG)
        page.evaluate('k.openBrowserPlayer(v)')
        page.wait_for_timeout(3000)
        native = S.count(src[len(M) - 1:], since, 'video')
        page.evaluate('() => { log.plays = 0; k.state() && k.closePlayer(); }')
        page.wait_for_timeout(800)
        s = snap(page)
        check('Funktionsverlust: %s ohne lesbaren Dateibeleg – kein nativer Kadri-Abruf, kein Originalstart' % label,
              native == 0 and s['plays'] == 0, dict(nativeMedia=native, **s))

    # ---------- Erlaubter HLS-Master über hls.js: Qualität und Rückgabe ----------
    setup(page, M + 'm/ok?cors=1')
    page.evaluate('k.openBrowserPlayer(v)')
    ok = wait(page, 'decoded() && k.state().hls && k.state().hls.levels.length === 2')
    if ok:
        lv = page.evaluate('k.state().hls.currentLevel')
        page.evaluate('l => { k.state().hls.currentLevel = l === 1 ? 0 : 1; }', lv)
        ok = wait(page, 'l => decoded() && k.state().hls.currentLevel === (l === 1 ? 0 : 1)', arg=lv)
    if ok:
        page.evaluate('() => { const h = k.state().hls; h.currentLevel = -1; h.nextAutoLevel = 1; h.nextLoadLevel = 1; }')
        ok = wait(page, 'decoded() && k.state().hls.autoLevelEnabled && k.state().hls.currentLevel === 1')
    page.evaluate('() => { log.plays = 0; k.state() && k.closePlayer(); }')
    page.wait_for_timeout(1500)
    s = snap(page)
    check('Positiv: erlaubter endungsloser Master mit CORS über hls.js, manueller und automatischer Wechsel, Rückgabe',
          ok and s['plays'] == 1, dict(hlsPath=ok, **s))


try:
    S.start()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or '/usr/bin/chromium')
        page = browser.new_page()
        page.set_default_timeout(30000)
        run(page)
        browser.close()
finally:
    S.stop()
    shutdown()
done()
raise SystemExit(0 if all(results) else 1)
