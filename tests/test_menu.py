# Kadri-Menü (Puzzle-Symbol) und Einstellungsseite (Kadri 1.1):
#  - Kadri auf einer Seite aus- und wieder einschalten (nach dem Neuladen)
#  - Zustand der Helfer-App
#  - Einstellungsseite: Wert ändern → gilt im Player; Seitenliste ändern → gespeichert
import time, json
from common import *

with sync_playwright() as p:
    ctx, sw, udir = launch(p)
    ext_id = sw.url.split('/')[2]
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(B + 'direct.html'); time.sleep(0.5)
    tab_id = sw.evaluate('async (u) => (await chrome.tabs.query({ url: u + "*" }))[0].id', B + 'direct.html')
    def popup():
        m = ctx.new_page(); m.goto('chrome-extension://%s/popup.html?tab=%d' % (ext_id, tab_id)); time.sleep(1.8)
        return m
    def kadri_active():
        pg.reload(); pg.wait_for_function('document.getElementById("v").currentTime > 0.5', timeout=20000)
        pg.evaluate('() => { document.getElementById("v").muted = false; }'); time.sleep(1.8)
        return pg.evaluate('() => !!document.querySelector("[data-kadri-test]")')
    # 1) Menü: Seite, Schalter an, Helfer nicht gefunden
    helper['on'] = False
    m = popup()
    st = m.evaluate('() => [document.body.innerText, document.getElementById("siteOn") && document.getElementById("siteOn").checked]')
    check('Menü: zeigt die Seite, Kadri hier an, Helfer-App nicht gefunden', '127.0.0.1' in st[0] and st[1] is True and 'nicht gefunden' in st[0], st)
    # 2) ausschalten → nach dem Neuladen kein Kadri
    m.evaluate('() => document.querySelector(".sw span").click()'); time.sleep(0.6)
    lst = sw.evaluate('async () => ((await chrome.storage.local.get("gm:settings"))["gm:settings"] || {}).disabledSites')
    m.close()
    a1 = kadri_active()
    check('… auf dieser Seite ausgeschaltet: steht in der Liste, nach Neuladen kein Knopf', lst and '127.0.0.1' in lst and not a1, [lst[-3:] if lst else lst, a1])
    # 3) wieder an
    m = popup(); m.evaluate('() => document.querySelector(".sw span").click()'); time.sleep(0.6); m.close()
    a2 = kadri_active()
    check('… wieder eingeschaltet: Knopf ist wieder da', a2)
    # 4) Helfer läuft → Menü zeigt „verbunden“
    helper['on'] = True; helper['key'] = 'evp-1'
    m = popup(); txt = m.evaluate('() => document.getElementById("helper").innerText'); m.close()
    check('Menü: Helfer-App verbunden, wenn sie läuft', 'verbunden' in txt, txt)
    helper['on'] = False
    # 5) Einstellungsseite: Sprungweite 30 s → gilt im Player
    o = ctx.new_page(); o.goto('chrome-extension://%s/options.html' % ext_id); time.sleep(1.0)
    o.select_option('select[data-k=skipSeconds]', '30'); time.sleep(0.5)
    o.fill('textarea[data-k=ytdlpSites]', 'youtube.com\nbeispiel.de'); o.evaluate('() => document.querySelector("textarea[data-k=ytdlpSites]").dispatchEvent(new Event("change"))'); time.sleep(0.5)
    sv = sw.evaluate('async () => (await chrome.storage.local.get("gm:settings"))["gm:settings"]')
    check('Einstellungsseite: Werte gespeichert (Sprungweite, Seitenliste)', sv.get('skipSeconds') == 30 and sv.get('ytdlpSites') == ['youtube.com', 'beispiel.de'], sv)
    o.close()
    pg.bring_to_front()
    open_player(pg, B + 'direct.html')
    s = dict(settings(pg))
    check('… im Player angekommen: Sprungweite 30 s', s.get('Sprungweite') == '30 s', s.get('Sprungweite'))
    close_menu(pg)
    check('keine Fehler der Seite', not errs, errs)
    ctx.close()
shutdown()
done()
