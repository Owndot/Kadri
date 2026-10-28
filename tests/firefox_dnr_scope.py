# Firefox: Kadris Schutz betrifft nur Kadris eigene Anfragen – nie den Service Worker einer fremden Webseite.
# Echter Firefox (Selenium + geckodriver), Kadri als temporäre Erweiterung aus dist/test-firefox (mit Test-Öffnung),
# echte Listener. Firefox schützt Kadris Anfragen mit webRequest (nur eigene: kein Tab UND Herkunft moz-extension://);
# per DNR setzt er nur kurzlebige Referer-Regeln für genau eine Adresse.
#   F1 fremder SW: Cookie und Authorization kommen an        F2 fremder SW: localhost (andere lokale Adresse) erreichbar
#   F3 fremder SW: Weiterleitung zu einer lokalen Adresse     F5 Kadris Referer-Regel trifft nur Kadris eigene Anfrage
#   O1 Kadris eigene Weiterleitung zu einer anderen lokalen Adresse bleibt gesperrt
#   Gegenprobe ohne Kadri: F1–F3 identisch.
# Vorher: node tools/build.js --test-firefox   Aufruf: python3 tests/firefox_dnr_scope.py [Erweiterungsordner]
import os, sys, time, threading, urllib.parse
from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from common import check, done, HDR_HITS, HEADER_BARRIERS, PORT, HERE, srv, hsrv

EXT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'dist', 'test-firefox'))
P = 'http://127.0.0.1:%d/' % PORT
LOCALHOST = 'http://localhost:%d/' % PORT
def hits(tag): return [h for h in HDR_HITS if h['tag'] == tag]
def wait_hits(tag, n, t=8):
    end = time.time() + t
    while time.time() < end and len(hits(tag)) < n: time.sleep(0.05)
    return hits(tag)

def browser(with_kadri):
    o = Options(); o.add_argument('-headless')
    o.set_preference('devtools.serviceWorkers.testing.enabled', True)
    o.set_preference('network.proxy.type', 0)
    o.set_preference('network.cookie.sameSite.laxByDefault', False)
    d = webdriver.Firefox(options=o)
    d.set_script_timeout(30)
    if with_kadri: d.install_addon(EXT, temporary=True)
    return d

SWFETCH = 'const [u, init, done] = arguments; window.swFetch(u, init).then(done, (e) => done("error " + e));'
XHR = '''const [o, done] = arguments; const id = Math.random().toString(36).slice(2);
  const h = (e) => { const d = e.data && e.data.kadriTestRes; if (d && d.id === id) { removeEventListener('message', h); done(d); } };
  addEventListener('message', h); postMessage({ kadriTestXhr: Object.assign({ id }, o) }, '*'); setTimeout(() => done({ error: 'kein Ergebnis' }), 15000);'''

def foreign_sw(d, label, prefix):
    d.get(P + 'setc?v=A')
    d.get(P + 'sw_foreign.html')
    d.execute_async_script('const done = arguments[0]; window.swReady.then(() => done(true), (e) => done(String(e)));')
    out = {}
    r = d.execute_async_script(SWFETCH, P + 'hdr?tag=%sf1' % prefix, {'credentials': 'include', 'headers': {'Authorization': 'Bearer sw-123'}})
    h = wait_hits(prefix + 'f1', 1)
    out['f1'] = bool(h) and 'c=A' in h[0]['cookie'] and h[0]['auth'] == 'Bearer sw-123'
    check(label + 'F1 fremder SW: Cookie und Authorization kommen an', out['f1'], [r, h])
    for key, url, what in (('f2', LOCALHOST + 'hdr?tag=%sf2' % prefix, 'localhost'),
                           ('f3', P + 'redir?to=' + urllib.parse.quote(LOCALHOST + 'hdr?tag=%sf3' % prefix), 'Weiterleitung zu einer lokalen Adresse')):
        r = d.execute_async_script(SWFETCH, url, {'mode': 'no-cors'})
        h = wait_hits(prefix + key, 1, 5)
        out[key] = bool(h)
        check(label + '%s fremder SW: %s erreicht den Listener' % (key.upper(), what), out[key], [r, h])
    return out

plain = browser(False)
try: base = foreign_sw(plain, 'ohne Kadri: ', 'p')
finally: plain.quit()

d = browser(True)
try:
    with_kadri = foreign_sw(d, 'mit Kadri: ', 'k')
    check('mit Kadri: fremder SW verhält sich genau wie ohne Kadri', with_kadri == base, [with_kadri, base])
    # Kadris Test-Öffnung bereit? (Inhaltsskript startet nach dem Laden des Speichers)
    d.get(P + 'sw_foreign.html')
    d.execute_async_script('const done = arguments[0]; window.swReady.then(() => done(true));')
    ready = None
    for _ in range(20):
        ready = d.execute_async_script(XHR, {'method': 'GET', 'url': P + 'hdr?tag=ready'})
        if ready.get('status') == 200: break
        time.sleep(0.5)
    check('Kadri-Test-Öffnung bereit (eigene Anfrage an die eigene lokale Seite)', ready and ready.get('status') == 200, ready)
    # F5: Kadris eigene Anfrage (mit Referer-Regel für genau diese Adresse) und gleichzeitig der fremde SW – beide in
    # einem Skript gestartet; der Server hält beide an, bis beide angekommen sind
    url5 = P + 'slow?tag=f5'
    HEADER_BARRIERS['f5'] = threading.Event()
    threading.Thread(target=lambda: (wait_hits('f5', 2, 12), HEADER_BARRIERS['f5'].set()), daemon=True).start()
    res = d.execute_async_script('''const [o, u, done] = arguments; const id = Math.random().toString(36).slice(2);
      const own = new Promise((res) => { const h = (e) => { const d = e.data && e.data.kadriTestRes; if (d && d.id === id) { removeEventListener('message', h); res(d); } };
        addEventListener('message', h); postMessage({ kadriTestXhr: Object.assign({ id }, o) }, '*'); setTimeout(() => res({ error: 'kein Ergebnis' }), 20000); });
      const sw = new Promise((r) => setTimeout(r, 300)).then(() => window.swFetch(u, { credentials: 'omit' }));
      Promise.all([own, sw]).then(done, (e) => done(String(e)));''', {'method': 'GET', 'url': url5, 'headers': {'Referer': P + 'direct.html'}}, url5)
    HEADER_BARRIERS['f5'].set()
    h = hits('f5')
    own_hit = [x for x in h if x['ref'] == P + 'direct.html']
    check('F5 Kadris eigene Anfrage trägt ihren Referer (Regel wirkt)', len(h) == 2 and len(own_hit) == 1, [h, res])
    check('F5 … der gleichzeitige fremde SW an dieselbe Adresse bekommt ihn nicht', len(h) == 2 and len(own_hit) == 1, h)
    # O1: Kadris eigene Anfrage: lokale Seite ist frei, eine Weiterleitung zu einer ANDEREN lokalen Adresse nicht
    d.get(P + 'direct.html'); time.sleep(0.5)
    r = d.execute_async_script(XHR, {'method': 'GET', 'url': P + 'redir?to=' + urllib.parse.quote(LOCALHOST + 'hdr?tag=o1')})
    time.sleep(0.8)
    check('O1 Kadri: Weiterleitung zu einer anderen lokalen Adresse gesperrt', not hits('o1') and r.get('status') != 200, [r, hits('o1')])
finally:
    d.quit()
srv.shutdown(); hsrv.shutdown()
done()
