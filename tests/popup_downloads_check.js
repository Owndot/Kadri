// Exercise the actual popup, including storage/messages and timer-driven rendering.
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert/strict');
const path = require('path');
const original = fs.readFileSync(path.join(__dirname, '../chrome/popup.js'), 'utf8');
const KEY = 'kadri-download-dismissed-v1';
const job = (n, state) => ({ id: n.toString(16).padStart(32, '0'), at: n, name: 'Video ' + n, state,
  label: state === 'failed' ? 'Datei nicht gefunden' : state === 'done' ? 'Gespeichert in Download/Video-Assistent' : state,
  progress: state === 'running' ? '10 %' : '', reason: state === 'failed' ? 'http_404' : '' });
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
async function popup(source, initial, data = {}, status = () => {}) {
  const nodes = new Map(), timers = [], messages = [], writes = [];
  let clock = 0, jobs = structuredClone(initial), rejectWrite = false;
  function el(tag, props = {}, ...children) {
    const node = { tag, props, children: [], style: {}, textContent: '',
      append(...xs) { this.children.push(...xs.filter((x) => x !== null)); },
      replaceChildren(...xs) { this.children = []; this.append(...xs); },
      addEventListener() {}, get firstChild() { return this.children[0]; } };
    node.append(...children);
    if (props.id) nodes.set(props.id, node);
    return node;
  }
  el('div', { id: 'app' }); el('span', { id: 'ver' });
  const api = { runtime: { getManifest: () => ({ version: 'test' }), async sendMessage(m) {
    messages.push(structuredClone(m));
    if (m.t === 'kadri-channel') return { ok: true, value: { paired: false } };
    assert.equal(m.t, 'kadri-download');
    assert.ok(['list', 'status', 'cancel'].includes(m.op), 'popup must never start/delete a download');
    if (m.op === 'status') await status(jobs.find((j) => j.id === m.id), jobs);
    if (m.op === 'cancel') jobs.find((j) => j.id === m.id).state = 'cancelling';
    return { ok: true, value: structuredClone(jobs) };
  } }, tabs: { query: async () => [{ id: 1, url: 'https://unrelated.example/' }] }, storage: { local: {
    get: async () => structuredClone(data), set: async (values) => {
      if (rejectWrite) throw Error('storage unavailable');
      assert.deepEqual(Object.keys(values), [KEY], 'journal, settings and pairing must be untouched');
      writes.push(structuredClone(values)); Object.assign(data, structuredClone(values));
    }
  } } };
  const context = { api, el, document: { getElementById: (id) => nodes.get(id) },
    store: { settings: async () => ({}) }, applyLang() {}, eff: () => [], hostMatches: () => false, t: (s) => s,
    URL, URLSearchParams, location: { search: '' }, window: { close() {} }, Date: { now: () => clock },
    setTimeout(fn, ms) { timers.push({ fn, at: clock + ms }); } };
  await vm.runInNewContext(source, context); await flush();
  const rows = () => nodes.get('downloads').children.filter((x) => x.props && x.props.class === 'row dl');
  const text = (node) => typeof node === 'string' ? node : node.children.map(text).join(' ') + node.textContent;
  return { rows, text, messages, writes, data, jobs: () => jobs, rejectWrite: (v) => { rejectWrite = v; },
    button: (i) => rows()[i].children.find((x) => x.tag === 'button'),
    async click(i) { const b = this.button(i); assert.ok(b, 'button present'); await b.props.onclick({ currentTarget: b }); await flush(); },
    async tick(ms) {
      const end = clock + ms;
      while (timers.some((t) => t.at <= end)) {
        timers.sort((a, b) => a.at - b.at); const timer = timers.shift(); clock = timer.at;
        await timer.fn(); await flush();
      }
      clock = end;
    }
  };
}
async function verify(source) {
  const old = [job(1, 'done'), job(2, 'cancelled')];
  let p = await popup(source, old);
  assert.equal(p.rows().length, 0, 'old completed/cancelled history hidden on unrelated pages');
  await p.tick(20000); assert.equal(p.rows().length, 0, 'old completion never reappears');
  assert.deepEqual(p.jobs(), old, 'hidden history remains in journal');
  assert.equal(p.writes.length, 0, 'hiding history requires no journal/storage mutation');

  p = await popup(source, [job(3, 'running')]);
  assert.equal(p.rows().length, 1, 'running download visible');
  assert.ok(p.text(p.rows()[0]).includes('10 %'), 'progress visible');
  await p.click(0);
  assert.equal(p.jobs()[0].state, 'cancelling', 'cancel uses existing background route');
  assert.equal(p.rows().length, 1, 'persisted cancel remains visible');
  assert.equal(p.button(0), undefined, 'pending cancellation cannot be dismissed');
  assert.equal(p.messages.filter((m) => m.op === 'cancel').length, 1);
  for (const state of ['starting', 'unconfirmed', 'cancelling']) {
    const q = await popup(source, [job(4, state)]);
    assert.equal(q.rows().length, 1, state + ' survives reopening');
    assert.ok(q.messages.some((m) => m.t === 'kadri-download' && m.op === 'status'), state + ' reconciles through background');
  }

  // A completion during the very first status refresh also deserves a short confirmation.
  p = await popup(source, [job(5, 'running')], {}, (j) => Object.assign(j, job(5, 'done')));
  assert.equal(p.rows().length, 1, 'completion observed in first refresh is confirmed');
  await p.tick(1500); assert.equal(p.rows().length, 1, 'confirmation does not flash away immediately');
  await p.tick(4500); assert.equal(p.rows().length, 0, 'completion expires automatically');
  await p.tick(20000); assert.equal(p.rows().length, 0, 'polling does not renew confirmation');
  assert.equal(p.jobs()[0].state, 'done', 'expired notice preserves completed job');
  const reopened = await popup(source, p.jobs(), p.data);
  assert.equal(reopened.rows().length, 0, 'reopening does not replay success');

  const journal = [job(6, 'failed'), job(7, 'failed'), job(8, 'interrupted')];
  p = await popup(source, journal);
  assert.equal(p.rows().length, 3, 'errors remain available');
  assert.ok(p.text(p.rows()[0]).includes('Fehlgeschlagen: Datei nicht gefunden'), '404 clearly marked as failure');
  assert.equal(p.messages.filter((m) => m.t === 'kadri-download' && m.op === 'status').length, 0, 'terminal errors cause no retry');
  p.rejectWrite(true); await p.click(0);
  assert.equal(p.rows().length, 3, 'failed dismissal write must not pretend to persist');
  p.rejectWrite(false); await p.click(0);
  assert.equal(p.rows().length, 2, 'dismiss affects only chosen error');
  assert.deepEqual(p.jobs(), journal, 'dismiss keeps journal and error reason intact');
  assert.equal(p.messages.filter((m) => m.op === 'cancel').length, 0, 'dismiss is not download cancellation');
  p = await popup(source, journal, p.data);
  assert.equal(p.rows().length, 2, 'dismissal survives popup/browser restart');
  await p.click(1); assert.equal(p.rows().length, 1, 'interrupted notice can also be dismissed');
  const newFailure = [job(6, 'failed'), job(9, 'failed')];
  p = await popup(source, newFailure, p.data);
  assert.equal(p.rows().length, 1, 'a new attempt is not hidden with an old failure');
  assert.ok(p.text(p.rows()[0]).includes('Video 9'));
}
async function main() {
  if (process.argv[2] && process.argv[2] !== '--mutations') {
    await verify(fs.readFileSync(process.argv[2], 'utf8')); console.log('PASS popup behavior'); return;
  }
  await verify(original); console.log('PASS popup: history, completion lifetime, restart, individual errors, cancellation and journal isolation');
  if (process.argv.includes('--mutations')) {
    const mutants = [
      ["(j.state === 'done' && notices.has(j.id))", "j.state === 'done'"],
      ['now + 4000', 'now + 4000000'],
      ['now + 4000', 'now'],
      ['observed.delete(j.id)) notices.set', "j.state === 'done') notices.set"],
      ['!dismissed.has(noticeKey(j))', 'true'],
      ["j.state === 'failed' || j.state === 'interrupted'", "j.state === 'failed'"],
      ['await api.storage.local.set({ [DISMISSED]: keys });', 'await api.storage.local.set({ "kadri-dl-jobs": [] });'],
      ["['starting', 'unconfirmed', 'running', 'cancelling']", "['starting', 'unconfirmed', 'running']"],
      ["t('Fehlgeschlagen') + ': '", "''"],
    ];
    for (const [from, to] of mutants) {
      assert.equal(original.split(from).length, 2, 'unique mutation anchor');
      let failed = false;
      try { await verify(original.replace(from, to)); } catch (e) { failed = true; }
      assert.ok(failed, 'surviving mutation: ' + from);
    }
    console.log('PASS popup mutations: ' + mutants.length + '/' + mutants.length + ' rejected');
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
