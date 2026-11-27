"""Befundprüfer (Diagnose, keine Produktänderung): authentifizierte MP4 einer anderen Herkunft derselben Site.

Echte Erweiterung (KADRI_EXT), echter Kanal-Helfer (HELPER_HOST_DIR), Seite 127.0.0.1:8790 (tests/web/mp4.html,
login=1 setzt das Sitzungs-Cookie der Seite), Medienserver 127.0.0.1:8791 wie in tests/test_mp4.py: ohne Cookie
„sess“ 403, sonst die MP4 mit Range und Access-Control-Allow-Origin: *. Zusätzlich über --host-resolver-rules
(nur auf 127.0.0.1 abgebildet) die Sites kadri-a.test und kadri-b.test für Subdomain-, Cross-Site- und SameSite-Fälle.

Protokolliert werden je Anfrage nur Klassen: Pfad ohne Query, Range, Sec-Fetch-Dest/-Mode, Namen der mitgeschickten
Cookies (nie Werte), ob Authorization/Referer da war, Status. Ausgabe als MEAS-Zeilen; check() nur für Invarianten,
die am Korrekturstand gelten müssen (auf dem Basisbau weichen einzelne bewusst ab: dort startete der Player nativ)."""
import http.server, json, os, threading, time, urllib.parse
from common import B, R, WEB, ChannelHelper, check, done, launch, pair_helper, results, shutdown, sync_playwright

CLIP = open(os.path.join(WEB, 'clip.mp4'), 'rb').read()
HLS2 = os.path.join(WEB, 'hls2')
LOG = []
MASTER = '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-STREAM-INF:BANDWIDTH=150000,RESOLUTION=320x180,CODECS="vp09.00.10.08,opus"\n' \
         'http://127.0.0.1:8791/hls2/a/index.m3u8?src=sniff\n'


class M(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *a):
        pass

    def out(self, code, body, ctype, cors=True, extra=None):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        if cors:
            self.send_header('Access-Control-Allow-Origin', '*')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass
        self.rec['status'] = code

    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        names = sorted(c.split('=', 1)[0].strip() for c in (self.headers.get('Cookie') or '').split(';') if '=' in c)
        self.rec = {'path': u.path, 'host': (self.headers.get('Host') or '').split(':')[0], 'range': self.headers.get('Range', ''),
                    'dest': self.headers.get('Sec-Fetch-Dest', ''), 'mode': self.headers.get('Sec-Fetch-Mode', ''),
                    'cookies': names, 'auth': bool(self.headers.get('Authorization')), 'ref': bool(self.headers.get('Referer')),
                    # Browser = Chromium-User-Agent (Sec-Fetch-* fehlt bei http://*.test, nicht vertrauenswürdige Herkunft)
                    'browser': 'Chrome/' in (self.headers.get('User-Agent') or ''), 'status': 0, 't': time.time()}
        LOG.append(self.rec)
        if u.path.startswith('/r/'):
            return self.out(302, b'', 'text/plain', True, {'Location': q.get('to', '/')})
        if u.path == '/sniff/master.mp4':   # HLS-Text, aber als video/mp4 ausgeliefert, ohne CORS
            return self.out(200, MASTER.encode(), 'video/mp4', cors=False)
        if u.path.startswith('/hls2/'):
            f = os.path.normpath(os.path.join(HLS2, u.path[6:]))
            if f.startswith(HLS2) and os.path.isfile(f):
                return self.out(200, open(f, 'rb').read(), 'application/vnd.apple.mpegurl' if f.endswith('.m3u8') else 'video/mp4', cors=False)
            return self.out(404, b'', 'text/plain')
        need = q.get('auth')
        if need:
            need = 'sess' if need == '1' else need
            if need not in names:
                return self.out(403, b'', 'text/plain')
        cors = q.get('nocors') != '1'
        rng = self.headers.get('Range', '')
        if rng.startswith('bytes='):
            a, _, b = rng[6:].partition('-')
            a = int(a or 0)
            b = min(int(b) if b else len(CLIP) - 1, len(CLIP) - 1)
            return self.out(206, CLIP[a:b + 1], 'video/mp4', cors, {'Content-Range': 'bytes %d-%d/%d' % (a, b, len(CLIP)), 'Accept-Ranges': 'bytes'})
        return self.out(200, CLIP, 'video/mp4', cors, {'Accept-Ranges': 'bytes'})


msrv = http.server.ThreadingHTTPServer(('127.0.0.1', 8791), M)
msrv.daemon_threads = True
threading.Thread(target=msrv.serve_forever, daemon=True).start()
ITEM = 'Mit Helper herunterladen'
OPEN = "button[aria-label='Im Videoplayer öffnen']"
DLB = "button[aria-label='Video speichern']"


def meas(label, **kv):
    print('MEAS %s: %s' % (label, json.dumps(kv, ensure_ascii=False, sort_keys=True)), flush=True)


def classes(since, path=None):
    return [dict(path=e['path'], host=e['host'], range=e['range'], dest=e['dest'], mode=e['mode'], cookies=e['cookies'],
                 auth=e['auth'], ref=e['ref'], helper=not e['browser'], status=e['status'])
            for e in LOG[since:] if path is None or e['path'] == path]


def shadow_q(sel):
    return '%s.querySelector("%s")' % (R, sel.replace('"', '\\"'))


def toasts(pg):
    return pg.evaluate('() => window.__toasts || []')


def watch_toasts(pg):
    pg.evaluate('''() => { const t = %s.querySelector(".toast"); window.__toasts = window.__toasts || [];
      if (!t || t.__w) return; t.__w = 1; new MutationObserver(() => window.__toasts.push(t.textContent)).observe(t, { childList: true, characterData: true, subtree: true }); }''' % R)


def wait_toast(pg, text, secs=20):
    end = time.time() + secs
    while time.time() < end:
        if any(text in t for t in toasts(pg)):
            return True
        time.sleep(0.3)
    return False


def page_playing(pg):
    t0 = pg.evaluate('document.getElementById("v").currentTime')
    time.sleep(1.0)
    # (loop: ein Rücksprung an den Anfang zählt als Weiterlaufen – entscheidend ist „nicht pausiert, Zeit bewegt sich“)
    return pg.evaluate('(t) => { const v = document.getElementById("v"); return !v.paused && Math.abs(v.currentTime - t) > 0.4; }', t0)


def own_playing(pg):
    return pg.evaluate('() => { const v = %s.querySelector(".vv"); return !!v && v.currentTime > 0.3 && !v.paused; }' % R)


def bridge(pg, url, headers=None, anonymous=False):
    """Bestehende Anfragebrücke (GM_xmlhttpRequest → Service Worker, Regel 80/credSites) – nur im Test-Bau erreichbar."""
    return pg.evaluate('''([u, h, an]) => new Promise((res) => { const id = 'b' + Math.random();
      const on = (e) => { const d = e.data && e.data.kadriTestRes; if (!d || d.id !== id) return; removeEventListener('message', on);
        res({status: d.status || 0, error: d.error || '', ftyp: typeof d.text === 'string' && d.text.slice(4, 8) === 'ftyp', len: (d.text || '').length}); };
      addEventListener('message', on);
      postMessage({kadriTestXhr: {id, method: 'GET', url: u, headers: h || {}, anonymous: an, timeout: 8000}}, '*');
      setTimeout(() => res({status: 0, error: 'keine Antwort'}), 10000); })''', [url, headers or {}, anonymous])


def run(ctx, sw, helper):
    ext_id = sw.url.split('/')[2]
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    check('Kopplung mit dem echten Kanal-Helfer', pair_helper(ctx, ext_id, helper) == 'Verbunden')
    pg.bring_to_front()

    # ---------- 1. Login-Fenster wie tests/test_mp4.py ----------
    login_src = '/videos/login.mp4?auth=1&token=T'
    pg.goto(B + 'mp4.html?login=1&src=' + urllib.parse.quote(login_src))
    pg.wait_for_function('document.getElementById("v").currentTime > 0.8', timeout=20000)
    pg.evaluate('() => { document.getElementById("v").muted = false; }')
    meas('Original vor dem Tipp', requests=classes(0, '/videos/login.mp4'))
    pg.wait_for_function('() => !!%s' % shadow_q(OPEN), timeout=15000)
    watch_toasts(pg)
    since = len(LOG)
    pg.evaluate('() => %s.click()' % shadow_q(OPEN))
    started = False
    end = time.time() + 12
    while time.time() < end and not started:
        started = own_playing(pg)
        time.sleep(0.3)
    time.sleep(1.0)
    after = classes(since, '/videos/login.mp4')
    meas('Tipp auf Player', ownPlayerStarted=started, toasts=toasts(pg), requests=after, originalPlaying=page_playing(pg))
    extra_cookie = [r for r in after if not r['helper'] and r['dest'] != 'video' and r['cookies']]
    check('Kein zusätzlicher Cookie tragender Nicht-Medien-Abruf durch Kadri beim Öffnen', not extra_cookie, extra_cookie)
    # Helper-Weg: im Player (wenn er läuft) über ⬇-Menü, sonst über ⬇ an der Seite (Alternative D)
    hs = len(LOG)
    if started:
        pg.evaluate('() => %s.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))' % shadow_q('button[aria-label^=Herunterladen]'))
        time.sleep(0.6)
        picked = pg.evaluate('(l) => { const b = Array.from(%s.querySelectorAll(".vmenu.on .vmi")).find(b => b.firstChild.textContent === l); if (b) b.click(); return !!b; }' % R, ITEM)
        way = 'Player-Menü'
    else:
        pg.wait_for_function('() => !!%s' % shadow_q(DLB), timeout=10000)
        watch_toasts(pg)
        pg.evaluate('() => %s.click()' % shadow_q(DLB))
        picked = False
        end = time.time() + 10
        while time.time() < end and not picked:
            picked = pg.evaluate('(l) => { const b = Array.from(%s.querySelectorAll(".dlm .dli")).find(b => b.firstChild.textContent === l); if (b) b.click(); return !!b; }' % R, ITEM)
            time.sleep(0.3)
        way = '⬇ an der Seite (D)'
    ctrl = wait_toast(pg, 'Server verlangt Anmeldung', 20)
    time.sleep(1.0)
    status_menu = []
    if not started and not ctrl:   # ⬇ an der Seite meldet den Ausgang im Statusmenü beim nächsten Tipp
        pg.evaluate('() => { const b = %s; if (b) b.click(); }' % shadow_q('.dlm .dlx'))
        time.sleep(0.5)
        pg.evaluate('() => %s.click()' % shadow_q(DLB))
        end = time.time() + 10
        while time.time() < end and not status_menu:
            status_menu = pg.evaluate('() => Array.from(%s.querySelectorAll(".dlm .dli, .dlm .dlh")).map(b => b.textContent)' % R)
            time.sleep(0.3)
        ctrl = any('Anmeldung' in t for t in status_menu)
    hh = [r for r in classes(hs, '/videos/login.mp4') if r['helper']]
    o = ctx.new_page()
    o.goto('chrome-extension://%s/popup.html' % ext_id)
    jobs = (o.evaluate('() => chrome.runtime.sendMessage({ t: "kadri-download", op: "list" })') or {}).get('value') or []
    o.close()
    pg.bring_to_front()
    job_states = [dict(state=j.get('state'), label=j.get('label')) for j in jobs]
    if not ctrl:
        ctrl = any(j.get('state') in ('failed', 'error') and 'Anmeldung' in str(j.get('label')) for j in jobs)
    browser_dl = pg.evaluate('() => !!document.querySelector("a[download]")')
    playing = page_playing(pg) if not started else own_playing(pg)
    meas('Helper-Download (' + way + ')', picked=picked, controlledError=ctrl, helperRequests=hh, browserDownload=browser_dl,
         playbackContinues=playing, toasts=toasts(pg)[-4:], statusMenu=status_menu, jobs=job_states)
    check('Helper: höchstens ein Abruf, ohne Cookie, Authorization und Referer', len(hh) <= 1 and all(not r['cookies'] and not r['auth'] and not r['ref'] for r in hh), hh)
    check('Helper-Download (%s): kontrollierter Fehler (Anmeldung verlangt), kein Browser-Download, Wiedergabe läuft' % way,
          picked and ctrl and len(hh) == 1 and not browser_dl and playing, dict(picked=picked, ctrl=ctrl, helper=len(hh), playing=playing))
    try:
        pg.evaluate('() => { const b = %s; if (b) b.click(); }' % shadow_q('.vp button[aria-label=Schließen]'))
    except Exception:
        pass
    time.sleep(0.8)

    # ---------- Öffentliche MP4 ohne CORS (gleiche Site, anderer Port): CORS-Funktionsverlust, kein Sicherheitsbeleg ----------
    pg.goto(B + 'mp4.html?src=' + urllib.parse.quote('/videos/pubnc.mp4?nocors=1'))
    pg.wait_for_function('document.getElementById("v").currentTime > 0.8', timeout=20000)
    pg.evaluate('() => { document.getElementById("v").muted = false; }')
    pg.wait_for_function('() => !!%s' % shadow_q(OPEN), timeout=15000)
    watch_toasts(pg)
    since = len(LOG)
    pg.evaluate('() => %s.click()' % shadow_q(OPEN))
    nc = False
    end = time.time() + 10
    while time.time() < end and not nc:
        nc = own_playing(pg)
        time.sleep(0.3)
    meas('Öffentliche MP4 ohne CORS (gleiche Site)', ownPlayerStarted=nc, requests=classes(since, '/videos/pubnc.mp4'), toasts=toasts(pg), originalPlaying=page_playing(pg))
    since = len(LOG)
    nca = bridge(pg, 'http://127.0.0.1:8791/videos/pubnc.mp4?nocors=1', {'Range': 'bytes=0-4095'}, anonymous=True)
    meas('Öffentliche MP4 ohne CORS: Brücke anonym (Service Worker, Hostberechtigung)', result=nca, requests=classes(since))
    try:
        pg.evaluate('() => { const b = %s; if (b) b.click(); }' % shadow_q('.vp button[aria-label=Schließen]'))
    except Exception:
        pass
    pg.goto(B + 'mp4.html?login=1&src=' + urllib.parse.quote(login_src))
    pg.wait_for_function('document.getElementById("v").currentTime > 0.5', timeout=20000)

    # ---------- A. Vorhandene Evidenz ohne neuen Abruf ----------
    cap = pg.evaluate('() => { try { document.getElementById("v").captureStream(); return "ok"; } catch (e) { return e.name; } }')
    rt = pg.evaluate('''() => performance.getEntriesByType('resource').filter(e => e.name.includes('/videos/login.mp4'))
      .map(e => ({initiator: e.initiatorType, transferSize: e.transferSize, encodedBodySize: e.encodedBodySize, contentType: e.contentType || ''}))''')
    meas('A: captureStream am authentifizierten Original', result=cap)
    meas('A: Resource Timing des Originals', entries=rt)
    check('A: captureStream am fremdherkunftigen Original ohne crossorigin verweigert (keine Bytes, keine Bilder)', cap == 'SecurityError', cap)
    # MIME ist kein Beleg: HLS-Text als video/mp4 unter .mp4 spielt Chromium nativ (Inhaltserkennung) und lädt die Variante
    since = len(LOG)
    pg.goto(B + 'mp4.html?src=' + urllib.parse.quote('/sniff/master.mp4'))
    ok = True
    try:
        pg.wait_for_function('document.getElementById("v").currentTime > 1.0', timeout=15000)
    except Exception:
        ok = False
    kid = [r for r in classes(since) if r['path'] == '/hls2/a/index.m3u8']
    meas('A: HLS-Master mit Content-Type video/mp4 unter .mp4', nativePlays=ok, kidRequests=len(kid),
         masterRequests=len([r for r in classes(since) if r['path'] == '/sniff/master.mp4']))
    check('A: Content-Type video/mp4 ist kein Dateibeleg – getarntes HLS spielt nativ und lädt die Variante', ok and len(kid) >= 1, dict(plays=ok, kids=len(kid)))

    # ---------- B. Bestehende Hintergrundfähigkeit ----------
    pg.goto(B + 'mp4.html?login=1&src=' + urllib.parse.quote(login_src))
    pg.wait_for_function('document.getElementById("v").currentTime > 0.5', timeout=20000)
    url = 'http://127.0.0.1:8791/videos/login.mp4?auth=1&token=T'
    since = len(LOG)
    raw_ip = sw.evaluate('''async (u) => { try { const r = await fetch(u, {credentials: 'include', headers: {Range: 'bytes=0-4095'}, cache: 'no-store'}); return {status: r.status}; }
      catch (e) { return {status: 0, error: e.name}; } }''', url)
    meas('B1: Roh-fetch im Service Worker an 127.0.0.1 (Regel 51 Privatnetz)', result=raw_ip, requests=classes(since))
    check('B1: Roh-Abruf des Service Workers ins eigene Netz wird blockiert (kein Serverkontakt)', raw_ip.get('status') == 0 and not classes(since), raw_ip)
    since = len(LOG)
    via = bridge(pg, url, {'Range': 'bytes=0-4095'})
    meas('B2: bestehende Brücke, gleiche Site (IP, anderer Port), Range 0-4095', result=via, requests=classes(since))
    since = len(LOG)
    anon = bridge(pg, url, {'Range': 'bytes=0-4095'}, anonymous=True)
    meas('B2: bestehende Brücke anonym', result=anon, requests=classes(since))
    # (b) Inhaltsskript-/Seitenkontext mit credentials include: CORS mit Access-Control-Allow-Origin: * scheitert
    since = len(LOG)
    page_inc = pg.evaluate('''async (u) => { try { const r = await fetch(u, {credentials: 'include', headers: {Range: 'bytes=0-4095'}}); return {status: r.status}; }
      catch (e) { return {status: 0, error: e.name}; } }''', url)
    meas('b: fetch im Seitenkontext, credentials include (CORS wie Inhaltsskripte in MV3)', result=page_inc, requests=classes(since))
    check('b: credentialed CORS mit Access-Control-Allow-Origin: * ist nicht lesbar', page_inc.get('status') == 0, page_inc)

    # Subdomain / Cross-Site / SameSite (Hosts über --host-resolver-rules auf 127.0.0.1)
    a_page = 'http://www.kadri-a.test:8790/mp4.html?src=' + urllib.parse.quote('/videos/pub.mp4')
    pg.goto('http://www.kadri-b.test:8790/direct.html')
    pg.evaluate("() => { document.cookie = 'bsess=1; domain=kadri-b.test; path=/'; }")
    pg.goto(a_page)
    pg.evaluate('''() => { document.cookie = 'lax=1; domain=kadri-a.test; path=/';
      document.cookie = 'strict=1; domain=kadri-a.test; path=/; SameSite=Strict'; document.cookie = 'host=1; path=/'; }''')
    pg.wait_for_timeout(1500)
    cases = [
        ('Subdomain gleiche Site', 'http://cdn.kadri-a.test:8791/videos/s.mp4?auth=lax', False),
        ('Subdomain gleiche Site, Strict-Cookie', 'http://cdn.kadri-a.test:8791/videos/s2.mp4?auth=strict', False),
        ('andere Site', 'http://cdn.kadri-b.test:8791/videos/x.mp4?auth=bsess', False),
        ('gleiche Site -> 302 -> andere Site', 'http://cdn.kadri-a.test:8791/r/1?to=' + urllib.parse.quote('http://cdn.kadri-b.test:8791/videos/y.mp4?auth=bsess', safe=''), False),
    ]
    since = len(LOG)
    raw = sw.evaluate('''async (u) => { try { const r = await fetch(u, {credentials: 'include', headers: {Range: 'bytes=0-4095'}, cache: 'no-store'});
      return {status: r.status}; } catch (e) { return {status: 0, error: e.name}; } }''', 'http://cdn.kadri-a.test:8791/videos/sw.mp4?auth=lax')
    meas('B1: Roh-fetch im Service Worker, credentials include, Subdomain (Regel 80 aktiv)', result=raw, requests=classes(since))
    check('B1: Regel 80 entfernt die Cookies eines Roh-Abrufs des Service Workers (403)',
          raw.get('status') == 403 and classes(since) and all(not r['cookies'] for r in classes(since)), raw)
    for label, u, an in cases:
        since = len(LOG)
        res = bridge(pg, u, {'Range': 'bytes=0-4095'}, an)
        meas('B3: Brücke ' + label, result=res, requests=classes(since))
    since = len(LOG)
    res = pg.evaluate('''async (u) => { try { const r = await fetch(u, {credentials: 'include'}); return {status: r.status}; } catch (e) { return {status: 0, error: e.name}; } }''',
                      'http://cdn.kadri-a.test:8791/videos/p.mp4?auth=lax')
    meas('B3: Seitenkontext credentials include zur Subdomain (ACAO *)', result=res, requests=classes(since))
    since = len(LOG)
    pg.evaluate("u => { const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = u; document.body.appendChild(v); }",
                'http://cdn.kadri-a.test:8791/videos/n.mp4?auth=strict')
    pg.wait_for_timeout(2500)
    meas('B3: natives <video> der Seite zur Subdomain (Vergleich)', requests=classes(since))


helper = ChannelHelper()
check('echter Kanal-Helfer mit Download-Engine', helper.ready.startswith('READY') and helper.cmd('downloads 8791') == 'DOWNLOADS on')
try:
    with sync_playwright() as p:
        ctx, sw, _ = launch(p, extra_args=['--host-resolver-rules=MAP *.kadri-a.test 127.0.0.1, MAP *.kadri-b.test 127.0.0.1'])
        try:
            run(ctx, sw, helper)
        finally:
            ctx.close()
finally:
    helper.stop()
    msrv.shutdown()
    shutdown()
done()
raise SystemExit(0 if all(results) else 1)
