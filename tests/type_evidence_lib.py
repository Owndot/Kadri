"""Gemeinsame Komponentenbasis für die Typbeleg-Prüfer (Produktquelltext im Seitenkontext, Zähler am Original).

Bekannte MPD-Kinder werden ohne Netz klassifiziert (notePlaylist mit echtem MPD-Text, 44 Füllanalysen verdrängen die
Zusammenfassung). Jeder spätere Abruf dieser Kinder auf dem Medienserver ist damit ein Folgeabruf nach Kadris Entscheidung."""
from pathlib import Path

import nocors_servers as S

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ''.join(p.read_text(encoding='utf-8') for p in sorted((ROOT / 'src').glob('[0-9]*.js')))
SOURCE = SOURCE[:SOURCE.rindex('})();')] + '''
  CONFIG.startFullscreen = false;
  CONFIG.systemHelper = false;
  CONFIG.ambient = false;
  CONFIG.resumeAfterClose = true;
  CONFIG.language = 'de';
  window.k = {
    openBrowserPlayer, closePlayer, dashSummaryOf, mediaIsDashManifest, notePlaylist, CONFIG,
    noteMediaType, mediaTypeOf, mediaProbe, hlsNativeStartAllowed, knownMpdIdentity,
    state: () => vp,
  };
})();
'''


def setup(page, src, preload='none', extra=''):
    page.goto(S.PAGE + 'mp4.html')
    page.set_content('<video id="v" muted playsinline preload="%s"%s></video>' % (preload, extra))
    page.add_script_tag(path=ROOT / 'vendor/hls.min.js')
    page.add_script_tag(content=SOURCE)
    page.evaluate('''([t, src]) => {
      window.mpd = t;
      window.mark = u => {
        k.notePlaylist(u, u, mpd);
        for (let i = 0; i < 44; i++) { const s = location.origin + '/analyses/' + Math.random() + '.mpd'; k.notePlaylist(s, s, mpd); }
        return !k.dashSummaryOf(u) && k.mediaIsDashManifest(u);
      };
      window.log = {plays: 0, seeks: 0, hlsMade: 0, hlsLive: 0, own: [], prev: []};
      const play = HTMLMediaElement.prototype.play, d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
      v.play = function() { log.plays++; return play.call(this); };
      Object.defineProperty(v, 'currentTime', {configurable: true, get() { return d.get.call(this); }, set(x) { log.seeks++; d.set.call(this, x); }});
      // Tatsächliche src-Zuweisungen der Kadri-eigenen Elemente (eigener Player .vv, Vorschau .vpv)
      const sd = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {configurable: true, get() { return sd.get.call(this); }, set(x) {
        if (this !== v && x) (this.classList.contains('vpv') ? log.prev : log.own).push(String(x));
        sd.set.call(this, x); }});
      const attach = Hls.prototype.attachMedia, destroy = Hls.prototype.destroy;
      Hls.prototype.attachMedia = function(m) { log.hlsMade++; log.hlsLive++; return attach.call(this, m); };
      Hls.prototype.destroy = function() { if (!this.__gone) { this.__gone = true; log.hlsLive--; } return destroy.call(this); };
      window.decoded = () => k.state()?.vid.videoWidth > 0 && k.state().vid.currentTime > 0.2;
      if (src) v.src = src;
    }''', [S.MPD, src])


def mark_kids(page, kids=(S.KID_A, S.KID_B)):
    for u in kids:
        assert page.evaluate('mark', u), 'MPD-Klassifikation fehlt'


def snap(page):
    return page.evaluate('''() => ({plays: log.plays, seeks: log.seeks, hlsMade: log.hlsMade, hlsLive: log.hlsLive,
      ownSrc: log.own.filter(x => !x.startsWith('blob:')).length, prevSrc: log.prev.length, open: !!k.state(),
      mode: k.state() ? k.state().mode : '', paused: v.paused})''')


def wait(page, expr, timeout=20000, arg=None):
    try:
        page.wait_for_function(expr, arg=arg, timeout=timeout)
        return True
    except Exception:
        return False


def kids(since):
    return S.count('/v/a/index.m3u8?src=gen', since) + S.count('/v/b/index.m3u8?src=gen', since)
