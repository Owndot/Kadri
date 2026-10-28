// Kadri – Testseite des Helfer-Kanals (nur im isolierten Test-Build). Spricht nur mit dem eigenen Hintergrund;
// der Hintergrund nimmt Kanal-Befehle ausschließlich von dieser Seite an.
'use strict';
const api = globalThis.chrome;
const $ = (id) => document.getElementById(id);
const say = (text) => { $('out').textContent = text; };
const send = (op, extra) => api.runtime.sendMessage(Object.assign({ t: 'kadri-channel', op }, extra || {}));

async function refresh() {
  const r = await send('status');
  if (!r.ok) { $('status').textContent = 'Status nicht verfügbar: ' + r.error.message; return; }
  const v = r.value;
  $('status').textContent = 'Zustand: ' + v.state + (v.paired ? ' · Kopplung ' + v.reg + '… · Helfer ' + v.helper + '…' : '') +
    (v.lastError ? ' · zuletzt: ' + v.lastError.message : '');
}

async function run(op, extra, busyText) {
  say(busyText || '…');
  const r = await send(op, extra);
  say(r.ok ? JSON.stringify(r.value, null, 1) : 'Fehler (' + r.error.kind + '): ' + r.error.message);
  await refresh();
  return r;
}

$('pair').addEventListener('click', async () => {
  const code = $('code').value.replace(/\s+/g, '');
  $('code').value = '';                     // Code nicht stehen lassen
  const r = await run('pair', { code }, 'Kopplung läuft …');
  if (r.ok) say((r.value.helperChanged ? 'Gekoppelt – ACHTUNG: andere Helfer-Identität als bisher.\n' : 'Gekoppelt.\n') + JSON.stringify(r.value, null, 1));
});
$('ping').addEventListener('click', () => run('ping'));
$('dummy').addEventListener('click', () => run('dummy', { size: 1048576 }, 'Dummy-Daten werden übertragen …'));
$('forget').addEventListener('click', () => {
  if (confirm('Gespeicherte Kopplung vergessen? Danach ist eine neue Kopplung per Code nötig.')) run('forget');
});
refresh();
