"""Isolated passive observer + real Kadri player source, NOT a shipping feature.

No extension policy changes. Inject the existing src files into a disposable local
fixture page, expose a test-only player entry point and fix its candidate URL.
Selection/registry authorization and extension isolation are explicitly NOT tested.
Requires an installed H.264/AAC-capable browser (KADRI_CAPTURE_CHROMIUM or Chrome/Chromium).
"""
import argparse
import base64
import hashlib
import http.server
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT/'tests/web/public/p4/fmp4_muxed'
HITS = []
CHECKS = []


def check(name, ok):
    if not ok:
        raise AssertionError(name)
    CHECKS.append(name)
    print('PASS '+name, flush=True)


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        path = urlsplit(self.path).path
        HITS.append(path)
        status, kind = 200, 'text/html'
        if path == '/page':
            body = b'<html><body><video id="v" muted playsinline style="width:640px;height:360px"></video></body></html>'
        elif path.startswith('/media/'):
            file = MEDIA/path.removeprefix('/media/')
            if file.parent != MEDIA or not file.is_file():
                status, body = 404, b'not found'
            else:
                body = file.read_bytes()
                kind = 'application/vnd.apple.mpegurl' if file.suffix == '.m3u8' else 'video/mp4'
        else:
            status, body = 404, b'not found'
        self.send_response(status)
        self.send_header('Content-Type', kind)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass


def instrumented_source():
    body = ''.join(p.read_text() for p in sorted((ROOT/'src').glob('[0-9][0-9][0-9]-*.js')))
    marker = "root = hostEl.attachShadow({ mode: 'closed' });"
    assert body.count(marker) == 1
    body = body.replace(marker, "root = hostEl.attachShadow({ mode: 'open' }); hostEl.setAttribute('data-kadri-test','');")
    # Test-only entry, source selection fixture and local getters. The loader/player/lifecycle are unchanged.
    end = body.rfind('})();')
    assert end > 0
    body = body[:end]+'''
    globalThis.capturePlayerTest = {
      open: (orig,url) => { playerSources = () => [url]; openBrowserPlayer(orig); },
      state: () => vp, close: () => closePlayer()
    };
    '''+body[end:]
    return 'const __KADRI__=true; const GM_getValue=(k,d)=>({systemHelper:false,startFullscreen:false,ambient:false})[k]??d;\n'+body


SETUP = r'''({scenario, enabled, source}) => {
  const RealHls = Hls; window.probes=[];window.loads=[];
  window.Hls = class extends RealHls {
    constructor(config) {
      let capture;
      const observe=enabled && config.subtitleDisplay===false && Object.hasOwn(config,'startPosition');
      class Loader extends RealHls.DefaultConfig.loader {
        load(context, conf, callbacks) {
          super.load(context, conf, {...callbacks, onSuccess:(response,stats,ctx,details)=>{
            const f=ctx.frag;
            if(f && ctx.responseType==='arraybuffer' && capture) {
              window.loads.push({sn:f.sn, size:response.data.byteLength});
              // Negative cases change only what the observer sees, never player bytes/requests.
              try {
                if(scenario==='cancel' && Number.isInteger(f.sn)) capture.cancel();
                // Inject only observer notifications; no fake events into the real player's controllers.
                if(scenario==='quality-change' && Number.isInteger(f.sn))
                  capture.listeners.find(([e])=>e===RealHls.Events.LEVEL_SWITCHING)[1](null,{level:1});
                if(scenario==='source-change' && Number.isInteger(f.sn))
                  capture.listeners.find(([e])=>e===RealHls.Events.MANIFEST_LOADING)[1](null,{url:source+'?changed=1'});
                if(!(scenario==='missing' && f.sn===2)) capture.response(f,response.data);
                if(scenario==='duplicate') capture.response(f,response.data);
                if(scenario==='conflicting-duplicate' && f.sn===2) {
                  const b=response.data.slice(0);new Uint8Array(b)[0]^=1;capture.response(f,b);
                }
              } catch(e) { capture.fail('observer_exception'); }
            }
            callbacks.onSuccess(response,stats,ctx,details);
          }});
        }
      }
      // Same player defaults. No buffer increase, start-position change or additional fetching.
      super(observe ? {...config,fLoader:Loader} : config);
      if(observe) {
        capture = new PassiveCaptureProbe(this,RealHls,{
          ownerCurrent:()=>window.capturePlayerTest?.state()?.hls===this,
          ...(scenario==='storage-limit'?{maxBytes:1024}:{})
        });
        window.probes.push(capture);
      }
    }
  };
}'''


def run_case(browser, server, scenario, enabled=True):
    context = browser.new_context(viewport={'width':800, 'height':600})
    page = context.new_page()
    origin = f'http://127.0.0.1:{server.server_port}'
    at = len(HITS)
    try:
        page.goto(origin+'/page')
        page.add_script_tag(path=str(ROOT/'vendor/hls.min.js'))
        page.add_script_tag(path=str(ROOT/'tests/experiments/passive_capture.js'))
        page.evaluate(SETUP, {'scenario':scenario,'enabled':enabled,'source':origin+'/media/master.m3u8'})
        page.add_script_tag(content=instrumented_source())
        if scenario == 'middle':
            page.evaluate("u => { const v=document.querySelector('#v');const h=new Hls({enableWorker:false});h.attachMedia(v);h.loadSource(u); }",origin+'/media/master.m3u8')
            page.wait_for_function("document.querySelector('#v').readyState>=2")
            page.evaluate("document.querySelector('#v').currentTime=12")
            page.wait_for_function("!document.querySelector('#v').seeking && document.querySelector('#v').currentTime>=12")
        page.evaluate("u=>capturePlayerTest.open(document.querySelector('#v'),u)",origin+'/media/master.m3u8')
        page.wait_for_function('capturePlayerTest.state()?.vid?.currentTime>0.15', timeout=20000)
        check(scenario+': actual Kadri own player decodes H.264/AAC',page.evaluate("capturePlayerTest.state().mode==='own' && capturePlayerTest.state().vid.videoWidth===640"))
        page.evaluate('capturePlayerTest.state().vid.playbackRate=8')
        page.wait_for_function('capturePlayerTest.state()?.vid?.ended', timeout=15000)
        result = page.evaluate('''({enabled,scenario})=>{
          const h=capturePlayerTest.state().hls;
          const info={worker:h.config.enableWorker,start:h.config.startPosition};
          if(!enabled)return {info};
          const p=probes[0];
          if(scenario==='close-control')p.ownerCurrent=()=>true; // deliberately broken TEST-ONLY counterexample
          if(scenario==='close'||scenario==='close-control')capturePlayerTest.close();
          if(scenario==='replace-player')capturePlayerTest.open(document.querySelector('#v'),h.url);
          if(scenario==='cancel-late') {
            p.cancel();
            p.listeners.find(([e])=>e===Hls.Events.MANIFEST_LOADING)[1](null,{url:h.url+'?late=1'});
          }
          const before=p.snapshot(),blocks=p.finish();
          const enc=b=>{let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s);};
          return {info,before,after:p.snapshot(),identityCleared:p.source===''&&p.plan===null,
            blocks:blocks?blocks.map(enc):null,instances:probes.length};
        }''',{'enabled':enabled,'scenario':scenario})
        result['requests']=[x for x in HITS[at:] if x.startswith('/media/')]
        return result
    finally:
        context.close()


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--export-fixture',type=Path,help='Export only the known complete local fixture after all checks pass; never a product download')
    args=parser.parse_args()
    executable = os.environ.get('KADRI_CAPTURE_CHROMIUM') or shutil.which('google-chrome') or shutil.which('chromium')
    if not executable:
        raise RuntimeError('An installed H.264/AAC-capable Chrome/Chromium is required')
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
    server.daemon_threads=True
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(executable_path=executable,headless=True,args=['--autoplay-policy=no-user-gesture-required'])
            try:
                baseline=run_case(browser,server,'baseline',False)
                good=run_case(browser,server,'complete')
                check('Observer preserves actual player worker/start settings',good['info']==baseline['info']=={'worker':False,'start':-1})
                check('Observer adds zero media requests versus unmodified player',sorted(good['requests'])==sorted(baseline['requests']))
                check('One player instance yields a complete candidate',good['instances']==1 and good['after']['state']=='candidate')
                blocks=[base64.b64decode(s,validate=True) for s in good['blocks']]
                expected=[MEDIA/'init_0.mp4']+sorted(MEDIA.glob('s0_*.m4s'))
                check('Every captured byte matches original H.264/AAC init/segments',len(blocks)==len(expected) and all(b==f.read_bytes() for b,f in zip(blocks,expected)))
                with tempfile.TemporaryDirectory(prefix='kadri-passive-player-') as tmp:
                    file=Path(tmp)/'candidate.mp4';file.write_bytes(b''.join(blocks))
                    probe=subprocess.run(['ffprobe','-v','error','-show_entries','stream=codec_name:format=duration','-of','json',str(file)],check=True,capture_output=True,text=True)
                    info=json.loads(probe.stdout)
                    check('Candidate has H.264, AAC and full 20-second duration', {s['codec_name'] for s in info['streams']}=={'h264','aac'} and 19.9<=float(info['format']['duration'])<=20.2)
                    decoded=subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(file),'-map','0:v:0','-map','0:a:0','-f','null','-'],capture_output=True)
                    check('Independent ffmpeg decodes complete video and audio without errors',decoded.returncode==0 and not decoded.stderr)
                control=run_case(browser,server,'close-control')
                check('Counterexample: waiting only for HLS destroy leaves a candidate after actual close',
                      control['blocks'] is not None and control['after']['state']=='candidate')
                reasons={'missing':'incomplete','middle':'incomplete','conflicting-duplicate':'conflicting_duplicate',
                         'quality-change':'quality_changed','source-change':'source_changed','cancel':'user_cancelled',
                         'cancel-late':'user_cancelled','close':'player_changed','replace-player':'player_changed','storage-limit':'storage_limit'}
                for scenario,reason in reasons.items():
                    r=run_case(browser,server,scenario)
                    check(scenario+': no candidate and fixed anonymous reason',r['blocks'] is None and r['after']['reason']==reason)
                    check(scenario+': buffered bytes and capture identity cleared',r['after']['bytes']==0 and r['after']['received']==0 and r['identityCleared'])
                    if scenario not in ('middle','replace-player'):
                        check(scenario+': player requests unchanged', sorted(r['requests'])==sorted(baseline['requests']))
                repeat=run_case(browser,server,'duplicate')
                check('Identical duplicate observations do not duplicate file bytes',repeat['blocks']==good['blocks'])
                check('Identical duplicate observations add no requests',sorted(repeat['requests'])==sorted(baseline['requests']))
                if args.export_fixture:
                    args.export_fixture.mkdir(parents=True,exist_ok=False)
                    lines=['capture-fixture-v1','20000',str(len(blocks))]
                    for i,block in enumerate(blocks):
                        (args.export_fixture/f'{i:04d}.bin').write_bytes(block)
                        lines.append(f'{len(block)} {hashlib.sha256(block).hexdigest()}')
                    (args.export_fixture/'fixture.txt').write_text('\n'.join(lines)+'\n')
                    print('Exported known local fixture only: numbered media blocks, lengths, hashes; no URLs or session data',flush=True)
                print(json.dumps({'browser':browser.version,'checks':len(CHECKS),'product_mode':'NOT_IMPLEMENTED',
                    'limits':['source selection fixed by test','no extension isolation proof','20-second muxed fMP4 only',
                              'no production container validator','no helper transfer','no Android/background proof']}),flush=True)
            finally:
                browser.close()
    finally:
        server.shutdown();server.server_close();thread.join(timeout=2)
    print(f'RESULT passive-player-capture EVIDENCE_PASS {len(CHECKS)}; PRODUCT_MODE NOT_IMPLEMENTED',flush=True)


if __name__=='__main__':
    main()
