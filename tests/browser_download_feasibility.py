"""Isolated feasibility evidence, NOT a download implementation or safety approval.

All .test names resolve to our loopback fixture. This is a static DNS-alias test,
not a live DNS-rebinding or public-to-private address-space transition test.
No helper, new permissions, real sites, user profiles or credential export.
Optional --extension tests the unchanged Kadri test-build request path in CI.
"""
import argparse
import hashlib
import http.server
import json
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
import threading
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / 'tests/web'
MP4 = MEDIA / 'public/clip-360-h264.mp4'
HLS = MEDIA / 'public/p4/fmp4_muxed'
COOKIE = 'fixture_session=SYNTHETIC_HTTPONLY_SESSION'
HITS = []
CHECKS = []


def check(name, condition):
    if not condition:
        raise AssertionError(name)
    CHECKS.append(name)
    print('PASS ' + name, flush=True)


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        path = urlsplit(self.path).path
        session = COOKIE in self.headers.get('Cookie', '').split('; ')
        # Record booleans only; no cookie values or private headers in evidence.
        HITS.append({'path': path, 'host': self.headers.get('Host', '').split(':')[0],
                     'session': session, 'authorization': bool(self.headers.get('Authorization'))})
        headers = {'Cache-Control': 'no-store'}
        status, kind, data = 200, 'text/html', b'<!doctype html><title>Fixture</title><video preload="none" controls src="/file.mp4"></video>'
        if path == '/login':
            headers['Set-Cookie'] = COOKIE + '; Secure; HttpOnly; SameSite=Lax; Path=/'
        elif path == '/logout':
            headers['Set-Cookie'] = 'fixture_session=; Secure; HttpOnly; Path=/; Max-Age=0'
        elif path == '/redirect-cross':
            status = 302
            headers['Location'] = f'https://other.test:{self.server.server_port}/target-cross'
        elif path == '/redirect-private':
            status = 302
            headers['Location'] = f'https://127.0.0.1:{self.server.server_port}/target-private'
        elif path.startswith('/target-'):
            kind, data = 'application/octet-stream', b'SYNTHETIC-NON-MEDIA'
        elif path == '/file.mp4' or path.startswith('/hls/'):
            if not session:
                status, kind, data = 412, 'text/plain', b'fixture requires its normal browser session'
            else:
                p = MP4 if path == '/file.mp4' else HLS / path.removeprefix('/hls/')
                # Only existing top-level fixture media, no arbitrary filesystem access.
                if p.parent not in (MP4.parent, HLS) or not p.is_file():
                    status, kind, data = 404, 'text/plain', b'not found'
                else:
                    data = p.read_bytes()
                    kind = 'application/vnd.apple.mpegurl' if p.suffix == '.m3u8' else 'video/mp4'
                    if path == '/file.mp4':
                        headers['Content-Disposition'] = 'attachment; filename="fixture.mp4"'
        elif path != '/page':
            status, kind, data = 404, 'text/plain', b'not found'
        self.send_response(status)
        for name, value in headers.items():
            self.send_header(name, value)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass


def fetch_info(page, url, credentials='same-origin', redirect='error'):
    # Existing origin's fetch. Credentials are never read or copied by JavaScript.
    return page.evaluate('''async ({url,credentials,redirect}) => {
      try {
        const r = await fetch(url, {credentials, redirect, cache:'no-store', signal:AbortSignal.timeout(5000)});
        const bytes = await r.arrayBuffer();
        const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
        return {status:r.status, size:bytes.byteLength, sha, type:r.headers.get('content-type')};
      } catch(e) {return {error:e.name};}
    }''', {'url': url, 'credentials': credentials, 'redirect': redirect})


def broker(page, url, anonymous=False):
    # Existing build.js test hook, not shipped in dist/chrome. Never request custom headers.
    return page.evaluate('''({url,anonymous})=>new Promise((resolve,reject)=>{
      const id=crypto.randomUUID(),timer=setTimeout(()=>{window.removeEventListener('message',f);reject(Error('probe timeout'));},10000);
      const f=e=>{if(e.source===window&&e.data?.kadriTestRes?.id===id){clearTimeout(timer);window.removeEventListener('message',f);resolve(e.data.kadriTestRes);}};
      window.addEventListener('message',f);
      window.postMessage({kadriTestXhr:{id,url,anonymous,timeout:5000}},'*');
    })''', {'url': url, 'anonymous': anonymous})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--extension', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    report = {'purpose': 'feasibility only', 'production': 'UNAPPROVED', 'safety_gate': 'BLOCKED',
              'limitations': ['desktop Chromium, not Vivaldi Android', 'static loopback DNS mapping, not live rebinding',
                              'no media transfer protocol', 'no source/frame authorization prototype',
                              'no background/process-restart guarantees', 'no real-site cause established']}
    with tempfile.TemporaryDirectory(prefix='kadri-browser-feasibility-') as tmp:
        cert, key = Path(tmp)/'cert.pem', Path(tmp)/'key.pem'
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),
                        '-days','1','-subj','/CN=SYNTHETIC-TEST-ONLY'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(cert, key)
        server.socket = tls.wrap_socket(server.socket, server_side=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = f'https://session.test:{server.server_port}'
        alias = f'https://alias.test:{server.server_port}'
        try:
            with sync_playwright() as p:
                # Trust only this disposable fixture environment; no production build/flags are changed.
                launch_args = ['--host-resolver-rules=MAP *.test 127.0.0.1', '--no-proxy-server', '--ignore-certificate-errors']
                if args.extension:
                    ext = str(args.extension.resolve())
                    launch_args += ['--disable-extensions-except='+ext, '--load-extension='+ext]
                context = p.chromium.launch_persistent_context(str(Path(tmp)/'profile'), channel='chromium', headless=True,
                    executable_path=os.environ.get('KADRI_CHROMIUM'), ignore_https_errors=True, accept_downloads=True, args=launch_args)
                context.set_default_timeout(15000)
                try:
                    page = context.new_page()
                    page.goto(origin+'/login')
                    check('HttpOnly session cannot be read by page JavaScript', page.evaluate('document.cookie') == '')
                    anon = fetch_info(page, origin+'/file.mp4', 'omit')
                    check('Anonymous MP4 fetch gets actual HTTP 412', anon.get('status') == 412 and not HITS[-1]['session'])
                    good = fetch_info(page, origin+'/file.mp4')
                    check('Normal browser fetch gets byte-identical MP4 without cookie export', good.get('status') == 200 and
                          good['sha'] == hashlib.sha256(MP4.read_bytes()).hexdigest() and HITS[-1]['session'])
                    check('HLS master without session also gets HTTP 412', fetch_info(page, origin+'/hls/master.m3u8', 'omit').get('status') == 412)
                    files = ['master.m3u8', 'v0.m3u8', 'init_0.mp4'] + sorted(p.name for p in HLS.glob('s0_*.m4s'))
                    for name in files:
                        r = fetch_info(page, origin+'/hls/'+name)
                        check('Session fetch matches fixture resource '+name, r.get('status') == 200 and
                              r['sha'] == hashlib.sha256((HLS/name).read_bytes()).hexdigest())
                    def packets(file):
                        r = subprocess.run(['ffprobe','-v','error','-count_packets','-show_entries','stream=nb_read_packets','-of','json',str(file)], capture_output=True, text=True, check=True)
                        return sum(int(x.get('nb_read_packets','0')) for x in json.loads(r.stdout)['streams'])
                    check('Init has zero media packets; complete MP4 has packets despite same MIME', packets(HLS/'init_0.mp4') == 0 and packets(MP4) > 0)
                    with page.expect_download() as d:
                        page.evaluate('''u=>{const a=document.createElement('a');a.href=u;a.download='fixture.mp4';document.body.append(a);a.click();a.remove();}''', origin+'/file.mp4')
                    saved = Path(tmp)/'download.mp4'
                    d.value.save_as(saved)
                    check('Native browser MP4 download is byte-identical and needs no helper or new permission', saved.read_bytes() == MP4.read_bytes())
                    for suffix in ('cross', 'private'):
                        at = len(HITS)
                        r = fetch_info(page, origin+'/redirect-'+suffix)
                        check('redirect:error prevents target request for '+suffix, 'error' in r and
                              not any(x['path'] == '/target-'+suffix for x in HITS[at:]))
                    at = len(HITS)
                    r = fetch_info(page, origin+'/redirect-cross', redirect='follow')
                    check('CORS refusal does not prevent the cross-origin HTTP request', 'error' in r and any(x['path']=='/target-cross' for x in HITS[at:]))
                    check('Browser did not send the source session to another hostname', all(not x['session'] for x in HITS if x['host']=='other.test'))
                    at = len(HITS)
                    r = fetch_info(page, alias+'/target-alias', 'omit')
                    check('Hostname mapped to loopback is reached before CORS refuses its response', 'error' in r and any(x['path']=='/target-alias' for x in HITS[at:]))
                    report['page_alias_reached'] = True
                    page.goto(origin+'/logout')
                    check('Logout prevents subsequent authenticated media fetch', fetch_info(page, origin+'/file.mp4').get('status') == 412)
                    if args.extension:
                        worker = next((w for w in context.service_workers if w.url.endswith('/background.js')), None)
                        if not worker:
                            worker = context.wait_for_event('serviceworker', predicate=lambda w: w.url.endswith('/background.js'))
                        check('Actual Kadri network rules installed', worker.evaluate('netGuard()') is True)
                        page.goto(origin+'/login')
                        page.wait_for_function("document.querySelector('[data-kadri-test]')")
                        r = broker(page, origin+'/file.mp4')
                        check('Existing Kadri broker uses same-site browser session', r.get('status') == 200 and HITS[-1]['session'])
                        r = broker(page, origin+'/file.mp4', True)
                        check('Existing anonymous broker still omits session', r.get('status') == 412 and not HITS[-1]['session'])
                        for url in (f'https://127.0.0.1:{server.server_port}/target-broker-private', origin+'/redirect-private'):
                            at = len(HITS)
                            broker(page, url)
                            check('Existing guard blocks literal private target before request', not any(x['path'] in ('/target-private','/target-broker-private') for x in HITS[at:]))
                        at = len(HITS)
                        r = broker(page, alias+'/target-broker-alias', True)
                        reached = any(x['path']=='/target-broker-alias' for x in HITS[at:])
                        report['kadri_alias_reached'] = reached
                        check('DNS-alias experiment has an unambiguous server/response observation',
                              (reached and r.get('status') == 200) or (not reached and r.get('status') != 200))
                        print('OBSERVATION existing Kadri DNS alias: '+('REACHED (network-equivalence BLOCKER)' if reached else 'blocked in this fixture only'), flush=True)
                    check('No Authorization header used by any fixture request', all(not x['authorization'] for x in HITS))
                    report.update(browser=context.browser.version if context.browser else 'persistent Chromium', checks=len(CHECKS), extension_tested=bool(args.extension))
                finally:
                    context.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report, indent=2), flush=True)
    print(f'RESULT browser-feasibility EVIDENCE_PASS {len(CHECKS)}; SAFETY_GATE BLOCKED', flush=True)


if __name__ == '__main__':
    main()
