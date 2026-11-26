"""Chromium-Komponententest für die Wiedergabeauswahl und ihre Ladeaufrufe."""
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
  const originalResolve = resolve;
  window.k = {
    notePlaylist, dashSummaryOf, playerSources, openBrowserPlayer, seeUrl,
    state: () => vp,
    resolveAs: (list) => {
      resolve = list ? () => ({best: list[0], qualities: list.map((u, i) => ({u, res: 720 - i * 100}))})
        : originalResolve;
    },
    output: (v) => root.querySelector(v),
  };
})();
'''
INSTRUMENT = r'''
  window.calls = {video: [], hls: []};
  const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  Object.defineProperty(HTMLMediaElement.prototype, 'src', {...src, set(u) {
    if (this.classList.contains('vv') || this.classList.contains('vpv')) calls.video.push(u);
    src.set.call(this, u);
  }});
  const hlsLoad = Hls.prototype.loadSource;
  Hls.prototype.loadSource = function (u) {
    calls.hls.push(u);
    return hlsLoad.call(this, u);
  };
  window.url = p => new URL(p, location.href).href;
  window.mark = (p, final = p) => k.notePlaylist(url(p), url(final), window.mpd);
  window.evictSummary = () => { for (let i = 0; i < 44; i++) mark('/manifests/' + i + '.mpd'); };
'''


def setup(frame):
    frame.set_content('<video id="v" muted playsinline></video>')
    frame.add_script_tag(path=ROOT / 'vendor/hls.min.js')
    frame.add_script_tag(content=INSTRUMENT)
    frame.add_script_tag(content=SOURCE)
    frame.evaluate('(t) => { window.mpd = t; }', MPD)


def test_player(page):
    for path in ('/probe.m3u8', '/probe.mp4', '/probe'):
        page.goto(B)
        setup(page)
        page.route('**' + path, lambda route: route.fulfill(body=MPD, content_type='application/dash+xml'))
        outcome = page.evaluate('''async p => {
            const u = url(p), mp4 = url('/clip.mp4'), hls = url('/hls/master.m3u8');
            const response = await fetch(u);
            if (!response.ok) throw Error('MPD konnte nicht gelesen werden');
            k.notePlaylist(u, response.url, await response.text());
            k.resolveAs([u, mp4, hls]);
            const list = k.playerSources(v);
            k.openBrowserPlayer(v);
            return {known: !!k.dashSummaryOf(u), blocked: !list.includes(u),
                controls: list.includes(mp4) && list.includes(hls),
                media: calls.video.includes(u), hls: calls.hls.includes(u)};
        }''', path)
        check(f'Player {path}: erkannt, Kandidat und Ladeaufrufe gesperrt, Kontrollen auswählbar',
              outcome == dict(known=True, blocked=True, controls=True, media=False, hls=False), outcome)
        page.wait_for_function("k.state()?.vid.videoWidth > 0 && k.state().vid.currentTime > 0")
        if path == '/probe.m3u8':
            check('Echte MP4 erreicht video.src und dekodiert', page.evaluate(
                "calls.video.includes(url('/clip.mp4')) && k.state().vid.currentSrc === url('/clip.mp4')"))

    page.goto(B)
    setup(page)
    page.evaluate('''() => {
        k.resolveAs([url('/clip.mp4'), url('/other.mp4'), url('/probe.mp4')]);
        k.openBrowserPlayer(v);
    }''')
    page.wait_for_function("k.state()?.vid.videoWidth > 0")
    outcome = page.evaluate('''() => {
        const button = k.output('[aria-label="Qualität"], [aria-label="Quality"]');
        button.click();
        const old = [...k.state().wrap.querySelectorAll('button')].find(b => b.textContent === '520p');
        if (!old) throw Error('Qualitätsauswahl fehlt');
        mark('/probe.mp4');
        evictSummary();
        old.click();
        k.state().prevWarm();
        return {summaryEvicted: !k.dashSummaryOf(url('/probe.mp4')),
            loaded: calls.video.includes(url('/probe.mp4')), kept: k.state().cur === url('/clip.mp4')};
    }''')
    check('Alter Qualitätseintrag bleibt nach Klassifikation und Cacheverdrängung gesperrt',
          outcome == dict(summaryEvicted=True, loaded=False, kept=True), outcome)

    page.goto(B)
    setup(page)
    outcome = page.evaluate('''async () => {
        const mp4 = url('/clip.mp4'), mpd = url('/probe.m3u8'), hls = url('/hls/master.m3u8');
        k.resolveAs([mp4, mpd, hls]);
        k.openBrowserPlayer(v);
        const st = k.state();
        // Direkte Dateiwiedergabe folgt der Typprobe (src/170): erst den tatsächlichen MP4-Ladeaufruf abwarten
        for (let i = 0; i < 100 && !calls.video.includes(mp4); i++) await new Promise(r => setTimeout(r, 50));
        const stored = st.sources.includes(mpd) && st.cur === mp4;
        mark('/probe.m3u8');
        evictSummary();
        st.vid.dispatchEvent(new Event('error'));
        return {stored, summaryEvicted: !k.dashSummaryOf(mpd), rejected: !calls.hls.includes(mpd),
            selected: st.cur === hls && calls.hls.includes(hls)};
    }''')
    check('Automatischer Fallback prüft gespeicherte HLS-Kandidaten erneut',
          outcome == dict(stored=True, summaryEvicted=True, rejected=True, selected=True), outcome)

    page.goto(B)
    setup(page)
    outcome = page.evaluate('''async () => {
        const mpd = url('/network.m3u8'), mp4 = url('/clip.mp4');
        k.seeUrl(mpd);
        k.seeUrl(mp4);
        mark('/network.m3u8');
        const list = k.playerSources(v);
        k.openBrowserPlayer(v);
        for (let i = 0; i < 100 && !calls.video.includes(mp4); i++) await new Promise(r => setTimeout(r, 50));
        return {control: list.includes(mp4) && calls.video.includes(mp4),
            blocked: !list.includes(mpd) && !calls.hls.includes(mpd) && !calls.video.includes(mpd)};
    }''')
    check('Erkannte Netzwerkquelle wird bei der Auswahl durch den echten Resolver verworfen',
          outcome == dict(control=True, blocked=True), outcome)

    page.goto(B)
    setup(page)
    page.evaluate("() => { k.resolveAs([url('/hls/master.m3u8')]); k.openBrowserPlayer(v); }")
    page.wait_for_function("k.state()?.vid.videoWidth > 0 && k.state().vid.currentTime > 0")
    check('Eigenständiges HLS erreicht hls.loadSource und dekodiert',
          page.evaluate("calls.hls.includes(url('/hls/master.m3u8'))"))


try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or '/usr/bin/chromium')
        page = browser.new_page()
        test_player(page)
        browser.close()
finally:
    shutdown()
done()
raise SystemExit(0 if all(results) else 1)
