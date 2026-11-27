"""P0-A End-zu-Ende in der echten Erweiterung (Service Worker, Inhaltsskript, page.js): .mp4-getarntes HLS ohne CORS.

Echtes Chromium mit geladenem Test-Bau (KADRI_EXT, sonst dist/test), zwei echte HTTP-Server (Seite 127.0.0.1:18891,
Medien localhost:18892, keine Playwright-Routen). Wie im echten Ablauf läuft das Original hörbar (der Knopf erscheint
nur an laufenden Videos); seine Hauptliste ist eine HLS-Liste hinter einer .mp4-Adresse ohne CORS, mit einer Variante
(VOD: Chromium lädt die Hauptliste für das Original beim Start – gemessen zweimal – und danach nicht mehr). Nach dem Tipp ist deshalb jeder weitere native Abruf
der Hauptliste (Sec-Fetch-Dest: video) Kadris eigenes Laden. Zusätzlich: src des eigenen Elements (.vv), Seeks am
Original (Ereignisse der Seite). Positiv: MP4 mit CORS, belegt durch Kadris eigene Probe, dekodiert im eigenen Player."""
import time
from urllib.parse import quote

import nocors_servers as S
from common import R, check, done, launch, results, shutdown, sync_playwright

M = S.MEDIA
OPEN = "button[aria-label='Im Videoplayer öffnen']"


def page_for(src, play=True):
    return S.PAGE + 'nocors.html?src=' + quote(src, safe='') + ('&play=1' if play else '')


def tap(pg):
    pg.wait_for_function('() => { const h = document.querySelector("[data-kadri-test]"); return h && h.shadowRoot && '
                         'h.shadowRoot.querySelector("%s"); }' % OPEN.replace('"', '\\"'), timeout=20000)
    pg.evaluate('() => %s.querySelector("%s").click()' % (R, OPEN.replace('"', '\\"')))


def own(pg):
    return pg.evaluate('() => { const v = %s.querySelector(".vv"); return v ? (v.getAttribute("src") || "") : null; }' % R)


def close(pg):
    pg.evaluate('() => { const b = %s.querySelector(".vp button[aria-label=Schließen]"); if (b) b.click(); }' % R)


def run(ctx):
    pg = ctx.new_page()
    # ---------- Rotfall: laufendes .mp4-HLS-Original ohne CORS ----------
    S.MASTERS['ext.mp4'] = [M + 'v/a/index.m3u8?src=ext']
    src = M + 'm/ext.mp4'
    first = len(S.LOG)
    pg.goto(page_for(src))
    pg.wait_for_function('v.currentTime > 1.0', timeout=20000)
    before = S.count('/m/ext.mp4', first, 'video')
    since = len(S.LOG)
    pg.evaluate('seeks = 0')
    tap(pg)
    time.sleep(4)
    own_src = own(pg)
    close(pg)
    time.sleep(3)
    native = S.count('/m/ext.mp4', since, 'video')
    probe = S.count('/m/ext.mp4', since, 'empty')
    ev = pg.evaluate('({seeks, paused: v.paused, t: v.currentTime})')
    obs = dict(nativeMasterOriginal=before, nativeMasterAfterTap=native, probeGets=probe,
               ownSrc=(own_src or '')[len(M) - 1:] if own_src else own_src, **ev)
    check('Erweiterung: .mp4-HLS ohne CORS – kein nativer Kadri-Abruf der Hauptliste, kein eigenes natives Laden, kein Seek am Original',
          before >= 1 and native == 0 and not own_src and ev['seeks'] == 0, obs)

    # ---------- Positiv: MP4 mit CORS – eigener Dateibeleg, eigener Player dekodiert ----------
    src = M + 'f/extclip.mp4?cors=1'
    since = len(S.LOG)
    pg.goto(page_for(src))
    pg.wait_for_function('v.currentTime > 1.0', timeout=20000)
    tap(pg)
    ok = True
    try:
        pg.wait_for_function('() => { const v = %s.querySelector(".vv"); return v && v.videoWidth > 0 && v.currentTime > 0.3; }' % R, timeout=20000)
    except Exception:
        ok = False
    probe = S.count('/f/extclip.mp4', since, 'empty')
    close(pg)
    time.sleep(1)
    check('Erweiterung positiv: MP4 mit CORS per eigener Probe belegt, eigener Player dekodiert', ok and probe >= 1,
          dict(decoded=ok, probeGets=probe))
    pg.close()


try:
    S.start()
    with sync_playwright() as p:
        ctx, sw, _ = launch(p)
        try:
            run(ctx)
        finally:
            ctx.close()
finally:
    S.stop()
    shutdown()
done()
raise SystemExit(0 if all(results) else 1)
