"""P0-A/B1 im Chromium-Komponententest nach Audit-Anhang A."""
import os
from pathlib import Path
import subprocess
import tempfile

from common import B, check, done, results, shutdown, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
# Gemeinsamer Prüfstand für Resource Timing, Manifestanalyse und Netzfolge wie beim Annex-I-Test.
fixture = (ROOT / 'tests/test_dash_urlparam.py').read_text(encoding='utf-8')
scope = {'__name__': __name__}
exec(fixture[:fixture.index('class H(')], scope)


def mod(number):
    return next((ROOT / 'src').glob(number + '-*.js')).read_text(encoding='utf-8')


cut = scope['cut']
player = mod('180')
player_menu = cut(player, '    function dashList(', '    // Gehört der laufende') + cut(
    player, '    function dlMenu(', '    // Tipp: immer die Auswahl')
diagnose = cut(mod('280'), '  const anonKind = ', '  function diagAnon()')
# Die Annex-I-Fixture stellt anonExt bereits für den Ressourcenbeobachter bereit.
diagnose = diagnose[:diagnose.index('  const anonExt = ')] + diagnose[diagnose.index('  const anonCount = '):]
units = (cut(mod('040'), '  function dashSummaryOf(', '  try {\n    new PerformanceObserver(')
         + mod('045') + mod('065') + mod('105') + diagnose)
stubs = '''
  const PH = false, CONFIG = {}, SHOW_DOWNLOAD = false, IN_FRAME = self !== top,
    KADRI_DOWNLOAD = () => {}, playerSources = () => {}, shadowVids = [],
    hdlEvidenceText = x => x.identity, sameOrigin = u => new URL(u).origin === location.origin,
    IS_ANDROID_UA = () => false, hdlSourceInfo = () => ({}), hdlDiagFailure = () => {},
    hdlDiagCode = () => '', toast = () => {};
  const caps = { reachable: true, supported: true, hls: true, dash: true };
  const hdlCapsSeen = {...caps, at: Date.now()};
  let active, menu, commands = [], relayed = [], planReply, sheets = 0;
  const KADRI_FRAMEUI = { send: async m => { relayed.push(m); return {ok: true}; } };
  pageDlMenu = (title, items, here, rid) => {
    if (!here && IN_FRAME && fuiRelay()) fuiFrameMenu(title, items, rid);
    else { menu = items; sheets++; }
  };
  const helperDl = async (op) => {
    commands.push(op);
    if (op === 'caps') return {ok: true, value: caps};
    if (op === 'dashplan') return planReply;
    if (op === 'dashstart') return null;
    return {ok: true, value: null};
  };
'''
export = '''
  function playerMenuFor(orig) {
    const ctx = mediaRegistry.contextFor(orig), st = {media: {orig: ctx}, hdl: {ok: true, hls: true, dash: true}};
    const directUrl = () => '', hdlUrl = () => '', hdlProbe = () => {}, hdlActive = () => false,
      hdlOptions = () => selectDownloads(mediaRegistry.snapshot(ctx), {supported: true}).map(x => ({...x, ctx})),
      hdlAttemptable = () => hdlOptions().filter(x => x.state === 'attemptable'),
      hlsOptions = () => [], hlsAttemptable = () => [], menu = {querySelector: () => null};
    let labels;
    const openMenu = (_, items) => { labels = items.map(x => x.label); };
    __PLAYER__
    dlMenu(false, true);
    return {labels, primary: hdlPrimary(), shown: hdlShown()};
  }
  Object.assign(window.__k, {
    mediaRegistry, pageDlOptions, dashOfferStill, pageDlDashGo, pageDlDashPlan, selectDashStreams,
    open: async v => { active = v; await onPageDownload(); return menu.map(x => x.label); },
    playerMenuFor,
    diag: () => { const lines = []; diagFrameSources(lines); return anonScrub(lines.join('\\n')); },
    handleRelay: v => {
      active = v;
      fui.shown = true;
      fui.mode = 'remote';
      return KADRI_FRAMEUI.onMsg({op: 'act', a: 'dl', n: fui.n, rid: '12345678'});
    },
    pickRelay: (seq, i) => fuiFramePick(seq, i),
    sheetCount: () => sheets,
    setPlanReply: reply => { planReply = reply; }, commands, relayed,
  });
'''.replace('__PLAYER__', player_menu)
base = scope['SRC'].replace('allVideos = () => []', "allVideos = () => Array.from(document.querySelectorAll('video'))")
src = base.replace(scope['EXPORT'], units + stubs + mod('035') + scope['EXPORT'] + export)

try:
    with tempfile.TemporaryDirectory() as tmp, sync_playwright() as pw:
        clip = Path(tmp) / 'clip.mp4'
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-stream_loop', '-1', '-i', str(ROOT / 'tests/web/clip.mp4'),
                        '-t', '20', '-c', 'copy', '-movflags', '+faststart', str(clip)], check=True)
        browser = pw.chromium.launch(executable_path=os.environ.get('KADRI_CHROMIUM'))
        page = browser.new_page()
        page.goto(B)
        page.set_content('<video id="v" muted loop></video><video id="other" preload="none" muted></video>')
        page.route('**/clip-*.mp4', lambda route: route.fulfill(path=str(clip), content_type='video/mp4'))
        page.add_script_tag(content=src)
        page.evaluate("async () => { v.src='/clip-a.mp4'; await v.play(); other.src='/clip-b.mp4'; other.load(); }")
        page.evaluate("""async () => {
            const dir = '/public/s3d-dash/', response = await fetch(dir + 'manifest.mpd');
            if (!response.ok) throw Error('MPD ' + response.status);
            __k.notePlaylist(response.url, response.url, await response.text());
            for (const n of ['00001', '00002', '00003']) {
                const response = await fetch(dir + 'chunk-0-' + n + '.m4s');
                if (!response.ok || !(await response.arrayBuffer()).byteLength) throw Error('Fixture ' + n);
            }
        }""")
        page.wait_for_function("Object.values(__k.dashBindingFor(v).res).some(r => r.hits === 3 && r.run === 3)")
        outcome = page.evaluate("""async () => {
            const k = __k, opts = k.pageDlOptions(v, {reachable: true, supported: true, dash: true});
            const ctx = k.mediaRegistry.contextFor(v), snap = k.mediaRegistry.snapshot(ctx);
            const source = snap.find(s => s.kind === 'dash');
            const choice = k.selectDashStreams(snap, {dash: true})[0];
            const url = new URL('/public/s3d-dash/manifest.mpd', location.href).href;
            const bind = {player: ctx.playerId, gen: ctx.mediaEpoch, rev: source.revision};
            const offer = k.dashOfferOf(url, k.dashFromOf(v)), old = {v, x: {...source, ctx}, offer};
            window.prepared = {old, bind};
            return {playing: !v.paused && other.paused && v.currentSrc.endsWith('/clip-a.mp4'),
                association: source.association.state, selection: choice.state, identity: choice.identity,
                mp4: opts.mp4.some(x => x.identity === 'played'), levels: opts.dashLv?.code, profile: opts.dashLv?.e3.code,
                offer: !!opts.dashOffer?.offer, validOldMenu: k.dashOfferStill(old, bind),
                menu: await k.open(v), player: k.playerMenuFor(v), diag: k.diag(), commands: k.commands};
        }""")
        check('MP4 A spielt, Zweitvideo pausiert, DASH-Vorprüfung bleibt positiv',
              outcome['playing'] and outcome['mp4'] and outcome['profile'] == 'ok')
        check('Fremde DASH-Folge bleibt Kandidat ohne gespielte Identität',
              outcome['association'] == 'ambiguous' and outcome['selection'] == 'candidate' and outcome.get('identity') != 'played',
              {key: outcome.get(key) for key in ('association', 'selection', 'identity')})
        item = 'DASH-Stream erkannt – Zuordnung zum Video nicht nachgewiesen'
        check('E2 in beiden Menüs, MP4 bleibt wählbar, keine DASH-Befehle oder Aktion',
              outcome['levels'] == 'E2/element-unproven' and not outcome['offer'] and
              all(item in labels and not any('DASH-Stream mit Helper' in x for x in labels) and
                  'Mit Helper herunterladen' in labels for labels in (outcome['menu'], outcome['player']['labels'])) and
              outcome['player']['primary'].endswith('/clip-a.mp4') and
              not {'dashplan', 'dashstart'} & set(outcome['commands']), (outcome['menu'], outcome['player'], outcome['commands']))
        check('Alte Auswahl bleibt auch mit aktuellem Kontext gesperrt', outcome['validOldMenu'] is False)
        check('Diagnose trennt Netzfolge, Angebot und Helferfähigkeit und bleibt anonym',
              all(x in outcome['diag'] for x in ('Netzfolge passt', 'Angebot nein', 'DASH ja', 'Treffer 3')) and
              not any(x in outcome['diag'] for x in ('://', 'clip-a', 's3d-dash', 'manifest.mpd')))

        delayed = page.evaluate("""async () => {
            const k = __k, {old, bind} = window.prepared, {x, offer} = old;
            const option = 'a'.repeat(24), planId = 'b'.repeat(32);
            // Testdouble nur für die erste Prüfung: Eine bereits gesendete Planung antwortet verspätet.
            const resolveDash = k.mediaRegistry.resolveDash;
            let first = true, answer;
            k.mediaRegistry.resolveDash = (...args) => {
                if (!first) return resolveDash(...args);
                first = false;
                return {ok: true, url: offer.url, bind};
            };
            k.setPlanReply(new Promise(resolve => { answer = resolve; }));
            const sheets = k.sheetCount(), pending = k.pageDlDashPlan(old);
            v.src = '/clip-b.mp4';
            await v.play();
            answer({ok: true, value: {planId, options: [{id: option}]}});
            await pending;
            k.mediaRegistry.resolveDash = resolveDash;
            for (let i = 0; i < 2; i++) await k.pageDlDashGo(offer.url, planId, {id: option}, x, old, bind);
            return {plan: k.commands.filter(op => op === 'dashplan').length,
                start: k.commands.filter(op => op === 'dashstart').length,
                newSheets: k.sheetCount() - sheets, oldEpoch: x.ctx.mediaEpoch < k.mediaRegistry.contextFor(v).mediaEpoch,
                still: k.dashOfferStill(old, bind)};
        }""")
        check('Vorbereiteter Plan: verspätete Antwort nach Medienwechsel und wiederholte Auswahl starten nichts',
              delayed == {'plan': 1, 'start': 0, 'newSheets': 0, 'oldEpoch': True, 'still': False}, delayed)

        page.set_content('<iframe src="/direct.html"></iframe>')
        page.locator('iframe').content_frame.locator('video').wait_for(state='attached')
        child = page.frames[1]
        child.set_content('<video muted playsinline></video>')
        child.add_script_tag(content=src)
        child.add_script_tag(url=B + 's4a/own.js')
        child.evaluate("""async () => {
            const v = document.querySelector('video');
            const u = '/public/s3d-dash/manifest.mpd', r = await fetch(u);
            __k.notePlaylist(r.url, r.url, await r.text());
            const p = await S4A.start({video: v, mpd: u, mode: 'main', burst: true});
            if (p.err || !p.done || p.segs < 3) throw Error(p.err || 'Wiedergabe-Fixture fehlgeschlagen');
        }""")
        child.wait_for_function("""() => {
            const v = document.querySelector('video');
            return v.currentTime > 0.5 && v.videoWidth > 0 && v.webkitAudioDecodedByteCount > 0 && !v.error && /^blob:/.test(v.currentSrc);
        }""")
        relay = child.evaluate("""async () => {
            const v = document.querySelector('video'), k = __k;
            const o = k.pageDlOptions(v, {reachable: true, supported: true, dash: true}), handled = k.handleRelay(v);
            for (let i = 0; i < 20 && !k.relayed.length; i++) await new Promise(r => setTimeout(r, 10));
            const m = k.relayed.find(m => m.op === 'menu');
            const info = m?.items.findIndex(x => x.label.includes('Zuordnung zum Video nicht nachgewiesen'));
            const pick = info >= 0 ? k.pickRelay(m.seq, info) : null;
            const player = k.playerMenuFor(v);
            return {handled: handled.ok, code: o.dashLv?.code, gate: o.dashLv?.e3.code, items: m?.items,
                primary: player.primary, shown: player.shown, relayId: m?.rid, pick, commands: k.commands};
        }""")
        check('Echtes DASH im iframe: Gate positiv, Relay meldet E2 ohne Aktion und keine speicherbare Primärquelle',
              relay['handled'] and relay['gate'] == 'ok' and relay['code'] == 'E2/element-unproven' and
              relay['relayId'] == '12345678' and relay['pick'] == {'ok': False} and relay['primary'] == '' and not relay['shown'] and
              not any('DASH-Stream mit Helper' in x['label'] for x in relay['items']) and
              not {'dashplan', 'dashstart'} & set(relay['commands']), relay)
        browser.close()
finally:
    shutdown()
done()
raise SystemExit(0 if all(results) else 1)
