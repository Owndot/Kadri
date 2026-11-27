"""Echte HTTP- und HTTPS-Server für die angemeldete Typprobe (keine Playwright-Routen).

http://<host>:8791/ und https://<host>:8443/ (selbstsigniert, Chromium mit --ignore-certificate-errors). Hosts über
--host-resolver-rules auf 127.0.0.1: www./cdn.kadri-a.test (eine Site), cdn.kadri-b.test (andere Site); dazu
127.0.0.1 direkt. Protokoll je Anfrage nur als Klassen: Pfad, Host, Port, Range, Sec-Fetch-Dest/-Mode, Herkunft
(ext = Typprobe des Service Workers: ohne Origin mit Range bytes=0-4095, page = http(s)-Origin, none), Namen der Cookies (nie Werte), Authorization/Referer
ja/nein, Status und tatsächlich gesendete Bytes.

Pfade:
  /page?src=URL           Testseite: <video autoplay loop src=URL> (hörbar), zählt play/seeking am Original
  /videos/<n>.mp4         MP4 (tests/web/clip.mp4, Range). Query: auth=<Cookie>|1 (ohne Cookie 403), nocors=1,
                          once=1 (nur der erste Abruf gelingt), big=1 (32 MiB, Kopf = clip.mp4), norange=1,
                          ext=<mpd|hls|401|500|drop|delay> (nur für Anfragen mit Erweiterungs-Origin), ms=<Verzögerung>
  /m/<n>.mp4              HLS-Hauptliste (eine abspielbare Variante /hls2/a/index.m3u8); auth= wie oben
  /hls2/...               tests/web/hls2
  /r/<n>?to=URL&code=302  Weiterleitung (code 302/307)
"""
import http.server, os, ssl, subprocess, tempfile, threading, time, urllib.parse
from pathlib import Path

WEB = Path(__file__).resolve().parent / 'web'
CLIP = (WEB / 'clip.mp4').read_bytes()
MPD = (WEB / 'dash/gate/g02-number-duration.mpd').read_bytes()
BIG = 32 * 1024 * 1024
LOG = []
SEEN = {}
HTTP_PORT, HTTPS_PORT = 8791, 8443
MASTER = ('#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-STREAM-INF:BANDWIDTH=150000,RESOLUTION=320x180,CODECS="vp09.00.10.08,opus"\n'
          '%s/hls2/a/index.m3u8?src=auth\n')
PAGE = ('<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>auth</title>'
        '<body style="margin:0"><video id=v autoplay loop playsinline style="width:100%%;height:225px;background:#000" src="%s"></video>'
        '<script>window.plays = 0; window.seeks = 0; v.addEventListener("play", () => plays++); v.addEventListener("seeking", () => seeks++);</script></body>')


class H(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *a):
        pass

    def head(self, code, ctype, length, cors, extra=None):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(length))
        self.send_header('Cache-Control', 'no-store')
        if cors:
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Expose-Headers', 'Content-Range, Content-Length')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.rec['status'] = code

    def body(self, data, chunk=65536):
        try:
            for i in range(0, len(data), chunk):
                self.wfile.write(data[i:i + chunk])
                self.rec['sent'] += min(chunk, len(data) - i)
        except Exception:
            self.rec['aborted'] = True

    def out(self, code, data, ctype, cors=True, extra=None):
        self.head(code, ctype, len(data), cors, extra)
        if self.command != 'HEAD':
            self.body(data)

    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        origin = self.headers.get('Origin') or ''
        browser = 'Chrome/' in (self.headers.get('User-Agent') or '')
        # Typprobe des Service Workers: mit Hostberechtigung OHNE Origin-Kopf (an http://*.test auch ohne Sec-Fetch-*),
        # erkennbar am festen Vertrag Range bytes=0-4095. Seitenprobe: mit Origin. Natives Element: bytes=0-.
        if origin.startswith('chrome-extension://') or (browser and not origin and self.headers.get('Range') == 'bytes=0-4095'):
            kind = 'ext'
        else:
            kind = 'page' if origin.startswith('http') else 'none'
        names = sorted(c.split('=', 1)[0].strip() for c in (self.headers.get('Cookie') or '').split(';') if '=' in c)
        self.rec = {'path': u.path, 'host': (self.headers.get('Host') or '').split(':')[0], 'port': self.server.server_port,
                    'range': self.headers.get('Range', ''), 'dest': self.headers.get('Sec-Fetch-Dest', ''),
                    'mode': self.headers.get('Sec-Fetch-Mode', ''), 'origin': kind, 'cookies': names,
                    'auth': bool(self.headers.get('Authorization')), 'ref': bool(self.headers.get('Referer')),
                    'helper': not browser, 'status': 0, 'sent': 0, 't': time.time()}
        LOG.append(self.rec)
        ext = q.get('ext', '') if kind == 'ext' else ''
        if ext == 'delay':
            time.sleep(int(q.get('ms', '5000')) / 1000)
        if ext == 'drop':
            self.rec['status'] = -1
            self.close_connection = True
            try:
                self.connection.shutdown(2)
            except Exception:
                pass
            return
        if u.path == '/page':
            return self.out(200, (PAGE % q.get('src', '').replace('"', '%22')).encode(), 'text/html; charset=utf-8')
        if u.path.startswith('/r/'):
            return self.out(int(q.get('code', '302')), b'', 'text/plain', True, {'Location': q.get('to', '/')})
        if u.path.startswith('/hls2/'):
            f = (WEB / 'hls2' / u.path[6:]).resolve()
            if str(f).startswith(str(WEB / 'hls2')) and f.is_file():
                return self.out(200, f.read_bytes(), 'application/vnd.apple.mpegurl' if f.suffix == '.m3u8' else 'video/mp4')
            return self.out(404, b'', 'text/plain')
        need = q.get('auth')
        if need:
            need = 'sess' if need == '1' else need
            if need not in names:
                return self.out(403, b'', 'text/plain')
        if q.get('once') == '1':
            SEEN[self.path] = SEEN.get(self.path, 0) + 1
            if SEEN[self.path] > 1:
                return self.out(403, b'verbraucht', 'text/plain')
        if ext in ('401', '500'):
            return self.out(int(ext), b'', 'text/plain')
        cors = q.get('nocors') != '1'
        if u.path.startswith('/m/'):
            base = '%s://%s' % ('https' if self.server.server_port == HTTPS_PORT else 'http', self.headers.get('Host'))
            return self.out(200, (MASTER % base).encode(), q.get('ct', 'application/vnd.apple.mpegurl'), cors)
        if ext == 'mpd':
            return self.out(206, MPD, 'video/mp4', cors, {'Content-Range': 'bytes 0-%d/%d' % (len(MPD) - 1, len(MPD))})
        if ext == 'hls':
            t = (MASTER % 'http://127.0.0.1:8791').encode()
            return self.out(206, t, 'video/mp4', cors, {'Content-Range': 'bytes 0-%d/%d' % (len(t) - 1, len(t))})
        if not u.path.startswith('/videos/'):
            return self.out(404, b'', 'text/plain')
        total = BIG if q.get('big') == '1' else len(CLIP)
        rng = '' if q.get('norange') == '1' else self.headers.get('Range', '')
        a, b, code = 0, total - 1, 200
        if rng.startswith('bytes='):
            x, _, y = rng[6:].partition('-')
            a = int(x or 0)
            b = min(int(y) if y else total - 1, total - 1)
            code = 206
        extra = {'Accept-Ranges': 'bytes'}
        if code == 206:
            extra['Content-Range'] = 'bytes %d-%d/%d' % (a, b, total)
        self.head(code, 'video/mp4', b - a + 1, cors, extra)
        if q.get('big') == '1':
            # Kopf = echte MP4, dahinter Nullen; in 64-KiB-Stücken senden und mitzählen, bis der Empfänger abbricht
            pos = a
            try:
                while pos <= b:
                    end = min(pos + 65536, b + 1)
                    part = CLIP[pos:end] if pos < len(CLIP) else b''
                    part = part + bytes(end - pos - len(part))
                    self.wfile.write(part)
                    self.rec['sent'] += len(part)
                    pos = end
            except Exception:
                self.rec['aborted'] = True
            return
        self.body(CLIP[a:b + 1])

    do_HEAD = do_GET


_servers = []


def cert_dir():
    d = tempfile.mkdtemp(prefix='kadri-tls-')
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', d + '/k.pem', '-out', d + '/c.pem',
                    '-days', '2', '-subj', '/CN=cdn.kadri-a.test',
                    '-addext', 'subjectAltName=DNS:*.kadri-a.test,DNS:*.kadri-b.test,IP:127.0.0.1'],
                   check=True, capture_output=True)
    return d


def start():
    s = http.server.ThreadingHTTPServer(('127.0.0.1', HTTP_PORT), H)
    s.daemon_threads = True
    threading.Thread(target=s.serve_forever, daemon=True).start()
    _servers.append(s)
    d = cert_dir()
    t = http.server.ThreadingHTTPServer(('127.0.0.1', HTTPS_PORT), H)
    t.daemon_threads = True
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(d + '/c.pem', d + '/k.pem')
    t.socket = ctx.wrap_socket(t.socket, server_side=True)
    threading.Thread(target=t.serve_forever, daemon=True).start()
    _servers.append(t)


def stop():
    for s in _servers:
        s.shutdown()


def since(i, **f):
    """Protokolleinträge ab Index i, gefiltert nach Feldern (Wert oder Funktion)."""
    out = []
    for e in LOG[i:]:
        if all((v(e[k]) if callable(v) else e[k] == v) for k, v in f.items()):
            out.append(e)
    return out


def cls(entries):
    keep = ('path', 'host', 'port', 'range', 'dest', 'origin', 'cookies', 'auth', 'ref', 'status', 'sent')
    return [{k: e.get(k) for k in keep} for e in entries]
