"""Reproduce Chromium address-space boundaries; NOT a product download path.

Only disposable profiles and synthetic loopback HTTPS servers. No extension,
real site, cookies, helper, system policy changes or live DNS rebinding.
TCP accepts and HTTP requests are counted separately. The expected insecure
Request-only result records a browser limitation, not desired product behavior.
If it changes, review the evidence instead of weakening a product guard.
"""
import argparse
import http.server
import json
import ssl
import subprocess
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path

from playwright.sync_api import sync_playwright

BODY = b'<!doctype html><title>Synthetic address-space fixture</title>'


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, tls):
        self.tls = tls
        self.lock = threading.Lock()
        self.tcp = self.http = 0
        super().__init__(('127.0.0.1', 0), Handler)

    def get_request(self):
        raw, address = self.socket.accept()
        with self.lock:
            self.tcp += 1  # Before TLS, not merely requests visible to HTTP.
        raw.settimeout(3)
        return self.tls.wrap_socket(raw, server_side=True,
                                    do_handshake_on_connect=False), address

    def handle_error(self, *_):
        pass  # A browser may close after connect without sending HTTP.

    def counts(self):
        with self.lock:
            return {'tcp_connections': self.tcp, 'http_requests': self.http}


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        with self.server.lock:
            self.server.http += 1
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(BODY)))
        self.end_headers()
        self.wfile.write(BODY)


@contextmanager
def endpoint(tls):
    server = Server(tls)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(5)


FETCH = """async ({url,mode}) => {
  let recognized = false;
  try { new Request(url, {targetAddressSpace:'invalid'}); }
  catch (e) { recognized = e.name === 'TypeError'; }
  const options = {credentials:'omit', referrerPolicy:'no-referrer',
    redirect:'error', cache:'no-store', signal:AbortSignal.timeout(4000)};
  try {
    let response;
    if (mode === 'unguarded') response = await fetch(url, options);
    else if (mode === 'direct')
      response = await fetch(url, {...options, targetAddressSpace:'public'});
    else {
      const request = new Request(url, {...options, targetAddressSpace:'public'});
      response = mode === 'request-only' ? await fetch(request)
        : await fetch(request, {targetAddressSpace:'public'});
    }
    return {recognized, status:response.status,
      bytes:(await response.arrayBuffer()).byteLength};
  } catch (e) { return {recognized, error:e.name}; }
}"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chromium', required=True, help='Existing Chromium executable')
    parser.add_argument('--public-origin', action='store_true',
                        help='Simulate public origin and explicitly grant loopback permission (Chrome 156)')
    args = parser.parse_args()
    evidence = []
    with tempfile.TemporaryDirectory(prefix='kadri-address-space-') as tmp:
        cert, key = Path(tmp) / 'cert.pem', Path(tmp) / 'key.pem'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                        '-keyout', str(key), '-out', str(cert), '-days', '1',
                        '-subj', '/CN=SYNTHETIC-ONLY'], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(cert, key)
        with endpoint(tls) as origin, sync_playwright() as pw:
            # Separate browser/target per row: no connection pool or permission carryover.
            for mode, public_target in [('unguarded', False), ('direct', False),
                                        ('request-only', False), ('request-reapplied', False),
                                        ('direct', True)]:
                with endpoint(tls) as target:
                    flags = ['--host-resolver-rules=MAP *.test 127.0.0.1',
                             '--no-proxy-server', '--ignore-certificate-errors']
                    overrides = []
                    if args.public_origin:
                        overrides.append(f'127.0.0.1:{origin.server_port}=public')
                    if public_target:
                        overrides.append(f'127.0.0.1:{target.server_port}=public')
                    if overrides:
                        flags.append('--ip-address-space-overrides=' + ','.join(overrides))
                    # Overrides and TLS exception apply ONLY to synthetic fixture profiles.
                    browser = pw.chromium.launch(executable_path=args.chromium,
                                                 headless=True, args=flags)
                    try:
                        ctx = browser.new_context(ignore_https_errors=True)
                        page = ctx.new_page()
                        origin_url = f'https://origin.test:{origin.server_port}'
                        page.goto(origin_url)
                        if args.public_origin:
                            session = ctx.new_cdp_session(page)
                            info = session.send('Target.getTargetInfo')['targetInfo']
                            session.send('Browser.setPermission', {
                                'permission': {'name': 'loopback-network'},
                                'setting': 'granted', 'origin': origin_url,
                                'browserContextId': info['browserContextId']})
                        result = page.evaluate(FETCH, {
                            'url': f'https://alias.test:{target.server_port}/fixture',
                            'mode': mode})
                        page.wait_for_timeout(200)
                        row = {'browser': browser.version, 'mode': mode,
                               'origin': 'public-simulated' if args.public_origin else 'loopback',
                               'target': 'public-simulated' if public_target else 'loopback',
                               'result': result, **target.counts()}
                        print(json.dumps(row), flush=True)
                        evidence.append(row)
                    finally:
                        browser.close()
    for row in evidence:
        result = row['result']
        assert result['recognized'], 'Browser does not recognize the option'
        assert row['tcp_connections'] > 0, 'Expected connection-phase evidence changed'
        blocked = row['target'] == 'loopback' and row['mode'] in ('direct', 'request-reapplied')
        if blocked:
            assert result.get('error') == 'TypeError' and row['http_requests'] == 0, row
        else:
            assert result.get('status') == 200 and result.get('bytes') == len(BODY), row
            assert row['http_requests'] > 0, row
    print('RESULT: 5/5 boundary observations reproduced; product gate BLOCKED', flush=True)


if __name__ == '__main__':
    main()
