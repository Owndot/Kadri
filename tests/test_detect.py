# Stream erkennen, den man an der Adresse nicht erkennt: Die Haupt-Liste heißt „/stream/master?token=…“
# (ohne .m3u8) – nur der Server sagt per Content-Type, dass es HLS ist. Der Hintergrund der Erweiterung sieht das und
# meldet sie → eigener Player (vorher: nichts gefunden → nur Spiegeln).
import time
from common import *

with sync_playwright() as p:
    ctx, sw, udir = launch(p)
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    open_player(pg, B + 'noext.html')
    s = pg.evaluate('() => { const v = %s.querySelector(".vv"); return { mirror: !!v.srcObject, src: v.currentSrc.slice(0, 5), dur: Math.round(v.duration) }; }' % R)
    check('Stream ohne Endung (nur Content-Type): eigener Player über hls.js, nicht Spiegeln', not s['mirror'] and s['src'] == 'blob:' and s['dur'] == 60, s)
    sw.evaluate('''async () => { const [t] = await chrome.tabs.query({ active: true }); await chrome.tabs.sendMessage(t.id, { t: 'kadri-menu' }, { frameId: 0 }); }''')
    time.sleep(0.8)
    dg = pg.evaluate('() => { const b = %s.querySelector("textarea"); return b ? b.value : ""; }' % R)
    first = [l for l in dg.split('\n') if l.startswith(' 1.')]
    check('… Diagnose: die Liste steht vorn in der Reihenfolge', first and '/stream/master' in dg and 'M3U8' in first[0], first)
    check('keine Fehler der Seite', not errs, errs)
    ctx.close()
shutdown()
done()
