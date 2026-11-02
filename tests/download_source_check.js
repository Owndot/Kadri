'use strict';
// Execute the actual C3 source selector. An original-page bridge must not count as a loaded own MP4.
const fs = require('fs'), vm = require('vm'), assert = require('assert/strict');
const path = require('path');
const source = fs.readFileSync(process.argv[2] && process.argv[2] !== '--mutations' ? process.argv[2] : path.join(__dirname, '../src/180-player-bedienung.js'), 'utf8');
const url = 'https://media.example/file.mp4?validfrom=1&validto=2&hash=a%2Fb+Z&x=1&x=2';
function run(text, change = {}) {
  const direct = text.match(/    const directUrl = [^\n]+;/)[0];
  const start = text.indexOf('    const hdlUrl = '), end = text.indexOf('    st.hdl = ', start);
  assert.ok(start >= 0 && end > start, 'source selector boundaries');
  const st = Object.assign({ mode: 'own', hls: null, cur: url }, change.st);
  const vid = Object.assign({ currentSrc: url, readyState: 2, error: null, srcObject: null }, change.vid);
  return vm.runInNewContext(direct + '\n' + text.slice(start, end) + '\nhdlUrl()', { st, vid, URL, PLAYLIST_RE: /\.(m3u8|mpd)(\?|#|$)/i });
}
function verify(text) {
  assert.equal(run(text, { vid: { readyState: 0 } }), '', 'unloaded MP4 candidate must not be offered');
  assert.equal(run(text, { vid: { readyState: 1 } }), '', 'metadata alone is not a decoded frame');
  assert.equal(run(text, { vid: { error: { code: 4 } } }), '', 'failed source must not be offered');
  assert.equal(run(text, { vid: { srcObject: {} } }), '', 'captured media must not be treated as a file');
  assert.equal(run(text, { vid: { currentSrc: 'https://media.example/previous.mp4' } }), '', 'previous loaded file cannot validate a new candidate');
  assert.equal(run(text, { vid: { currentSrc: '' } }), '', 'empty currentSrc cannot validate a candidate');
  assert.equal(run(text, { st: { mode: 'capture' } }), '', 'capture mode excluded');
  assert.equal(run(text, { st: { hls: {} } }), '', 'hls.js source excluded');
  for (const candidate of ['https://media.example/720.mp4:hls:manifest.m3u8', 'https://media.example/live.mpd', 'blob:https://media.example/id', 'https://media.example/clip.webm']) {
    assert.equal(run(text, { st: { cur: candidate }, vid: { currentSrc: candidate } }), '', 'unsupported source: ' + candidate);
  }
  assert.equal(run(text), url, 'loaded MP4 keeps signed query bytes and duplicate parameters');
  for (const readyState of [2, 3, 4]) assert.equal(run(text, { vid: { readyState } }), url, 'loaded MP4 available');
  const raw = 'https://MEDIA.example/a b.mp4?hash=abc%2Fdef';
  assert.equal(run(text, { st: { cur: raw }, vid: { currentSrc: new URL(raw).href } }), raw, 'browser URL canonicalization used only for comparison');
  const event = text.match(/    vid\.addEventListener\('loadeddata', [^\n]+;/);
  assert.ok(event, 'loadeddata must refresh eligibility after loadedmetadata');
  let refreshes = 0, callback;
  const st = { refreshDl() { refreshes++; } }, ctx = { st, vid: { addEventListener(name, f) { assert.equal(name, 'loadeddata'); callback = f; } } };
  ctx.vp = st;
  vm.runInNewContext(event[0], ctx);
  callback(); assert.equal(refreshes, 1, 'refresh once media data is ready');
  ctx.vp = {}; callback(); assert.equal(refreshes, 1, 'closed/replaced player ignored');
}
verify(source);
console.log('PASS source readiness: candidate, metadata, failure, switch, HLS/DASH, capture, signed URL and loadeddata');
if (process.argv.includes('--mutations')) {
  const mutations = [
    ['vid.readyState < 2', 'false'], ['vid.error', 'false'], ['vid.srcObject', 'false'],
    ["if (vid.currentSrc !== new URL(d).href) return '';", ''],
    ["vid.addEventListener('loadeddata'", "vid.addEventListener('loadedmetadata'"],
    ['if (vp === st) st.refreshDl();', 'st.refreshDl();'],
  ];
  for (const [a, b] of mutations) {
    assert.equal(source.split(a).length, 2, 'unique mutation anchor');
    let caught = false; try { verify(source.replace(a, b)); } catch (e) { caught = true; }
    assert.ok(caught, 'surviving readiness mutation: ' + a);
  }
  console.log('PASS source readiness mutations: ' + mutations.length + '/' + mutations.length);
}
