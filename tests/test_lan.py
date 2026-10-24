# Schutz auf Netzwerk-Ebene (Chrome): Kadris eigene Anfragen (aus dem Hintergrund) erreichen nie das eigene Netz –
# auch nicht, wenn eine öffentliche Adresse dorthin WEITERLEITET (die Prüfung vor der Anfrage sieht nur die erste
# Adresse). Die Helfer-App auf 127.0.0.1:47811 bleibt erreichbar. „public.test“ zeigt im Test auf 127.0.0.1, gilt für
# Kadri aber als öffentliche Adresse.
import time
from common import *

with sync_playwright() as p:
    ctx, sw, udir = launch(p, extra_args=['--host-resolver-rules=MAP public.test 127.0.0.1'])
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    pg.goto(B + 'direct.html'); time.sleep(1.5)
    pub = 'http://public.test:%d/' % PORT
    # Regeln stehen (der Hintergrund setzt sie beim Start)
    rules = sw.evaluate('async () => (await chrome.declarativeNetRequest.getSessionRules()).map((r) => r.id)')
    check('Netzwerk-Regeln aktiv (Helfer erlaubt, eigenes Netz gesperrt)', 50 in rules and 51 in rules, rules)
    ok = sw.evaluate('async (u) => { try { const r = await fetch(u); return r.status; } catch (e) { return "Fehler"; } }', pub + 'direct.html')
    check('öffentliche Adresse: erreichbar', ok == 200, ok)
    del SECRET_HITS[:]
    red = sw.evaluate('async (u) => { try { const r = await fetch(u); return r.status; } catch (e) { return "gesperrt"; } }', pub + 'redir-lan')
    time.sleep(0.5)
    check('Weiterleitung ins eigene Netz: gesperrt, das Ziel wird gar nicht erreicht', red == 'gesperrt' and not SECRET_HITS, [red, list(SECRET_HITS)])
    direct = sw.evaluate('async (u) => { try { const r = await fetch(u); return r.status; } catch (e) { return "gesperrt"; } }', B + 'secret')
    check('direkt ins eigene Netz (ohne Erlaubnis): gesperrt', direct == 'gesperrt', direct)
    # Seite liegt selbst im eigenen Netz (wie ein Medienserver zu Hause): ihre eigenen Dateien lädt Kadri weiter
    open_player(pg, B + 'subs_page.html')
    pg.evaluate('() => { const r = %s; r.querySelector(".vp").classList.add("ctl"); r.querySelector("button[aria-label=Untertitel]").click(); }' % R)
    try: pg.wait_for_function('() => !Array.from(%s.querySelectorAll(".vmenu.on .vmi")).some(b => /Suche Untertitel/.test(b.textContent))' % R, timeout=12000)
    except Exception: pass
    time.sleep(0.3)
    m = pg.evaluate('() => Array.from(%s.querySelectorAll(".vmenu.on .vmi")).map(b => b.firstChild.textContent)' % R)
    check('Seite im eigenen Netz: deren Untertitel lädt Kadri trotzdem (Ausnahme nur für diese Adresse)', 'English' in m, m)
    ctx.close()
shutdown()
done()
