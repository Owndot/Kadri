"""Zwei echte HTTP/1.1-Server für fremdherkunftige Typ- und Wiedergabeprüfungen (keine Playwright-Routen).

Seite: http://127.0.0.1:PAGE/   Medien: http://localhost:MEDIA/ (andere Site). Jeder Medienabruf wird serverseitig mit
Pfad samt Query, Range, Sec-Fetch-Dest/-Mode und Origin protokolliert.

Medienpfade (Query-Optionen: cors=1 setzt Access-Control-Allow-Origin, delay=ms verzögert, status=n antwortet so,
delay1=ms verzögert nur den ersten Abruf der Adresse, fail1=n beantwortet nur den ersten Abruf mit Status n,
norange=1 ignoriert Range (200, ganze Datei), once=1 macht die Adresse nach dem ersten Abruf ungültig):
  /m/<name>[...]   HLS-Hauptliste, Kinder absolut auf diesem Server (siehe MASTERS)
  /f/<name>        echte MP4 (tests/web/clip.mp4, Range 206)
  /d/<name>        MPD-Text (tests/web/dash/gate/g02-number-duration.mpd)
  /v/a/..., /v/b/... abspielbare Medienplaylists und Stücke (tests/web/hls2/a|b), immer mit CORS
  /r/<n>?to=URL    302 auf URL (ohne to: Ziel aus REDIRS[<n>], für überlange Ziele hinter kurzer Adresse)
  /x/<name>        MPD-Text mit CORS und application/dash+xml (Kinder, die die Seite selbst liest)
Seitenpfade: /nocors.html?src=URL&mark=URL,URL[&play=1]  Testseite mit <video src> (play=1: hörbar, autoplay) und Abruf
  der mark-Adressen durch die Seite
"""
import html, http.server, json, threading, time, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'tests' / 'web'
PAGE_PORT, MEDIA_PORT = 18891, 18892
PAGE = 'http://127.0.0.1:%d/' % PAGE_PORT
MEDIA = 'http://localhost:%d/' % MEDIA_PORT
CLIP = (WEB / 'clip.mp4').read_bytes()
MPD = (WEB / 'dash/gate/g02-number-duration.mpd').read_text(encoding='utf-8')
INF = '#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=320x180,CODECS="vp09.00.10.08,opus"'
KID_A = MEDIA + 'v/a/index.m3u8?src=gen'
KID_B = MEDIA + 'v/b/index.m3u8?src=gen'

LOG = []          # (Pfad samt Query, Range, Dest, Mode, Origin)
SEEN = {}         # once-Zähler
FIRST = {}        # delay1-Zähler
MASTERS = {}      # Name -> Liste absoluter Kindadressen (Standard: KID_A, KID_B)
REDIRS = {}       # Name -> Weiterleitungsziel (für /r/<Name> ohne to)


def master_text(name):
    kids = MASTERS.get(name, [KID_A, KID_B])
    return '#EXTM3U\n#EXT-X-VERSION:7\n' + ''.join('%s\n%s\n' % (INF % (150000 + 1000 * i), u) for i, u in enumerate(kids))


class Media(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *a):
        pass

    def send(self, code, body, ctype, cors, extra=None):
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        if cors:
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Expose-Headers', 'Content-Range, Content-Length')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            try:
                self.wfile.write(body)
            except Exception:
                pass

    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        LOG.append((self.path, self.headers.get('Range', ''), self.headers.get('Sec-Fetch-Dest', ''),
                    self.headers.get('Sec-Fetch-Mode', ''), self.headers.get('Origin', '')))
        cors = q.get('cors') == '1'
        if q.get('delay'):
            time.sleep(int(q['delay']) / 1000)
        if q.get('delay1'):
            FIRST[self.path] = FIRST.get(self.path, 0) + 1
            if FIRST[self.path] == 1:
                time.sleep(int(q['delay1']) / 1000)
        if q.get('once') == '1':
            SEEN[self.path] = SEEN.get(self.path, 0) + 1
            if SEEN[self.path] > 1:
                return self.send(403, 'verbraucht', 'text/plain', cors)
        if q.get('fail1'):
            FIRST['f:' + self.path] = FIRST.get('f:' + self.path, 0) + 1
            if FIRST['f:' + self.path] == 1:
                return self.send(int(q['fail1']), 'fehler', 'text/plain', cors)
        if q.get('status'):
            return self.send(int(q['status']), 'fehler', 'text/plain', cors)
        p = u.path
        if p.startswith('/r/'):
            self.send_response(302)
            self.send_header('Location', q.get('to') or REDIRS.get(p[3:], '/'))
            self.send_header('Content-Length', '0')
            if cors:
                self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            return
        if p.startswith('/m/'):
            return self.send(200, master_text(p[3:]), 'application/vnd.apple.mpegurl', cors)
        if p.startswith('/x/'):
            return self.send(200, MPD, 'application/dash+xml', True)
        if p.startswith('/d/'):
            return self.send(200, MPD, 'application/dash+xml', cors)
        if p.startswith('/f/'):
            rng = '' if q.get('norange') == '1' else self.headers.get('Range', '')
            if rng.startswith('bytes='):
                a, _, b = rng[6:].partition('-')
                a = int(a or 0)
                b = min(int(b) if b else len(CLIP) - 1, len(CLIP) - 1)
                return self.send(206, CLIP[a:b + 1], 'video/mp4', cors,
                                 {'Content-Range': 'bytes %d-%d/%d' % (a, b, len(CLIP)), 'Accept-Ranges': 'bytes'})
            return self.send(200, CLIP, 'video/mp4', cors, {'Accept-Ranges': 'bytes'})
        if p.startswith('/v/'):
            f = WEB / 'hls2' / p[3:]
            if f.is_file():
                ct = 'application/vnd.apple.mpegurl' if f.suffix == '.m3u8' else 'video/mp4'
                return self.send(200, f.read_bytes(), ct, True)
        return self.send(404, 'nicht gefunden', 'text/plain', cors)

    do_HEAD = do_GET


class Page(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(WEB), **k)

    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        if u.path == '/nocors.html':   # Testseite: fremdherkunftiges Video, die Seite liest ihre eigenen Listen (page.js)
            q = dict(urllib.parse.parse_qsl(u.query))
            marks = [m for m in q.get('mark', '').split(',') if m]
            body = ('<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>nocors</title>'
                    '<body style="margin:0"><video id=v %s playsinline style="width:100%%;height:225px;background:#000" '
                    'src="%s"></video><script>window.plays = 0; window.seeks = 0;'
                    'v.addEventListener("play", () => plays++); v.addEventListener("seeking", () => seeks++);'
                    'window.marked = false; Promise.all(%s.map(u => fetch(u).then(r => r.text()))).then(() => { marked = true; });'
                    '</script></body>') % ('autoplay loop preload=auto' if q.get('play') == '1' else 'muted preload=none',
                                           html.escape(q.get('src', ''), quote=True), json.dumps(marks))
            b = body.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(b)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(b)
            return
        if u.path.startswith('/r/'):   # gleiche Herkunft wie die Seite -> 302 (z. B. auf die fremde Medien-Site)
            LOG.append(('page:' + self.path, self.headers.get('Range', ''), self.headers.get('Sec-Fetch-Dest', ''),
                        self.headers.get('Sec-Fetch-Mode', ''), self.headers.get('Origin', '')))
            self.send_response(302)
            self.send_header('Location', dict(urllib.parse.parse_qsl(u.query)).get('to', '/'))
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        return super().do_GET()

    def log_message(self, *a):
        pass


_servers = []


def start():
    for port, h in ((PAGE_PORT, Page), (MEDIA_PORT, Media)):
        s = http.server.ThreadingHTTPServer(('127.0.0.1', port), h)
        s.daemon_threads = True
        threading.Thread(target=s.serve_forever, daemon=True).start()
        _servers.append(s)


def stop():
    for s in _servers:
        s.shutdown()


def count(path_prefix, since, dest=None):
    """Abrufe ab Index since, deren Pfad samt Query mit path_prefix beginnt."""
    return sum(1 for e in LOG[since:] if e[0].startswith(path_prefix) and (dest is None or e[2] == dest))
