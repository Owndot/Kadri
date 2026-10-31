// Mutationsprobe für den Helfer-Kanal: Jeder Mutant baut gezielt einen Sicherheitsfehler in eine KOPIE des Codes ein.
// Die Tests müssen jeden Mutanten erkennen (fehlschlagen). Die echten Quellen werden nie verändert.
//   HELPER_HOST_DIR=... node tests/channel/channel_mutation_check.js   (vorher: node tools/build.js --test)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT } = require('./lib');

const NODE_MUTANTS = [
  ['R4: Pin vor der Bestätigung gespeichert', 'channel-session.js', "        const keep = previous ?", "        await store.setPin(candidate);\n        const keep = previous ?"],
  ['Widerruf: Pin automatisch vergessen', 'channel-session.js', "state = 'rejected'; throw fail('rejected');", "state = 'rejected'; await store.forgetPin(); throw fail('rejected');"],
  ['fremde Identität als Widerruf eingeordnet', 'channel-session.js', "throw fail(coreError(e) === 'AuthFailed' ? 'identity-mismatch' : 'protocol'", "throw fail(coreError(e) === 'AuthFailed' ? 'rejected' : 'protocol'"],
  ['jeder Fehler wird wiederholt', 'channel-session.js', "if (e.kind !== 'stale-session') throw e;", "if (false) throw e;"],
  ['Sitzung nach Manipulation weiterverwendet', 'channel-session.js', "        if (session === s) drop();\n        state = 'paired';\n        throw fail('tampered'", "        state = 'paired';\n        throw fail('tampered'"],
  ['I1: jeder Befehl nach 404 wiederholt', 'channel-session.js', "const retryableAfterStaleSession = (op) => IDEMPOTENT_OPS.has(op);", "const retryableAfterStaleSession = (op) => true;"],
  ['I1: kein Befehl nach 404 wiederholt', 'channel-session.js', "const retryableAfterStaleSession = (op) => IDEMPOTENT_OPS.has(op);", "const retryableAfterStaleSession = (op) => false;"],
  ['Warteschlange unbegrenzt', 'channel-session.js', "if (queued >= MAX_QUEUE)", "if (false)"],
  ['Codeformat ungeprüft', 'channel-session.js', "if (!/^[0-9]{8}$/.test(code))", "if (false)"],
  ['Befehl: beliebige Befehle durchgelassen', 'channel-session.js', "    if (op !== 'vol' && op !== 'bright') return null;", "    if (op !== 'vol' && op !== 'bright') return { op };"],
  ['Befehl: Helligkeit ohne Untergrenze', 'channel-session.js', "!(r >= 0.004 && r <= 1)", "!(r <= 1)"],
  ['Befehl: Werte ungerundet (Exponent möglich)', 'channel-session.js', "const r = Math.round(v * 1e4) / 1e4;", "const r = v;"],
  ['Befehl: Antwort ohne ok-Prüfung', 'channel-session.js', "if (!reply || typeof reply.ok !== 'boolean') { drop(); throw fail('protocol'); }", "if (!reply) { drop(); throw fail('protocol'); }"],
  ['Befehl: Antwort anderer Record-Art angenommen', 'channel-session.js', "      if (r[0] !== 1) return null;", ""],
  ['stille Identität neben gespeichertem Pin', 'channel-store.js', "      if (await pin()) throw new StoreError('inconsistent'", "      if (false) throw new StoreError('inconsistent'"],
  ['Schreibfehler verschluckt', 'channel-store.js', "try { await backend.put(k, v); } catch (e) { throw new StoreError('storage', 'Speichern fehlgeschlagen – nichts geändert'); }", "try { await backend.put(k, v); } catch (e) { }"],
  ['beschädigter Pin stillschweigend verworfen', 'channel-store.js', "if (!validPin(p)) throw new StoreError('corrupt'", "if (!validPin(p)) return null; if (false) throw new StoreError('corrupt'"],
  ['Weiterleitungen werden verfolgt', 'channel-transport.js', "redirect: 'error'", "redirect: 'follow'"],
  ['Antwortgröße unbegrenzt', 'channel-transport.js', "declared > MAX_RESPONSE", "declared > Infinity"],
  ['beliebige Pfade', 'channel-transport.js', "if (!PATHS.has(path))", "if (false)"],
  ['keine Zeitgrenze', 'channel-transport.js', "signal: AbortSignal.timeout(timeoutMs),", ""],
  // Phase C3: direkte MP4-Downloads
  ['Download: fremde Felder (Cookie, Header, Referer) durchgelassen', 'channel-session.js', "if (op !== 'dlstart' || !keys.every((k) => k === 'id' || k === 'url' || k === 'name')) return null;", "if (op !== 'dlstart') return null;"],
  ['Download: URL-Zeichen ungeprüft (Zeilenumbruch, Leerzeichen)', 'channel-session.js', "!DL_URL.test(a.url)", "!/^https?:/.test(a.url)"],
  ['Download: Name ungeprüft', 'channel-session.js', "a.name.length > 120 || DL_NAME_BAD.test(a.name)", "a.name.length > 120"],
  ['Download: dlstatus/dlcancel mit Zusatzfeldern', 'channel-session.js', "return keys.every((k) => k === 'id') ? { op, id: a.id } : null;", "return { op, id: a.id };"],
  ['Verwaltung: doppelter Start nicht erkannt', 'channel-downloads.js', "const same = jobs.find((x) => x.key === key && !TERMINAL.has(x.state));", "const same = null;"],
  ['Verwaltung: Kennung erst nach dem Senden gespeichert', 'channel-downloads.js', "        await save(jobs);                // erst gespeichert, dann gesendet: die Kennung überlebt jeden Abbruch\n", ""],
  ['Verwaltung: URL im Speicher', 'channel-downloads.js', "const j = { id: random(), key, name:", "const j = { id: random(), key, url, name:"],
  ['Verwaltung: Wiederholung mit neuer Kennung', 'channel-downloads.js', "try { await send(j, url); }   // dieselbe Kennung", "try { j.id = random(); await send(j, url); }"],
  ['Verwaltung: „sicher nicht angekommen“ ignoriert', 'channel-downloads.js', "!!e && !e.notSent && ", "!!e && "],
  ['Verwaltung: Abbruch nach Verbindungsabbruch nicht nachgeholt', 'channel-downloads.js', "if (s === 'running' && j.state === 'cancelling') {", "if (false) {"],
  ['Verwaltung: Abbruchabsicht vor Netzwerk nicht gespeichert', 'channel-downloads.js', "        await save(jobs);                // Abbruchabsicht dauerhaft, bevor dlcancel den Browser verlässt\n", ""],
  ['Verwaltung: laufender Auftrag verliert Abbruchabsicht', 'channel-downloads.js', "        j.state = 'cancelling';", "        if (j.state !== 'running') j.state = 'cancelling';"],
  ['Verwaltung: unknown fälschlich als Abbruch bestätigt', 'channel-downloads.js', "if (j.state === 'cancelling') { pending.delete(id); }", "if (j.state === 'cancelling') { j.state = 'cancelled'; pending.delete(id); }"],
  ['Verwaltung: Grund ungefiltert übernommen', 'channel-downloads.js', "typeof r.reason === 'string' && /^[a-z0-9_]{0,40}$/.test(r.reason)", "typeof r.reason === 'string'"],
  ['Verwaltung: Antwort für fremde Kennung angenommen', 'channel-downloads.js', "if (r.id !== j.id) {", "if (false) {"],
  ['Verwaltung: ohne URL nach Neustart erneut gestartet (alte URL geraten)', 'channel-downloads.js', "} else { j.state = 'failed'; j.reason = 'not_started'; }", "} else { try { await send(j, 'https://media.example/videos/clip.mp4'); } catch (e) {} }"],
  ['Verwaltung: Zugangsdaten in der URL erlaubt', 'channel-downloads.js', "|| url.username || url.password) return null;", ") return null;"],
];
const BROWSER_MUTANTS = [   // [Name, Datei in dist/test, alt, neu]
  ['Verwaltung: Absenderprüfung entfernt (Content-Scripts dürfen koppeln)', 'channel/channel-service.js', "if (!a || !a.pages.some((p) => isPage(sender, p)))", "if (!a)"],
  ['Verwaltung: Menü darf koppeln', 'channel/channel-service.js', "pair: { pages: ['options.html'],", "pair: { pages: ['options.html', 'popup.html'],"],
  ['Befehle: fremde Felder durchgelassen', 'channel/channel-service.js', "keys.every((k) => k === 't' || k === 'op' || k === 'v')", "true"],
  // (Kein Mutant „Befehle ungeprüft weitergereicht“: channel.command() prüft dieselbe Form selbst noch einmal –
  //  der Mutant wäre gleichwertig. Die Prüfung im Hintergrund deckt der Mutant „fremde Felder“ ab.)
  ['Kanal-Regel für alle Methoden', 'background.js', ", requestMethods: ['post'] }, OWN())", " }, OWN())"],
  ['Kanal-Regel für den ganzen Port', 'background.js', "47899/p1/(?:pair/m[02]|ch/(?:hs|rec))$'", "47899/'"],
  ['Alte Freigabe für Port 47811 wieder da', 'background.js', "const NET_RULES = [CHANNEL_RULE]", "const NET_RULES = [CHANNEL_RULE, { id: 50, priority: 10, action: { type: 'allow' }, condition: Object.assign({ regexFilter: '^http://127\\\\.0\\\\.0\\\\.1:47811/' }, OWN()) }]"],
  ['Vorbedingung im Kanal ignoriert', 'channel/channel-service.js', "const precondition = () => (typeof NS.networkPrecondition === 'function' ?", "const precondition = () => (false ?"],
];
function mutate(srcFile, from, to) {
  const text = fs.readFileSync(srcFile, 'utf8');
  if (text.split(from).length !== 2) throw new Error('pattern not found exactly once in ' + srcFile + ': ' + from);
  fs.writeFileSync(srcFile, text.replace(from, to));
}

function run(script, env, timeoutMs, verbose) {
  const r = spawnSync(process.execPath, [path.join(__dirname, script)], { env: Object.assign({}, process.env, env), encoding: 'utf8', timeout: timeoutMs });
  const ok = r.status === 0 && /RESULT \S+ PASS/.test(r.stdout || '');
  if (!ok && verbose) console.log(String(r.stdout || '').split('\n').filter((l) => /FAIL|RESULT|Error/.test(l)).slice(0, 10).join('\n') + '\n' + String(r.stderr || '').slice(-800));
  return ok;
}

let survived = 0;
if (!run('channel_unit_check.js', {}, 120000, true)) { console.log('baseline unit FAILED'); process.exit(1); }
if (!run('download_unit_check.js', {}, 120000, true)) { console.log('baseline download unit FAILED'); process.exit(1); }
if (!run('download_integration_check.js', {}, 300000, true)) { console.log('baseline download integration FAILED'); process.exit(1); }
if (!run('channel_integration_check.js', {}, 600000, true)) { console.log('baseline integration FAILED'); process.exit(1); }
if (!run('channel_browser_check.js', {}, 600000, true)) { console.log('baseline browser FAILED'); process.exit(1); }
if (!run('channel_netguard_failure_check.js', {}, 300000, true)) { console.log('baseline netguard failure FAILED'); process.exit(1); }
console.log('baselines pass');
for (const [name, file, from, to] of NODE_MUTANTS) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kadri-channel-mutant-'));
  fs.cpSync(path.join(ROOT, 'channel'), dir, { recursive: true });
  mutate(path.join(dir, file), from, to);
  // erst die schnellen Unit-Tests, dann die Integration; hängt ein Mutant, gilt die Zeitgrenze als erkannt
  const passed = run('channel_unit_check.js', { CHANNEL_SRC_DIR: dir }, 120000) && run('download_unit_check.js', { CHANNEL_SRC_DIR: dir }, 120000) &&
    run('channel_integration_check.js', { CHANNEL_SRC_DIR: dir }, 240000) && run('download_integration_check.js', { CHANNEL_SRC_DIR: dir }, 300000);
  fs.rmSync(dir, { recursive: true, force: true });
  if (passed) survived++;
  console.log((passed ? 'SURVIVED ' : 'killed   ') + name);
}
for (const [name, file, from, to] of BROWSER_MUTANTS) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kadri-channel-mutant-dist-'));
  fs.cpSync(path.join(ROOT, 'dist', 'test'), dir, { recursive: true });
  mutate(path.join(dir, file), from, to);
  // erkannt, wenn der Browser-Test oder der Fail-closed-Test fehlschlägt
  const passed = run('channel_browser_check.js', { CHANNEL_DIST_DIR: dir }, 300000) &&
    run('channel_netguard_failure_check.js', { CHANNEL_DIST_DIR: dir }, 300000);
  fs.rmSync(dir, { recursive: true, force: true });
  if (passed) survived++;
  console.log((passed ? 'SURVIVED ' : 'killed   ') + name);
}
console.log('CHANNEL MUTATION RESULT ' + (survived ? 'FAIL (' + survived + ' survived)' : 'PASS') + ' ' + (NODE_MUTANTS.length + BROWSER_MUTANTS.length) + ' mutants');
process.exitCode = survived ? 1 : 0;
