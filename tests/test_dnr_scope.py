# Kadris Schutzregeln (DNR) betreffen nur Kadris eigene Anfragen – nie die Service Worker fremder Webseiten.
# Beide haben keinen Tab (tabIds -1); unterschieden wird über den Initiator (diese Erweiterung). Echte Anfragen an echte
# Listener, geprüft wird, was beim Server TATSÄCHLICH ankommt:
#  Fremder Service Worker (Seite a.test mit eigenem SW):
#   F1 Cookie und Authorization kommen bei der eigenen Seite an (früher entfernte Regel 80 sie)
#   F2 Anfrage an 127.0.0.1 erreicht den Listener (früher Regeln 51–58)
#   F3 Anfrage an localhost erreicht den Listener (früher Regel 70)
#   F4 Weiterleitung ins eigene Netz erreicht den Listener (früher gesperrt)
#   F5 eine gleichzeitige Kadri-Anfrage an GENAU dieselbe Adresse überträgt ihren Referer nicht auf den SW
#  Gegenprobe: Chromium ohne Kadri liefert für F1–F4 dasselbe.
#  Kadris eigene Anfragen bleiben geschützt (gleicher Lauf):
#   O1 Weiterleitung ins eigene Netz (127.0.0.1) gesperrt   O2 Weiterleitung zu localhost gesperrt
#   O3 Regeln stehen mit Initiator = Kadri (Prüfung im Hintergrund)
# (Cookies bei Weiterleitung zu fremden Seiten, Helfer-App, Medienserver zu Hause: test_redirect.py, gleicher Bau)
import time
from common import *

XHR = '''(o) => new Promise((res) => { const id = Math.random().toString(36).slice(2);
  const h = (e) => { const d = e.data && e.data.kadriTestRes; if (d && d.id === id) { removeEventListener('message', h); res(d); } };
  addEventListener('message', h); postMessage({ kadriTestXhr: Object.assign({ id }, o) }, '*'); setTimeout(() => res({ error: 'kein Ergebnis' }), 15000); })'''
A = 'http://a.test:%d/' % PORT
LAN = 'http://127.0.0.1:%d/' % PORT
LOCALHOST = 'http://localhost:%d/' % PORT
ARGS = ['--host-resolver-rules=MAP *.test 127.0.0.1', '--no-proxy-server', '--unsafely-treat-insecure-origin-as-secure=' + A.rstrip('/')]
def hits(tag): return [h for h in HDR_HITS if h['tag'] == tag]
def wait_hits(tag, n, t=8):
    end = time.time() + t
    while time.time() < end and len(hits(tag)) < n: time.sleep(0.05)
    return hits(tag)

def foreign_sw(pg, label, prefix):
    """F1–F4 mit dem Service Worker der Seite; liefert die Ergebnisse für den Vergleich mit/ohne Kadri."""
    pg.goto(A + 'setc?v=A&d=a.test')
    pg.goto(A + 'sw_foreign.html')
    pg.evaluate('() => window.swReady')
    out = {}
    r = pg.evaluate('(u) => swFetch(u, { credentials: "include", headers: { Authorization: "Bearer sw-123" } })', A + 'hdr?tag=%sf1' % prefix)
    h = wait_hits(prefix + 'f1', 1)
    out['f1'] = bool(h) and 'c=A' in h[0]['cookie'] and h[0]['auth'] == 'Bearer sw-123'
    check(label + 'F1 fremder SW: Cookie und Authorization kommen bei der eigenen Seite an', out['f1'], [r, h])
    for key, url, what in (('f2', LAN + 'hdr?tag=%sf2' % prefix, '127.0.0.1'), ('f3', LOCALHOST + 'hdr?tag=%sf3' % prefix, 'localhost'),
                           ('f4', A + 'redir?to=' + urllib.parse.quote(LAN + 'hdr?tag=%sf4' % prefix), 'Weiterleitung ins eigene Netz')):
        r = pg.evaluate('(u) => swFetch(u, { mode: "no-cors" })', url)
        h = wait_hits(prefix + key, 1, 5)
        out[key] = bool(h)
        check(label + '%s fremder SW: %s erreicht den Listener' % (key.upper(), what), out[key], [r, h])
    return out

with sync_playwright() as p:
    # ---- Gegenprobe: derselbe Browser ohne Kadri ----
    plain = p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='kadri-plain-'), headless=False, args=ARGS)
    base = foreign_sw(plain.pages[0] if plain.pages else plain.new_page(), 'ohne Kadri: ', 'p')
    plain.close()

    ctx, sw, udir = launch(p, extra_args=ARGS)
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    pg.goto(A + 'direct.html'); time.sleep(1.5)
    with_kadri = foreign_sw(pg, 'mit Kadri: ', 'k')
    check('mit Kadri: fremder SW verhält sich genau wie ohne Kadri', with_kadri == base, [with_kadri, base])

    # ---- F5: Kadris Referer-Regel (genaue Adresse) gilt nicht für den fremden SW ----
    pg.goto(A + 'sw_foreign.html'); pg.evaluate('() => window.swReady')
    url5 = A + 'slow?tag=f5'
    HEADER_BARRIERS['f5'] = threading.Event()
    # beide Anfragen starten, ohne auf sie zu warten (der Server hält sie an, bis beide da sind)
    pg.evaluate('(o) => { window.__own = (%s)(o); }' % XHR, {'method': 'GET', 'url': url5, 'headers': {'Referer': A + 'direct.html'}})
    wait_hits('f5', 1)
    rules_held = sw.evaluate('async () => (await chrome.declarativeNetRequest.getSessionRules()).filter((r) => r.id >= 1000).length')
    pg.evaluate('(u) => { window.__sw = swFetch(u, { credentials: "omit" }); }', url5)
    h = wait_hits('f5', 2)
    HEADER_BARRIERS['f5'].set()
    res = pg.evaluate('() => Promise.all([window.__own, window.__sw])')
    check('F5 Kadris Referer-Regel steht, während beide Anfragen laufen', rules_held >= 1, rules_held)
    own_hit = [x for x in h if x['ref'] == A + 'direct.html']
    sw_hit = [x for x in h if x is not (own_hit[0] if own_hit else None)]
    check('F5 Kadris eigene Anfrage trägt ihren Referer (Regel wirkt)', len(h) == 2 and len(own_hit) == 1, h)
    check('F5 … der gleichzeitige fremde SW an dieselbe Adresse bekommt ihn nicht', len(sw_hit) == 1 and sw_hit[0]['ref'] != A + 'direct.html', h)

    # ---- Kadris eigene Anfragen bleiben geschützt ----
    pg.goto(A + 'direct.html'); time.sleep(0.5)
    r = pg.evaluate('(o) => (%s)(o)' % XHR, {'method': 'GET', 'url': A + 'redir?to=' + urllib.parse.quote(LAN + 'hdr?tag=o1')})
    time.sleep(0.8)
    check('O1 Kadri: Weiterleitung ins eigene Netz (127.0.0.1) gesperrt', not hits('o1') and r.get('status') != 200, [r, hits('o1')])
    r = pg.evaluate('(o) => (%s)(o)' % XHR, {'method': 'GET', 'url': A + 'redir?to=' + urllib.parse.quote(LOCALHOST + 'hdr?tag=o2')})
    time.sleep(0.8)
    check('O2 Kadri: Weiterleitung zu localhost gesperrt', not hits('o2') and r.get('status') != 200, [r, hits('o2')])
    rules = sw.evaluate('async () => (await chrome.declarativeNetRequest.getSessionRules()).filter((r) => r.id >= 50 && r.id <= 80).map((r) => [r.id, r.condition.initiatorDomains || null, r.condition.tabIds || null])')
    ext_id = sw.evaluate('() => chrome.runtime.id')
    check('O3 Regeln 50–58, 70, 80 stehen nur für Kadri (Initiator = Erweiterung, kein Tab)',
          sorted(x[0] for x in rules) == [50, 51, 52, 53, 54, 55, 56, 57, 58, 70, 80] and all(x[1] == [ext_id] and x[2] == [-1] for x in rules), rules)
    ctx.close()
shutdown()
done()
