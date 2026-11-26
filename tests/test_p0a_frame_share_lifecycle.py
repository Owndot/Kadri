"""P0-A: Linkfreigabe aus einem iframe bleibt bis zum letzten Share-/Kopieraufruf beim Prüfer des Ursprungsdokuments.

Echte gleichherkunftige Dokumente (Hauptfenster und iframe), echte Produktfunktionen auf beiden Seiten, die echte
Antwortsanitisierung fuiBack aus chrome/background.js und nachgebildete Browser-IPC. Gezählt werden die tatsächlich
ausgeführten Aufrufe von navigator.share, navigator.clipboard.writeText, document.execCommand('copy') und
Intent-Links in BEIDEN Dokumenten. Bestätigungen im Ursprungsframe erfolgen durch echte Playwright-Klicks (vertrauens-
würdige Eingabe, Benutzeraktivierung wird am Share-Aufruf protokolliert)."""
import os
import re
from pathlib import Path

from common import B, check, done, results, shutdown, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
MPD = (ROOT / 'tests/web/dash/gate/g02-number-duration.mpd').read_text(encoding='utf-8')
SOURCE = ''.join(p.read_text(encoding='utf-8') for p in sorted((ROOT / 'src').glob('[0-9]*.js')))
# Wie der Testbau (tools/build.js): offener Shadow-DOM, damit echte Klicks die Bedienelemente erreichen.
SHADOW = "root = hostEl.attachShadow({ mode: 'closed' });"
assert SOURCE.count(SHADOW) == 1
SOURCE = SOURCE.replace(SHADOW, "root = hostEl.attachShadow({ mode: 'open' }); hostEl.setAttribute('data-kadri-test', '');")
# Seiten mit Linkdownload (CONFIG.downloadEverywhere bzw. ytdlpSites): Das reale Menü enthält Beitragslinks.
# Die verzögerte Intent-Navigation bleibt wie im Redirect-Prüfer ein Messpunkt.
assert SOURCE.count('location.href = intent;') == 1
SOURCE = SOURCE.replace('location.href = intent;', 'window.calls.intents.push(intent);')
LINKS = 'const SHOW_DOWNLOAD = DOWNLOAD_ONLY ||'
assert SOURCE.count(LINKS) == 1
SOURCE = SOURCE.replace(LINKS, 'const SHOW_DOWNLOAD = true ||')
SOURCE = SOURCE[:SOURCE.rindex('})();')] + '''
  CONFIG.startFullscreen = false;
  CONFIG.systemHelper = false;
  CONFIG.ambient = false;
  CONFIG.language = 'de';
  window.k = {
    notePlaylist, dashSummaryOf, mediaIsDashManifest,
    // Eingang einer Relay-Nachricht im Ursprungsframe (wie background.js -> onMsg), Knopf steht oben.
    frameMsg: (m) => { active = v; fui.shown = true; fui.mode = 'remote'; return fuiFrameMsg(Object.assign({n: fui.n}, m)); },
    frameMenu: () => { active = v; fui.shown = true; fui.mode = 'remote'; fui.relayUntil = Date.now() + 60000;
      fuiFrameMenu('Video speichern', pageDlExternal(v, [])); return {seq: fui.menu.seq, labels: fui.menu.items.map(it => it.label)}; },
    // Hauptfenster: registriertes Fenster mit Knopf hier oben
    topRegister: (frame) => {
      const g = {key: '1:doc', src: {f: 1, d: 'doc'}, n: 'a'.repeat(32), mode: 'remote', hold: 0};
      fuiTop.regs.set(g.key, g); fuiTop.geo.set(g.n, {f: frame, t: Date.now()}); fuiTop.cur = g; fuiTop.lastRid = '';
      return g;
    },
    topAct: (a) => fuiTopAct(a),
    // Tipp auf einen weitergereichten Eintrag im Hauptfenster (Funktion des Relay-Eintrags, src/035)
    topPick: (seq, i) => fuiTopPick(fuiTop.cur, seq, i),
  };
})();
'''
BG = (ROOT / 'chrome/background.js').read_text(encoding='utf-8')
FUI_BACK = BG[BG.index('function fuiBack(r)'):BG.index('function fuiUpBack(r)')]
POST = '/watch?v=post123456'
LINK = B + POST.lstrip('/')

INSTRUMENT = '''mpd => {
  window.calls = {shares: [], copies: [], exec: [], intents: [], toasts: [], activation: []};
  window.mark = p => { const u = new URL(p, location.href).href; k.notePlaylist(u, u, mpd); };
  window.evict = () => { for (let i = 0; i < 44; i++) mark('/evict/' + Math.random() + '.mpd'); };
  window.overflow = () => { for (let i = 0; i < 514; i++) mark('/manifests/' + i + '.m3u8'); };
  window.shareReply = null;
  Object.defineProperty(navigator, 'share', {configurable: true, writable: true, value: ({url}) => {
    calls.shares.push(url);
    calls.activation.push(!!navigator.userActivation?.isActive);
    return window.shareReply || Promise.resolve();
  }});
  Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: u => {
    calls.copies.push(u);
    return window.clipReply || Promise.resolve();
  }}});
  const exec = document.execCommand.bind(document);
  document.execCommand = (c, ...a) => { if (c === 'copy') { calls.exec.push(document.activeElement?.value || ''); return true; } return exec(c, ...a); };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function() { if (/^intent:/.test(this.href)) { calls.intents.push(this.href); return; } return click.call(this); };
  window.flush = () => new Promise(r => setTimeout(r, 0));
}'''


ARTICLE = '<article><a href="' + POST + '">Beitrag</a><video id="v" muted playsinline src="/clip.mp4"></video></article>'


def frame_setup(frame, body=ARTICLE, path=None):
    frame.set_content(body)
    if path:
        frame.evaluate('p => history.replaceState(null, "", p)', path)
    frame.evaluate("() => { window.KADRI_FRAMEUI = {send: m => Promise.resolve({ok: true})}; }")
    frame.add_script_tag(content=SOURCE)
    frame.evaluate(INSTRUMENT, MPD)
    frame.wait_for_function('v.readyState >= 2')
    # Toasts im Fenster (Relay abgeschaltet: lokale Anzeige)
    frame.evaluate("() => { window.KADRI_FRAMEUI.send = m => { if (m.op === 'toast') calls.toasts.push(m.text); return Promise.resolve({ok: true}); }; }")


def top_setup(page, body=ARTICLE, path=None):
    page.goto(B)
    page.set_content('<h1>Hauptseite</h1><iframe id="f" src="/direct.html" style="width:640px;height:400px"></iframe>')
    page.evaluate('''fuiBackSrc => {
      window.fuiBack = new Function(fuiBackSrc + '; return fuiBack;')();
      window.hooks = {afterReply: null};
      // Nachgebildete Browser-IPC: das Hauptfenster erreicht genau das Dokument des registrierten Fensters.
      window.KADRI_FRAMEUI = {send: async m => {
        if (m.op === 'toast') return {ok: true};
        if (m.op !== 'act' && m.op !== 'pick') return {ok: true};
        const w = document.getElementById('f')?.contentWindow;
        if (!w || !w.k) return null;
        const r = w.k.frameMsg({op: m.op, a: m.a, seq: m.seq, i: m.i, rid: m.rid});
        relays.push(m.op);
        if (hooks.afterReply) await hooks.afterReply(r);   // Antwort erzeugt, noch nicht zugestellt
        return fuiBack(r);
      }};
      window.relays = [];
    }''', FUI_BACK)
    page.add_script_tag(content=SOURCE)
    page.evaluate(INSTRUMENT, MPD)
    child = page.frames[1]
    child.wait_for_load_state()
    frame_setup(child, body, path)
    page.evaluate("k.topRegister(document.getElementById('f'))")
    return child


def totals(page, child):
    top = page.evaluate('calls')
    low = child.evaluate('calls')
    return dict(topShares=len(top['shares']), topCopies=len(top['copies']) + len(top['exec']), topIntents=len(top['intents']),
                frameShares=len(low['shares']), frameCopies=len(low['copies']) + len(low['exec']),
                frameIntents=len(low['intents']), activation=low['activation'], frameToasts=low['toasts'])


def confirm(child, label=None):
    """Echter Tipp auf den Bestätigungseintrag im Ursprungsframe, falls vorhanden."""
    items = child.locator('[data-kadri-test] [role=menuitem]')
    if label:
        items = items.filter(has_text=label)
    if items.count() == 0:
        return False
    items.first.click()
    return True


def cases(page):
    # ---------- Test A: Klassifikation nach Erstellung der Frame-Antwort, vor ihrer Zustellung ----------
    child = top_setup(page)
    page.evaluate("() => { hooks.afterReply = async () => { const w = document.getElementById('f').contentWindow; w.mark('%s'); w.evict(); }; }" % POST)
    page.evaluate("() => { k.topAct('share'); }")
    page.wait_for_timeout(300)
    tapped = confirm(child)
    page.wait_for_timeout(300)
    known = child.evaluate("u => k.mediaIsDashManifest(new URL(u, location.href).href) && !k.dashSummaryOf(new URL(u, location.href).href)", POST)
    t = totals(page, child)
    check('Test A (Knopf): späte MPD-Klassifikation vor Zustellung – null Share/Clipboard in beiden Dokumenten',
          known and t['topShares'] + t['frameShares'] == 0 and t['topCopies'] + t['frameCopies'] == 0, dict(t, tapped=tapped))
    check('Test A (Knopf): keine Ausgabe im Hauptfenster', t['topShares'] == t['topCopies'] == t['topIntents'] == 0, t)

    # gleiches Zeitfenster über den Auswahleintrag „Teilen …“ (Download-Menü des Fensters, Relay-Pick)
    for label, kind in (('Teilen …', 'share'), ('Mit YTDLnis', 'intent')):
        child = top_setup(page)
        menu = child.evaluate('k.frameMenu()')
        index = menu['labels'].index(label)
        page.evaluate("() => { hooks.afterReply = async () => { const w = document.getElementById('f').contentWindow; w.mark('%s'); w.evict(); }; }" % POST)
        page.evaluate('([seq, i]) => { k.topPick(seq, i); }', [menu['seq'], index])
        page.wait_for_timeout(300)
        tapped = confirm(child, label)
        page.wait_for_timeout(300)
        t = totals(page, child)
        out = t['topShares'] + t['frameShares'] + t['topCopies'] + t['frameCopies'] + t['topIntents'] + t['frameIntents']
        check('Test A (Eintrag „%s“): späte MPD-Klassifikation vor Zustellung – keine Ausgabe' % label, out == 0, dict(t, tapped=tapped))

    # ---------- Test B: Klassifikation nach begonnenem Share, vor dem Clipboard-Fallback ----------
    child = top_setup(page)
    for w in (page, child):
        w.evaluate("() => { window.shareReply = new Promise((_, r) => { window.failShare = () => r(Object.assign(new Error('x'), {name: 'NotAllowedError'})); }); }")
    page.evaluate("() => { k.topAct('share'); }")
    page.wait_for_timeout(300)
    tapped = confirm(child)
    page.wait_for_timeout(200)
    started = totals(page, child)
    child.evaluate("() => { mark('%s'); evict(); }" % POST)
    for w in (page, child):
        w.evaluate("() => window.failShare && window.failShare()")
    page.wait_for_timeout(400)
    t = totals(page, child)
    shares = t['topShares'] + t['frameShares']
    copies = t['topCopies'] + t['frameCopies']
    prevented = [x for x in t['frameToasts'] if re.search(r'verhindert|gesperrt|nicht geteilt', x)]
    check('Test B: genau ein bereits begonnener Share, keine zweite Share-Aktion', shares == 1 and started['topShares'] + started['frameShares'] == 1, dict(t, tapped=tapped))
    check('Test B: null Clipboard-Aufrufe nach später MPD-Klassifikation', copies == 0, t)
    check('Test B: erfolgter Share wird nicht nachträglich als verhindert dargestellt', not prevented, t['frameToasts'])

    # ---------- Positive Kontrollen ----------
    child = top_setup(page)
    page.evaluate("() => { k.topAct('share'); }")
    page.wait_for_timeout(300)
    hint = child.evaluate("() => [...(document.querySelector('[data-kadri-test]')?.shadowRoot?.querySelectorAll('.dlh, [role=menuitem]') || [])].map(e => e.textContent)")
    tapped = confirm(child)
    page.wait_for_timeout(300)
    t = totals(page, child)
    check('Gültiger Beitragslink aus iframe: genau ein Share im Ursprungsframe nach echtem Tipp',
          tapped and t['frameShares'] == 1 and t['topShares'] == 0 and t['activation'] == [True] and
          child.evaluate('calls.shares[0]') == LINK, dict(t, hint=hint))
    check('Bestätigung ist in der Oberfläche als zweiter Tipp im Video-Fenster erkennbar',
          any('Video-Fenster' in x for x in hint), hint)

    child = top_setup(page, '<div><video id="v" muted playsinline src="/clip.mp4"></video></div>', '/clip/page-7')
    page.evaluate("() => { k.topAct('share'); }")
    page.wait_for_timeout(300)
    tapped = confirm(child)
    page.wait_for_timeout(300)
    t = totals(page, child)
    shared = child.evaluate('calls.shares')
    check('Gültiger Seitenlink (Dokumentadresse) aus iframe: genau ein Share im Ursprungsframe',
          tapped and t['frameShares'] == 1 and t['topShares'] == 0 and shared == [B + 'clip/page-7'], dict(t, shared=shared))

    for label, kind in (('Teilen …', 'shares'), ('Mit YTDLnis', 'intents')):
        child = top_setup(page)
        menu = child.evaluate('k.frameMenu()')
        page.evaluate('([seq, i]) => { k.topPick(seq, i); }', [menu['seq'], menu['labels'].index(label)])
        page.wait_for_timeout(300)
        tapped = confirm(child, label)
        page.wait_for_timeout(1300)
        t = totals(page, child)
        got = child.evaluate('calls.' + kind)
        top_out = t['topShares'] + t['topCopies'] + t['topIntents']
        check('Gültiger Beitragslink über Eintrag „%s“: genau ein Aufruf im Ursprungsframe' % label,
              tapped and len(got) == 1 and LINK.split('://')[1] in got[0] and top_out == 0, dict(t, got=got))

    child = top_setup(page)
    child.evaluate("() => { window.shareReply = Promise.reject(Object.assign(new Error('x'), {name: 'NotAllowedError'})); window.shareReply.catch(() => {}); }")
    page.evaluate("() => { k.topAct('share'); }")
    page.wait_for_timeout(300)
    confirm(child)
    page.wait_for_timeout(300)
    t = totals(page, child)
    check('Zulässiger Clipboard-Fallback nach Share-Fehler im Ursprungsframe',
          t['frameShares'] == 1 and t['frameCopies'] == 1 and t['topShares'] == t['topCopies'] == 0 and
          child.evaluate('calls.copies') == [LINK], t)

    child = top_setup(page)
    child.evaluate('overflow()')
    page.evaluate('overflow()')
    page.evaluate("() => { k.topAct('share'); }")
    page.wait_for_timeout(300)
    confirm(child)
    page.wait_for_timeout(300)
    t = totals(page, child)
    check('Teilen nach Medienbudgetüberlauf', t['frameShares'] == 1 and t['topShares'] == 0, t)

    child = top_setup(page)
    child.evaluate("() => { window.shareReply = new Promise(() => {}); }")
    page.evaluate("() => { k.topAct('share'); k.topAct('share'); }")
    page.wait_for_timeout(300)
    confirm(child)
    confirm(child)
    page.wait_for_timeout(300)
    t = totals(page, child)
    check('Kein doppelter Share-Aufruf (Doppeltipp oben und im Fenster)',
          t['frameShares'] + t['topShares'] == 1 and page.evaluate('relays.length') == 1, dict(t, relays=page.evaluate('relays')))

    child = top_setup(page)
    child.evaluate("mark('%s')" % POST)
    child.evaluate('evict()')
    page.evaluate("() => { k.topAct('share'); }")
    page.wait_for_timeout(300)
    tapped = confirm(child)
    page.wait_for_timeout(300)
    out = [u for w in (page, child) for kind in ('shares', 'copies', 'exec') for u in w.evaluate('calls.' + kind)]
    check('Bekannte MPD mit Beitragsform erreicht nie Share oder Clipboard', LINK not in out, dict(outputs=out, tapped=tapped))

    for mode in ('navigiert', 'ersetzt', 'entfernt'):
        child = top_setup(page)
        page.evaluate("() => { k.topAct('share'); }")
        page.wait_for_timeout(300)
        sheet = child.locator('[data-kadri-test] [role=menuitem]').count() > 0
        before = totals(page, child)
        page.evaluate('''mode => {
          const f = document.getElementById('f');
          if (mode === 'navigiert') f.src = '/hls.html';
          else if (mode === 'ersetzt') f.replaceWith(Object.assign(f.cloneNode(false), {src: '/direct.html'}));
          else f.remove();
        }''', mode)
        page.wait_for_timeout(800)
        for f in [f for f in page.frames if f != page.main_frame]:
            confirm(f)
        page.wait_for_timeout(300)
        top = page.evaluate('calls')
        after = len(top['shares']) + len(top['copies']) + len(top['exec'])
        late = sum(len(f.evaluate('window.calls ? window.calls.shares.concat(window.calls.copies) : []'))
                   for f in page.frames if f != page.main_frame)
        check('Kein verspäteter Aufruf nach Frame-Änderung: ' + mode,
              sheet and after == before['topShares'] + before['topCopies'] and late == 0,
              dict(sheetBefore=sheet, before=before, topAfter=top, late=late))

    # Antwort trifft erst ein, nachdem der Frame ersetzt wurde
    child = top_setup(page)
    page.evaluate('''() => { hooks.afterReply = async () => {
      const f = document.getElementById('f');
      f.replaceWith(Object.assign(f.cloneNode(false), {src: '/direct.html'}));
      await new Promise(r => setTimeout(r, 50));
    }; }''')
    page.evaluate("() => { k.topAct('share'); }")
    page.wait_for_timeout(600)
    top = page.evaluate('calls')
    check('Kein Aufruf aus einem während der Antwort ersetzten Frame', not top['shares'] and not top['copies'] and not top['exec'], top)


try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or '/usr/bin/chromium')
        cases(browser.new_page())
        browser.close()
finally:
    shutdown()
done()
raise SystemExit(0 if all(results) else 1)
