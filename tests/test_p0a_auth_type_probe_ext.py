"""Angemeldete Typprobe – End-zu-Ende in der echten Erweiterung mit echtem Service Worker und Kanal-Helfer.

Ungepackter Test-Bau (KADRI_EXT), Desktop-Harness des Helpers (HELPER_HOST_DIR), echte Server (tests/auth_probe_servers.py:
http 8791, https 8443; tests/web/mp4.html auf 8790) mit echten Weiterleitungen. Hosts über --host-resolver-rules auf
127.0.0.1: www./cdn.kadri-a.test (eine Site), cdn.kadri-b.test (andere Site). Gezählt wird serverseitig je Anfrage:
Herkunft (ext = Service Worker der Erweiterung, page = Inhaltsskript/Seite, none = nativ/Helper), Cookie-NAMEN (nie
Werte), Authorization/Referer ja/nein, Status, gesendete Bytes. Original-Element: play/seeking über Seitenereignisse."""
import json, time, urllib.parse

import auth_probe_servers as S
from common import B, R, ChannelHelper, check, done, launch, pair_helper, results, shutdown, sync_playwright

A = 'http://www.kadri-a.test:8791/'
CA = 'http://cdn.kadri-a.test:8791/'
CB = 'http://cdn.kadri-b.test:8791/'
SA = 'https://cdn.kadri-a.test:8443/'
OPEN = "button[aria-label='Im Videoplayer öffnen']"
ITEM = 'Mit Helper herunterladen'


def q(sel):
    return '%s.querySelector("%s")' % (R, sel.replace('"', '\\"'))


def page_for(src, base=A):
    return base + 'page?src=' + urllib.parse.quote(src, safe='')


def open_page(pg, url):
    pg.goto(url)
    pg.wait_for_function('document.getElementById("v").currentTime > 0.8', timeout=20000)
    pg.evaluate('() => { document.getElementById("v").muted = false; }')
    pg.wait_for_function('() => !!%s' % q(OPEN), timeout=15000)
    pg.evaluate('''() => { const t = %s.querySelector(".toast"); window.__toasts = window.__toasts || [];
      if (t && !t.__w) { t.__w = 1; new MutationObserver(() => window.__toasts.push(t.textContent)).observe(t, { childList: true, characterData: true, subtree: true }); } }''' % R)


def tap(pg):
    pg.evaluate('() => { const b = %s; if (b) b.click(); }' % q(OPEN))


def own_src(pg):
    return pg.evaluate('() => { const v = %s; return v ? (v.getAttribute("src") || "") : ""; }' % q('.vv'))


def decoded(pg, secs=15):
    try:
        pg.wait_for_function('() => { const v = %s; return !!v && v.videoWidth > 0 && v.currentTime > 0.3; }' % q('.vv'), timeout=secs * 1000)
        return True
    except Exception:
        return False


def close(pg):
    pg.evaluate('() => { const b = %s; if (b) b.click(); }' % q('.vp button[aria-label=Schließen]'))
    time.sleep(0.6)


def orig(pg):
    return pg.evaluate('() => ({plays: window.plays || 0, seeks: window.seeks || 0, paused: document.getElementById("v").paused})')


def ext(i, **f):
    return S.since(i, origin='ext', **f)


def report(label, **kv):
    print('MEAS %s: %s' % (label, json.dumps(kv, ensure_ascii=False, sort_keys=True)), flush=True)


def refused(pg, src, label, page=None, wait=6):
    """Kein angemeldeter Abruf, kein eigener Start, nichts mit Cookies an fremde Sites."""
    open_page(pg, page or page_for(src))
    i = len(S.LOG)
    o0 = orig(pg)
    tap(pg)
    ok = decoded(pg, wait)
    time.sleep(0.5)
    e = ext(i)
    o1 = orig(pg)
    close(pg)
    report(label, ownDecoded=ok, extRequests=S.cls(e), all=S.cls(S.since(i)))
    return ok, e, o0, o1, i


def run(ctx, sw, helper):
    ext_id = sw.url.split('/')[2]
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    check('Kopplung mit dem echten Kanal-Helfer', pair_helper(ctx, ext_id, helper) == 'Verbunden')
    pg.bring_to_front()
    ctx.add_cookies([{'name': 'lax', 'value': '1', 'domain': '.kadri-a.test', 'path': '/'},
                     {'name': 'bsess', 'value': '1', 'domain': '.kadri-b.test', 'path': '/'}])

    # ---------- E1 Anmeldung, andere Herkunft, gleiche Site (Port) – wie tests/test_mp4.py ----------
    open_page(pg, B + 'mp4.html?login=1&src=' + urllib.parse.quote('/videos/login.mp4?auth=1&token=T'))
    i = len(S.LOG)
    tap(pg)
    ok = decoded(pg, 25)
    reqs = S.since(i, path='/videos/login.mp4')
    page_probe = [r for r in reqs if r['origin'] == 'page']
    auth = [r for r in reqs if r['origin'] == 'ext']
    report('E1 Anmeldung', ownDecoded=ok, requests=S.cls(reqs))
    check('E1: unangemeldete Probe ohne Cookie (403), danach genau ein angemeldeter Probeabruf (Cookie ja, Range 0-4095, 206), eigener Player dekodiert',
          ok and len(page_probe) == 1 and not page_probe[0]['cookies'] and page_probe[0]['status'] == 403 and len(auth) == 1 and
          auth[0]['cookies'] == ['sess'] and auth[0]['range'] == 'bytes=0-4095' and auth[0]['status'] == 206 and not auth[0]['auth'] and not auth[0]['ref'],
          dict(decoded=ok, page=S.cls(page_probe), auth=S.cls(auth)))
    if ok:
        hs = len(S.LOG)
        pg.evaluate('() => %s.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))' % q('button[aria-label^=Herunterladen]'))
        time.sleep(0.6)
        picked = pg.evaluate('(l) => { const b = Array.from(%s.querySelectorAll(".vmenu.on .vmi")).find(b => b.firstChild.textContent === l); if (b) b.click(); return !!b; }' % R, ITEM)
        end, ctrl = time.time() + 20, False
        while time.time() < end and not ctrl:
            ctrl = any('Server verlangt Anmeldung' in t for t in pg.evaluate('() => window.__toasts || []'))
            time.sleep(0.3)
        hh = S.since(hs, path='/videos/login.mp4', helper=True)
        t0 = pg.evaluate('() => %s.currentTime' % q('.vv'))
        time.sleep(1.0)
        still = pg.evaluate('(t) => { const v = %s; return !v.paused && v.currentTime > t + 0.5; }' % q('.vv'), t0)
        report('E1 Helper', picked=picked, controlled=ctrl, helper=S.cls(hh), playing=still)
        check('E1: Helper-Download – 1 Abruf ohne Cookie/Authorization/Referer, kontrollierter Fehler, Wiedergabe läuft weiter',
              picked and ctrl and len(hh) == 1 and not hh[0]['cookies'] and not hh[0]['auth'] and not hh[0]['ref'] and still and
              not pg.evaluate('() => !!document.querySelector("a[download]")'), dict(picked=picked, ctrl=ctrl, helper=S.cls(hh), playing=still))
        close(pg)
        # Wiederöffnen: Beleg vorhanden, kein zweiter angemeldeter Abruf
        i2 = len(S.LOG)
        tap(pg)
        ok2 = decoded(pg, 15)
        close(pg)
        check('E1: Wiederöffnen dekodiert ohne weiteren angemeldeten Abruf', ok2 and not ext(i2), dict(decoded=ok2, ext=S.cls(ext(i2))))
    else:   # ohne Start sind Helper-Download und Wiederöffnen im Player nicht erreichbar: ausdrücklich nicht erfüllt
        check('E1: Helper-Download – 1 Abruf ohne Cookie/Authorization/Referer, kontrollierter Fehler, Wiedergabe läuft weiter', False, 'Player nicht gestartet')
        check('E1: Wiederöffnen dekodiert ohne weiteren angemeldeten Abruf', False, 'Player nicht gestartet')

    # ---------- E2 öffentliche MP4 ohne CORS, gleiche Site (anderer Port) ----------
    open_page(pg, B + 'mp4.html?src=' + urllib.parse.quote('/videos/pubnc.mp4?nocors=1'))
    i = len(S.LOG)
    tap(pg)
    ok = decoded(pg, 20)
    e = ext(i, path='/videos/pubnc.mp4')
    close(pg)
    check('E2: öffentliche MP4 ohne CORS derselben Site – ein Probeabruf der Erweiterung, eigener Player dekodiert', ok and len(e) == 1, dict(decoded=ok, ext=S.cls(e)))

    # ---------- E3 getarntes HLS (.mp4) derselben Site mit Sitzung ----------
    src = CA + 'm/h.mp4?auth=lax'
    open_page(pg, page_for(src))
    i = len(S.LOG)
    tap(pg)
    time.sleep(6)
    own = own_src(pg)
    o = orig(pg)
    close(pg)
    time.sleep(2)
    e = ext(i, path='/m/h.mp4')
    native = S.since(i, path='/m/h.mp4', dest='video')
    report('E3 getarntes HLS', ownSrc=own, ext=S.cls(e), native=S.cls(native), orig=o)
    # (Zustand des Originals nur gemessen: commitOwnLoad hält es beim Start des bewachten hls.js-Wegs an; scheitert dieser
    # ohne Sitzung, wäre ein Fortsetzen ein nativer HLS-Start ohne vollständige Masterentscheidung – gesperrt.)
    check('E3: getarntes HLS mit Sitzung – angemeldete Probe erkennt HLS, kein natives eigenes Laden, kein Kadri-Seek, kein Kadri-Play',
          len(e) == 1 and not own and not native and o['seeks'] == 0 and o['plays'] <= 1, dict(ext=len(e), own=own, native=len(native), orig=o))
    open_page(pg, page_for(src))
    i = len(S.LOG)
    tap(pg)
    time.sleep(4)
    close(pg)
    check('E3: Wiederöffnen – kein weiterer angemeldeter Abruf, kein nativer Masterabruf durch Kadri',
          not ext(i) and not S.since(i, path='/m/h.mp4', dest='video'), dict(ext=S.cls(ext(i))))

    # ---------- E4 DASH unter .mp4 mit Sitzung (der Server liefert der Probe ein MPD, dem Original eine MP4) ----------
    src = CA + 'videos/d.mp4?auth=lax&ext=mpd'
    open_page(pg, page_for(src))
    i = len(S.LOG)
    tap(pg)
    time.sleep(6)
    own = own_src(pg)
    close(pg)
    time.sleep(1)
    e = ext(i, path='/videos/d.mp4')
    native = S.since(i, path='/videos/d.mp4', dest='video')
    report('E4 DASH', ownSrc=own, ext=S.cls(e), native=S.cls(native))
    check('E4: Probe erkennt MPD – kein eigenes natives Laden, keine nativen MPD-Abrufe durch Kadri', len(e) == 1 and not own and not native,
          dict(ext=len(e), own=own, native=len(native)))
    for n in (1, 2, 3):
        open_page(pg, page_for(src))
        i = len(S.LOG)
        tap(pg)
        time.sleep(3)
        own = own_src(pg)
        close(pg)
        check('E4: Wiederöffnen %d – gesperrt, kein weiterer angemeldeter Abruf' % n, not own and not ext(i) and
              not S.since(i, path='/videos/d.mp4', dest='video'), dict(own=own, ext=S.cls(ext(i))))

    # ---------- E5 andere Site ----------
    ok, e, _, _, i = refused(pg, CB + 'videos/x.mp4?nocors=1', 'E5 andere Site')
    cookies_b = [r for r in S.since(i, host='cdn.kadri-b.test') if r['cookies'] and not r['dest'] == 'video']
    check('E5: andere Site – kein angemeldeter Abruf, keine Cookies von Kadri an die fremde Site, kein eigener Start',
          not ok and not e and not cookies_b, dict(decoded=ok, ext=S.cls(e), cookies=S.cls(cookies_b)))

    # ---------- E6 Subdomain derselben Site ----------
    open_page(pg, page_for(CA + 'videos/s.mp4?auth=lax'))
    i = len(S.LOG)
    tap(pg)
    ok = decoded(pg, 20)
    e = ext(i, path='/videos/s.mp4')
    close(pg)
    check('E6: Subdomain derselben Site – ein angemeldeter Probeabruf mit Cookie, eigener Player dekodiert',
          ok and len(e) == 1 and e[0]['cookies'] and e[0]['status'] == 206, dict(decoded=ok, ext=S.cls(e)))

    # ---------- E7 Weiterleitungen ----------
    chains = [
        ('302 auf andere Site', CA + 'r/1?code=302&to=' + urllib.parse.quote(CB + 'videos/y.mp4?nocors=1', safe='')),
        ('307 auf andere Site', CA + 'r/2?code=307&to=' + urllib.parse.quote(CB + 'videos/y2.mp4?nocors=1', safe='')),
        ('gleiche Site -> gleiche Site -> andere Site', CA + 'r/3?to=' + urllib.parse.quote(CA + 'r/4?to=' + urllib.parse.quote(CB + 'videos/y3.mp4?nocors=1', safe=''), safe='')),
        ('andere Site -> zurück zur Site', CA + 'r/5?to=' + urllib.parse.quote(CB + 'r/6?to=' + urllib.parse.quote(CA + 'videos/y4.mp4?auth=lax', safe=''), safe='')),
        ('gleiche Site -> gleiche Site (Datei)', CA + 'r/7?to=' + urllib.parse.quote(CA + 'videos/y5.mp4?auth=lax', safe='')),
    ]
    for label, src in chains:
        ok, e, _, _, i = refused(pg, src, 'E7 ' + label)
        b_ext = [r for r in S.since(i, host='cdn.kadri-b.test') if r['origin'] == 'ext']
        b_cookie = [r for r in S.since(i, host='cdn.kadri-b.test') if r['cookies'] and r['dest'] != 'video']
        check('E7 %s: höchstens der erste Schritt angemeldet, keine Folgeschritte der Probe, 0 Cookies an die fremde Site, kein eigener Start' % label,
              not ok and len(e) <= 1 and all(r['path'].startswith('/r/') for r in e) and not b_ext and not b_cookie,
              dict(decoded=ok, ext=S.cls(e), bExt=len(b_ext), bCookie=len(b_cookie)))

    # ---------- E8 privates Ziel ----------
    ok, e, _, _, _ = refused(pg, 'http://127.0.0.1:8791/videos/p.mp4?nocors=1', 'E8 privates Ziel')
    check('E8: privates Ziel von einer öffentlichen Seite – kein Probeabruf, kein eigener Start', not ok and not e, dict(decoded=ok, ext=S.cls(e)))

    # ---------- E9 Schema ----------
    # (öffentliche Quelle: über Schemagrenzen sendet schon der Browser das Lax-Cookie nicht – schemeful same-site)
    ok, e, _, _, _ = refused(pg, SA + 'videos/t.mp4?nocors=1', 'E9 http-Seite, https-Quelle')
    check('E9: anderes Schema (http-Seite, https-Quelle) – kein angemeldeter Abruf', not ok and not e, dict(decoded=ok, ext=S.cls(e)))
    open_page(pg, page_for(SA + 'videos/u.mp4?auth=lax', base='https://www.kadri-a.test:8443/'))
    i = len(S.LOG)
    tap(pg)
    ok = decoded(pg, 20)
    e = ext(i, path='/videos/u.mp4')
    close(pg)
    check('E9: https-Seite, https-Quelle derselben Site – angemeldete Probe, dekodiert', ok and len(e) == 1 and e[0]['cookies'], dict(decoded=ok, ext=S.cls(e)))

    # ---------- E10 Range ignoriert, große Antwort ----------
    open_page(pg, page_for(CA + 'videos/big.mp4?auth=lax&big=1&norange=1'))
    i = len(S.LOG)
    tap(pg)
    time.sleep(6)
    e = ext(i, path='/videos/big.mp4')
    close(pg)
    report('E10 Range ignoriert', ext=S.cls(e))
    aborted = [x for x in S.LOG[i:] if x['path'] == '/videos/big.mp4' and x['origin'] == 'ext']
    check('E10: Range ignoriert (200, 32 MiB) – genau ein Probeabruf, vom Empfänger abgebrochen (gesendet: siehe Zähler, < 32 MiB)',
          len(e) == 1 and e[0]['status'] == 200 and e[0]['sent'] < S.BIG // 2 and aborted and aborted[0].get('aborted'), dict(ext=S.cls(e)))

    # ---------- E11 Fehler und Zeitgrenze ----------
    for kind, extra in (('401', ''), ('500', ''), ('drop', ''), ('delay', '&ms=12500')):
        src = CA + 'videos/e%s.mp4?auth=lax&ext=%s%s' % (kind, kind, extra)
        ok, e, _, _, _ = refused(pg, src, 'E11 ' + kind, wait=16 if kind == 'delay' else 6)
        open_page(pg, page_for(src))
        i = len(S.LOG)
        tap(pg)
        ok2 = decoded(pg, 4)
        close(pg)
        # (drop: Chromium wiederholt einen zurückgesetzten GET selbst einmal – ein Probeversuch, bis zu zwei Serverabrufe)
        check('E11 %s: kein eigener Start, genau ein angemeldeter Versuch, kein Wiederholungsversuch beim Wiederöffnen (Neuladen)' % kind,
              not ok and (1 <= len(e) <= 2 if kind == 'drop' else len(e) == 1) and not ok2 and not ext(i), dict(decoded=ok, ext=len(e), again=len(ext(i))))

    # ---------- E12 Einmaladresse ----------
    src = CA + 'videos/once.mp4?auth=lax&once=1'
    ok, e, _, _, i = refused(pg, src, 'E12 Einmaladresse')
    allq = S.since(0, path='/videos/once.mp4')
    report('E12 Einmaladresse alle Abrufe', requests=S.cls(allq))
    check('E12: Einmaladresse – genau ein angemeldeter Versuch (danach verbraucht: 403), kein eigener Start, kein dritter angemeldeter Abruf',
          not ok and len(e) == 1 and e[0]['status'] == 403, dict(ext=S.cls(e)))

    # ---------- E13 Schließen, Wiederöffnen und Navigation während der Probe ----------
    src = CA + 'videos/slow.mp4?auth=lax&ext=delay&ms=5000'
    open_page(pg, page_for(src))
    i = len(S.LOG)
    o0 = orig(pg)
    tap(pg)
    time.sleep(1.0)
    close(pg)
    time.sleep(6.5)
    own = own_src(pg)
    o1 = orig(pg)
    check('E13: Schließen während der Probe – kein späterer eigener Start, kein Kadri-Seek/-Play am Original',
          not own and o1['seeks'] == o0['seeks'] and o1['plays'] == o0['plays'] and len(ext(i)) == 1, dict(own=own, o0=o0, o1=o1, ext=len(ext(i))))
    src = CA + 'videos/slow2.mp4?auth=lax&ext=delay&ms=5000'
    open_page(pg, page_for(src))
    i = len(S.LOG)
    tap(pg)
    time.sleep(1.0)
    close(pg)
    time.sleep(0.3)
    pg.wait_for_function('() => !!%s' % q(OPEN), timeout=10000)
    tap(pg)
    ok = decoded(pg, 15)
    close(pg)
    check('E13: Zweiter Tipp während der Probe – ein einziger angemeldeter Abruf, danach Start mit dem Beleg', ok and len(ext(i)) == 1,
          dict(decoded=ok, ext=len(ext(i))))
    src = CA + 'videos/slow3.mp4?auth=lax&ext=delay&ms=5000'
    open_page(pg, page_for(src))
    i = len(S.LOG)
    tap(pg)
    time.sleep(1.0)
    pg.goto(A + 'page?src=')
    time.sleep(6)
    check('E13: Navigation während der Probe – genau ein angemeldeter Abruf, keiner danach', len(ext(i)) == 1, dict(ext=len(ext(i))))

    # ---------- E14 Seite fälscht Hooks ----------
    ctx2 = pg.context
    pg2 = ctx2.new_page()
    pg2.add_init_script('window.__KADRI__ = true; window.KADRI_HOOKS = { typeProbe: () => Promise.resolve("file") };')
    ok, e, _, _, _ = refused(pg2, CB + 'videos/forge.mp4?nocors=1', 'E14 gefälschte Hooks der Seite')
    pg2.close()
    check('E14: gefälschte KADRI_HOOKS/__KADRI__ der Seite – keine Freigabe, kein Probeabruf', not ok and not e, dict(decoded=ok, ext=S.cls(e)))

    # ---------- E15 Schutzregeln nach allen Fällen ----------
    time.sleep(1)
    rules = sw.evaluate('() => chrome.declarativeNetRequest.getSessionRules()')
    temp = [r['id'] for r in rules if 1000 <= r['id'] <= 900000]
    strip = [r for r in rules if r['id'] == 80]
    report('E15 Sitzungsregeln', ids=sorted(r['id'] for r in rules), strip=strip)
    check('E15: keine hängenden Ausnahmen (keine temporären Regeln, Regel 80 ohne Ausnahme-Domains)',
          not temp and strip and not strip[0]['condition'].get('excludedRequestDomains'), dict(temp=temp, strip=strip))


S.start()
helper = ChannelHelper()
check('echter Kanal-Helfer mit Download-Engine', helper.ready.startswith('READY') and helper.cmd('downloads 8791') == 'DOWNLOADS on')
try:
    with sync_playwright() as p:
        ctx, sw, _ = launch(p, extra_args=['--host-resolver-rules=MAP *.kadri-a.test 127.0.0.1, MAP *.kadri-b.test 127.0.0.1',
                                           '--ignore-certificate-errors', '--no-proxy-server'])   # nur lokale Server, kein Umgebungsproxy
        try:
            run(ctx, sw, helper)
        finally:
            ctx.close()
finally:
    helper.stop()
    S.stop()
    shutdown()
done()
raise SystemExit(0 if all(results) else 1)
