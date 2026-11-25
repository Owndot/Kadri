"""Chromium-Komponente für Seitenlinks und konkrete Medienausgabe bei vollem Budget."""
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
  window.k = {
    openBrowserPlayer, notePlaylist, shareUrl, dashSummaryOf,
    selected: () => postUrlFor(v),
    sharePost: () => onDownload(v, true),
    sharePage: () => root.querySelector('[aria-label="Link teilen"], [aria-label="Share link"]').click(),
    fromFrame: () => { active = v; return fuiFrameAct('share'); },
    relay: (r, frame) => {
      const g = {key: '1:fixture', src: {f: 1, d: 'fixture'}, n: 'a'.repeat(32)};
      fuiTop.regs.set(g.key, g);
      fuiTop.geo.set(g.n, {f: frame, t: Date.now()});
      fuiTop.cur = g;
      window.frameReply = r;
      return () => fuiTopAct('share');
    },
    overBudget: () => mediaIdentityOverflow,
  };
})();
'''


def setup(frame, post='/watch?v=post123456'):
    frame.set_content('<article><a href="' + post + '">Beitrag</a><video id="v" muted playsinline></video></article>')
    frame.evaluate('''() => {
      window.relayCalls = 0;
      window.KADRI_FRAMEUI = {send: m => {
        if (m.op === 'act') { relayCalls++; return window.frameReply; }
        return {ok: true};
      }};
    }''')
    frame.add_script_tag(content=SOURCE)
    frame.evaluate('''mpd => {
      window.calls = {shares: [], copies: []};
      window.mark = p => {
        const u = new URL(p, location.href).href;
        k.notePlaylist(u, u, mpd);
      };
      window.overflow = () => { for (let i = 0; i < 514; i++) mark('/manifests/' + i + '.m3u8'); };
      Object.defineProperty(navigator, 'share', {configurable: true, writable: true, value: ({url}) => {
        calls.shares.push(url);
        return window.shareReply || Promise.resolve();
      }});
      Object.defineProperty(navigator, 'clipboard', {value: {writeText: u => {
        calls.copies.push(u);
        return Promise.resolve();
      }}});
      window.flush = () => new Promise(r => setTimeout(r, 0));
    }''', MPD)


def cases(page):
    for mode in ('normal', 'overflow', 'clipboard', 'fallback'):
        page.goto(B)
        setup(page)
        result = page.evaluate('''async mode => {
          if (mode !== 'normal') overflow();
          if (mode === 'clipboard') navigator.share = undefined;
          let fail;
          if (mode === 'fallback') window.shareReply = new Promise((_, r) => { fail = r; });
          const url = k.selected();
          k.sharePost();
          if (fail) fail(new Error('Share-Ziel nicht verfügbar'));
          await flush();
          return {overflow: k.overBudget(), url, ...calls};
        }''', mode)
        link = B + 'watch?v=post123456'
        check('Beitragslink ' + mode, result == dict(overflow=mode != 'normal', url=link,
              shares=[] if mode == 'clipboard' else [link], copies=[link] if mode in ('clipboard', 'fallback') else []), result)

    page.goto(B)
    setup(page, '/no-post-here')
    result = page.evaluate('''async () => {
      v.src = '/clip.mp4';
      k.openBrowserPlayer(v);
      overflow();
      k.sharePage();
      await flush();
      return calls;
    }''')
    check('Gewöhnliche Dokumentadresse nach Überlauf', result == dict(shares=[B], copies=[]), result)

    page.goto(B)
    setup(page, '/watch?v=afterfull')
    result = page.evaluate('''async () => {
      overflow();
      mark('/watch?v=afterfull');
      for (let i = 0; i < 44; i++) mark('/evict/' + i + '.mpd');
      k.sharePost();
      await k.shareUrl(new URL('/watch?v=afterfull', location.href).href);
      return calls;
    }''')
    check('Nach Überlauf erkanntes MPD ist auch mit Beitragsform ausgeschlossen', result == dict(shares=[], copies=[]), result)

    page.goto(B)
    setup(page)
    result = page.evaluate('''async () => {
      let reject;
      window.shareReply = new Promise((_, r) => { reject = r; });
      const u = new URL('/clip.mp4', location.href).href;
      const pending = k.shareUrl(u);
      overflow();
      mark('/clip.mp4');
      for (let i = 0; i < 44; i++) mark('/evict/' + i + '.mpd');
      reject(Error('Share-Ziel nicht verfügbar'));
      await pending;
      return calls;
    }''')
    check('Späte MPD-Klassifikation sperrt Medien-Kopierfallback', result == dict(shares=[B + 'clip.mp4'], copies=[]), result)

    page.goto(B)
    setup(page)
    page.evaluate("document.body.append(Object.assign(document.createElement('iframe'), {src:'/direct.html'}))")
    frame = page.frames[1]
    frame.wait_for_load_state()
    setup(frame)
    reply = frame.evaluate("() => { overflow(); return k.fromFrame(); }")
    result = page.evaluate('''async r => {
      overflow();
      const frame = document.querySelector('iframe');
      let finish;
      window.shareReply = new Promise(r => { finish = r; });
      const share = k.relay(r, frame);
      share();
      share();
      await flush();
      finish();
      await flush();
      return {...calls, relays: relayCalls};
    }''', reply)
    check('Beitragslink aus iframe erreicht einmal die Ausgabe', result == dict(shares=[link], copies=[], relays=1), (reply, result))

    for mode in ('ersetzt', 'navigiert', 'später Clipboard-Fallback'):
        page.goto(B)
        setup(page)
        page.evaluate("document.body.append(Object.assign(document.createElement('iframe'), {src:'/direct.html'}))")
        child = page.frames[1]
        child.wait_for_load_state()
        setup(child)
        reply = child.evaluate("k.fromFrame()")
        result = page.evaluate('''async ([mode, reply]) => {
          const f = document.querySelector('iframe');
          let respond, fail;
          const pending = new Promise(r => { respond = r; });
          window.shareReply = mode === 'später Clipboard-Fallback' ? new Promise((_, r) => { fail = r; }) : null;
          k.relay(pending, f)();
          if (fail) { respond(reply); await flush(); }
          if (mode === 'navigiert') f.src = '/hls.html';
          else f.replaceWith(f.cloneNode(false));
          if (fail) fail(new Error('Share-Ziel nicht verfügbar'));
          else respond(reply);
          await flush();
          return calls;
        }''', [mode, reply])
        expected = [link] if mode == 'später Clipboard-Fallback' else []
        check('Alter Frame: ' + mode, result == dict(shares=expected, copies=[]), result)


try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or '/usr/bin/chromium')
        cases(browser.new_page())
        browser.close()
finally:
    shutdown()
done()
raise SystemExit(0 if all(results) else 1)
