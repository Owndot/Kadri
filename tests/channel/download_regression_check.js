// The new cancellation assertions must reject the exact reviewed predecessor, without editing the checkout.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { ROOT } = require('./lib');
const previous = 'e044acad5b427ea4a008fed468201e6c6f19cb8a';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kadri-cancel-predecessor-'));
try {
  fs.cpSync(path.join(ROOT, 'channel'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'channel-downloads.js'), execFileSync('git', ['show', previous + ':channel/channel-downloads.js'], { cwd: ROOT }));
  const r = spawnSync(process.execPath, [path.join(__dirname, 'download_unit_check.js')], {
    env: { ...process.env, CHANNEL_SRC_DIR: dir }, encoding: 'utf8', timeout: 120000,
  });
  const failures = [
    'FAIL Abbruch, Helfer nicht erreichbar: Absicht dauerhaft gespeichert',
    'FAIL Abbruchabsicht VOR dem Netzwerkaufruf gespeichert',
    'FAIL Nach Neustart zuerst Status, dann erforderlichen Abbruch zustellen',
    'FAIL Unbekannte Kennung ist keine Abbruchbestätigung',
  ];
  if (r.status !== 1 || !failures.every((f) => r.stdout.includes(f)) || !r.stdout.includes('RESULT download_unit FAIL')) {
    throw new Error('predecessor did not fail the intended regressions: ' + r.stdout + r.stderr);
  }
  console.log('RESULT download-predecessor PASS (durability, restart and unknown-state regressions detected)');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
