# S4b-7a (Vorschlag, noch NICHT Teil von dash-gate/1): neutrale MPD-Fixtures zum Audit „unbekanntes EssentialProperty auf
# MPD-/Period-Ebene“. Nutzt die Bausteine von tests/web/dash/gate/erzeuge_fixtures.py (dieselbe Grund-MPD wie g01).
# Die vorgeschlagenen Erwartungen stehen von Hand in vorschlag.tsv; tests/s4b7_essential_audit.py zeigt das IST-Verhalten.
#   python3 erzeuge.py ZIELORDNER
import os, sys, io, runpy, tempfile, contextlib
OUT = sys.argv[1]
GEN = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'web', 'dash', 'gate', 'erzeuge_fixtures.py')
argv = sys.argv; sys.argv = [GEN, tempfile.mkdtemp()]
with contextlib.redirect_stdout(io.StringIO()): g = runpy.run_path(GEN)
sys.argv = argv
mpd, period, B, vset, aset, vrep, vtpl, up = g['mpd'], g['period'], g['B'], g['vset'], g['aset'], g['vrep'], g['vtpl'], g['up']
def prop(kind, scheme='urn:example:needs-feature', value=None, ind='  '):
    s = '' if scheme is None else ' schemeIdUri="%s"' % scheme
    v = '' if value is None else ' value="%s"' % value
    return '%s<%s%s%s/>\n' % (ind, kind, s, v)
E, SP = 'EssentialProperty', 'SupplementalProperty'
F = {}
F['e01-mpd-essential-unknown'] = mpd(period(B), extra=prop(E))
F['e02-mpd-supplemental-unknown'] = mpd(period(B), extra=prop(SP))
F['e03-period-essential-unknown'] = mpd('  <Period id="0">\n' + prop(E, ind='    ') + B + '  </Period>\n')
F['e04-period-supplemental-unknown'] = mpd('  <Period id="0">\n' + prop(SP, ind='    ') + B + '  </Period>\n')
F['e05-mpd-essential-unknown-and-urlparam'] = mpd(period(B), extra=up() + prop(E))
F['e06-mpd-essential-no-scheme'] = mpd(period(B), extra=prop(E, scheme=None, value='1'))
F['e07-mpd-essential-cicp'] = mpd(period(B), extra=prop(E, scheme='urn:mpeg:mpegB:cicp:TransferCharacteristics', value='1'))
F['e08-set-essential-unknown'] = mpd(period(vset(extra=prop(E, ind='      ')) + aset()))
F['e09-rep-essential-one'] = mpd(period(vset(reps=vrep('v0', 'avc1.4d400c', 90000, 320, 180, prop(E, ind='')) + vrep('v1', 'avc1.4d401e', 320000, 640, 360)) + aset()))
F['e10-essential-misplaced'] = mpd(period(vset(tpl=vtpl().replace('<SegmentTimeline>', prop(E, ind='') + '<SegmentTimeline>')) + aset()))
F['e11-audio-set-essential-unknown'] = mpd(period(vset() + aset(extra=prop(E, ind='      '))))
os.makedirs(OUT, exist_ok=True)
for k, v in F.items():
    with open(os.path.join(OUT, k + '.mpd'), 'w', encoding='utf-8', newline='\n') as f: f.write(v)
print(len(F), 'Fixtures nach', OUT)
