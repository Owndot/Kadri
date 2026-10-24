'use strict';
// Runs actual background source against a deterministic DNR/fetch model.
// This tests lifecycle isolation, not Chrome's implementation of DNR.
async function runHeaderTests(source, runtime) {
  const { URL, AbortController, setTimeout, clearTimeout } = runtime;
  const assert = (v, m) => { if (!v) throw new Error(m); };
  const tick = async () => { for (let i=0;i<60;i++) await Promise.resolve(); };
  const deferred = () => { let resolve; const promise = new Promise(r=>{resolve=r;}); return {promise,resolve}; };
  const output=[];
  function setup(initial=[], failing=false) {
    const rules=new Map(initial.map(r=>[r.id,r])), calls=[];
    let connect, hold=null, body=null, failCleanup=false, stalled=null;
    const event=()=>({addListener(){}});
    const chrome={runtime:{id:'test',onConnect:{addListener(f){connect=f;}},onMessage:event()},
      action:{onClicked:event()},declarativeNetRequest:{
        async getSessionRules(){return [...rules.values()];},
        async updateSessionRules(o){
          if(failing || (failCleanup && (o.removeRuleIds||[]).some(id=>id>=1000) && !(o.addRules||[]).length)) throw new Error('DNR failure');
          for(const id of o.removeRuleIds||[]) rules.delete(id);
          for(const r of o.addRules||[]) rules.set(r.id,r);
        }
      }};
    const fetch=async(u,o)=>{
      const call={u,o,headers:null}; calls.push(call);
      if(hold && u.includes('/hold')) { const h=hold; stalled=h; await h.promise; if(o.signal.aborted) throw new Error('abort'); }
      const target=u.includes('/redirect-lan')?'http://127.0.0.1:8790/hold':u.includes('/redirect-b')?'https://b.test/check':u;
      const matches=[...rules.values()].filter(r=>r.condition.regexFilter && new RegExp(r.condition.regexFilter).test(target));
      matches.sort((a,b)=>b.priority-a.priority);
      if(matches[0]?.action.type==='block') throw new Error('blocked');
      const strip=rules.get(80), domain=new URL(target).hostname;
      const exempt=strip?.condition.excludedRequestDomains?.some(d=>domain===d || domain.endsWith('.'+d));
      call.headers={cookie:o.credentials==='include' && exempt?'cookie':'',auth:exempt?(o.headers.Authorization||''):''};
      if(target.includes('127.0.0.1') && target!==u) call.localReached=true;
      return {status:200,statusText:'OK',url:target,headers:new Map(),text:()=>body?body.promise:Promise.resolve('ok')};
    };
    const pslBase=h=>h;
    new Function('chrome','fetch','URL','AbortController','setTimeout','clearTimeout','importScripts','pslBase','globalThis',source)
      (chrome,fetch,URL,AbortController,setTimeout,clearTimeout,()=>{},pslBase,{chrome});
    function req(from,url,extra={}) {
      const end=deferred(),messages=[];let listener,disconnect;
      connect({name:'kadri-xhr',sender:{url:from},onMessage:{addListener(f){listener=f;}},onDisconnect:{addListener(f){disconnect=f;}},
        postMessage(m){messages.push(m);if(m.t==='done'||m.t==='error')end.resolve(m);}});
      listener({t:'req',url,headers:{Authorization:'test-auth'},...extra});
      return {done:end.promise,messages,abort(){listener({t:'abort'});},disconnect(){disconnect();}};
    }
    return {rules,calls,req,setHold(d){hold=d;},setBody(d){body=d;},failCleanup(){failCleanup=true;}};
  }
  {
    const h=setup(),d=deferred();h.setHold(d);await tick();
    const a=h.req('http://127.0.0.1:8790/page','http://127.0.0.1:8790/hold');await tick();
    const b=h.req('https://a.test/page','https://a.test/redirect-lan');await tick();
    assert(h.calls.length===1,'same URL: foreign fetch entered active grant');
    d.resolve();await a.done;await b.done;
    assert(!h.calls.some(c=>c.localReached),'same URL redirect reached local server');
    output.push('same URL parallel redirect isolated');
  }
  {
    const h=setup(),d=deferred();h.setHold(d);await tick();
    const b=h.req('https://b.test/page','https://b.test/hold');await tick();
    const a=h.req('https://a.test/page','https://a.test/redirect-b');await tick();
    assert(h.calls.length===1,'credential contexts overlapped');
    d.resolve();await b.done;await a.done;
    assert(h.calls[1].headers.cookie===''&&h.calls[1].headers.auth==='','foreign credentials retained');
    output.push('parallel B credentials do not authorize A redirect');
  }
  {
    const h=setup(),d=deferred();h.setBody(d);await tick();
    const a=h.req('https://a.test/page','https://a.test/large');await tick();
    const b=h.req('https://b.test/page','https://b.test/large');await tick();
    assert(h.calls.length===2,'body consumption blocks next request');
    assert(!(h.rules.get(80).condition.excludedRequestDomains||[]).length,'body retains grants');
    d.resolve('large body stand-in');await a.done;await b.done;
    output.push('bodies run concurrently after grants removed');
  }
  {
    const h=setup(),d=deferred();h.setHold(d);await tick();
    const a=h.req('https://a.test/page','https://a.test/hold');await tick();
    const b=h.req('https://b.test/page','https://b.test/check');b.abort();await tick();
    assert((await b.done).t==='error','queued abort missing');
    const helper=h.req('https://a.test/page','http://127.0.0.1:47811/ping');await helper.done;
    assert(h.calls.at(-1).o.redirect==='error','helper followed redirect');
    d.resolve();await a.done;
    assert(!h.calls.some(c=>c.u==='https://b.test/check'),'aborted queue fetched');
    output.push('queued abort removed; helper bypass remains responsive');
  }
  {
    const h=setup([{id:1007,priority:20,action:{type:'allow'},condition:{regexFilter:'.*'}}]);await tick();
    assert(!h.rules.has(1007),'restart retains orphan grant');
    const a=h.req('https://a.test/page','https://a.test/check');await a.done;
    output.push('worker startup purges orphaned session grant');
  }
  {
    const h=setup(),d=deferred();h.setHold(d);await tick();
    const a=h.req('http://127.0.0.1:8790/page','http://127.0.0.1:8790/hold');await tick();
    const b=h.req('https://b.test/page','https://b.test/check');h.failCleanup();d.resolve();
    await a.done;await b.done;await tick();
    assert(h.calls.length===1,'cleanup failure allowed queued fetch');
    output.push('cleanup failure closes queue');
  }
  {
    const h=setup([],true);await tick();
    const a=h.req('https://a.test/page','https://a.test/check');await a.done;
    assert(h.calls.length===0,'initialization failure fetched');
    output.push('initialization failure is closed');
  }
  {
    const h=setup(),d=deferred();h.setHold(d);await tick();
    const a=h.req('https://a.test/page','https://a.test/hold');await tick();
    const b=h.req('https://b.test/page','https://b.test/check',{timeout:1});
    const r=await b.done; assert(r.t==='error' && r.timeout,'queued deadline not enforced');
    const c=h.req('https://c.test/page','https://c.test/check');c.disconnect();await tick();
    d.resolve();await a.done;await tick();
    assert(!h.calls.some(x=>/b.test|c.test/.test(x.u)),'cancelled queue reached network');
    output.push('queue timeout and disconnect do not reach network');
  }
  return output;
}
if (typeof module !== 'undefined') {
  module.exports=runHeaderTests;
  if(require.main===module) {
    const fs=require('fs'),path=require('path');
    runHeaderTests(fs.readFileSync(path.join(__dirname,'../chrome/background.js'),'utf8'),
      {URL,AbortController,setTimeout,clearTimeout}).then(xs=>xs.forEach(x=>console.log('OK   '+x)),
      e=>{console.error(e);process.exitCode=1;});
  }
}
