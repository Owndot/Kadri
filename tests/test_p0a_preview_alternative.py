"""P0-A: Die Vorschau lädt nativ nur Quellen mit eigenem Dateibeleg – dieselbe Entscheidung wie der Hauptplayer.

Zwei echte HTTP-Server. Der Hauptplayer spielt eine belegte MP4; die Quellenliste derselben Playerinstanz erhält eine
kleinere Alternative. Gezählt werden die tatsächlichen src-Zuweisungen am Vorschauelement (.vpv) und serverseitig die
Abrufe an bekannte MPD-Kinder."""
import os

import nocors_servers as S
from common import check, done, results, shutdown, sync_playwright
from type_evidence_lib import kids, mark_kids, setup, wait

M = S.MEDIA


def main_playing(page, main):
    setup(page, main, preload='auto')
    mark_kids(page)
    page.evaluate('k.openBrowserPlayer(v)')
    assert wait(page, 'decoded()'), 'Hauptplayer dekodiert nicht'


def with_alternative(page, alt):
    page.evaluate('''a => { const st = k.state(); st.sources.push(a); st.srcRes[a] = 180; st.srcRes[st.cur] = 640; log.prev = []; }''', alt)


def run(page):
    for alt, label in ((M + 'm/low.mp4', 'fremde Site ohne CORS'), (M + 'm/low2.mp4?cors=1', 'mit CORS')):
        main_playing(page, M + 'f/main.mp4?cors=1')
        with_alternative(page, alt)
        since = len(S.LOG)
        page.evaluate('k.state().prevWarm()')
        ok = wait(page, "k.state() && k.state().wrap.querySelector('.vpv') && k.state().wrap.querySelector('.vpv').videoWidth > 0", timeout=8000)
        page.wait_for_timeout(1500)
        prev = page.evaluate('log.prev')
        got = kids(since)
        page.evaluate('() => k.state() && k.closePlayer()')
        check('Vorschau-Alternative .mp4-HLS (%s): nicht nativ geladen, 0 MPD-Kind-Abrufe, Vorschau aus der laufenden Quelle' % label,
              got == 0 and alt not in prev and ok, dict(kids=got, prevSrc=[p[len(M) - 1:] for p in prev], previewDecoded=ok))

    # Positiv: belegte kleinere Alternative wird für die Vorschau genommen und dekodiert
    main_playing(page, M + 'f/main3.mp4?cors=1')
    alt = M + 'f/small.mp4?cors=1'
    assert page.evaluate('u => k.mediaProbe(u)', alt) == 'file'
    with_alternative(page, alt)
    page.evaluate('k.state().prevWarm()')
    ok = wait(page, "k.state().wrap.querySelector('.vpv').videoWidth > 0", timeout=8000)
    prev = page.evaluate('log.prev')
    page.evaluate('() => k.state() && k.closePlayer()')
    check('Positiv: belegte kleinere Alternative wird als Vorschau geladen und dekodiert', ok and alt in prev, dict(prevSrc=len(prev), decoded=ok))

    # Späte Klassifikation während der Vorschau: kein erneutes natives Laden der inzwischen als HLS bekannten Adresse
    main = M + 'f/main4.mp4?cors=1'
    main_playing(page, main)
    page.evaluate('k.state().prevWarm()')
    wait(page, "k.state().wrap.querySelector('.vpv').videoWidth > 0", timeout=8000)
    page.evaluate("u => { k.noteMediaType(u, 'hls'); log.prev = []; k.state().wrap.querySelector('.vpv').dispatchEvent(new Event('error')); }", main)
    page.wait_for_timeout(1500)
    prev = page.evaluate('log.prev')
    page.evaluate('() => k.state() && k.closePlayer()')
    check('Späte HLS-Klassifikation der Vorschauquelle: kein erneutes natives Laden', main not in prev, dict(prevSrc=len(prev)))

    # Positiv: erlaubter HLS-Master – Vorschau über die bewachte hls.js-Instanz
    setup(page, M + 'm/okprev?cors=1')
    page.evaluate('k.openBrowserPlayer(v)')
    ok = wait(page, 'decoded() && k.state().hls && k.state().hls.levels.length === 2')
    page.evaluate('k.state().prevWarm()')
    pok = ok and wait(page, "k.state().wrap.querySelector('.vpv').videoWidth > 0", timeout=10000)
    page.evaluate('() => k.state() && k.closePlayer()')
    check('Positiv: Vorschau eines erlaubten HLS-Masters dekodiert über hls.js', pok, dict(hls=ok, preview=pok))


try:
    S.start()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM') or '/usr/bin/chromium')
        page = browser.new_page()
        page.set_default_timeout(30000)
        run(page)
        browser.close()
finally:
    S.stop()
    shutdown()
done()
raise SystemExit(0 if all(results) else 1)
