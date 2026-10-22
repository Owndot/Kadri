# Facebook mit EIGENEM Player (Kadri 1.1): Die fertige MP4 wird nur genommen, wenn sie sicher zum laufenden Video
# gehört (gleiche Video-ID wie die gerade geladenen Stücke). Sonst – und wenn ihre Länge nicht passt – wird gespiegelt.
# Nachgebaut wie der Reels-Feed: vier Reels werden vorgeladen, eines (A) läuft und lädt Stück für Stück nach.
import time, json, base64
from common import *

CLIP30 = open(WEB + '/clip_mse.webm', 'rb').read()   # gleich lang wie das laufende Video (30 s)
CLIP60 = open(WEB + '/clip.webm', 'rb').read()       # anderes Video (60 s)
R4 = ['4492197337662979', '2124988348408949', '1589423489311856', '1021815134245564']
A = R4[0]
def efg(d): return base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip('=')
def prog(a): return 'https://scontent-ber1-1.xx.fbcdn.net/o1/v/t2/f2/m367/' + a + '.mp4?efg=' + efg({'vencode_tag': 'xpv_progressive.FACEBOOK..C3.720.progressive_h264-basic-gen2_720p', 'xpv_asset_id': a})
def seg(a, n): return 'https://scontent-ber1-1.xx.fbcdn.net/o1/v/t2/f2/m69/' + a + '_%d.mp4?bytestart=%d&efg=' % (n, n * 1000) + efg({'vencode_tag': 'dash_h264_' + ('video' if n % 2 else 'audio'), 'xpv_asset_id': a})
def page(order):
    reels = ''.join('<div class="reel" data-video-url="%s" data-store=\'{"videoID":"%s"}\'></div>' % (prog(a).replace('&', '&amp;'), a) for a in R4)
    return '''<!doctype html><html><head><title>Reels</title></head><body style="margin:0">
<div id="list">%s</div>
<div id="player"><video id=v muted playsinline style="width:100%%;display:block"></video></div>
<script>
const nc = (u) => fetch(u, { mode: 'no-cors' }).catch(() => {});
const R4 = %s, SEG = {}; R4.forEach((a) => SEG[a] = %s[a]);
const w = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const v = document.getElementById('v');
  const ms = new MediaSource(); v.src = URL.createObjectURL(ms);
  await new Promise(r => ms.addEventListener('sourceopen', r, { once: true }));
  const sv = ms.addSourceBuffer('video/webm; codecs="vp8"'), sa = ms.addSourceBuffer('audio/webm; codecs="opus"');
  const V = new Uint8Array(await (await fetch('/data/mse_v.webm')).arrayBuffer()), Au = new Uint8Array(await (await fetch('/data/mse_a.webm')).arrayBuffer());
  const N = 8; let k = 0;
  const app = (sb, buf, i) => new Promise((r) => { sb.addEventListener('updateend', r, { once: true }); sb.appendBuffer(buf.slice(Math.floor(buf.length * i / N), Math.floor(buf.length * (i + 1) / N))); });
  const feed = async () => { if (k >= N) return; await app(sv, V, k); await app(sa, Au, k); k++; };
  await feed(); v.play().catch(() => {});
  const idx = {}; R4.forEach((a) => idx[a] = 0);
  for (const st of %s) {
    if (st[0] === 'wait') { await w(st[1]); continue; }
    const a = R4[st[0]];
    for (let i = 0; i < st[1]; i++) { nc(SEG[a][idx[a]++]); await w(st[2]); }
    if (st[3]) { await w(250); await feed(); }
  }
  window.__ready = true;
})();
</script></body></html>''' % (reels, json.dumps(R4), json.dumps({a: [seg(a, n) for n in range(30)] for a in R4}), json.dumps(order))
PLAYING = [[1, 6, 25, 0], [2, 6, 25, 0], [3, 7, 25, 0], ['wait', 1500],
           [0, 1, 10, 1], ['wait', 400], [3, 2, 30, 0], ['wait', 400], [0, 1, 10, 1], ['wait', 300], [1, 2, 30, 0], ['wait', 500], [0, 1, 10, 1], ['wait', 400],
           [0, 1, 10, 1], ['wait', 350], [2, 1, 30, 0], ['wait', 450], [0, 1, 10, 1], ['wait', 400]]
PRELOAD_ONLY = [[1, 6, 25, 0], [2, 6, 25, 0], [3, 7, 25, 0], ['wait', 600]]   # nur vorgeladen – unklar, was läuft
state = {'order': PLAYING, 'clip': CLIP30}
def fb(route):
    u = route.request.url
    if '/reel/' in u: route.fulfill(status=200, content_type='text/html', body=page(state['order']))
    elif '/data/mse_' in u: route.fulfill(status=200, content_type='video/webm', body=open(WEB + '/' + u.split('/data/')[1], 'rb').read())
    else: route.fulfill(status=404, body='')
def cdn(route):
    u = route.request.url
    if '/m69/' in u: route.fulfill(status=200, content_type='video/mp4', body=b'x' * 4000); return
    data = state['clip']; rg = route.request.headers.get('range', ''); n = len(data)
    if rg.startswith('bytes='):
        a, _, z = rg[6:].partition('-'); a = int(a or 0); z = min(int(z) if z else n - 1, n - 1)
        route.fulfill(status=206, content_type='video/webm', body=data[a:z + 1], headers={'Content-Range': 'bytes %d-%d/%d' % (a, z, n), 'Accept-Ranges': 'bytes'})
    else: route.fulfill(status=200, content_type='video/webm', body=data, headers={'Accept-Ranges': 'bytes'})

def run(pg):
    pg.goto('https://m.facebook.com/reel/1874944457203372/')
    pg.wait_for_function('window.__ready', timeout=40000)
    pg.evaluate('() => { document.getElementById("v").muted = false; }'); time.sleep(0.8)
    pg.wait_for_function('() => { const h = document.querySelector("[data-kadri-test]"); return h && h.shadowRoot.querySelector("button[aria-label=\'Im Videoplayer öffnen\']"); }', timeout=15000)
    pg.evaluate('() => %s.querySelector("button[aria-label=\'Im Videoplayer öffnen\']").click()' % R)
    pg.wait_for_function('() => { const v = %s.querySelector(".vv"); return v && (v.srcObject || (v.currentSrc && v.readyState >= 1)); }' % R, timeout=20000)
    time.sleep(1.5)
    return pg.evaluate('''() => { const r = %s, v = r.querySelector(".vv"), b = r.querySelector("button[aria-label='Bild-in-Bild']");
        return { mirror: !!v.srcObject, src: v.currentSrc || "", dur: Math.round(v.duration), pip: b ? getComputedStyle(b).display !== "none" : false, vnopip: v.disablePictureInPicture }; }''' % R)

with sync_playwright() as p:
    ctx, sw, udir = launch(p)
    ctx.route('https://m.facebook.com/**', fb)
    ctx.route('https://scontent-ber1-1.xx.fbcdn.net/**', cdn)
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    # 1) A läuft sicher erkennbar, die MP4 von A passt → eigener Player mit Bild-in-Bild
    s1 = run(pg)
    check('Facebook: laufendes Video sicher erkannt → EIGENER Player mit der MP4 genau dieses Videos', not s1['mirror'] and A in s1['src'] and s1['dur'] == 30, s1)
    check('… Bild-in-Bild möglich (Knopf da, nicht gesperrt)', s1['pip'] and s1['vnopip'] is False, s1)
    pg.evaluate('() => %s.querySelector("button[aria-label=Schließen]").click()' % R); time.sleep(0.8)
    # 2) MP4 hat die falsche Länge (anderes Video) → spiegeln
    state['clip'] = CLIP60
    s2 = run(pg)
    check('… MP4 mit anderer Länge → spiegeln statt falsches Video', s2['mirror'], s2)
    check('… auch beim Spiegeln Bild-in-Bild (Schild)', s2['pip'], s2)
    pg.evaluate('() => %s.querySelector("button[aria-label=Schließen]").click()' % R); time.sleep(0.8)
    # 3) nur Vorgeladenes, unklar was läuft → spiegeln
    state['clip'] = CLIP30; state['order'] = PRELOAD_ONLY
    s3 = run(pg)
    check('… unklar, welches Video läuft → spiegeln', s3['mirror'], s3)
    check('keine Fehler der Seite', not errs, errs)
    ctx.close()
shutdown()
done()
