# Same native metadata regression through the actual Kadri extension.
import time
from common import *
with sync_playwright() as p:
    ctx,sw,_=launch(p)
    pg=ctx.new_page();errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
    pg.goto(B+'direct.html')
    pg.wait_for_function('document.getElementById("v").readyState>=2 && document.getElementById("v").duration>4')
    opening=pg.evaluate('''()=>{const v=document.getElementById("v");v.pause();v.muted=false;
      const t=Math.min(10,v.duration/2);v.currentTime=t;return t;}''')
    pg.wait_for_function('()=>!document.getElementById("v").seeking')
    pg.wait_for_function('() => !!%s.querySelector("button[aria-label=\\"Im Videoplayer öffnen\\"]")'%R)
    pg.evaluate('() => %s.querySelector("button[aria-label=\\"Im Videoplayer öffnen\\"]").click()'%R)
    pg.wait_for_function('()=>{const v=%s.querySelector(".vv");return v&&v.readyState>=2&&v.currentTime>1;}'%R)
    actual=pg.evaluate('()=>%s.querySelector(".vv").currentTime'%R)
    check('intentional opening keeps playback position',abs(actual-opening)<1.5,[opening,actual])
    result=pg.evaluate('''()=>new Promise(resolve=>{
      const v=%s.querySelector(".vv");v.pause();
      v.addEventListener("loadedmetadata",()=>resolve({time:v.currentTime,source:v.currentSrc}),{once:true});
      v.src=v.currentSrc+(v.currentSrc.includes("?")?"&":"?")+"independent-source=1";
    })'''%R)
    check('new source does not inherit opening position',result['time']<1,result)
    pg.wait_for_function('()=>%s.querySelector(".vv").readyState>=2'%R)
    check('new source remains playable without page errors',not errors,errors)
    ctx.close()
shutdown()
done()
