# Helfer-App über den sicheren Kanal (Kopplung per Code, Noise KK; echter ChannelServer der Helper-App auf dem Desktop,
# nur das Gerät ist nachgebildet). Ohne Kopplung sieht man nur, was auch ohne App geht (keine Helligkeit, kein Eintrag
# „Helper-App“). Gekoppelt sind Helligkeit und Lautstärke wieder da und kommen am Gerät an; Downloads über die App
# bleiben vorübergehend aus (keine Helfer-Wege im Download-Menü). Der alte Port 47811 wird nie angesprochen.
#   HELPER_HOST_DIR=<Helper-Repository: tests/java/channel/build.sh OUT>
import time
from common import *

helper = ChannelHelper()
check('echter Kanal-Helfer (ChannelServer) läuft', helper.ready.startswith('READY'), helper.ready)
with sync_playwright() as p:
    ctx, sw, udir = launch(p)
    ext_id = sw.url.split('/')[2]
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    def menu_helper():
        m = ctx.new_page(); m.goto('chrome-extension://%s/popup.html' % ext_id)
        m.wait_for_function('() => /verbunden|gekoppelt|connected|paired/i.test(document.getElementById("helper").textContent)', timeout=20000)
        t = m.text_content('#helper'); m.close(); return t
    def dl_menu():
        pg.evaluate('() => %s.querySelector("button[aria-label^=Herunterladen]").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))' % R); time.sleep(0.4)
        d = pg.evaluate('() => Array.from(%s.querySelectorAll(".vmenu.on .vmi")).map(b => b.firstChild.textContent)' % R)
        close_menu(pg); return d
    # ---------- ohne Kopplung ----------
    open_player(pg, B + 'direct.html')
    swipe(pg, 80, 600, 450)          # links hoch = Helligkeit
    s_l = side(pg)
    check('ohne Kopplung: links wischen zeigt KEINE Helligkeit', not s_l or ' on' not in s_l[0] or ' l' not in s_l[0], s_l)
    time.sleep(1.5)
    swipe(pg, 330, 600, 450)         # rechts hoch = Lautstärke – ohne Helfer ebenfalls aus
    s_r = side(pg)
    check('… rechts wischen zeigt KEINE Lautstärke', not s_r or ' on' not in s_r[0], s_r)
    names = [n for n, _ in settings(pg)]
    check('… Einstellungen ohne „Helper-App“', 'Helper-App' not in names and 'Sprache' in names, names)
    close_menu(pg)
    dl = dl_menu()
    check('… Download-Menü ohne Helfer-Wege', dl and 'Mit dem Helper' not in dl and 'Über den Browser laden' not in dl, dl)
    pg.evaluate('() => %s.querySelector("button[aria-label=Schließen]").click()' % R); time.sleep(0.6)
    check('… Menü: Helfer-App nicht gekoppelt', 'nicht gekoppelt' in menu_helper())
    check('… Gerät unberührt', helper.device()['brights'] == 0 and helper.device()['vols'] == 0)
    # ---------- koppeln (echte Einstellungsseite, Code aus der App) ----------
    msg = pair_helper(ctx, ext_id, helper)
    check('Kopplung über die Einstellungsseite', msg == 'Verbunden', msg)
    check('Menü: Helfer-App verbunden (über den Kanal)', 'verbunden' in menu_helper())
    # ---------- mit Kopplung ----------
    open_player(pg, B + 'direct.html')
    time.sleep(1.0)
    swipe(pg, 80, 600, 450)
    s_l2 = side(pg)
    time.sleep(0.5)
    d1 = helper.device()
    check('mit Kopplung: links wischen zeigt Helligkeit und sie kommt am Gerät an', s_l2 and ' on' in s_l2[0] and ' l' in s_l2[0] and d1['brights'] >= 1 and d1['overriding'], [s_l2, d1])
    time.sleep(1.5)
    swipe(pg, 330, 600, 450)
    s_r2 = side(pg)
    time.sleep(0.5)
    d2 = helper.device()
    check('… rechts wischen: Lautstärke sichtbar und am Gerät', s_r2 and ' on' in s_r2[0] and ' r' in s_r2[0] and d2['vols'] >= 1, [s_r2, d2])
    names2 = [n for n, _ in settings(pg)]
    check('… Einstellungen mit „Helper-App“', 'Helper-App' in names2, names2)
    close_menu(pg)
    dl2 = dl_menu()
    check('… Download-Menü weiterhin ohne Helfer-Wege (Helfer-Downloads vorübergehend aus), Browser-Wege da', dl2 and 'Mit dem Helper' not in dl2 and 'Über den Browser laden' not in dl2, dl2)
    time.sleep(3.0)
    check('… Lebenszeichen erreichen das Gerät', helper.device()['beats'] > d2['beats'])
    pg.evaluate('() => %s.querySelector("button[aria-label=Schließen]").click()' % R)
    end = time.time() + 5
    while time.time() < end and helper.device()['overriding']: time.sleep(0.2)
    check('Player zu: Helligkeit sofort zurück (end)', not helper.device()['overriding'] and helper.device()['ends'] >= 1, helper.device())
    check('alter Klartext-Port 47811 nie angesprochen', not LEGACY_HITS, LEGACY_HITS)
    check('kein alter Schlüssel gespeichert', not sw.evaluate('async () => Object.keys(await chrome.storage.local.get(null)).filter(k => /helperKey/.test(k))'))
    check('keine Fehler der Seite', not errs, errs)
    ctx.close()
helper.stop()
shutdown()
done()
