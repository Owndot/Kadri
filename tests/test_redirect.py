# Weiterleitungen und Anmeldung (Chrome, echte Anfragen aus einem Tab über Kadri; zwei Test-Seiten a.test und b.test,
# dazu cdn.a.test – alle im Test auf 127.0.0.1, für Kadri aber öffentliche Adressen). Geprüft wird, was beim Server
# TATSÄCHLICH ankommt:
#  1. Cookies und ein ausdrücklich gesetzter Authorization-Header gehen an die eigene Seite (auch cdn.a.test), aber nie
#     an eine andere Seite, auf die weitergeleitet wird – Gegenprobe: ohne Kadris Regel käme der Cookie dort an.
#  2. Während Kadri die Helfer-App fragt, kann eine gleichzeitige fremde Anfrage nicht ins eigene Netz weiterleiten.
#  3. Liegt die Seite im eigenen Netz (Medienserver), ist nur GENAU die angefragte Adresse frei – eine gleichzeitige
#     fremde Weiterleitung auf denselben Server erreicht ihn nicht; Weiterleitungen des Servers selbst werden gesperrt.
#  4. Lassen sich die Schutzregeln nicht setzen, geht keine Anfrage hinaus (außer an die Helfer-App).
import time, ssl, subprocess
from common import *
# zweiter Server mit HTTPS für b.test: nur dort darf ein Cookie „SameSite=None; Secure“ sein – so einen schickt der
# Browser von sich aus auch bei Weiterleitungen von fremden Seiten mit (die Gegenprobe zeigt es)
CERT = os.path.join(tempfile.mkdtemp(prefix='kadri-tls-'), 'c.pem')
subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', CERT, '-out', CERT, '-days', '2', '-subj', '/CN=b.test',
                '-addext', 'subjectAltName=DNS:b.test'], check=True, capture_output=True)
SPORT = PORT + 2
tsrv = http.server.ThreadingHTTPServer(('127.0.0.1', SPORT), functools.partial(Q, directory=WEB))
_tc = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); _tc.load_cert_chain(CERT)
tsrv.socket = _tc.wrap_socket(tsrv.socket, server_side=True)
threading.Thread(target=tsrv.serve_forever, daemon=True).start()

XHR = '''(o) => new Promise((res) => { const id = Math.random().toString(36).slice(2);
  const h = (e) => { const d = e.data && e.data.kadriTestRes; if (d && d.id === id) { removeEventListener('message', h); res(d); } };
  addEventListener('message', h); postMessage({ kadriTestXhr: Object.assign({ id }, o) }, '*'); setTimeout(() => res({ error: 'kein Ergebnis' }), 15000); })'''
PAR = '''(list) => Promise.all(list.map((o) => (%s)(o)))''' % XHR
def xhr(pg, o): return pg.evaluate(XHR, o)
def hits(tag): return [h for h in HDR_HITS if h['tag'] == tag]

with sync_playwright() as p:
    ctx, sw, udir = launch(p, extra_args=['--host-resolver-rules=MAP *.test 127.0.0.1', '--ignore-certificate-errors', '--no-proxy-server'])
    A, C, Bb = 'http://a.test:%d/' % PORT, 'http://cdn.a.test:%d/' % PORT, 'https://b.test:%d/' % SPORT
    LAN = 'http://127.0.0.1:%d/' % PORT
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    # Cookies setzen: a.test (gilt auch für cdn.a.test) und b.test – wie nach einer Anmeldung auf beiden Seiten
    pg.goto(A + 'setc?v=A&d=a.test'); pg.goto(Bb + 'setc?v=B&s=1')
    pg.goto(A + 'direct.html'); time.sleep(1.5)
    AUTH = {'Authorization': 'Bearer geheim-123'}
    # ---- 1. Anmeldung ----
    r = xhr(pg, {'method': 'GET', 'url': A + 'hdr?tag=a1', 'headers': AUTH})
    h = hits('a1')
    check('eigene Seite: Cookie und Authorization kommen an', r.get('status') == 200 and h and 'c=A' in h[0]['cookie'] and h[0]['auth'] == 'Bearer geheim-123', [r, h])
    r = xhr(pg, {'method': 'GET', 'url': A + 'redir?to=' + urllib.parse.quote(C + 'hdr?tag=c1'), 'headers': AUTH})
    h = hits('c1')
    check('Weiterleitung innerhalb der Seite (cdn.a.test): Cookie kommt an', r.get('status') == 200 and h and 'c=A' in h[0]['cookie'], [r, h])
    r = xhr(pg, {'method': 'GET', 'url': A + 'redir?to=' + urllib.parse.quote(Bb + 'hdr?tag=b1'), 'headers': AUTH})
    h = hits('b1')
    check('Weiterleitung zu b.test: dort weder Cookie noch Authorization', r.get('status') == 200 and h and h[0]['cookie'] == '' and h[0]['auth'] == '', [r, h])
    # Gegenprobe: ohne Kadris Regel 80 (nur die normalen Regeln des Browsers) käme der Cookie von b.test an
    sw.evaluate('''async () => { const d = chrome.declarativeNetRequest; globalThis.__upd0 = d.updateSessionRules;
        d.updateSessionRules = (o) => globalThis.__upd0.call(d, Object.assign({}, o, { addRules: (o.addRules || []).filter((r) => r.id !== 80) }));
        await d.updateSessionRules({ removeRuleIds: [80] }); }''')
    xhr(pg, {'method': 'GET', 'url': A + 'redir?to=' + urllib.parse.quote(Bb + 'hdr?tag=b0'), 'headers': AUTH})
    h0 = hits('b0')
    sw.evaluate('async () => { chrome.declarativeNetRequest.updateSessionRules = globalThis.__upd0; await stripUpdate(); }')
    check('Gegenprobe ohne Regel: der Browser allein schickte den Cookie von b.test mit', h0 and 'c=B' in h0[0]['cookie'], h0)
    r = xhr(pg, {'method': 'GET', 'url': A + 'redir?to=' + urllib.parse.quote(Bb + 'hdr?tag=b2'), 'headers': AUTH})
    h = hits('b2')
    check('… Regel wieder da: wieder nichts', h and h[0]['cookie'] == '' and h[0]['auth'] == '', h)
    r = xhr(pg, {'method': 'GET', 'url': Bb + 'hdr?tag=b3'})
    h = hits('b3')
    check('direkt an b.test (fremde Seite): ohne Anmeldung', r.get('status') == 200 and h and h[0]['cookie'] == '', [r, h])
    # ---- 2. Helfer-Abfrage + gleichzeitige fremde Weiterleitung ins eigene Netz ----
    helper['on'] = True
    del SECRET_HITS[:]
    res = pg.evaluate(PAR, [{'method': 'GET', 'url': 'http://127.0.0.1:47811/status', 'headers': {'X-EVP-Key': 'evp-1'}}] * 4 +
                      [{'method': 'GET', 'url': A + 'redir?to=' + urllib.parse.quote(LAN + 'secret')}] * 4)
    time.sleep(0.5)
    check('Helfer-Abfragen gehen durch', all(x.get('status') == 200 for x in res[:4]), res[:4])
    check('gleichzeitige Weiterleitung ins eigene Netz: gesperrt, Ziel nie erreicht', all('error' in x for x in res[4:]) and not SECRET_HITS, [res[4:], SECRET_HITS[:]])
    helper['on'] = False
    # ---- 3. Seite im eigenen Netz (Medienserver) ----
    lan = ctx.new_page(); lan.goto(LAN + 'direct.html'); time.sleep(1.5)
    del SECRET_HITS[:]
    slow = lan.evaluate('(o) => { window.__slow = (%s)(o); return 1; }' % XHR, {'method': 'GET', 'url': LAN + 'slow?ms=2000'})
    time.sleep(0.4)
    r2 = xhr(pg, {'method': 'GET', 'url': A + 'redir?to=' + urllib.parse.quote(LAN + 'secret')})
    r1 = lan.evaluate('() => window.__slow')
    check('Medienserver: die eigene Anfrage geht durch', r1.get('status') == 200, r1)
    check('… gleichzeitige fremde Weiterleitung auf denselben Server: gesperrt', 'error' in r2 and not SECRET_HITS, [r2, SECRET_HITS[:]])
    r = xhr(lan, {'method': 'GET', 'url': LAN + 'hdr?tag=l1'})
    check('Medienserver: eigene Dateien mit Anmeldung erreichbar', r.get('status') == 200 and hits('l1'), r)
    r = xhr(lan, {'method': 'GET', 'url': LAN + 'redir?to=' + urllib.parse.quote(LAN + 'hdr?tag=l2')})
    check('Weiterleitung des Medienservers (unerwartet): gesperrt', 'error' in r and not hits('l2'), [r, hits('l2')])
    lan.close()
    # Exact SAME local URL: only the legitimate request may reach the server.
    lan = ctx.new_page(); lan.goto(LAN + 'direct.html'); time.sleep(1.0)
    exact = LAN + 'slow?ms=1200&tag=exact-grant'
    lan.evaluate('(o) => { window.__slow = (%s)(o); return 1; }' % XHR, {'url': exact})
    for _ in range(100):
        if hits('exact-grant'): break
        time.sleep(0.02)
    check('exact URL: legitimate request reached server', len(hits('exact-grant')) == 1, hits('exact-grant'))
    r = xhr(pg, {'url': A + 'redir?to=' + urllib.parse.quote(exact)})
    legitimate = lan.evaluate('() => window.__slow')
    check('exact URL: concurrent foreign redirect blocked', 'error' in r and legitimate.get('status') == 200 and len(hits('exact-grant')) == 1, [r, hits('exact-grant')])
    lan.close()
    # B has an authenticated request in flight while A redirects to B.
    bp = ctx.new_page(); bp.goto(Bb + 'direct.html'); time.sleep(1.0)
    bp.evaluate('(o) => { window.__slow = (%s)(o); return 1; }' % XHR,
                {'url': Bb + 'slow?ms=1200&tag=b-active'})
    for _ in range(100):
        if hits('b-active'): break
        time.sleep(0.02)
    check('B credential request is active', len(hits('b-active')) == 1, hits('b-active'))
    r = xhr(pg, {'url': A + 'redir?to=' + urllib.parse.quote(Bb + 'hdr?tag=b-parallel'), 'headers': AUTH})
    bp.evaluate('() => window.__slow')
    h = hits('b-parallel')
    check('parallel B request does not authorize A redirect', r.get('status') == 200 and h and not h[0]['cookie'] and not h[0]['auth'], [r,h])
    bp.close()
    # ---- 4. Schutzregeln lassen sich nicht setzen ----
    sw.evaluate('''() => { const d = chrome.declarativeNetRequest; globalThis.__upd = d.updateSessionRules;
        d.updateSessionRules = () => Promise.reject(new Error('Test')); netReady = null; }''')
    r = xhr(pg, {'method': 'GET', 'url': A + 'hdr?tag=f1'})
    check('ohne Schutzregeln: keine Anfrage hinaus', 'error' in r and 'Schutzregeln' in r['error'] and not hits('f1'), [r, hits('f1')])
    helper['on'] = True
    r = xhr(pg, {'method': 'GET', 'url': 'http://127.0.0.1:47811/status', 'headers': {'X-EVP-Key': 'evp-1'}})
    check('… die Helfer-App bleibt erreichbar', r.get('status') == 200, r)
    sw.evaluate('() => { chrome.declarativeNetRequest.updateSessionRules = globalThis.__upd; netReady = null; }')
    r = xhr(pg, {'method': 'GET', 'url': A + 'hdr?tag=f2'})
    check('Regeln wieder setzbar: Anfragen gehen wieder', r.get('status') == 200 and hits('f2'), r)
    ctx.close()
tsrv.shutdown()
shutdown()
done()
