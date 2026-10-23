# Bild-in-Bild auf allen Seiten: Seiten wie Facebook verbieten es per „Permissions-Policy“ für die ganze
# Seite (dann gibt es weder Knopf noch automatisches kleines Fenster). Kadri hängt „picture-in-picture=*“ an –
# andere Verbote der Seite (hier: Kamera) bleiben bestehen.
import time
from common import *

with sync_playwright() as p:
    ctx, sw, udir = launch(p)
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(B + 'direct.html?nopip=1'); time.sleep(0.5)
    st = pg.evaluate('() => [document.pictureInPictureEnabled, document.featurePolicy ? document.featurePolicy.allowsFeature("picture-in-picture") : null, document.featurePolicy ? document.featurePolicy.allowsFeature("camera") : null]')
    check('Seite verbietet Bild-in-Bild: mit Kadri trotzdem erlaubt, Kamera-Verbot bleibt', st[0] is True and st[1] is not False and st[2] is False, st)
    open_player(pg, B + 'direct.html?nopip=1')
    pg.evaluate('() => %s.querySelector(".vp").classList.add("ctl")' % R)
    pg.evaluate('() => %s.querySelector("button[aria-label=\'Bild-in-Bild\']").click()' % R); time.sleep(1.5)
    pip = pg.evaluate('() => { const r = %s; return !!(r.pictureInPictureElement || document.pictureInPictureElement); }' % R)
    check('… Knopf öffnet das kleine Fenster', pip, pip)
    check('keine Fehler der Seite', not errs, errs)
    ctx.close()
shutdown()
done()
