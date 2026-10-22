# Welcher Stream läuft wirklich? In der Erweiterung liest page.js die Stream-Listen der Seite mit (das Userscript
# im abgetrennten Bereich sieht sie nicht) – damit greift der Nachweis über die geladenen Stücke.
#  - Seite lädt das nächste Video vor, spielt aber dieses → Player spielt das laufende
#  - Videowechsel ohne Neuladen (ARD-artig) → neuer Stream; zurück zum ersten → wieder dessen Stream
import time
from common import *

with sync_playwright() as p:
    ctx, sw, udir = launch(p)
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    reqs = []; pg.on('request', lambda r: reqs.append(r.url))
    # 1) vorgeladenes nächstes Video
    pg.goto(B + 'proof.html#preload')
    pg.wait_for_function('document.getElementById("v").currentTime > 0.8', timeout=20000)
    pg.evaluate('() => { document.getElementById("v").muted = false; }'); time.sleep(1.2)
    n0 = len(reqs)
    pg.evaluate('() => %s.querySelector("button[aria-label=\'Im Videoplayer öffnen\']").click()' % R)
    pg.wait_for_function('() => { const v = %s.querySelector(".vv"); return v && v.currentTime > 0.3; }' % R, timeout=25000)
    time.sleep(0.5)
    st = pg.evaluate('() => [Math.round(%s.querySelector(".vv").duration), Math.round(document.getElementById("v").duration)]' % R)
    after = [u.replace(B, '/') for u in reqs[n0:] if '.m3u8' in u]
    check('vorgeladenes nächstes Video: Player spielt das laufende (60 s), lädt das andere nicht', st == [60, 60] and not any('/hls3/' in u for u in after), [st, after])
    # Diagnose: Listen wurden wirklich mitgelesen
    sw.evaluate('''async () => { const [t] = await chrome.tabs.query({ active: true }); await chrome.tabs.sendMessage(t.id, { t: 'kadri-menu' }, { frameId: 0 }); }''')
    time.sleep(0.8)
    dg = pg.evaluate('() => { const b = %s.querySelector("textarea"); return b ? b.value : ""; }' % R)
    line = [l for l in dg.split('\n') if l.startswith('Stream-Nachweis')]
    import re as _re
    m = _re.search(r'Listen gelesen: (\d+)', line[0] if line else '')
    check('… Diagnose: Stream-Listen der Seite gelesen (page.js)', m and int(m.group(1)) >= 2, line)
    # 2) Videowechsel ohne Neuladen
    pg.goto(B + 'spa.html')
    pg.wait_for_function('document.getElementById("v").currentTime > 0.5', timeout=20000)
    pg.evaluate('() => { document.getElementById("v").muted = false; }'); time.sleep(2.0)
    pg.evaluate('() => switchTo()')
    pg.wait_for_function('() => { const v = document.getElementById("v"); return v.currentTime > 0.3 && v.videoWidth > 0; }', timeout=20000)
    pg.evaluate('() => { document.getElementById("v").muted = false; }'); time.sleep(0.6)
    n1 = len(reqs)
    pg.evaluate('() => %s.querySelector("button[aria-label=\'Im Videoplayer öffnen\']").click()' % R)
    pg.wait_for_function('() => { const v = %s.querySelector(".vv"); return v && v.currentTime > 0.3; }' % R, timeout=25000)
    time.sleep(0.5)
    a1 = [u.replace(B, '/') for u in reqs[n1:] if '.m3u8' in u]
    check('Videowechsel ohne Neuladen: Player lädt den Stream des neuen Videos', any('/hls2/' in u for u in a1) and not any('/hls/' in u for u in a1), a1)
    pg.evaluate('() => %s.querySelector("button[aria-label=Schließen]").click()' % R); time.sleep(1.0)
    pg.evaluate('() => switchBack()')
    pg.wait_for_function('() => { const v = document.getElementById("v"); return v.currentTime > 0.3 && v.videoWidth > 0; }', timeout=20000)
    pg.evaluate('() => { const v = document.getElementById("v"); v.muted = false; v.play(); }'); time.sleep(0.8)
    n2 = len(reqs)
    pg.evaluate('() => %s.querySelector("button[aria-label=\'Im Videoplayer öffnen\']").click()' % R)
    pg.wait_for_function('() => { const v = %s.querySelector(".vv"); return v && v.currentTime > 0.3; }' % R, timeout=25000)
    time.sleep(0.5)
    a2 = [u.replace(B, '/') for u in reqs[n2:] if '.m3u8' in u]
    check('… zurück zum ersten Video: wieder dessen Stream', any('/hls/' in u for u in a2) and not any('/hls2/' in u for u in a2), a2)
    check('keine Fehler der Seite', not errs, errs)
    ctx.close()
shutdown()
done()
