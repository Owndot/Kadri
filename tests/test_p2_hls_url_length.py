"""P2: Länge und Form jeder HLS-Master- und Kindadresse vor der Aufnahme in den Masterdatensatz.

Echtes hls.js im integrierten Player (die lange Variante wird tatsächlich angefordert), danach Schließen mit
resumeAfterClose. Gezählt werden play() am Original; zusätzlich die tatsächlich gespeicherten Adress- und
Schlüssellängen der Playerinstanz. Grenze: MEDIA_LIMITS.urlLen = 4096 Zeichen der vollständigen Eingabe."""
import os
import urllib.parse
from pathlib import Path

from common import B, check, done, results, shutdown, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ''.join(p.read_text(encoding='utf-8') for p in sorted((ROOT / 'src').glob('[0-9]*.js')))
SOURCE = SOURCE[:SOURCE.rindex('})();')] + '''
  CONFIG.startFullscreen = false;
  CONFIG.systemHelper = false;
  CONFIG.ambient = false;
  CONFIG.resumeAfterClose = true;
  CONFIG.language = 'de';
  window.k = { openBrowserPlayer, closePlayer, CONFIG, state: () => vp,
    stored: () => { let url = 0, key = 0, n = 0;
      (vp && vp.hlsMasters || new Map()).forEach((r, k2) => { key = Math.max(key, k2.length);
        r.urls.forEach((u) => { url = Math.max(url, u.length); n++; });
        (r.keys || new Set()).forEach((x) => { key = Math.max(key, x.length); }); });
      return {url, key, n}; } };
})();
'''
INF = '#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=320x180,CODECS="vp09.00.10.08,opus"'
SHORT = B + 'hls2/b/index.m3u8?n=short'


def padded(total, frag=0):
    base = B + 'hls2/b/index.m3u8?pad='
    if frag:
        return base + 'q#' + 'f' * (total - len(base) - 2)
    return base + 'x' * (total - len(base))


def master(*kids):
    return '#EXTM3U\n#EXT-X-VERSION:7\n' + ''.join('%s\n%s\n' % (INF % (150000 + i), u) for i, u in enumerate(kids))


def run(page):
    page.gen = {}
    page.route(lambda u: urllib.parse.urlsplit(u).path.startswith('/gen/'), lambda r: r.fulfill(body=page.gen[r.request.url.split('?')[0].split('#')[0].rsplit('/', 1)[1]],
                                               content_type='application/vnd.apple.mpegurl'))

    def case(label, kids, plays, src=B + 'gen/m.m3u8', limit=True, need_decode=False):
        page.gen = {'m.m3u8': master(*kids), 'r.m3u8': master(*kids)}
        page.goto(B)
        page.set_content('<video id="v" muted playsinline preload="none"></video>')
        page.add_script_tag(path=ROOT / 'vendor/hls.min.js')
        page.add_script_tag(content=SOURCE)
        page.evaluate('''src => {
          window.log = {plays: 0};
          const play = HTMLMediaElement.prototype.play;
          v.play = function() { log.plays++; return play.call(this); };
          v.src = src;
        }''', src)
        page.evaluate('k.openBrowserPlayer(v)')
        decoded = True
        try:
            page.wait_for_function('k.state()?.vid.videoWidth > 0 && k.state().vid.currentTime > 0.3', timeout=20000)
        except Exception:
            decoded = False
        stored = page.evaluate('k.stored()')
        page.evaluate('() => { log.plays = 0; k.state() && k.closePlayer(); }')
        page.wait_for_timeout(1500)
        got = page.evaluate('log.plays')
        ok = got == plays and (not limit or (stored['url'] <= 4096 and stored['key'] <= 4096)) and (decoded or not need_decode)
        check(label, ok, dict(plays=got, decoded=decoded, **stored))

    for n, plays in ((4095, 1), (4096, 1), (4097, 0)):
        assert len(padded(n)) == n
        case('Kindadresse mit %d Zeichen: %s' % (n, 'erfasst, native Rückgabe erlaubt' if plays else 'nicht gespeichert, unvollständig, keine native Rückgabe'),
             [SHORT, padded(n)], plays)
    long_q = padded(16033)
    case('Lange Query (16.033 Zeichen): nicht gespeichert, keine native Rückgabe', [SHORT, long_q], 0)
    long_f = padded(19034, frag=1)
    assert len(long_f) == 19034
    case('Langes Fragment (Eingabe 19.034 Zeichen): Längenprüfung vor dem Schlüssel, keine native Rückgabe', [SHORT, long_f], 0)
    case('Duplikate einer 4096-Zeichen-Adresse: ein Eintrag, native Rückgabe erlaubt', [SHORT, padded(4096), padded(4096)], 1)
    # Umleitung auf eine echte Serverdatei (Playwright-Routen greifen für umgeleitete Abrufe nicht); die relative
    # Kindadresse ergibt aufgelöst gegen das Ziel exakt 4097 Zeichen (tests/web/hls2/b/long4097.m3u8)
    case('Umleitung auf den Master, Kind mit 4097 Zeichen relativ zum Ziel: dekodiert, keine native Rückgabe', [], 0,
         src=B + 'redir?to=/hls2/b/long4097.m3u8', need_decode=True)
    long_master = B + 'gen/m.m3u8?pad=' + 'm' * (4097 - len(B + 'gen/m.m3u8?pad='))
    case('Überlange Masteradresse (4097 Zeichen): kein Datensatz, keine native Rückgabe', [SHORT], 0, src=long_master)
    case('Positiv: gewöhnliche Adressen, native Rückgabe erlaubt', [SHORT, B + 'hls2/a/index.m3u8?n=ok'], 1)


try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or '/usr/bin/chromium')
        page = browser.new_page()
        page.set_default_timeout(30000)
        run(page)
        browser.close()
finally:
    shutdown()
done()
raise SystemExit(0 if all(results) else 1)
