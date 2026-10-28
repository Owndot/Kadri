// Mutationsprobe für den Helfer-Kanal: Jeder Mutant baut gezielt einen Sicherheitsfehler in eine KOPIE des Codes ein.
// Die Tests müssen jeden Mutanten erkennen (fehlschlagen). Die echten Quellen werden nie verändert.
//   HELPER_HOST_DIR=... node tests/channel/channel_mutation_check.js   (vorher: node tools/build.js --channel-poc)
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
  ['Warteschlange unbegrenzt', 'channel-session.js', "if (queued >= MAX_QUEUE)", "if (false)"],
  ['Codeformat ungeprüft', 'channel-session.js', "if (!/^[0-9]{8}$/.test(code))", "if (false)"],
  ['Dummy-Inhalt ungeprüft', 'channel-session.js', "if (r[13 + i] !== ((offset + i) * 31 + 7 + transfer) % 256)", "if (false)"],
  ['Dummy-Größe unbegrenzt', 'channel-session.js', "size > DUMMY_MAX", "size > Infinity"],
  ['stille Identität neben gespeichertem Pin', 'channel-store.js', "      if (await pin()) throw new StoreError('inconsistent'", "      if (false) throw new StoreError('inconsistent'"],
  ['Schreibfehler verschluckt', 'channel-store.js', "try { await backend.put(k, v); } catch (e) { throw new StoreError('storage', 'Speichern fehlgeschlagen – nichts geändert'); }", "try { await backend.put(k, v); } catch (e) { }"],
  ['beschädigter Pin stillschweigend verworfen', 'channel-store.js', "if (!validPin(p)) throw new StoreError('corrupt'", "if (!validPin(p)) return null; if (false) throw new StoreError('corrupt'"],
  ['Weiterleitungen werden verfolgt', 'channel-transport.js', "redirect: 'error'", "redirect: 'follow'"],
  ['Antwortgröße unbegrenzt', 'channel-transport.js', "declared > MAX_RESPONSE", "declared > Infinity"],
  ['beliebige Pfade', 'channel-transport.js', "if (!PATHS.has(path))", "if (false)"],
  ['keine Zeitgrenze', 'channel-transport.js', "signal: AbortSignal.timeout(timeoutMs),", ""],
];
const BROWSER_MUTANTS = [
  ['Absenderprüfung entfernt (Content-Scripts dürfen koppeln)', 'channel/channel-service.js', "const fromPage = sender &&", "const fromPage = true || sender &&"],
  ['Netzwerkfreigabe für alle Methoden', 'channel/channel-service.js', "requestMethods: ['post'], ", ""],
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
if (!run('channel_integration_check.js', {}, 600000, true)) { console.log('baseline integration FAILED'); process.exit(1); }
if (!run('channel_browser_check.js', {}, 600000, true)) { console.log('baseline browser FAILED'); process.exit(1); }
console.log('baselines pass');
for (const [name, file, from, to] of NODE_MUTANTS) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kadri-channel-mutant-'));
  fs.cpSync(path.join(ROOT, 'channel'), dir, { recursive: true });
  mutate(path.join(dir, file), from, to);
  // erst die schnellen Unit-Tests, dann die Integration; hängt ein Mutant, gilt die Zeitgrenze als erkannt
  const passed = run('channel_unit_check.js', { CHANNEL_SRC_DIR: dir }, 120000) && run('channel_integration_check.js', { CHANNEL_SRC_DIR: dir }, 240000);
  fs.rmSync(dir, { recursive: true, force: true });
  if (passed) survived++;
  console.log((passed ? 'SURVIVED ' : 'killed   ') + name);
}
for (const [name, file, from, to] of BROWSER_MUTANTS) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kadri-channel-mutant-dist-'));
  fs.cpSync(path.join(ROOT, 'dist', 'channel-poc'), dir, { recursive: true });
  mutate(path.join(dir, file), from, to);
  const passed = run('channel_browser_check.js', { CHANNEL_DIST_DIR: dir }, 300000);
  fs.rmSync(dir, { recursive: true, force: true });
  if (passed) survived++;
  console.log((passed ? 'SURVIVED ' : 'killed   ') + name);
}
console.log('CHANNEL MUTATION RESULT ' + (survived ? 'FAIL (' + survived + ' survived)' : 'PASS') + ' ' + (NODE_MUTANTS.length + BROWSER_MUTANTS.length) + ' mutants');
process.exitCode = survived ? 1 : 0;
