# Real Chromium extension + controlled HTTP Helper; no Android/OEM claims.
# Keep both video documents alive while a separate tab re-pairs.
from common import *
OLD = '0123456789abcdef0123456789abcdef'
NEW = 'abcdef0123456789abcdef0123456789'

def require(name, condition):
    check(name, condition)
    assert condition, name

def until(page, predicate, message, seconds=8):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        if predicate(): return
        page.wait_for_timeout(100)
    raise AssertionError(message)

with sync_playwright() as p:
    helper.update(on=True,key=OLD)
    ctx,sw,profile=launch(p)
    try:
        sw.evaluate('(key)=>chrome.storage.local.set({"gm:helperKey":key})',OLD)
        a=ctx.new_page();open_player(a,B+'direct.html')
        a.evaluate('window.repairDocumentMarker="original-a"')
        b=ctx.new_page();open_player(b,B+'direct.html')
        b.evaluate('window.repairDocumentMarker="original-b"')
        require('Initial synthetic key used', any(c[2]==OLD for c in hcalls('/ping')))
        helper['key']=NEW
        pair=ctx.new_page();pair.goto('http://127.0.0.1:47811/pair#'+NEW)
        pair.wait_for_function('document.getElementById("evp-pair").textContent.includes("Verbunden")')
        require('New key persisted after pairing', sw.evaluate('async()=> (await chrome.storage.local.get("gm:helperKey"))["gm:helperKey"]')==NEW)
        require('Pairing fragment removed', '#' not in pair.url)
        for page,marker in ((a,'original-a'),(b,'original-b')):
            page.bring_to_front();helper['calls'].clear()
            until(page,lambda:any(c[2]==NEW for c in hcalls('/beat')),'existing tab kept stale key after re-pairing')
            check('Existing tab heartbeat uses new key', True)
            swipe(page,330,600,450)
            until(page,lambda:any(c[2]==NEW for c in hcalls('/vol')),'Gesture used stale key after re-pairing')
            check('Existing tab gesture uses new key', True)
            require('Video document stayed loaded', page.evaluate('window.repairDocumentMarker')==marker)
        print('PASS: real extension re-pairs two existing video documents; heartbeat and gestures recover without reload',flush=True)
        pair.close()
    finally:
        ctx.close()
    # A browser-process restart retains the newly paired identity.
    ctx,sw,_=launch(p,user_dir=profile)
    try:
        helper['calls'].clear();page=ctx.new_page();open_player(page,B+'direct.html')
        require('Browser restart retains stored pairing', any(c[2]==NEW for c in hcalls('/ping')))
        print('PASS: real Chromium persistent profile retains new pairing after browser restart',flush=True)
    finally:ctx.close()
shutdown()
done()
assert all(results), 'Pairing regression failed'
