# Angriffs-Test (Kadri 1.11): Was eine böse Webseite (oder eingebettete Werbung) versuchen könnte – nichts davon darf
# wirken:
#  1. Werbung im eingebetteten Fenster tut so, als wäre sie der Player („mach mich groß / Vollbild“) – nach einem Tipp,
#     mit geratenen Schlüsseln. Und fragt nach Titel/Adresse der Seite.
#  2. Programmcode im Titel der Seite oder des Videos (XSS) – darf im Player nur als Text erscheinen.
#  3. Gefälschte Mitlese-Meldungen: riesig (Speicher/Rechenzeit), unsinnig, mit javascript:-Adressen.
#  4. Falsche Koppel-Seite der Helfer-App auf einer anderen Adresse.
import time, json
from common import *

with sync_playwright() as p:
    ctx, sw, udir = launch(p)
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(B + 'attack.html'); time.sleep(2.0)
    ad = [f for f in pg.frames if f.url.endswith('ad.html')][0]
    # 1) Werbung tippen lassen
    box = pg.evaluate('() => { const r = document.getElementById("ad").getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }')
    pg.mouse.click(box[0] + 50, box[1] + 40); time.sleep(1.0)
    after = pg.evaluate('() => { const f = document.getElementById("ad"), r = f.getBoundingClientRect(); return [Math.round(r.height), getComputedStyle(f).position, !!document.fullscreenElement]; }')
    got = ad.evaluate('() => window.__got || []')
    check('Werbung kann sich nicht als Player groß/Vollbild machen (auch nach Tipp, mit geratenem Schlüssel)', after[0] == 120 and after[1] != 'fixed' and not after[2], after)
    check('… und bekommt keine Angaben der Seite (Titel, Adresse)', not got, got)
    # 2) XSS über Titel: Player öffnen, Titel wird nur als Text gezeigt
    pg.evaluate('() => { document.getElementById("v").muted = false; }'); time.sleep(1.0)
    pg.wait_for_function('() => { const h = document.querySelector("[data-kadri-test]"); return h && h.shadowRoot.querySelector("button[aria-label=\'Im Videoplayer öffnen\']"); }', timeout=15000)
    pg.evaluate('() => %s.querySelector("button[aria-label=\'Im Videoplayer öffnen\']").click()' % R)
    pg.wait_for_function('() => { const v = %s.querySelector(".vv"); return v && v.currentTime > 0.3; }' % R, timeout=20000)
    time.sleep(0.8)
    x = pg.evaluate('() => { const r = %s; return [window.__xss || 0, r.querySelectorAll("img,script,iframe").length, (r.querySelector(".vtitle") || {}).textContent || ""]; }' % R)
    check('Programmcode im Titel: läuft nicht, nur Text im Player', x[0] == 0 and x[1] == 0 and '<img' in x[2], x)
    pg.evaluate('() => %s.querySelector("button[aria-label=Schließen]").click()' % R); time.sleep(0.6)
    # 3) gefälschte Mitlese-Meldungen
    t0 = time.time()
    pg.evaluate('''() => { const big = "x".repeat(30e6);
        document.dispatchEvent(new CustomEvent("kadri-net", { detail: big }));
        document.dispatchEvent(new CustomEvent("kadri-net", { detail: JSON.stringify({ k: "pl", u: "https://a.b/x.m3u8", f: "", t: "#EXTM3U\\n" + "#EXT-X-STREAM-INF:BANDWIDTH=1\\n".repeat(150000) }) }));
        document.dispatchEvent(new CustomEvent("kadri-net", { detail: JSON.stringify({ k: "src", u: "javascript:alert(1)", f: "m3u8", t: "" }) }));
        document.dispatchEvent(new CustomEvent("kadri-net", { detail: "{kaputt" }));
        document.dispatchEvent(new CustomEvent("kadri-net", { detail: { k: "pl" } }));
        document.dispatchEvent(new Event("kadri-hello")); document.dispatchEvent(new Event("kadri-vis")); }''')
    dt = time.time() - t0
    check('gefälschte Meldungen (30 MB, 150 000 Zeilen, javascript:, kaputt): kein Hänger (%.1f s), keine Fehler' % dt, dt < 3 and not errs, [round(dt, 2), errs])
    # danach funktioniert Kadri normal weiter
    open_player(pg, B + 'direct.html')
    ok = pg.evaluate('() => { const v = %s.querySelector(".vv"); return v.currentSrc.split("/").pop(); }' % R)
    check('… danach spielt Kadri normal (eigene Datei)', ok == 'clip.webm', ok)
    # 4) falsche Koppel-Seite
    pg.goto(B + 'pair.html#evil-key-123'); time.sleep(1.5)
    key = sw.evaluate('async () => (await chrome.storage.local.get("gm:helperKey"))["gm:helperKey"] || ""')
    check('falsche Koppel-Seite (andere Adresse): Schlüssel wird nicht übernommen', key != 'evil-key-123', key)
    # 5) Schlüssel-Diebstahl: Seite A liest den Schlüssel ihres Kadri-Fensters mit – Werbung auf Seite B benutzt ihn
    pg.goto(B + 'steal.html'); time.sleep(3.0)
    keys = pg.evaluate('() => window.__keys')
    pg.goto(B.replace('127.0.0.1', 'localhost') + 'victim.html?k=' + (keys[0] if keys else ''))
    time.sleep(2.0)
    vb = pg.evaluate('() => { const r = document.getElementById("ad").getBoundingClientRect(); return [r.left, r.top]; }')
    pg.mouse.click(vb[0] + 50, vb[1] + 40); time.sleep(1.0)
    ad2 = [f for f in pg.frames if 'ad_key.html' in f.url][0]
    st5 = pg.evaluate('() => { const f = document.getElementById("ad"), r = f.getBoundingClientRect(); return [Math.round(r.height), getComputedStyle(f).position, !!document.fullscreenElement]; }')
    got5 = ad2.evaluate('() => (window.__got || []).filter((d) => d.t === "pageurl" || d.t === "state")')
    check('gestohlener Schlüssel von Seite A hilft auf Seite B nicht (kein Vergrößern, keine Adresse)', keys and st5[0] == 120 and st5[1] != 'fixed' and not st5[2] and not got5, [len(keys), st5, got5])
    check('keine Fehler der Seite', not errs, errs)
    ctx.close()
shutdown()
done()
