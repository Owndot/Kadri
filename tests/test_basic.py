# Grundfunktionen der Erweiterung: lädt auf jeder Seite, Knopf am Video, eigener Player (Datei und Stream über das
# mitgelieferte hls.js), Diagnose über das Kadri-Symbol, Einstellungen bleiben über Neuladen hinweg gespeichert.
import time
from common import *

with sync_playwright() as p:
    ctx, sw, udir = launch(p)
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    # 1) Datei-Video
    open_player(pg, B + 'direct.html')
    st = pg.evaluate('() => { const v = %s.querySelector(".vv"), o = document.getElementById("v"); return [v.currentSrc.split("/").pop(), v.paused, o.paused]; }' % R)
    check('Datei: eigener Player spielt die Datei, Seitenvideo angehalten', st[0] == 'clip.webm' and not st[1] and st[2], st)
    # 2) Stream (HLS) – hls.js kommt aus der Erweiterung
    pg.evaluate('() => %s.querySelector("button[aria-label=Schließen]").click()' % R); time.sleep(0.8)
    open_player(pg, B + 'hls.html')
    hs = pg.evaluate('() => { const v = %s.querySelector(".vv"); return [v.currentSrc.slice(0, 5), Math.round(v.duration)]; }' % R)
    check('Stream: Player spielt über hls.js der Erweiterung', hs[0] == 'blob:' and hs[1] == 60, hs)
    # 3) Diagnose über das Kadri-Symbol (Nachricht vom Hintergrund an die Seite)
    sw.evaluate('''async () => { const [t] = await chrome.tabs.query({ active: true }); await chrome.tabs.sendMessage(t.id, { t: 'kadri-menu' }, { frameId: 0 }); }''')
    time.sleep(0.8)
    dg = pg.evaluate('() => { const r = %s; const box = r.querySelector("textarea"); const head = Array.from(r.querySelectorAll("div")).map(d => d.textContent).find(t => /Diagnose$/.test(t)); return [head || "", box ? box.value.split("\\n")[0] : ""]; }' % R)
    check('Diagnose über das Kadri-Symbol: Fenster offen, beim Öffnen nur die ANONYMISIERTE Fassung im Feld (mit Version)',
          dg[0].endswith('Diagnose') and dg[1].startswith('Kadri – anonymisierte Diagnose · Kadri 1.'), dg)
    full0 = pg.evaluate('() => { const r = %s; const box = r.querySelector("textarea"); return box ? box.value : ""; }' % R)
    check('… vor der ausdrücklichen Auswahl keine Adresse der Seite im Feld', '://' not in full0 and 'direct.html' not in full0 and '127.0.0.1' not in full0, full0[:300])
    pg.evaluate('() => { const r = %s; r.querySelector(".diag .dfull").click(); }' % R)
    time.sleep(0.4)
    full1 = pg.evaluate('() => { const r = %s; const box = r.querySelector("textarea"); return box ? box.value : ""; }' % R)
    check('… „Vollständige Diagnose kopieren (mit Adressen)“ zeigt erst dann die vollständige Fassung (Version zuerst)', full1.startswith('Kadri 1.'), full1[:120])
    pg.evaluate('() => { const r = %s; const b = Array.from(r.querySelectorAll(".diag button")).find((x) => x.textContent === "Schließen"); if (b) b.click(); }' % R)
    pg.goto(B + 'direct.html'); time.sleep(0.5)
    # 4) Einstellung ändern → nach dem Neuladen noch da (Speicher der Erweiterung)
    open_player(pg, B + 'direct.html')
    s0 = dict(settings(pg))
    pick(pg, 'Sprungweite'); time.sleep(0.3)
    s1 = dict(pg.evaluate('() => Array.from(%s.querySelectorAll(".vmenu.on .vmi")).map(b => [b.firstChild.textContent, b.querySelector("small") ? b.querySelector("small").textContent : ""])' % R))
    stored = sw.evaluate('async () => (await chrome.storage.local.get("gm:settings"))["gm:settings"]')
    pg.reload(); time.sleep(0.5)
    open_player(pg, B + 'direct.html')
    s2 = dict(settings(pg))
    check('Einstellung bleibt gespeichert (auch nach Neuladen)', s1.get('Sprungweite') != s0.get('Sprungweite') and s2.get('Sprungweite') == s1.get('Sprungweite') and stored and 'skipSeconds' in stored, [s0.get('Sprungweite'), s1.get('Sprungweite'), s2.get('Sprungweite'), stored])
    close_menu(pg)
    check('keine Fehler der Seite', not errs, errs)
    ctx.close()
shutdown()
done()
