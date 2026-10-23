# Facebook gespiegelt + Bild-in-Bild: Solange gespiegelt wird, erfährt die Seite nicht, dass sie verdeckt
# ist (page.js, „Schild“) – ihr Video und damit der Spiegel laufen im Hintergrund weiter. Kadri selbst bekommt die
# Meldung trotzdem („Beim Verlassen: Anhalten“ greift). Nach dem Schließen gilt wieder alles wie gewohnt.
# „Verdeckt“ nachgestellt: Playwright hält jeden Tab „sichtbar“. Darum ersetzt der Test die Abfrage des Browsers
# („document.hidden“) durch eine schaltbare – bevor page.js sie einwickelt – und schickt die Meldung wie der Browser.
import time
from common import *

CLIP = open(WEB + '/clip.webm', 'rb').read()
PAGE = '''<!doctype html><html><head><title>Reels</title></head><body style="margin:0">
<video id=v muted autoplay playsinline loop src="/data/c.webm" style="width:100%;display:block"></video>
<script>
// wie Facebook: verdeckt → anhalten (per Meldung UND per Abfrage)
const v = document.getElementById('v'); window.__pausedBySite = 0; window.__sawHidden = 0;
const chk = () => { if (document.hidden || document.visibilityState === 'hidden') { window.__sawHidden++; if (!v.paused) { v.pause(); window.__pausedBySite++; } } };
document.addEventListener('visibilitychange', chk);
setInterval(chk, 250);
</script></body></html>'''
def serve(route):
    u = route.request.url
    if '/data/' in u:
        rg = route.request.headers.get('range', ''); n = len(CLIP)
        if rg.startswith('bytes='):
            a, _, z = rg[6:].partition('-'); a = int(a or 0); z = min(int(z) if z else n - 1, n - 1)
            route.fulfill(status=206, content_type='video/webm', body=CLIP[a:z + 1], headers={'Content-Range': 'bytes %d-%d/%d' % (a, z, n), 'Accept-Ranges': 'bytes'})
        else: route.fulfill(status=200, content_type='video/webm', body=CLIP, headers={'Accept-Ranges': 'bytes'})
    else: route.fulfill(status=200, content_type='text/html', body=PAGE)

with sync_playwright() as p:
    ctx, sw, udir = launch(p)
    ctx.add_init_script('''(() => { const DP = Document.prototype; window.__fakeHidden = false;
      Object.defineProperty(DP, "hidden", { configurable: true, get() { return !!window.__fakeHidden; } });
      Object.defineProperty(DP, "visibilityState", { configurable: true, get() { return window.__fakeHidden ? "hidden" : "visible"; } }); })()''')
    ctx.route('https://www.facebook.com/**', serve)
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    def site(): return pg.evaluate('() => { const v = document.getElementById("v"); return { paused: v.paused, bySite: window.__pausedBySite, sawHidden: window.__sawHidden }; }')
    def away(sec):
        pg.evaluate('() => { window.__fakeHidden = true; window.__kv = 0; document.addEventListener("kadri-vis", () => window.__kv++); document.dispatchEvent(new Event("visibilitychange")); }')
        time.sleep(sec)
    def back():
        pg.evaluate('() => { window.__fakeHidden = false; document.dispatchEvent(new Event("visibilitychange")); }'); time.sleep(0.5)
    pg.goto('https://www.facebook.com/reel/111222333444555/')
    pg.wait_for_function('document.getElementById("v").currentTime > 0.5', timeout=20000)
    pg.evaluate('() => { document.getElementById("v").muted = false; }'); time.sleep(1.0)
    pg.evaluate('() => %s.querySelector("button[aria-label=\'Im Videoplayer öffnen\']").click()' % R)
    pg.wait_for_function('() => { const v = %s.querySelector(".vv"); return v && v.srcObject; }' % R, timeout=20000); time.sleep(0.8)
    pp = pg.evaluate('() => { const b = %s.querySelector("button[aria-label=\'Bild-in-Bild\']"); return b ? getComputedStyle(b).display : "fehlt"; }' % R)
    check('gespiegelt: Bild-in-Bild-Knopf da (Schild aktiv)', pp not in ('none', 'fehlt'), pp)
    # 1) anderer Tab nach vorn: die Seite merkt nichts, ihr Video (= der Spiegel) läuft weiter
    away(2.0)
    s1 = site()
    seen = pg.evaluate('() => [document.hidden, window.__kv]')   # aus Sicht der Seite · Weitergabe an Kadri
    check('verdeckt beim Spiegeln: Seite bekommt es nicht mit, ihr Video läuft weiter', not s1['paused'] and s1['bySite'] == 0 and s1['sawHidden'] == 0 and seen[0] is False, [s1, seen])
    check('… Kadri bekommt die Meldung trotzdem (kadri-vis)', seen[1] >= 1, seen)
    back()
    # 3) Player zu: die Seite bekommt „verdeckt“ wieder selbst
    pg.evaluate('() => %s.querySelector("button[aria-label=Schließen]").click()' % R); time.sleep(0.8)
    pg.evaluate('() => document.getElementById("v").play()'); time.sleep(0.5)
    away(1.0)
    s3 = site()
    check('Player zu: Seite bekommt „verdeckt“ wieder und hält selbst an', s3['paused'] and s3['bySite'] >= 1, s3)
    back()
    check('keine Fehler der Seite', not errs, errs)
    ctx.close()
shutdown()
done()
