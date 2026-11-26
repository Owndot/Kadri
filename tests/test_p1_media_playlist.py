"""P1: Direkt eingebundene HLS-Medienplaylist – dynamische Angaben und Playlistverweise vor der nativen Freigabe.

Echtes hls.js im integrierten Player, danach Schließen mit resumeAfterClose. Gezählt werden play() am Original und die
nativen Playlistabrufe. Ein vom nativen Player ausgelöster Abruf an ein Rendition-Ziel wird nicht behauptet."""
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
  window.k = { openBrowserPlayer, closePlayer, dashSummaryOf, mediaIsDashManifest, notePlaylist, CONFIG, state: () => vp };
})();
'''
# Statische Medienplaylist aus der Fixture, Adressen absolut auf das abspielbare Material
MEDIA = []
for line in (ROOT / 'tests/web/hls2/b/index.m3u8').read_text().splitlines():
    if line.startswith('#EXT-X-MAP:URI="'):
        line = '#EXT-X-MAP:URI="%shls2/b/%s' % (B, line[len('#EXT-X-MAP:URI="'):])
    elif line and not line.startswith('#'):
        line = B + 'hls2/b/' + line
    MEDIA.append(line)
REPORT = B + 'hls2/a/index.m3u8?report=1'
INF = '#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=320x180,CODECS="vp09.00.10.08,opus"'


def media(extra_head=(), extra_tail=()):
    lines = MEDIA[:2] + list(extra_head) + MEDIA[2:]
    if lines[-1] == '#EXT-X-ENDLIST':
        return '\n'.join(lines[:-1] + list(extra_tail) + ['#EXT-X-ENDLIST']) + '\n'
    return '\n'.join(lines + list(extra_tail)) + '\n'


def run(page):
    page.gen = ''
    mpd = set()
    reqs = []
    page.on('request', lambda r: reqs.append((r.url.split('#')[0], r.resource_type)) if not r.headers.get('x-kadri-fixture') else None)
    page.route('**/*.m3u8*', lambda r: r.fulfill(body=MPD, content_type='application/dash+xml')
               if (r.request.headers.get('x-kadri-fixture') == 'parse-mpd' or r.request.url.split('#')[0] in mpd)
               else (r.fulfill(body=page.gen, content_type='application/vnd.apple.mpegurl') if '/gen/' in r.request.url else r.continue_()))

    def case(label, text, plays, mark=None, url=B + 'gen/media.m3u8'):
        page.gen = text
        mpd.clear()
        page.goto(B)
        page.set_content('<video id="v" muted playsinline preload="none"></video>')
        page.add_script_tag(path=ROOT / 'vendor/hls.min.js')
        page.add_script_tag(content=SOURCE)
        page.evaluate('''([t, src]) => {
          window.mpd = t;
          window.mark = async u => {
            const r = await fetch(u, {headers: {'x-kadri-fixture': 'parse-mpd'}});
            k.notePlaylist(u, r.url, await r.text());
            for (let i = 0; i < 44; i++) { const s = new URL('/analyses/' + Math.random() + '.mpd', location.href).href; k.notePlaylist(s, s, mpd); }
            return !k.dashSummaryOf(u) && k.mediaIsDashManifest(u);
          };
          window.log = {plays: 0};
          const play = HTMLMediaElement.prototype.play;
          v.play = function() { log.plays++; return play.call(this); };
          v.src = src;
        }''', [MPD, url])
        if mark:
            assert page.evaluate('mark', mark)
            mpd.add(mark)
        page.evaluate('k.openBrowserPlayer(v)')
        page.wait_for_function('k.state()?.vid.videoWidth > 0 && k.state().vid.currentTime > 0.3', timeout=20000)
        since = len(reqs)
        page.evaluate('() => { log.plays = 0; k.closePlayer(); }')
        page.wait_for_timeout(2000)
        got = page.evaluate('log.plays')
        native = sum(1 for u, t in reqs[since:] if u == url and t == 'media')
        check(label, got == plays and (plays or native == 0), dict(plays=got, nativePlaylist=native))

    case('Positiv: statische Medienplaylist dekodiert und wird nativ zurückgegeben', media(), 1)
    case('Medienplaylist mit DEFINE: nicht vollständig prüfbar, kein nativer Originalstart',
         media(['#EXT-X-DEFINE:NAME="x",VALUE="1"']), 0)
    case('Medienplaylist mit Variable in einer Adresse: kein nativer Originalstart',
         media(['#EXT-X-DEFINE:NAME="seg",VALUE="seg000.m4s"']).replace(B + 'hls2/b/seg000.m4s', B + 'hls2/b/{$seg}'), 0)
    case('Medienplaylist mit RENDITION-REPORT auf bekannte MPD: kein nativer Originalstart',
         media(extra_tail=['#EXT-X-RENDITION-REPORT:URI="%s",LAST-MSN=11' % REPORT]), 0, mark=REPORT)
    case('Positiv: RENDITION-REPORT auf zulässige Playlist wird erfasst, nativer Start erlaubt',
         media(extra_tail=['#EXT-X-RENDITION-REPORT:URI="%s",LAST-MSN=11' % REPORT]), 1)
    case('Multivarianten-Master mit DEFINE bleibt gesperrt',
         '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-DEFINE:NAME="x",VALUE="1"\n%s\n%s\n' % (INF % 150000, B + 'hls2/b/index.m3u8?m=1'), 0,
         url=B + 'gen/master.m3u8')


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
