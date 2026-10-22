# Helfer-App: Ohne sie sieht man nur, was auch ohne sie geht (keine Helligkeit, kein Eintrag „Helper-App“, keine
# Helfer-Downloads). Läuft sie, ist alles wieder da – Anfragen gehen über den Hintergrund der Erweiterung.
# Koppeln: Die Koppel-Seite der App (127.0.0.1:47811/pair#SCHLÜSSEL) speichert den Schlüssel in der Erweiterung.
import time
from common import *

KEY = '0123456789abcdef0123456789abcdef'
with sync_playwright() as p:
    ctx, sw, udir = launch(p)
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    # ---------- ohne Helfer ----------
    helper['on'] = False
    open_player(pg, B + 'direct.html')
    swipe(pg, 80, 600, 450)          # links hoch = Helligkeit
    s_l = side(pg)
    check('ohne Helfer: links wischen zeigt KEINE Helligkeit', not s_l or ' on' not in s_l[0] or ' l' not in s_l[0], s_l)
    time.sleep(1.5)
    swipe(pg, 330, 600, 450)         # rechts hoch = Lautstärke – ohne Helfer ebenfalls aus (1.2)
    s_r = side(pg)
    check('… rechts wischen zeigt KEINE Lautstärke', not s_r or ' on' not in s_r[0], s_r)
    names = [n for n, _ in settings(pg)]
    check('… Einstellungen ohne „Helper-App“', 'Helper-App' not in names and 'Sprache' in names, names)
    close_menu(pg)
    pg.evaluate('() => %s.querySelector("button[aria-label^=Herunterladen]").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))' % R); time.sleep(0.4)
    dl = pg.evaluate('() => Array.from(%s.querySelectorAll(".vmenu.on .vmi")).map(b => b.firstChild.textContent)' % R)
    check('… Download-Menü ohne Helfer-Wege', dl and 'Mit dem Helper' not in dl and 'Über den Browser laden' not in dl, dl)
    close_menu(pg)
    pg.evaluate('() => %s.querySelector("button[aria-label=Schließen]").click()' % R); time.sleep(0.6)
    # ---------- mit Helfer (alter fester Schlüssel) ----------
    helper['on'] = True; helper['key'] = 'evp-1'; helper['calls'].clear()
    open_player(pg, B + 'direct.html')
    time.sleep(0.8)
    check('mit Helfer: beim Öffnen nachgefragt (Anfrage über den Hintergrund, mit Schlüssel)', len(hcalls('/ping')) >= 1 and hcalls('/ping')[0][2] == 'evp-1', helper['calls'][:3])
    swipe(pg, 80, 600, 450)
    s_l2 = side(pg)
    br = hcalls('/bright')
    check('… links wischen: Helligkeit sichtbar und geht ans Handy', s_l2 and ' on' in s_l2[0] and ' l' in s_l2[0] and len(br) >= 1, [s_l2, br[:3]])
    time.sleep(1.5)
    swipe(pg, 330, 600, 450)
    s_r2 = side(pg)
    check('… rechts wischen: Lautstärke sichtbar und geht ans Handy', s_r2 and ' on' in s_r2[0] and ' r' in s_r2[0] and len(hcalls('/vol')) >= 1, [s_r2, hcalls('/vol')[:2]])
    names2 = [n for n, _ in settings(pg)]
    check('… Einstellungen mit „Helper-App“', 'Helper-App' in names2, names2)
    close_menu(pg)
    pg.evaluate('() => %s.querySelector("button[aria-label^=Herunterladen]").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))' % R); time.sleep(0.4)
    dl2 = pg.evaluate('() => Array.from(%s.querySelectorAll(".vmenu.on .vmi")).map(b => b.firstChild.textContent)' % R)
    check('… Download-Menü mit „Mit dem Helper“', 'Mit dem Helper' in dl2, dl2)
    close_menu(pg)
    pg.evaluate('() => %s.querySelector("button[aria-label=Schließen]").click()' % R); time.sleep(0.6)
    # ---------- Koppeln: eigener Schlüssel der App ----------
    helper['key'] = KEY; helper['calls'].clear()
    pg.goto('http://127.0.0.1:47811/pair#' + KEY); time.sleep(2.0)
    msg = pg.evaluate('() => (document.getElementById("evp-pair") || {}).textContent || ""')
    stored = sw.evaluate('async () => (await chrome.storage.local.get("gm:helperKey"))["gm:helperKey"]')
    check('Koppeln: Bestätigung auf der Seite, Schlüssel in der Erweiterung gespeichert', 'Verbunden' in msg and stored == KEY, [msg[:60], stored])
    open_player(pg, B + 'direct.html'); time.sleep(0.8)
    pk = hcalls('/ping')
    check('… danach fragt der Player mit dem neuen Schlüssel', pk and pk[-1][2] == KEY, pk[-2:])
    check('keine Fehler der Seite', not errs, errs)
    ctx.close()
shutdown()
done()
