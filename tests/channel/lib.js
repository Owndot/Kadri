// Gemeinsame Hilfen der Kanal-Tests (nur Tests).
//  - loadChannel(): lädt den vendorten WASM-Kern und die Kanal-Module in Node – dieselben Dateien wie im Test-Build.
//  - startHelper(): startet den echten ChannelServer der Helper-App auf dem Desktop (ChannelHarness aus dem
//    Helper-Repository, tests/java/channel/build.sh; Ausgabe-Pfad in HELPER_HOST_DIR) und steuert ihn über stdin:
//    open | list | revoke <id> | revoke-all | restart | reset-identity | device | rogue-on | rogue-off | fail-persist on|off
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const { spawn } = require('child_process');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');

function loadChannel() {
  if (globalThis.KadriChannel && globalThis.wasm_bindgen) return { NS: globalThis.KadriChannel, core: globalThis.wasm_bindgen };
  const dir = path.join(ROOT, 'vendor', 'kadri-pairing-poc');
  const src = fs.readFileSync(path.join(dir, 'SOURCE'), 'utf8');
  const want = (k) => (new RegExp('^' + k + '=([0-9a-f]{64})$', 'm').exec(src) || [])[1];
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex');
  if (sha('kadri_pairing_poc.js') !== want('sha256_js') || sha('kadri_pairing_poc_bg.wasm') !== want('sha256_wasm')) throw new Error('vendored core does not match vendor/kadri-pairing-poc/SOURCE');
  // Wie im Service Worker: der Glue legt eine globale lexikalische Bindung `wasm_bindgen` an (keine Eigenschaft von
  // globalThis). Für die Tests wird sie zusätzlich als Eigenschaft bereitgestellt.
  vm.runInThisContext(fs.readFileSync(path.join(dir, 'kadri_pairing_poc.js'), 'utf8') + '\n;globalThis.wasm_bindgen = wasm_bindgen;', { filename: 'kadri_pairing_poc.js' });
  globalThis.wasm_bindgen.initSync({ module: fs.readFileSync(path.join(dir, 'kadri_pairing_poc_bg.wasm')) });
  // CHANNEL_SRC_DIR: nur für die Mutationsprobe (tests/channel/channel_mutation_check.js) – mutierte Kopien.
  const srcDir = process.env.CHANNEL_SRC_DIR || path.join(ROOT, 'channel');
  for (const f of ['channel-store.js', 'channel-transport.js', 'channel-session.js', 'channel-downloads.js'])
    vm.runInThisContext(fs.readFileSync(path.join(srcDir, f), 'utf8'), { filename: f });
  return { NS: globalThis.KadriChannel, core: globalThis.wasm_bindgen };
}

// Wartet, bis Port 47899 frei ist (ein vorheriger Host kann noch herunterfahren).
async function portFree(port, ms) {
  const net = require('net');
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const busy = await new Promise((res) => { const c = net.connect(port, '127.0.0.1'); c.on('connect', () => { c.destroy(); res(true); }); c.on('error', () => res(false)); });
    if (!busy) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('port ' + port + ' still busy');
}

// opts.state: Zustandsverzeichnis eines früheren Laufs weiterverwenden (Neustart des Helfer-Prozesses, Phase C3).
function startHelper(opts = {}) {
  const dir = process.env.HELPER_HOST_DIR;
  if (!dir) throw new Error('HELPER_HOST_DIR not set (output of the helper repository\'s tests/java/channel/build.sh)');
  const state = opts.state || fs.mkdtempSync(path.join(os.tmpdir(), 'kadri-channel-helper-'));
  const events = [], waiting = [];
  let p = null, buf = '';
  const next = () => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('helper did not answer')), 20000);
    waiting.push((l) => { clearTimeout(t); res(l); });
  });
  const ready = portFree(47899, 15000).then(() => {
    p = spawn('java', ['-Djava.library.path=' + path.join(dir, 'lib'), '-cp', path.join(dir, 'classes'), 'de.evp.helfer.ChannelHarness', state],
      // UTF-8-Dateinamen in der Desktop-Ablage (auf Android immer UTF-8)
      { stdio: ['pipe', 'pipe', 'inherit'], env: Object.assign({}, process.env, { LC_ALL: 'C.UTF-8' }) });
    p.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        if (line.startsWith('EVENT ')) { events.push(line.slice(6)); continue; }
        const w = waiting.shift();
        if (w) w(line);
      }
    });
    return next();
  });
  const cmd = async (c) => { await ready; const r = next(); p.stdin.write(c + '\n'); return r; };
  return {
    ready, events, cmd, state,
    async code() { const r = await cmd('open'); const m = /^CODE ([0-9]{8})$/.exec(r); if (!m) throw new Error('no code: ' + r); return m[1]; },
    // Zustand des nachgebildeten Geräts (Helligkeit, Lautstärke, Zähler) als Objekt.
    async device() {
      const r = await cmd('device');
      const o = {};
      for (const [, k, v] of r.matchAll(/(\w+)=(\S+)/g)) o[k] = v === 'true' ? true : v === 'false' ? false : Number(v);
      return o;
    },
    async regs() { const r = await cmd('list'); return r.split(' ').slice(1); },
    // keep: Zustand (Kopplungen, Download-Journal, Dateien) für einen Neustart behalten; kill: Prozess hart beenden.
    async stop(o = {}) {
      if (p) {
        const exited = new Promise((r) => p.once('exit', r));
        if (o.kill) p.kill('SIGKILL'); else { try { await cmd('quit'); } catch (e) {} p.kill(); }
        await exited;
      }
      if (!o.keep) fs.rmSync(state, { recursive: true, force: true });
    },
  };
}

let failures = 0, passes = 0;
function check(name, ok, detail) {
  if (ok) passes++; else failures++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
}
async function expectError(promise, kind) {
  try { await promise; return 'no error'; }
  catch (e) { return e && e.kind === kind ? true : 'got ' + (e && e.kind) + ': ' + (e && e.message); }
}
function summary(label) {
  console.log('RESULT ' + label + ' ' + (failures ? 'FAIL' : 'PASS') + ' ' + passes + '/' + (passes + failures));
  if (failures) process.exitCode = 1;
}

module.exports = { ROOT, loadChannel, startHelper, check, expectError, summary };
