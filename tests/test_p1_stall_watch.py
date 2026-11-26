"""P1: Der Stallwächter nach dem Schließen prüft vor jedem Seek und Play erneut Quelle, Klassifikation und Kontext.

Echte MP4 im integrierten Player, echtes Schließen mit resumeAfterClose. Am Seitenvideo werden play()-Aufrufe gezählt
(ohne Wirkung: ausbleibender Fortschritt wird so simuliert) und Seeks über den currentTime-Setter erfasst."""
import os
from pathlib import Path

from common import B, check, done, results, shutdown, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
MPD = (ROOT / 'tests/web/dash/gate/g02-number-duration.mpd').read_text(encoding='utf-8')
SOURCE = ''.join(p.read_text(encoding='utf-8') for p in sorted((ROOT / 'src').glob('[0-9]*.js')))
SOURCE = SOURCE[:SOURCE.rindex('})();')] + '''
  CONFIG.startFullscreen = false;
  CONFIG.systemHelper = false;
  CONFIG.ambient = false;
  CONFIG.resumeAfterClose = true;
  CONFIG.language = 'de';
  window.k = {
    openBrowserPlayer, closePlayer, notePlaylist, mediaIsDashManifest, dashSummaryOf,
    state: () => vp,
  };
})();
'''
CLIP = B + 'clip.mp4'


def setup(page):
    page.goto(B)
    page.set_content('<div id="box"><video id="v" muted playsinline preload="auto" src="/clip.mp4"></video></div>')
    page.add_script_tag(content=SOURCE)
    page.evaluate('''mpd => {
      window.mark = u => {
        k.notePlaylist(u, u, mpd);
        for (let i = 0; i < 44; i++) { const s = new URL('/evict/' + Math.random() + '.mpd', location.href).href; k.notePlaylist(s, s, mpd); }
        return k.mediaIsDashManifest(u) && !k.dashSummaryOf(u);
      };
      window.log = [];
      window.watch = el => {
        const proto = HTMLMediaElement.prototype, d = Object.getOwnPropertyDescriptor(proto, 'currentTime');
        el.play = function() {   // gezählt, ohne Wirkung: die Wiedergabe kommt nicht in Gang
          log.push({op: 'play', t: performance.now(), open: !!k.state(), el: this === window.v ? 'v' : 'other', src: this.currentSrc});
          return Promise.resolve();
        };
        Object.defineProperty(el, 'currentTime', {configurable: true, get() { return d.get.call(this); },
          set(x) { log.push({op: 'seek', t: performance.now(), open: !!k.state()}); d.set.call(this, x); }});
      };
      watch(v);
      window.decoded = () => k.state()?.vid.videoWidth > 0 && k.state().vid.currentTime > 0.3;
      window.after = t0 => log.filter(e => e.t > t0);
    }''', MPD)
    page.wait_for_function('v.readyState >= 2')


def open_close(page):
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function('decoded()')
    page.evaluate('k.closePlayer()')
    page.wait_for_function("log.some(e => e.op === 'play')", timeout=5000)


def ops(entries, op):
    return [e for e in entries if e['op'] == op]


def run(page):
    # ---------- Rot: MPD-Klassifikation nach dem zulässigen Erststart ----------
    setup(page)
    open_close(page)
    first = page.evaluate('log.filter(e => e.op === "play").length')
    t0 = page.evaluate('performance.now()')
    known = page.evaluate('mark', CLIP)
    page.wait_for_timeout(4500)
    late = page.evaluate('after', t0)
    check('Stallwächter: nach MPD-Klassifikation kein weiterer Seek oder Play',
          known and first == 1 and not ops(late, 'play') and not ops(late, 'seek'),
          dict(known=known, firstPlays=first, latePlays=len(ops(late, 'play')), lateSeeks=len(ops(late, 'seek'))))

    # ---------- Positivkontrolle: weiterhin zulässige, stockende MP4 ----------
    setup(page)
    open_close(page)
    t0 = page.evaluate('performance.now()')
    page.wait_for_timeout(4500)
    late = page.evaluate('after', t0)
    check('Positivkontrolle: zulässige stockende MP4 wird einmal angestoßen (Seek + Play)',
          len(ops(late, 'play')) == 1 and len(ops(late, 'seek')) == 1,
          dict(latePlays=len(ops(late, 'play')), lateSeeks=len(ops(late, 'seek'))))

    # ---------- Medienwechsel im selben Element ----------
    setup(page)
    open_close(page)
    t0 = page.evaluate('performance.now()')
    page.evaluate("() => { v.src = '/clip-180.mp4'; }")
    page.wait_for_timeout(4500)
    late = page.evaluate('after', t0)
    check('Medienwechsel: alter Wächter stößt das neue Medium nicht an',
          not ops(late, 'play') and not ops(late, 'seek'),
          dict(latePlays=len(ops(late, 'play')), lateSeeks=len(ops(late, 'seek'))))

    # ---------- Elementersatz ----------
    setup(page)
    open_close(page)
    t0 = page.evaluate('performance.now()')
    page.evaluate('''() => {
      const n = document.createElement('video'); n.muted = true; n.src = '/clip.mp4'; watch(n);
      v.replaceWith(n); window.v2 = n;
    }''')
    page.wait_for_timeout(4500)
    late = page.evaluate('after', t0)
    check('Elementersatz: kein Seek oder Play an altem oder neuem Element', not ops(late, 'play') and not ops(late, 'seek'),
          dict(latePlays=len(ops(late, 'play')), lateSeeks=len(ops(late, 'seek'))))

    # ---------- Dokumentwechsel (SPA-Navigation: neue Registry-Dokumentkennung) ----------
    setup(page)
    open_close(page)
    t0 = page.evaluate('performance.now()')
    page.evaluate("() => history.pushState(null, '', '/anderer-beitrag')")
    page.wait_for_timeout(4500)
    late = page.evaluate('after', t0)
    check('Dokumentwechsel: alter Wächter endet ohne Seek oder Play', not ops(late, 'play') and not ops(late, 'seek'),
          dict(latePlays=len(ops(late, 'play')), lateSeeks=len(ops(late, 'seek'))))

    # ---------- Wiederholtes Schließen und Öffnen ----------
    setup(page)
    open_close(page)
    t0 = page.evaluate('performance.now()')
    page.evaluate('k.openBrowserPlayer(v)')
    page.wait_for_function('decoded()')
    page.wait_for_timeout(3500)
    during = page.evaluate('after', t0)
    t1 = page.evaluate('performance.now()')
    page.evaluate('k.closePlayer()')
    page.wait_for_timeout(4500)
    late = page.evaluate('after', t1)
    check('Neu geöffneter Player: alter Wächter stößt das Original nicht an',
          not [e for e in during if e['open']], dict(during=[(e['op'], e['open']) for e in during]))
    check('Zweites Schließen: genau ein Start und ein Anstoß des neuen Wächters',
          len(ops(late, 'play')) == 2 and len(ops(late, 'seek')) <= 2 and not [e for e in late if e['open']],
          dict(late=[(e['op'], e['open']) for e in late]))


try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or '/usr/bin/chromium')
        run(browser.new_page())
        browser.close()
finally:
    shutdown()
done()
raise SystemExit(0 if all(results) else 1)
