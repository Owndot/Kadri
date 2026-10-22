# Facebook (nachgebaut) in der Erweiterung: Spiegeln, am Reel-Ende anhalten, Countdown „Next reel in 3“ abbrechen,
# kein Bild-in-Bild, Teilen des laufenden Reels.
import time
from common import *

CLIP = open(WEB + '/clip.webm', 'rb').read()
A, Bid = '111111111111111', '222222222222222'
PAGE = '''<!doctype html><html><head><title>Reels</title></head><body style="margin:0">
<div class="reel" data-store='{"videoID":"%s"}'><a href="/reel/%s/?s=1">Reel</a>
<video id=v muted autoplay playsinline src="/data/reel1.webm" style="width:100%%;display:block"></video></div>
<script>
const v = document.getElementById('v'); window.__advanced = 0; window.__cancelled = 0; let cd = null;
setInterval(() => {   // wie Facebook: Countdown am Ende – auch wenn angehalten
  if (cd || !v.src.endsWith('reel1.webm') || !(v.duration - v.currentTime < 1.5)) return;
  cd = document.createElement('div');
  cd.innerHTML = '<div><span>↓ </span><span>Next reel in <b>3</b></span></div><div role="button"><span>Cancel</span></div>';
  document.body.append(cd); let n = 3;
  const iv = setInterval(() => { n--; if (!cd.isConnected) { clearInterval(iv); return; } if (n <= 0) { clearInterval(iv); cd.remove(); window.__advanced++; v.src = '/data/reel2.webm'; v.play().catch(() => {}); return; } cd.querySelector('b').textContent = n; }, 700);
  cd.querySelector('[role=button]').addEventListener('click', () => { window.__cancelled++; clearInterval(iv); cd.remove(); setTimeout(() => { cd = null; }, 400); });
}, 200);
</script></body></html>''' % (Bid, Bid)
def serve(route):
    u = route.request.url
    if '/data/' in u:
        rg = route.request.headers.get('range', ''); n = len(CLIP)
        if rg.startswith('bytes='):
            a, _, z = rg[6:].partition('-'); a = int(a or 0); z = min(int(z) if z else n - 1, n - 1)
            route.fulfill(status=206, content_type='video/webm', body=CLIP[a:z + 1], headers={'Content-Range': 'bytes %d-%d/%d' % (a, z, n), 'Accept-Ranges': 'bytes'})
        else: route.fulfill(status=200, content_type='video/webm', body=CLIP, headers={'Accept-Ranges': 'bytes'})
    elif '/reel/' in u: route.fulfill(status=200, content_type='text/html', body=PAGE)
    else: route.fulfill(status=404, body='')

with sync_playwright() as p:
    ctx, sw, udir = launch(p)
    ctx.route('https://www.facebook.com/**', serve)
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('https://www.facebook.com/reel/%s/' % A)   # Adresse noch beim ersten Reel
    pg.wait_for_function('document.getElementById("v").currentTime > 0.5', timeout=20000)
    pg.evaluate('() => { document.getElementById("v").muted = false; }'); time.sleep(1.2)
    pg.evaluate('() => %s.querySelector("button[aria-label=\'Im Videoplayer öffnen\']").click()' % R)
    pg.wait_for_function('() => { const v = %s.querySelector(".vv"); return v && v.srcObject; }' % R, timeout=20000); time.sleep(0.6)
    check('Facebook: Player spiegelt das Video der Seite', pg.evaluate('() => !!%s.querySelector(".vv").srcObject' % R))
    pp = pg.evaluate('() => { const r = %s, b = r.querySelector("button[aria-label=\'Bild-in-Bild\']"); return [b ? getComputedStyle(b).display : "fehlt", r.querySelector(".vv").disablePictureInPicture, document.getElementById("v").disablePictureInPicture]; }' % R)
    check('… kein Bild-in-Bild (kein Knopf, weder Player noch Seitenvideo)', pp[0] in ('none', 'fehlt') and pp[1] is True and pp[2] is True, pp)
    # Teilen: laufendes Reel (ID aus dem Kasten), nicht die Seitenadresse
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin='https://www.facebook.com')
    has_share = pg.evaluate('() => typeof navigator.share === "function"')
    pg.evaluate('() => { const r = %s; r.querySelector(".vp").classList.add("ctl"); r.querySelector("button[aria-label=Mehr]").click(); }' % R); time.sleep(0.4)
    pg.evaluate('() => Array.from(%s.querySelectorAll(".vmenu.on .vmi")).find(b => b.firstChild.textContent === "Link teilen").click()' % R); time.sleep(0.6)
    # (die Erweiterung läuft abgetrennt – ein nachgebautes Teilen-Menü der Seite sähe sie nicht; ohne Teilen-Menü
    #  kopiert sie den Link: der steht dann in der Zwischenablage)
    sh = pg.evaluate('() => navigator.clipboard.readText().catch(e => "Fehler: " + e)') if not has_share else ''
    check('… Teilen: das laufende Reel, nicht die Seitenadresse', has_share or (('/reel/%s/' % Bid) in sh and A not in sh), [has_share, sh])
    close_menu(pg)
    # ans Ende: anhalten, Countdown abbrechen, Seite springt nicht weiter
    pg.evaluate('() => { const v = document.getElementById("v"); v.currentTime = v.duration - 3; }')
    time.sleep(6)
    s = pg.evaluate('() => { const v = document.getElementById("v"); return { adv: window.__advanced, cancelled: window.__cancelled, src: v.src.split("/").pop(), paused: v.paused, open: !!%s.querySelector(".vp") }; }' % R)
    check('Reel-Ende: angehalten, Countdown abgebrochen, bleibt beim Reel', s['adv'] == 0 and s['cancelled'] >= 1 and s['src'] == 'reel1.webm' and s['paused'] and s['open'], s)
    u = pg.evaluate('() => { const r = %s; r.querySelector(".vp").classList.add("ctl"); const t = r.querySelectorAll(".vtime"); return [t[0].textContent, t[1].textContent, r.querySelector(".vplay path").getAttribute("d").slice(0, 7)]; }' % R)
    check('… Anzeige wie fertig (Zeit = Länge, „noch einmal“)', u[0] == u[1] and u[2] == 'M12 5V1', u)
    check('keine Fehler der Seite', not errs, errs)
    ctx.close()
shutdown()
done()
