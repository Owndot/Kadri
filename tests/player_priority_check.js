'use strict';
// Actual finalUrlGM -> actual Chrome prelude -> actual background/header queue.
// DNR/fetch are deterministic transport models, not a real Chrome integration claim.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||process.cwd());
const shared=fs.readFileSync(process.argv[3]||path.join(root,'src/080-helper-app.js'),'utf8');
const a=shared.indexOf('  function finalUrlGM('),b=shared.indexOf('  // Datei mit den Angaben',a);assert(a>=0&&b>a);
const background=fs.readFileSync(path.join(root,'chrome/background.js'),'utf8');
const tick=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
function event(){const list=[];return {addListener:f=>list.push(f),emit(...args){for(const f of list){const p=f(...args);if(p&&p.catch)p.catch(e=>errors.push(e));}}};}
const errors=[],rules=new Map(),calls=[],messages=[],ports=[];let connect,releaseHold,releaseSlow;
const hold=new Promise(r=>{releaseHold=r;}),slow=new Promise(r=>{releaseSlow=r;});
const api={runtime:{id:'priority-test',onConnect:{addListener:f=>{connect=f;}},onMessage:event(),connect(){
 const incoming=event(),outgoing=event(),disconnect=event();let closed=false;
 const front={onMessage:incoming,onDisconnect:disconnect,postMessage(m){messages.push(m);queueMicrotask(()=>{if(!closed)outgoing.emit(m);});},disconnect(){if(!closed){closed=true;disconnect.emit();}}};
 connect({name:'kadri-xhr',sender:{url:'https://page.test/watch'},onMessage:outgoing,onDisconnect:disconnect,postMessage(m){queueMicrotask(()=>{if(!closed)incoming.emit(m);});}});ports.push(front);return front;
}},storage:{local:{get:async()=>({})},onChanged:event()},action:{onClicked:event()},declarativeNetRequest:{
 getSessionRules:async()=>[...rules.values()],updateSessionRules:async o=>{for(const id of o.removeRuleIds||[])rules.delete(id);for(const r of o.addRules||[])rules.set(r.id,r);}
}};
const fetch=async(u,o)=>{
 calls.push(u);
 const wait=u.endsWith('/hold')?hold:u.includes('/normal')?slow:null;
 if(wait)await Promise.race([wait,new Promise((_,reject)=>{if(o.signal.aborted)reject(Error('abort'));else o.signal.addEventListener('abort',()=>reject(Error('abort')),{once:true});})]);
 if(o.signal.aborted)throw Error('abort');
 return {status:200,statusText:'OK',url:u.endsWith('/player')?'https://cdn.test/clip.mp4':u,headers:new Map(),text:async()=> 'ok'};
};
new Function('chrome','fetch','URL','AbortController','setTimeout','clearTimeout','importScripts','pslBase','globalThis','btoa','atob',background)(api,fetch,URL,AbortController,setTimeout,clearTimeout,()=>{},x=>x,{chrome:api},btoa,atob);
const context={chrome:api,KADRI_VERSION:'test',URL,AbortController,setTimeout,clearTimeout,console,ArrayBuffer,Uint8Array,Blob,atob,btoa};
const injection="\nlet lastResolve='';const mediaReferrer=()=>'';const hostOf=u=>new URL(u).hostname;\n"+shared.slice(a)+"\nconst gmXhr=()=>GM_xmlhttpRequest;globalThis.testXhr=GM_xmlhttpRequest;globalThis.resolvePlayer=finalUrl;\n";
vm.runInNewContext(fs.readFileSync(path.join(root,'chrome/prelude.js'),'utf8')+injection+fs.readFileSync(path.join(root,'chrome/epilogue.js'),'utf8'),context);
(async()=>{
 let resolution;
 try{
  await tick();context.testXhr({url:'https://media.test/hold',onerror(){}});await tick();assert.equal(calls.length,1);
  context.testXhr({url:'https://media.test/normal1',onerror(){}});context.testXhr({url:'https://media.test/normal2',onerror(){}});
  resolution=context.resolvePlayer('https://media.test/player');await tick();assert.equal(calls.length,1,'active security owner was bypassed');
  releaseHold();await tick();assert.equal(calls[1],'https://media.test/player','actual player caller lost priority behind background work');
  assert.equal(messages.find(m=>m.url==='https://media.test/player').purpose,'player-resolve');
  assert.equal(await resolution,'https://cdn.test/clip.mp4');
  console.log('PASS: actual player caller supplies purpose through Chrome adapter/background and overtakes queued slow normals without bypassing active header ownership');
 }finally{ports.forEach(p=>p.disconnect());releaseHold();releaseSlow();if(resolution)await resolution;await tick();}
 assert.equal(errors.length,0,'unhandled background rejection');
})().catch(e=>{console.error(e);process.exitCode=1;});
