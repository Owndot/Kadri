#!/usr/bin/env node
// Erzeugt vendor/psl.js aus vendor/public_suffix_list.dat (offizielle Public Suffix List, https://publicsuffix.org,
// Mozilla Public License 2.0). Nur nötig, wenn die Liste erneuert wird – der normale Bau kopiert vendor/psl.js nur.
//   node tools/make-psl.js
// Die Regeln kommen in Kleinbuchstaben und als Punycode (so stehen Adressen in URL.hostname), ohne Kommentare.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), url = require('url');
const ROOT = path.join(__dirname, '..');
const datFile = path.join(ROOT, 'vendor', 'public_suffix_list.dat');
const dat = fs.readFileSync(datFile);
const sha = crypto.createHash('sha256').update(dat).digest('hex');
const rules = [];
for (let line of dat.toString('utf8').split('\n')) {
  line = line.trim().split(/\s/)[0];
  if (!line || line.startsWith('//')) continue;
  let pre = '';
  if (line.startsWith('!')) { pre = '!'; line = line.slice(1); }
  if (line.startsWith('*.')) { pre += '*.'; line = line.slice(2); }
  const a = url.domainToASCII(line);
  if (!a) { console.error('Regel nicht umwandelbar: ' + line); process.exit(1); }
  rules.push(pre + a.toLowerCase());
}
const out = `// Erzeugt von tools/make-psl.js aus vendor/public_suffix_list.dat (SHA-256 ${sha}).
// Public Suffix List, https://publicsuffix.org – Mozilla Public License 2.0 (siehe psl.LICENSE).
// pslBase(host) → die „registrierbare Domain“ (eTLD+1): www.bbc.co.uk → bbc.co.uk, alice.eu.org → alice.eu.org.
// Ist host selbst eine öffentliche Endung (github.io), kommt host zurück.
'use strict';
const PSL_LIST = ${JSON.stringify(rules.join(','))};
const pslBase = (() => {
  const R = new Set(), W = new Set(), X = new Set();
  for (const r of PSL_LIST.split(',')) {
    if (r[0] === '!') X.add(r.slice(1));
    else if (r.startsWith('*.')) W.add(r.slice(2));
    else R.add(r);
  }
  // Anzahl der Teile der öffentlichen Endung (längste passende Regel; Ausnahmen „!“ gehen vor; sonst Regel „*“ = 1)
  const suffixLen = (p) => {
    for (let i = 0; i < p.length; i++) {
      const rest = p.slice(i).join('.');
      if (X.has(rest)) return p.length - i - 1;
      if (R.has(rest)) return p.length - i;
      if (i + 1 < p.length && W.has(p.slice(i + 1).join('.'))) return p.length - i;
    }
    return 1;
  };
  return (host) => {
    const h = String(host || '').toLowerCase().replace(/\\.$/, '');
    if (!h || /^[\\d.]+$/.test(h) || h.indexOf(':') >= 0 || h.indexOf('[') >= 0) return h;   // IP-Adresse: nur sie selbst
    const p = h.split('.');
    const n = suffixLen(p);
    return n >= p.length ? h : p.slice(-(n + 1)).join('.');
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = { pslBase };
`;
fs.writeFileSync(path.join(ROOT, 'vendor', 'psl.js'), out);
console.log('vendor/psl.js: ' + rules.length + ' Regeln, ' + Math.round(out.length / 1024) + ' KB (Liste SHA-256 ' + sha + ')');
