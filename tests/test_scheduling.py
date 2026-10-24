# Real Chromium extension test. No external services or release writes.
import time
from common import *

PORT2 = PORT + 3
started = [threading.Event(), threading.Event()]
release_bodies = threading.Event()
hold_started = threading.Event()
release_headers = threading.Event()

class SchedulingServer(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/hold':
            hold_started.set()
            if not release_headers.wait(10): self.send_error(504); return
        download = path.startswith('/download')
        payload = b'x' * (1024 * 1024) if download else b'ok'
        self.send_response(200)
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        if download:
            started[int(path[-1])].set()
            if not release_bodies.wait(30): return
        try: self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError): pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT2), SchedulingServer)
threading.Thread(target=server.serve_forever, daemon=True).start()
XHR = """o => new Promise(resolve => {
 const id = Math.random().toString(36), begin=performance.now();
 const h=e=>{const d=e.data&&e.data.kadriTestRes;if(d&&d.id===id){
 removeEventListener('message',h);resolve({...d,elapsed:performance.now()-begin});}};
 addEventListener('message',h);postMessage({kadriTestXhr:{...o,id}},'*');
 setTimeout(()=>{removeEventListener('message',h);resolve({error:'harness timeout'});},20000);
})"""
try:
    with sync_playwright() as p:
        ctx, sw, _ = launch(p, extra_args=['--host-resolver-rules=MAP *.test 127.0.0.1', '--no-proxy-server'])
        pg = ctx.new_page()
        pg.goto('http://a.test:%d/direct.html' % PORT)
        time.sleep(1)
        base = 'http://a.test:%d' % PORT2
        pg.evaluate('(o)=>{window.d0=(%s)(o);return 1;}' % XHR, {'url':base+'/download0','responseType':'blob'})
        check('first body pending', started[0].wait(5))
        pg.evaluate('(o)=>{window.d1=(%s)(o);return 1;}' % XHR, {'url':base+'/download1','responseType':'blob'})
        check('second body starts before first body released', started[1].wait(5))
        result = pg.evaluate(XHR, {'url':base+'/resolve','headers':{'Range':'bytes=0-1'},
                                  'timeout':4000,'kadriPurpose':'player-resolve'})
        check('player resolution succeeds while two downloads wait', result.get('status') == 200, result)
        print('MEASUREMENT resolution_with_two_pending_bodies_ms', result.get('elapsed'), flush=True)

        # Measure actual player handoff while background download bodies remain pending.
        video = ctx.new_page()
        video.goto('http://a.test:%d/direct.html' % PORT)
        video.wait_for_function('document.getElementById("v").currentTime > 0.8')
        video.evaluate('document.getElementById("v").muted=false')
        video.wait_for_function('''() => { const h=document.querySelector("[data-kadri-test]");
          return h&&h.shadowRoot&&h.shadowRoot.querySelector("button[aria-label='Im Videoplayer öffnen']"); }''')
        begin = time.perf_counter()
        video.evaluate('() => %s.querySelector("button[aria-label=\'Im Videoplayer öffnen\']").click()' % R)
        video.wait_for_function('() => { const v=%s.querySelector(".vv"); return v&&!v.paused&&v.readyState>=2; }' % R, timeout=25000)
        print('MEASUREMENT player_handoff_with_downloads_ms', round((time.perf_counter()-begin)*1000), flush=True)
        check('player plays while background downloads remain pending', not release_bodies.is_set())
        release_bodies.set()
        downloads = pg.evaluate('() => Promise.all([window.d0,window.d1])')
        check('both real downloads finish', all(r.get('status') == 200 for r in downloads), downloads)

        # Demonstrate queue waiting behind active headers, with explicit release.
        pg.evaluate('(o)=>{window.held=(%s)(o);return 1;}' % XHR, {'url':base+'/hold'})
        check('slow headers active', hold_started.wait(5))
        pg.evaluate('(o)=>{window.resolution=(%s)(o);return 1;}' % XHR,
                    {'url':base+'/resolve','timeout':4000,'kadriPurpose':'player-resolve'})
        release_headers.set()
        r = pg.evaluate('() => window.resolution')
        check('resolution after slow-header release', r.get('status') == 200, r)
        print('MEASUREMENT queued_resolution_ms', r.get('elapsed'), flush=True)
        ctx.close()
finally:
    release_bodies.set()
    release_headers.set()
    server.shutdown()
    shutdown()
done()
