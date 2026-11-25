"""Chromium-Komponententest für Quellenherkunft bis zum Ausgabeaufruf."""
import os
from pathlib import Path

from common import B, check, done, results, shutdown, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
MPD = (ROOT / 'tests/web/dash/gate/g02-number-duration.mpd').read_text(encoding='utf-8')
SOURCE = ''.join(p.read_text(encoding='utf-8') for p in sorted((ROOT / 'src').glob('[0-9]*.js')))
# Auch die letzte Navigation bleibt als Messpunkt im Prüfstand.
assert SOURCE.count('location.href = intent;') == 1
SOURCE = SOURCE.replace('location.href = intent;', 'window.calls.navigations.push(intent);')
SOURCE = SOURCE[:SOURCE.rindex('})();')] + '''
  CONFIG.startFullscreen = false;
  CONFIG.systemHelper = false;
  CONFIG.ambient = false;
  function menuFor(v) { active = v; return pageDlExternal(v, []); }
  window.k = {
    notePlaylist, dashSummaryOf, openBrowserPlayer, directDownload, browserDownload, shareUrl, shareLinkTo,
    pill: (v) => { active = v; onPillMain(); },
    state: () => vp,
    actions: menuFor,
    framePick: (item) => { fui.menu = {seq: 1, items: [item]}; return fuiFramePick(1, 0); },
    confirmFrame: () => root.querySelector('[role="menuitem"]')?.click(),
    appButton: () => root.querySelector('[aria-label="In externer App öffnen"], [aria-label="Open in external app"]'),
  };
})();
'''
INSTRUMENT = '''
  window.calls = {resolve: [], intents: [], navigations: [], downloads: [], tabs: [], share: [], copies: []};
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.protocol === 'intent:') {
      calls.intents.push(this.href.split('#')[0]);
      if (!window.measureFallback) window.dispatchEvent(new Event('blur'));
      return;
    }
    if (this.download) { calls.downloads.push(this.href); return; }
    return click.call(this);
  };
  window.open = u => { calls.tabs.push(u); return {}; };
  Object.defineProperty(navigator, 'share', {value: ({url}) => {
    calls.share.push(url);
    return window.shareReply || Promise.resolve();
  }});
  Object.defineProperty(navigator, 'clipboard', {value: {writeText: u => {
    calls.copies.push(u);
    return Promise.resolve();
  }}});
  const realFetch = window.fetch;
  window.fetch = (u, options) => {
    if (options?.headers?.Range === 'bytes=0-1') {
      calls.resolve.push(u);
      return window.resolution = window.resolveReply || realFetch(u, options);
    }
    if (window.fileReply && options?.referrerPolicy && !options?.headers) return window.fileReply;
    return realFetch(u, options);
  };
  window.url = p => new URL(p, location.href).href;
  window.mark = (p, f = p) => k.notePlaylist(url(p), url(f), window.mpd);
  window.evict = () => { for (let i = 0; i < 44; i++) mark('/other/' + i + '.mpd'); };
  window.flush = async () => { if (window.resolution) await window.resolution; await new Promise(r => setTimeout(r, 0)); };
  window.setVideo = (p) => { v.src = url(p); };
'''


def setup(frame):
    frame.set_content('<video id="v" muted playsinline></video>')
    frame.add_script_tag(content=INSTRUMENT)
    frame.add_script_tag(content=SOURCE)
    frame.evaluate('(t) => { window.mpd = t; }', MPD)


def fresh(page):
    page.goto(B)
    setup(page)


def scenarios(page):
    for name, target in (('unknown', '/missing-url'), ('mp4', '/clip.mp4'), ('hls', '/hls/master.m3u8')):
        fresh(page)
        outcome = page.evaluate('''async target => {
          const hop = '/redir?to=' + encodeURIComponent(target).replaceAll('.', '%2E');
          const p = '/redir?to=' + encodeURIComponent(hop);
          setVideo(p);
          mark(p, '/old-manifest');
          const known = !!k.dashSummaryOf(url(p));
          k.pill(v);
          await flush();
          return {known, resolution: calls.resolve.length, intents: calls.intents};
        }''', target)
        check('Bekanntes MPD vor doppeltem Redirect zu ' + name + ' gesperrt',
              outcome == dict(known=True, resolution=0, intents=[]), outcome)

    fresh(page)
    outcome = page.evaluate('''async () => {
      const p = '/redir?to=' + encodeURIComponent('/redir?to=/clip.mp4');
      const other = '/redir?to=' + encodeURIComponent('/redir?via=other&to=/clip.mp4');
      mark(other, '/previous-mpd');
      setVideo(other);
      k.pill(v);
      await flush();
      const before = calls.intents.length;
      v.remove();
      document.body.append(Object.assign(document.createElement('video'), {id: 'v', src: url(p)}));
      k.pill(v);
      await flush();
      v.remove();
      document.body.append(Object.assign(document.createElement('video'), {id: 'v', src: url('/hls/master.m3u8')}));
      k.pill(v);
      k.shareLinkTo(url('/watch/ordinary'), 'Beitrag');
      await flush();
      return {intents: calls.intents.slice(before), share: calls.share};
    }''')
    check('Eigenständiges MP4 mit Redirect, HLS und Beitragslink erreichen ihre Ausgaben',
          outcome == dict(intents=[B.replace('http:', 'intent:') + 'clip.mp4',
                                   B.replace('http:', 'intent:') + 'hls/master.m3u8'],
                          share=[B + 'watch/ordinary']), outcome)

    for change in ('classify', 'replace', 'target'):
        fresh(page)
        outcome = page.evaluate('''async mode => {
          const path = '/pending-source', target = url('/clip.mp4');
          let finish;
          window.resolveReply = new Promise(r => { finish = r; });
          setVideo(path);
          k.pill(v);
          if (mode === 'classify') { mark(path); evict(); }
          if (mode === 'replace') setVideo('/next.mp4');
          if (mode === 'target') mark('/clip.mp4');
          finish({url: target, status: 206});
          await flush();
          return {resolution: calls.resolve.length, intents: calls.intents,
              evicted: !k.dashSummaryOf(url(path))};
        }''', change)
        check('Offene Auflösung erneut geprüft: ' + change,
              outcome == dict(resolution=1, intents=[], evicted=True), outcome)

    for classified in ('/player-file.mp4', '/clip.mp4', ''):
        fresh(page)
        page.route('**/player-file.mp4', lambda r: r.fulfill(status=302, headers={'Location': '/clip.mp4'}))
        page.evaluate("""() => { setVideo('/player-file.mp4'); k.openBrowserPlayer(v); }""")
        page.wait_for_function('calls.resolve.length > 0 && k.state()?.vid.videoWidth > 0')
        outcome = page.evaluate('''async p => {
          await flush();
          if (p) { mark(p); evict(); }
          k.appButton().click();
          await flush();
          return {requests: calls.resolve.length, intents: calls.intents};
        }''', classified)
        expected = [] if classified else [B.replace('http:', 'intent:') + 'clip.mp4']
        check('Vorab aufgelöstes Playerziel: ' + (classified or 'echte MP4'),
              outcome == dict(requests=1, intents=expected), outcome)

    fresh(page)
    page.evaluate("setVideo('/clip.mp4')")
    page.wait_for_function('v.readyState >= 2')
    outcome = page.evaluate('''async () => {
      const items = k.actions(v);
      mark('/clip.mp4');
      evict();
      items.forEach(it => it.fn());
      await flush();
      return {items: items.length, tabs: calls.tabs, share: calls.share, downloads: calls.downloads};
    }''')
    check('Geöffnetes Menü blockiert nachträglich erkanntes MPD nach Cacheverdrängung',
          outcome['items'] >= 3 and all(not outcome[key] for key in ('tabs', 'share', 'downloads')), outcome)

    for classified in (True, False):
        fresh(page)
        outcome = page.evaluate('''async classified => {
          const source = 'http://127.0.0.1:8791/clip.mp4';
          let reply;
          window.GM_xmlhttpRequest = request => { reply = request.onload; return {abort() {}}; };
          const pending = k.browserDownload(source);
          if (classified) { k.notePlaylist(source, source, mpd); evict(); }
          reply({status: 206, responseHeaders: 'Content-Disposition: attachment', finalUrl: source});
          return {ok: await pending, downloads: calls.downloads.length};
        }''', classified)
        check('Asynchrone Anhangsprobe: ' + ('MPD' if classified else 'Downloadkontrolle'),
              outcome == dict(ok=not classified, downloads=0 if classified else 1), outcome)

    fresh(page)
    outcome = page.evaluate('''async () => {
      let finish;
      window.fileReply = Promise.resolve({ok: true, url: url('/clip.mp4'), blob: () => new Promise(r => { finish = r; })});
      k.directDownload(url('/clip.mp4'));
      await Promise.resolve();
      mark('/clip.mp4');
      evict();
      finish(new Blob(['x'.repeat(21000)]));
      await flush();
      return calls.downloads;
    }''')
    check('Verspäteter Blob löst keinen Speicherklick aus', not outcome, outcome)

    fresh(page)
    outcome = page.evaluate('''async () => {
      let fail;
      window.shareReply = new Promise((_, reject) => { fail = reject; });
      const sharing = k.shareUrl(url('/clip.mp4'));
      mark('/clip.mp4');
      evict();
      fail(new Error('Kein Share-Ziel'));
      await sharing;
      return {shares: calls.share.length, copies: calls.copies};
    }''')
    check('Neue MPD-Klassifikation sperrt asynchronen Kopier-Fallback',
          outcome == dict(shares=1, copies=[]), outcome)

    for classified in (True, False):
        fresh(page)
        outcome = page.evaluate('''async classified => {
          window.measureFallback = true;
          setVideo('/hls/master.m3u8');
          k.pill(v);
          if (classified) { mark('/hls/master.m3u8'); evict(); }
          await new Promise(r => setTimeout(r, 1050));
          return {click: calls.intents.length, navigations: calls.navigations.length};
        }''', classified)
        check('Verzögerte Intent-Navigation: ' + ('MPD' if classified else 'HLS-Kontrolle'),
              outcome == dict(click=1, navigations=0 if classified else 1), outcome)

    page.goto(B)
    page.set_content('<iframe src="/direct.html"></iframe>')
    frame = page.frames[1]
    frame.wait_for_load_state()
    setup(frame)
    page.route('**/frame-source', lambda r: r.fulfill(body=MPD, content_type='application/dash+xml'))
    outcome = frame.evaluate('''async () => {
      const path = '/frame-source';
      window.resolveReply = Promise.resolve({url: url('/clip.mp4'), status: 206});
      setVideo(path);
      mark(path, '/previous-mpd');
      k.pill(v);
      await flush();
      return {resolve: calls.resolve.length, intents: calls.intents};
    }''')
    check('Ursprungsframe sperrt bekannte MPD-Quelle am externen Knopf',
          outcome == dict(resolve=0, intents=[]), outcome)
    frame.evaluate("setVideo('/clip.mp4')")
    frame.wait_for_function('v.readyState >= 2')
    outcome = frame.evaluate('''() => {
      const entry = k.actions(v).find(it => it.label === 'Im Browser öffnen');
      if (!entry) throw Error('Relay-Auswahl fehlt');
      mark('/clip.mp4');
      evict();
      return k.framePick(entry);
    }''')
    check('Ursprungsframe liefert für veralteten Menüeintrag keine Ausgabe zurück',
          outcome == dict(ok=False), outcome)

    page.goto(B)
    page.set_content('<iframe src="/direct.html"></iframe>')
    frame = page.frames[1]
    frame.wait_for_load_state()
    setup(frame)
    frame.evaluate("setVideo('/clip.mp4')")
    frame.wait_for_function('v.readyState >= 2')
    outcome = frame.evaluate('''() => {
      const entry = k.actions(v).find(it => it.label === 'Im Browser öffnen');
      const reply = k.framePick(entry);
      if (reply.ext) window.open(reply.ext.u);
      else k.confirmFrame();
      return {ok: reply.ok, tabs: calls.tabs};
    }''')
    check('Eigenständige MP4 im iframe erreicht den Aufruf zum Öffnen',
          outcome == dict(ok=True, tabs=[B + 'clip.mp4']), outcome)


try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or '/usr/bin/chromium')
        scenarios(browser.new_page())
        browser.close()
finally:
    shutdown()
done()
raise SystemExit(0 if all(results) else 1)
