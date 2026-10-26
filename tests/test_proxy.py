# „Über den Browser laden“ (mit Helfer-App): Der Helfer verlangt Stücke einer Datei, Kadri lädt sie mit der Sitzung des
# Browsers und schickt sie zurück. Geprüft wird Byte für Byte: Kommen genau die Daten der Datei an? (Früher kam in
# Kadri der Text „[object ArrayBuffer]“ an.)
import time, os
from common import *

with sync_playwright() as p:
    ctx, sw, udir = launch(p)
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    helper['on'] = True; helper['key'] = '11112222333344445555666677778888'
    sw.evaluate('(key) => chrome.storage.local.set({"gm:helperKey":key})', helper['key'])
    data = open(os.path.join(WEB, 'clip.webm'), 'rb').read()
    helper['pulls'] = [{'reqs': [{'id': 1, 'u': B + 'clip.webm', 'o': 0, 'l': 70000}, {'id': 2, 'u': B + 'clip.webm', 'o': 100000, 'l': 50000}]}]
    open_player(pg, B + 'direct.html')
    pg.evaluate('() => %s.querySelector(".vp").classList.add("ctl")' % R); time.sleep(0.3)
    pg.evaluate('() => %s.querySelector("button[aria-label^=Herunterladen]").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))' % R); time.sleep(0.5)
    ok = pg.evaluate('() => { const b = Array.from(%s.querySelectorAll(".vmenu.on .vmi")).find(b => b.firstChild.textContent.startsWith("Über den Browser")); if (b) b.click(); return !!b; }' % R)
    check('Menü „Über den Browser laden“ da', ok, ok)
    for i in range(40):
        if len(helper['pushed']) >= 2: break
        time.sleep(0.25)
    got = {x[0]: x for x in helper['pushed']}
    a, b = got.get('1'), got.get('2')
    check('Stück 1 (70 000 Bytes ab 0): genau die Bytes der Datei', a and a[1] == '206' and a[2] == data[0:70000], [a and a[1], a and len(a[2]), a and a[2][:20]])
    check('Stück 2 (50 000 Bytes ab 100 000): genau die Bytes der Datei', b and b[2] == data[100000:150000], [b and b[1], b and len(b[2])])
    # Download ohne Helfer-App: Kadri lädt die Datei als Blob (aus den Stücken zusammengesetzt) – genau die Bytes?
    pg.evaluate('() => %s.querySelector("button[aria-label=Schließen]").click()' % R); time.sleep(1.0)
    helper['on'] = False
    open_player(pg, B + 'direct.html')
    pg.evaluate('() => %s.querySelector(".vp").classList.add("ctl")' % R); time.sleep(0.3)
    got = None
    try:
        with pg.expect_download(timeout=20000) as dl:
            pg.evaluate('() => %s.querySelector("button[aria-label^=Herunterladen]").click()' % R)
        got = open(dl.value.path(), 'rb').read()
    except Exception as e: got = str(e)[:200]
    check('Download ohne Helfer: genau die Datei (Blob)', got == data, [len(got) if isinstance(got, bytes) else got, len(data)])
    ctx.close()
shutdown()
done()
