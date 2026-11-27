"""Angemeldete Typprobe – Entscheidungslogik im Inhaltsskript (Produktquelltext, echte Server, Test-Hook statt Brücke).

Die Brücke zum Service Worker gibt es nur in der Erweiterung. Hier ersetzt ein Test-Hook (authTypeProbeHook) die
Antwort des Hintergrunds (Typ und Verzögerung je Fall) und zählt die Aufrufe; alles andere ist Produktcode mit zwei
echten HTTP-Servern (tests/nocors_servers.py: Seite 127.0.0.1:18891, Medien 127.0.0.1:18892 = gleiche Site, anderer
Port, ohne CORS; localhost:18892 = andere Site). Bekannte MPD-Kinder werden ohne Netz klassifiziert; jeder Abruf an sie
folgt einer Kadri-Entscheidung. Cookies, Herkunftsgrenzen, Bytegrenze und Weiterleitungen des Hintergrunds prüfen
tests/test_p0a_auth_type_probe_ext.py und tests/type_probe_bridge_check.js."""
import os

import nocors_servers as S
import type_evidence_lib as L
from common import check, done, results, shutdown, sync_playwright
from type_evidence_lib import kids, mark_kids, snap, wait

MS = 'http://127.0.0.1:%d/' % S.MEDIA_PORT   # gleiche Site wie die Seite (IP), andere Herkunft (Port)
MX = S.MEDIA                                  # localhost: andere Site
HOOK = 'function authTypeProbeHook() {'
L.SOURCE = L.SOURCE.replace(HOOK, HOOK + ' return window.__authHook || null;', 1)


def setup(page, src, typ='file', delay=0, never=False, preload='none'):
    L.setup(page, src, preload=preload)
    page.evaluate('''([t, d, n]) => { window.__auth = {calls: [], type: t, delay: d};
      window.__authHook = (u) => { __auth.calls.push(u); if (n) return new Promise(() => {});
        return new Promise((r) => setTimeout(() => r(__auth.type), __auth.delay)); }; }''', [typ, delay, never])


def calls(page):
    return page.evaluate('__auth.calls.length')


def run(page):
    # ---------- K1 Datei-Beleg nach 9,5 s: kein nativer Start vor dem Ergebnis, danach Dekodierung und Rückgabe ----------
    u = MS + 'f/k1.mp4'
    setup(page, u, 'file', 9500)
    since = len(S.LOG)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_timeout(9200)
    early = snap(page)
    n_early = calls(page)
    ok = wait(page, 'decoded()', timeout=15000)
    page.evaluate('() => { log.plays = 0; k.state() && k.closePlayer(); }')
    page.wait_for_timeout(1200)
    s = snap(page)
    check('K1: Beleg nach 9,5 s – vorher kein eigenes natives Laden, genau ein Hook-Aufruf, danach dekodiert und zurückgegeben',
          early['ownSrc'] == 0 and early['open'] and n_early == 1 and ok and calls(page) == 1 and s['plays'] == 1,
          dict(ownSrcBefore=early['ownSrc'], openBefore=early['open'], calls=calls(page), decoded=ok, plays=s['plays'],
               native=S.count('/f/k1.mp4', since, 'video')))

    # Später HLS-Beleg sticht den Dateibeleg: keine Rückgabe
    u = MS + 'f/k1b.mp4'
    setup(page, u, 'file')
    page.evaluate('k.openBrowserPlayer(v)')
    ok = wait(page, 'decoded()', timeout=15000)
    page.evaluate("u => { k.noteMediaType(u, 'hls'); log.plays = 0; k.closePlayer(); }", u)
    page.wait_for_timeout(1200)
    s = snap(page)
    check('K1: späterer HLS-Beleg nach angemeldetem Dateibeleg – kein Originalstart', ok and s['plays'] == 0 and page.evaluate('u => k.mediaTypeOf(u)', u) == 'hls',
          dict(decoded=ok, plays=s['plays']))

    # ---------- K2 HLS-Beleg der angemeldeten Probe, Kinder als MPD bekannt ----------
    for name, close_after, label in (('k2', 4000, 'offen 4 s'), ('k2b', 1000, 'Schließen vor der Masterantwort (3 s)')):
        u = MS + 'm/%s.mp4%s' % (name, '?delay2=3000' if name == 'k2b' else '')
        setup(page, u, 'hls')
        mark_kids(page)
        since = len(S.LOG)
        page.evaluate('() => { log.plays = 0; log.seeks = 0; k.openBrowserPlayer(v); }')
        page.wait_for_timeout(close_after)
        page.evaluate('() => { k.state() && k.closePlayer(); }')
        page.wait_for_timeout(4500)
        s = snap(page)
        native = S.count('/m/' + name, since, 'video')
        check('K2 %s: HLS-Beleg – 0 MPD-Kind-Abrufe, kein nativer Masterabruf, kein Originalstart/-Seek' % label,
              kids(since) == 0 and native == 0 and s['plays'] == 0 and s['seeks'] == 0 and calls(page) == 1,
              dict(kids=kids(since), native=native, calls=calls(page), **s))
        page.evaluate('() => { log.plays = 0; k.openBrowserPlayer(v); }')
        page.wait_for_timeout(3000)
        page.evaluate('() => { k.state() && k.closePlayer(); }')
        page.wait_for_timeout(2000)
        s = snap(page)
        check('K2 %s: Wiederöffnen – kein zweiter Hook-Aufruf, 0 MPD-Kind-Abrufe, kein Originalstart' % label,
              calls(page) == 1 and kids(since) == 0 and s['plays'] == 0, dict(calls=calls(page), kids=kids(since), **s))

    # ---------- K3 DASH-Beleg: harte MPD-Identität, dauerhaft, auch nach Verdrängung ----------
    u = MS + 'm/k3.mp4'
    setup(page, u, 'dash')
    since = len(S.LOG)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_timeout(3000)
    page.evaluate('() => { log.plays = 0; k.state() && k.closePlayer(); }')
    page.wait_for_timeout(1500)
    s = snap(page)
    check('K3: DASH-Beleg – MPD-Identität, kein nativer Abruf, kein Originalstart',
          page.evaluate('u => k.knownMpdIdentity(u) && k.mediaTypeOf(u) === "dash"', u) and S.count('/m/k3.mp4', since, 'video') == 0 and s['plays'] == 0,
          dict(native=S.count('/m/k3.mp4', since, 'video'), **s))
    for n in (1024, 2048, 6000):
        page.evaluate('''async ([n, media]) => { for (let i = 0; i < n; i++) k.noteMediaType(location.origin + '/fl/' + n + '/' + i + '.mp4', 'hls');
          for (let i = 0; i < 257; i++) await k.mediaProbe(media + 'f/ev.mp4?cors=1&n=' + n + '&i=' + i); }''', [n, S.MEDIA])
        since = len(S.LOG)
        page.evaluate('() => { log.plays = 0; k.openBrowserPlayer(v); }')
        page.wait_for_timeout(2500)
        page.evaluate('() => { k.state() && k.closePlayer(); }')
        page.wait_for_timeout(1200)
        s = snap(page)
        check('K3: nach %d Belegen und Probecache-Verdrängung – weiterhin DASH, kein Hook-Aufruf, kein nativer Abruf, kein Start' % n,
              page.evaluate('u => k.mediaTypeOf(u)', u) == 'dash' and calls(page) == 1 and S.count('/m/k3.mp4', since, 'video') == 0 and
              s['plays'] == 0 and s['ownSrc'] == 0, dict(calls=calls(page), **s))

    # ---------- K4 kein Hook-Aufruf: andere Site, restriktiver Beleg, Alternativquelle, Vorschau ----------
    setup(page, MX + 'f/k4.mp4', 'file')
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_timeout(2500)
    s = snap(page)
    page.evaluate('() => { k.state() && k.closePlayer(); }')
    check('K4: andere Site – kein Hook-Aufruf, kein eigenes natives Laden', calls(page) == 0 and s['ownSrc'] == 0, dict(calls=calls(page), **s))
    u = MS + 'f/k4b.mp4'
    setup(page, u, 'file')
    page.evaluate("u => k.noteMediaType(u, 'hls')", u)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_timeout(2500)
    s = snap(page)
    page.evaluate('() => { k.state() && k.closePlayer(); }')
    check('K4: restriktiver HLS-Beleg vorhanden – kein Hook-Aufruf, keine Freigabe', calls(page) == 0 and s['ownSrc'] == 0, dict(calls=calls(page), **s))
    u, alt = MS + 'f/k4c.mp4', MS + 'f/k4alt.mp4'
    setup(page, u, '', 1500)
    page.evaluate('a => { k.openBrowserPlayer(v); k.state() && k.state().sources.push(a); }', alt)
    page.wait_for_timeout(5000)
    got = page.evaluate('__auth.calls')
    s = snap(page)
    page.evaluate('() => { k.state() && k.closePlayer(); }')
    check('K4: Alternativquelle der Liste – Hook nur für die Adresse des Originals, Alternative nicht nativ geladen',
          got == [u] and s['ownSrc'] == 0, dict(calls=[g[len(MS) - 1:] for g in got], **s))
    main, alt = MS + 'f/k4m.mp4', MS + 'f/k4p.mp4'
    setup(page, main, 'file', preload='auto')
    page.evaluate('k.openBrowserPlayer(v)')
    ok = wait(page, 'decoded()', timeout=15000)
    page.evaluate('''a => { const st = k.state(); if (!st) return; st.sources.push(a); st.srcRes[a] = 180; st.srcRes[st.cur] = 640; log.prev = []; st.prevWarm(); }''', alt)
    page.wait_for_timeout(2500)
    prev = page.evaluate('log.prev')
    page.evaluate('() => { k.state() && k.closePlayer(); }')
    check('K4: Vorschau – unbelegte Alternative nie nativ, kein Hook-Aufruf für sie', ok and alt not in prev and page.evaluate('__auth.calls') == [main],
          dict(decoded=ok, prev=len(prev), calls=len(page.evaluate('__auth.calls'))))

    # ---------- K5 Schließen und Wiederöffnen während der angemeldeten Probe ----------
    u = MS + 'f/k5.mp4'
    setup(page, u, 'file', 5000)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_timeout(1000)
    page.evaluate('() => { log.plays = 0; log.seeks = 0; k.closePlayer(); }')
    page.wait_for_timeout(6000)
    s = snap(page)
    check('K5: Schließen während der Probe – kein späterer eigener Start, kein Originalstart/-Seek', not s['open'] and s['ownSrc'] == 0 and
          s['plays'] == 0 and s['seeks'] == 0 and s['hlsMade'] == 0, s)
    u = MS + 'f/k5b.mp4'
    setup(page, u, 'file', 4000)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_timeout(1000)
    page.evaluate('() => { k.state() && k.closePlayer(); }')
    page.wait_for_timeout(500)   # (Schließen endet nach der Animation; erst dann ist ein neuer Tipp möglich)
    page.evaluate('k.openBrowserPlayer(v)')
    ok = wait(page, 'decoded()', timeout=15000)
    page.evaluate('() => { k.state() && k.closePlayer(); }')
    check('K5: zweiter Tipp während der Probe – ein Hook-Aufruf, danach Start mit dem Beleg', ok and calls(page) == 1, dict(decoded=ok, calls=calls(page)))

    # ---------- K6 Hook antwortet nie / unzulässige Antwort ----------
    u = MS + 'f/k6.mp4'
    setup(page, u, 'file', never=True)
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_timeout(14000)
    s = snap(page)
    check('K6: Hook antwortet nie – nach der Zeitgrenze beendet, kein eigenes natives Laden', not s['open'] and s['ownSrc'] == 0, s)
    for bad in ('file ', 'FILE', 'unknown', 'hls;file'):
        u = MS + 'f/k6b.mp4?b=' + str(len(bad)) + bad[:1]
        setup(page, u, bad)
        page.evaluate('k.openBrowserPlayer(v)')
        page.wait_for_timeout(2500)
        s = snap(page)
        page.evaluate('() => { k.state() && k.closePlayer(); }')
        check('K6: unzulässige Hook-Antwort %r – keine Freigabe' % bad, s['ownSrc'] == 0 and page.evaluate('u => k.mediaTypeOf(u)', u) != 'file', s)


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
