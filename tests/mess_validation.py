"""Desktop Chromium baseline measurement. Reports observations, no performance pass thresholds."""
import argparse, json, pathlib, statistics, time
from common import *

parser=argparse.ArgumentParser()
parser.add_argument('--label',required=True)
parser.add_argument('--output',required=True)
args=parser.parse_args()

class Stream(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_GET(self):
        if self.path.startswith('/large'):
            self.send_response(200); self.send_header('Content-Length',str(32*1024*1024)); self.end_headers()
            try:
                for _ in range(512): self.wfile.write(b'x'*65536); self.wfile.flush(); time.sleep(.002)
            except (BrokenPipeError,ConnectionResetError): pass
        else:
            self.send_response(200); self.send_header('Content-Length','2'); self.end_headers(); self.wfile.write(b'ok')
server=http.server.ThreadingHTTPServer(('127.0.0.1',PORT+3),Stream)
threading.Thread(target=server.serve_forever,daemon=True).start()
XHR="""o=>new Promise(resolve=>{const id=Math.random().toString(36),t=performance.now();
 const h=e=>{const d=e.data&&e.data.kadriTestRes;if(d&&d.id===id){removeEventListener('message',h);resolve({...d,ms:performance.now()-t});}};
 addEventListener('message',h);postMessage({kadriTestXhr:{...o,id}},'*');
 setTimeout(()=>resolve({error:'measurement deadline'}),60000);
})"""
out={'label':args.label,'environment':'desktop Chromium, mobile viewport; not Android hardware',
     'memory_note':'RSS sum double-counts shared pages; page JS heap excludes Blob/GPU/native memory',
     'battery':'not measured','cycles':[]}
try:
  with sync_playwright() as p:
    ctx,sw,_=launch(p,extra_args=['--host-resolver-rules=MAP *.test 127.0.0.1','--no-proxy-server'])
    pg=ctx.new_page(); page_cdp=ctx.new_cdp_session(pg)
    page_cdp.send('Performance.enable')
    root=ctx.browser.new_browser_cdp_session()
    def rss_cpu():
        processes=root.send('SystemInfo.getProcessInfo')['processInfo']
        rss=0
        for proc in processes:
            try:
                for line in pathlib.Path('/proc/%s/status'%proc['id']).read_text().splitlines():
                    if line.startswith('VmRSS:'): rss+=int(line.split()[1])*1024
            except (FileNotFoundError,PermissionError): pass
        return {'rss_sum_bytes':rss,'browser_cpu_seconds':sum(x['cpuTime'] for x in processes)}
    pg.add_init_script("""(()=>{window.__firstFrame=null;const seen=new WeakSet();
      new MutationObserver(()=>document.querySelectorAll('video').forEach(v=>{
        if(!seen.has(v)){seen.add(v);v.requestVideoFrameCallback(()=>{if(window.__firstFrame===null)window.__firstFrame=performance.now();});}
      })).observe(document,{childList:true,subtree:true});})();""")
    pg.goto('http://a.test:%d/direct.html'%PORT)
    pg.wait_for_function('window.__firstFrame!==null',timeout=20000)
    out['first_video_frame_ms']=pg.evaluate('window.__firstFrame')
    pg.evaluate('document.getElementById("v").muted=false')
    pg.wait_for_function('()=>{const h=document.querySelector("[data-kadri-test]");return h&&h.shadowRoot&&h.shadowRoot.querySelector("button[aria-label=\'Im Videoplayer öffnen\']");}')
    def cycle():
        before=pg.evaluate('document.getElementById("v").currentTime')
        start=time.perf_counter()
        pg.evaluate('()=>%s.querySelector("button[aria-label=\'Im Videoplayer öffnen\']").click()'%R)
        pg.wait_for_function('()=>{const v=%s.querySelector(".vv");return v&&!v.paused&&v.readyState>=2&&!%s.querySelector(".vbridge");}'%(R,R),timeout=20000)
        pg.evaluate('()=>new Promise(resolve=>%s.querySelector(".vv").requestVideoFrameCallback(()=>resolve()))'%R)
        elapsed=(time.perf_counter()-start)*1000
        position=pg.evaluate('()=>%s.querySelector(".vv").currentTime'%R)
        pg.evaluate('()=>%s.querySelector("button[aria-label=Schließen]").click()'%R)
        pg.wait_for_function('()=>!%s.querySelector(".vv")'%R,timeout=10000)
        page_cdp.send('HeapProfiler.collectGarbage')
        return {'handoff_frame_ms':elapsed,'position_before':before,'position_player':position,
                'retained_js_heap_bytes':page_cdp.send('Runtime.getHeapUsage')['usedSize'],**rss_cpu()}
    out['initial_process']=rss_cpu()
    for _ in range(8): out['cycles'].append(cycle())
    base='http://a.test:%d'%(PORT+3)
    pg.evaluate('(o)=>{window.__downloadsDone=false;window.__downloads=Promise.all(o.map(x=>(%s)(x))).then(x=>{window.__downloadsDone=true;return x;});return 1;}'%XHR,
      [{'url':base+'/large?a=1','responseType':'blob'},{'url':base+'/large?a=2','responseType':'blob'}])
    pg.wait_for_timeout(100)
    out['resolution_during_download']=pg.evaluate(XHR,{'url':base+'/resolve','timeout':4000,'kadriPurpose':'player-resolve','headers':{'Range':'bytes=0-1'}})
    samples=[]
    while not pg.evaluate('window.__downloadsDone'):
        samples.append(rss_cpu()); pg.wait_for_timeout(200)
    out['download_results']=pg.evaluate('window.__downloads')
    if not all(x.get('status')==200 for x in out['download_results']): raise RuntimeError('Download failed')
    if out['resolution_during_download'].get('status')!=200: raise RuntimeError('Resolution failed')
    out['download_peak_sampled_rss_bytes']=max((x['rss_sum_bytes'] for x in samples),default=None)
    out['download_memory_samples']=len(samples)
    a=page_cdp.send('Performance.getMetrics'); c=rss_cpu(); start=time.perf_counter()
    pg.wait_for_timeout(3000)
    z=page_cdp.send('Performance.getMetrics'); end=rss_cpu()
    metrics=lambda x:{m['name']:m['value'] for m in x['metrics']}
    out['idle_window_seconds']=time.perf_counter()-start
    out['idle_page_task_seconds']=metrics(z)['TaskDuration']-metrics(a)['TaskDuration']
    out['idle_browser_cpu_seconds']=end['browser_cpu_seconds']-c['browser_cpu_seconds']
    out['browser_version']=ctx.browser.version
    ctx.close()
finally:
    server.shutdown(); shutdown()
with open(args.output,'a') as f: f.write(json.dumps(out)+'\n')
print(json.dumps(out))
