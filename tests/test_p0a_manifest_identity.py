"""Chromium-Prüfung für MPD-Identität vor und während einer Medienauswahl."""
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
    notePlaylist, dashSummaryOf, mediaIsDashManifest, seeUrl, resolve, playerSources, openBrowserPlayer, closePlayer,
    browserDownload, directDownload, shareUrl, shareLinkTo,
    state: () => vp,
    recent: () => sources.map(s => s.u),
    registry: mediaRegistry,
    budget: () => typeof mediaSourceIdentities === 'undefined' ? null : {
      mpd: mediaSourceIdentities.size, admitted: admittedMediaIdentities.size
    },
    external: v => { active = v; onPillMain(); },
    pick: v => {
      active = v;
      const item = pageDlExternal(v, []).find(it => it.label === 'Im Browser öffnen');
      if (!item) return false;
      fui.menu = {seq: 1, items: [item]};
      return !!fuiFramePick(1, 0).ok;
    },
  };
})();
'''
INSTRUMENT = '''
window.calls = {hls: [], video: [], preview: [], intents: [], resolves: [], downloads: [], shares: [], copies: []};
const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
Object.defineProperty(HTMLMediaElement.prototype, 'src', {...src, set(u) {
  if (this.classList.contains('vv')) calls.video.push(u);
  if (this.classList.contains('vpv')) calls.preview.push(u);
  src.set.call(this, u);
}});
const load = Hls.prototype.loadSource;
Hls.prototype.loadSource = function(u) {
  calls.hls.push(u);
  return load.call(this, u);
};
const click = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function() {
  if (this.protocol === 'intent:') { calls.intents.push(this.href); dispatchEvent(new Event('blur')); return; }
  if (this.download) { calls.downloads.push(this.href); return; }
  return click.call(this);
};
Object.defineProperty(navigator, 'share', {value: ({url}) => {
  calls.shares.push(url);
  return Promise.reject(new Error('Testziel hat keine Share-API'));
}});
Object.defineProperty(navigator, 'clipboard', {value: {writeText: t => {
  calls.copies.push(t);
  return Promise.resolve();
}}});
const realFetch = fetch;
window.fetch = (u, options) => {
  if (options?.headers?.Range === 'bytes=0-1') {
    calls.resolves.push(u);
    return window.resolution = Promise.resolve({status: 206, url: url('/clip.mp4')});
  }
  if (options?.referrerPolicy && !options.headers) {
    return Promise.resolve({ok: true, url: u, blob: async () => new Blob(['x'.repeat(22000)])});
  }
  return realFetch(u, options);
};
window.url = p => new URL(p, location.href).href;
window.mark = (p, final = p) => k.notePlaylist(url(p), url(final), mpd);
window.evict = () => { for (let i = 0; i < 44; i++) mark('/analyses/' + i + '.mpd'); };
window.decoded = () => k.state()?.vid.videoWidth > 0 && k.state().vid.currentTime > 0;
'''


def setup(frame):
    frame.set_content('<video id="v" muted playsinline></video>')
    frame.add_script_tag(path=ROOT / 'vendor/hls.min.js')
    frame.add_script_tag(content=INSTRUMENT)
    frame.add_script_tag(content=SOURCE)
    frame.evaluate('(t) => { window.mpd = t; }', MPD)


def fresh(page):
    page.goto(B)
    setup(page)


def before_selection(page, path):
    page.route('**' + path, lambda route: route.fulfill(body=MPD, content_type='application/dash+xml'))
    return page.evaluate(r'''async p => {
      const u = url(p), mp4 = url('/clip.mp4');
      k.seeUrl(mp4);
      if (/\.(m3u8|mp4)$/.test(p)) k.seeUrl(u);
      else v.src = u;
      const response = await fetch(u);
      if (!response.ok) throw Error('MPD-Fixture nicht abrufbar');
      k.notePlaylist(u, response.url, await response.text());
      const known = !!k.dashSummaryOf(u);
      evict();
      const evicted = !k.dashSummaryOf(u);
      const sourcePresent = k.recent().includes(u) || v.src === u;
      const candidates = k.playerSources(v);
      k.openBrowserPlayer(v);
      k.state()?.prevWarm();
      return {known, evicted, sourcePresent, candidate: candidates.includes(u),
        hls: calls.hls.includes(u), video: calls.video.includes(u), preview: calls.preview.includes(u),
        independent: p === '/disguised' || candidates.includes(mp4)};
    }''', path)


def cases(page):
    for path in ('/disguised.m3u8', '/disguised.mp4', '/disguised'):
        fresh(page)
        outcome = before_selection(page, path)
        check('Echter Resolver nach Vorverdrängung: ' + path,
              outcome == dict(known=True, evicted=True, sourcePresent=True, candidate=False,
                              hls=False, video=False, preview=False, independent=True), outcome)
        if path == '/disguised.m3u8':
            page.wait_for_function('decoded()')
            check('Unabhängige MP4 erreicht video.src und dekodiert', page.evaluate(
                "k.state().vid.currentSrc === url('/clip.mp4') && calls.video.includes(url('/clip.mp4'))"))

    fresh(page)
    page.route(lambda u: u.endswith(('/hls2/master.m3u8?token=bad', '/master.m3u8?entry=mpd')),
               lambda route: route.fulfill(body=MPD, content_type='application/dash+xml'))
    outcome = page.evaluate('''() => {
      const base = '/hls2/master.m3u8';
      const bad = url(base + '?token=bad'), good = url(base + '?token=good'), req = url('/master.m3u8?entry=mpd');
      k.seeUrl(bad); k.seeUrl(good); k.seeUrl(req);
      mark(req, bad);
      const recognized = [req, bad].every(x => !!k.dashSummaryOf(x));
      evict();
      k.openBrowserPlayer(v);
      return {recognized, evicted: [req, bad].every(x => !k.dashSummaryOf(x)),
          selected: k.state().cur === good, badLoaded: calls.hls.some(x => x === bad || x === req)};
    }''')
    check('Anfrage- und MPD-Endadresse bleiben gesperrt, gleicher Pfad mit anderer Query spielt',
          outcome == dict(recognized=True, evicted=True, selected=True, badLoaded=False), outcome)
    # B.2 konnte zunächst die falsche HLS-Adresse versuchen und danach auf die Kontrollquelle fallen.
    page.wait_for_function('decoded() && k.state().hls?.levels.length === 2')
    quality = page.evaluate('''() => {
      const st = k.state();
      const previous = st.hls.currentLevel, next = previous === 1 ? 0 : 1;
      const label = st.hls.levels[next].height + 'p';
      const button = st.wrap.querySelector('[aria-label="Qualität"], [aria-label="Quality"]');
      button.click();
      const level = [...st.wrap.querySelectorAll('button')].find(b => b.firstChild?.textContent === label);
      if (!level) throw Error('HLS-Qualitätsauswahl fehlt');
      const at = st.vid.currentTime;
      level.click();
      return {previous, next, at};
    }''')
    page.wait_for_function('({at, next}) => decoded() && k.state().vid.currentTime > at + 0.15 && k.state().hls.currentLevel === next',
                           arg=quality)
    check('Echte HLS dekodiert nach Wechsel auf eine andere Qualität', quality['previous'] != quality['next'], quality)

    fresh(page)
    outcome = page.evaluate('''async () => {
      const u = url('/file.mp4?mpd=1');
      const foreign = 'http://127.0.0.1:8791/file.mp4';
      v.src = u;
      mark(u); mark(foreign); evict();
      let probes = 0;
      window.GM_xmlhttpRequest = o => {
        probes++;
        queueMicrotask(() => o.onload({status: 206, finalUrl: o.url, responseHeaders: 'Content-Disposition: attachment'}));
        return {abort() {}};
      };
      const attached = await k.browserDownload(foreign);
      delete window.GM_xmlhttpRequest;
      k.external(v);
      k.directDownload(u);
      const native = await k.browserDownload(u);
      await k.shareUrl(u);
      await window.resolution;
      await new Promise(r => setTimeout(r, 20));
      const blocked = {evicted: !k.dashSummaryOf(u), attached, native, probes, intents: calls.intents.length,
        resolves: calls.resolves.length, downloads: calls.downloads.length, shares: calls.shares.length, copies: calls.copies.length};
      k.shareLinkTo(url('/watch/ordinary'), 'Beitrag');
      await new Promise(r => setTimeout(r, 0));
      return {blocked, pageLink: calls.copies.includes(url('/watch/ordinary'))};
    }''')
    check('Vorverdrängung vor externem Knopf, Attachment, nativem oder Blob-Download und Teilen/Kopieren',
          outcome == dict(blocked=dict(evicted=True, attached=False, native=False, probes=0, intents=0,
                                       resolves=0, downloads=0, shares=0, copies=0), pageLink=True), outcome)

    fresh(page)
    outcome = page.evaluate('''async () => {
      const suspect = url('/master.m3u8?mpd=old'), good = url('/clip.mp4');
      k.seeUrl(suspect); k.seeUrl(good); mark(suspect); evict();
      const first = k.registry.contextFor(v);
      v.dispatchEvent(new Event('emptied'));
      const second = k.registry.contextFor(v);
      const replacement = document.createElement('video');
      v.replaceWith(replacement);
      history.pushState({}, '', '/spa');
      const third = k.registry.contextFor(replacement);
      const denied = [];
      for (let i = 0; i < 8; i++) {
        k.openBrowserPlayer(replacement);
        denied.push(k.state().cur === good && !k.state().sources.includes(suspect));
        k.closePlayer();
        // Produkt schließt per history.back; der Dokumentpfad bleibt bei einem SPA-Video grundsätzlich lebendig.
      }
      return {newEpoch: second.mediaEpoch > first.mediaEpoch,
        newDocumentKey: third.documentKey !== second.documentKey,
        reopened: denied.every(Boolean), loaded: calls.hls.includes(suspect)};
    }''')
    check('Neue Epoche, Elementersatz, SPA und wiederholtes Öffnen behalten dieselbe Netzidentität',
          outcome == dict(newEpoch=True, newDocumentKey=True, reopened=True, loaded=False), outcome)

    fresh(page)
    outcome = page.evaluate('''() => {
      const good = url('/clip.mp4'), prior = url('/budget-prior.m3u8');
      k.seeUrl(good); k.seeUrl(prior);
      for (let i = 0; i < 280; i++) k.seeUrl(url('/previous/' + i + '.mp4'));
      k.seeUrl(good); k.seeUrl(prior);
      for (let i = 0; i < 524; i++) mark('/budget/' + i + '.m3u8');
      const missing = url('/overflow.m3u8');
      mark(missing); mark(prior); evict();
      for (let i = 0; i < 80; i++) k.seeUrl(url('/network-' + i + '.mp4'));
      k.seeUrl(missing); k.seeUrl(prior); k.seeUrl(good);
      const control = k.playerSources(v).includes(good);
      const rejected = [missing, prior].every(u => !k.playerSources(v).includes(u));
      v.src = missing;
      k.external(v);
      const previous = url('/previous/0.mp4');
      v.src = previous;
      const refusedOldAdmission = !k.playerSources(v).includes(previous);
      return {control, rejected, refusedOldAdmission, intents: calls.intents.length, resolves: calls.resolves.length,
        mpd: k.budget()?.mpd, admittedBounded: k.budget()?.admitted <= 256, networkBounded: k.recent().length <= 40};
    }''')
    check('Volles Identitäts- und Netzwerkbudget behält zugelassene MP4 und vergisst kein Veto',
          outcome == dict(control=True, rejected=True, refusedOldAdmission=True, intents=0, resolves=0,
                          mpd=512, admittedBounded=True, networkBounded=True), outcome)

    fresh(page)
    outcome = page.evaluate('''() => {
      const doomed = url('/alias.mp4?exact=1'), control = url('/alias.mp4?exact=2');
      const videos = [v, ...Array.from({length: 5}, () => document.createElement('video'))];
      const ctxs = videos.map(el => k.registry.contextFor(el));
      const observe = (ctx, url) => k.registry.observe(ctx, {url,
        provenance: {kind: 'element', origin: 'fixture'}, association: {state: 'bound', evidence: ['element-src']}});
      for (const [i, ctx] of ctxs.slice(0, 4).entries()) {
        for (let j = 0; j < 64; j++) observe(ctx, url('/fixture/' + i + '/' + j + '.mp4'));
      }
      const playerFull = observe(ctxs[0], doomed).reason === 'budget';
      const documentFull = observe(ctxs[4], doomed).reason === 'budget';
      mark(doomed); evict();
      const freshElement = document.createElement('video');
      freshElement.src = doomed;
      const veto = !k.playerSources(freshElement).includes(doomed);
      freshElement.src = control;
      return {playerFull, documentFull, veto, control: k.playerSources(freshElement).includes(control)};
    }''')
    check('Volle Elementregistry und neuer Elementkontext behalten das exakte Veto',
          outcome == dict(playerFull=True, documentFull=True, veto=True, control=True), outcome)

    fresh(page)
    outcome = page.evaluate('''() => {
      const path = '/long.mp4?token=' + 'a'.repeat(4096), u = url(path);
      v.preload = 'none';
      v.src = u;
      k.seeUrl(u); mark(path); evict();
      return {candidate: k.playerSources(v).includes(u), summaryEvicted: !k.dashSummaryOf(u)};
    }''')
    check('Adresse oberhalb des Längenbudgets bleibt nach Verdrängung ausgeschlossen',
          outcome == dict(candidate=False, summaryEvicted=True), outcome)

    fresh(page)
    outcome = page.evaluate('''() => {
      const u = url('/master.m3u8?mpd=old');
      k.seeUrl(u);
      return {fresh: !k.mediaIsDashManifest(u), candidate: k.playerSources(v).includes(u)};
    }''')
    check('Neues HTML-Dokument übernimmt keine MPD-Identität', outcome == dict(fresh=True, candidate=True), outcome)

    page.goto(B)
    page.set_content('<iframe src="/direct.html"></iframe>')
    frame = page.frames[1]
    frame.wait_for_load_state()
    setup(frame)
    frame.evaluate("v.src = url('/clip.mp4')")
    frame.wait_for_function('v.readyState >= 2')
    outcome = frame.evaluate('''async () => {
      mark('/clip.mp4'); evict();
      k.external(v);
      const confirmation = k.pick(v);
      await window.resolution;
      await new Promise(r => setTimeout(r, 0));
      k.openBrowserPlayer(v);
      return {confirmation, intents: calls.intents.length, playerLoads: calls.video.length + calls.hls.length};
    }''')
    check('Iframe mit Vorverdrängung bietet keine lokale Medienbestätigung und sendet keinen Intent',
          outcome == dict(confirmation=False, intents=0, playerLoads=0), outcome)


try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or '/usr/bin/chromium')
        cases(browser.new_page())
        browser.close()
finally:
    shutdown()
done()
raise SystemExit(0 if all(results) else 1)
