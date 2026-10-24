# Actual Chrome fetch aborts via the test-only bridge.
import time
from common import *
hits=[]
header_started=threading.Event();release_headers=threading.Event()
body_started=threading.Event();release_body=threading.Event()
timeout_started=threading.Event();release_timeout=threading.Event()
class AbortServer(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        hits.append(self.path)
        if self.path=='/timeout':timeout_started.set();release_timeout.wait(30)
        if self.path=='/hold':header_started.set();release_headers.wait(10)
        self.send_response(200);self.send_header('Content-Length','131072' if self.path=='/body' else '2');self.end_headers()
        try:
            if self.path=='/body':
                self.wfile.write(b'x'*65536);self.wfile.flush();body_started.set()
                release_body.wait(10);self.wfile.write(b'x'*65536)
            else:self.wfile.write(b'ok')
        except (BrokenPipeError,ConnectionResetError):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',PORT+4),AbortServer)
threading.Thread(target=server.serve_forever,daemon=True).start()
def begin(pg,id,url,**extra):
    pg.evaluate("""o=>{window.__abortResults=window.__abortResults||{};
      if(!window.__abortListener){window.__abortListener=true;addEventListener('message',e=>{
      const d=e.data&&e.data.kadriTestRes;if(d)window.__abortResults[d.id]=d;});}
      postMessage({kadriTestXhr:o},'*');}""",{'id':id,'url':url,**extra})
def result(pg,id,timeout=10000):
    pg.wait_for_function('id=>!!window.__abortResults[id]',arg=id,timeout=timeout)
    return pg.evaluate('id=>window.__abortResults[id]',id)
def abort(pg,id):pg.evaluate("id=>postMessage({kadriTestAbort:id},'*')",id)
try:
  with sync_playwright() as p:
    ctx,sw,_=launch(p,extra_args=['--host-resolver-rules=MAP *.test 127.0.0.1','--no-proxy-server'])
    pg=ctx.new_page();pg.goto('http://a.test:%d/direct.html'%PORT);time.sleep(1)
    base='http://a.test:%d'%(PORT+4)
    begin(pg,'active',base+'/hold')
    check('native header request started',header_started.wait(5))
    begin(pg,'queued',base+'/queued');abort(pg,'queued')
    check('queued abort callback',result(pg,'queued').get('error')=='aborted')
    abort(pg,'active')
    check('header abort callback',result(pg,'active').get('error')=='aborted')
    begin(pg,'probe',base+'/probe')
    check('next request proceeds before held headers released',result(pg,'probe').get('status')==200)
    check('aborted queued request never reached server','/queued' not in hits,hits)
    release_headers.set()
    begin(pg,'body',base+'/body',responseType='blob')
    check('response body started',body_started.wait(5))
    for _ in range(100):
        rules=sw.evaluate('()=>chrome.declarativeNetRequest.getSessionRules()')
        strip=next(r for r in rules if r['id']==80)
        if not strip['condition'].get('excludedRequestDomains'):break
        pg.wait_for_timeout(20)
    check('header grants removed before body abort',not strip['condition'].get('excludedRequestDomains'))
    abort(pg,'body')
    check('body abort callback',result(pg,'body').get('error')=='aborted')
    begin(pg,'after',base+'/after')
    check('request works after body abort',result(pg,'after').get('status')==200)
    release_body.set()
    # Real unmodified 15-second header deadline, even with unlimited caller/body timeout.
    begin(pg,'native-header-timeout',base+'/timeout',timeout=0)
    check('native timeout server holds headers',timeout_started.wait(5))
    timed=result(pg,'native-header-timeout',timeout=25000)
    check('native header deadline fires before server response',
          timed.get('error')=='timeout' and not release_timeout.is_set(),timed)
    begin(pg,'after-native-timeout',base+'/after-timeout')
    check('header timeout cleans ownership and allows next request',
          result(pg,'after-native-timeout').get('status')==200)
    release_timeout.set();ctx.close()
finally:
    release_headers.set();release_body.set();release_timeout.set();server.shutdown();shutdown()
done()
