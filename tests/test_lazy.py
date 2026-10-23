# Sparsam: hls.js wird erst geladen, wenn ein Stream läuft (nicht mehr auf jeder Seite); in eingebetteten
# Fenstern lädt Kadri selbst erst, wenn dort ein Video auftaucht (sub.js) – auch wenn es erst später kommt.
# Stream-Listen ohne Endung erkennt page.js am Content-Type (der Hintergrund hört nicht mehr jede Anfrage ab).
import time, json, os
from common import *

man = json.load(open(os.path.join(EXT, 'manifest.json')))
cs = [j for c in man['content_scripts'] for j in c['js']]
check('Manifest: hls.js nicht mehr auf jeder Seite, kein webRequest', 'hls.min.js' not in cs and 'webRequest' not in man['permissions'], [cs, man['permissions']])
with sync_playwright() as p:
    ctx, sw, udir = launch(p)
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(B + 'frames.html'); time.sleep(2.0)
    def on(name): 
        f = [x for x in pg.frames if x.url.endswith(name)][0]
        return f, f.evaluate('() => document.documentElement.hasAttribute("data-evp-on")')
    fa, a = on('frame_novid.html'); fb, b = on('frame_vid.html'); fc, c0 = on('frame_late.html')
    top = pg.evaluate('() => document.documentElement.hasAttribute("data-evp-on")')
    check('Hauptfenster: Kadri läuft sofort', top)
    check('Fenster ohne Video: Kadri wird gar nicht geladen', not a, a)
    check('Fenster mit Video: Kadri geladen', b, b)
    check('… Video erscheint erst später: noch nicht geladen', not c0, c0)
    time.sleep(2.5); c1 = fc.evaluate('() => document.documentElement.hasAttribute("data-evp-on")')
    check('… sobald es da ist: Kadri geladen', c1, c1)
    # im Fenster mit Video: Knopf da, Player öffnet und spielt
    fb.evaluate('() => { document.getElementById("v").muted = false; }'); time.sleep(1.0)
    fb.wait_for_function('() => { const h = document.querySelector("[data-kadri-test]"); return h && h.shadowRoot.querySelector("button[aria-label=\'Im Videoplayer öffnen\']"); }', timeout=15000)
    fb.evaluate('() => document.querySelector("[data-kadri-test]").shadowRoot.querySelector("button[aria-label=\'Im Videoplayer öffnen\']").click()')
    fb.wait_for_function('() => { const v = document.querySelector("[data-kadri-test]").shadowRoot.querySelector(".vv"); return v && v.currentTime > 0.3; }', timeout=20000)
    time.sleep(1.0)
    r = pg.evaluate('() => { const f = document.getElementById("b").getBoundingClientRect(); return [Math.round(f.width), Math.round(f.height)]; }')
    check('… Knopf am Video im Fenster, Player spielt und das Fenster füllt den Bildschirm (mit Schlüssel)', r[1] >= 780, r)
    check('keine Fehler der Seite', not errs, errs)
    ctx.close()
shutdown()
done()
