# Real worker termination, persisted DNR session grants and fresh request isolation.
import time
from common import *

XHR = """o=>new Promise(resolve=>{
 const id=Math.random().toString(36), h=e=>{const d=e.data&&e.data.kadriTestRes;
 if(d&&d.id===id){removeEventListener('message',h);resolve(d);}};
 addEventListener('message',h);postMessage({kadriTestXhr:{...o,id}},'*');
 setTimeout(()=>resolve({error:'harness deadline'}),15000);
})"""
with sync_playwright() as p:
    ctx, sw, _ = launch(p, extra_args=['--host-resolver-rules=MAP *.test 127.0.0.1','--no-proxy-server'])
    public=ctx.new_page(); public.goto('http://a.test:%d/direct.html' % PORT)
    local=ctx.new_page(); local.goto(B+'direct.html'); time.sleep(1)
    cdp=ctx.new_cdp_session(public)
    versions=[]
    cdp.on('ServiceWorker.workerVersionUpdated', lambda event: versions.extend(event.get('versions',[])))
    root_cdp=ctx.browser.new_browser_cdp_session()
    old_targets={t['targetId'] for t in root_cdp.send('Target.getTargets')['targetInfos'] if t.get('type')=='service_worker' and t.get('url')==sw.url}
    cdp.send('ServiceWorker.enable')
    for _ in range(100):
        if any(v.get('scriptURL')==sw.url and v.get('status')=='activated' for v in versions): break
        public.wait_for_timeout(50)
    candidates=[v for v in versions if v.get('scriptURL')==sw.url and v.get('status')=='activated']
    if not candidates: raise RuntimeError('CDP did not expose the extension worker; restart not tested')
    gate=threading.Event(); HEADER_BARRIERS['worker-restart']=gate
    url=B+'slow?tag=worker-restart'
    local.evaluate('(o)=>{window.pending=(%s)(o);return 1;}' % XHR, {'url':url})
    for _ in range(100):
        if any(x['tag']=='worker-restart' for x in HDR_HITS): break
        public.wait_for_timeout(20)
    check('request active before worker termination',sum(x['tag']=='worker-restart' for x in HDR_HITS)==1)
    rules=sw.evaluate('()=>chrome.declarativeNetRequest.getSessionRules()')
    check('temporary grant installed before termination',any(r['id']>=1000 for r in rules))
    cdp.send('ServiceWorker.stopWorker',{'versionId':candidates[-1]['versionId']})
    gate.set()
    result=public.evaluate(XHR,{'url':'http://a.test:%d/redir?to=' % PORT + urllib.parse.quote(url)})
    check('foreign redirect after worker restart is blocked','error' in result,result)
    check('foreign request did not reach former grant',sum(x['tag']=='worker-restart' for x in HDR_HITS)==1,HDR_HITS)
    new_targets={t['targetId'] for t in root_cdp.send('Target.getTargets')['targetInfos'] if t.get('type')=='service_worker' and t.get('url')==sw.url}
    check('worker target replaced by real restart',bool(new_targets) and not (old_targets & new_targets),[list(old_targets),list(new_targets)])
    sw2=next((w for w in ctx.service_workers if w.url==sw.url),None)
    if sw2 is None:
        sw2=ctx.wait_for_event('serviceworker',timeout=10000)
    rules=sw2.evaluate('()=>chrome.declarativeNetRequest.getSessionRules()')
    check('orphan grants removed after real restart',not any(r['id']>=1000 for r in rules),rules)
    strip=next(r for r in rules if r['id']==80)
    check('credential exemptions absent after real restart',not strip['condition'].get('excludedRequestDomains'),strip)
    r=public.evaluate(XHR,{'url':'http://a.test:%d/hdr?tag=after-restart' % PORT})
    check('normal requests work after restart',r.get('status')==200,r)
    root_cdp.detach(); cdp.detach(); ctx.close()
shutdown()
done()
