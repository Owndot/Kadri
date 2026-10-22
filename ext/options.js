// Kadri – Einstellungsseite: alle Einstellungen des Players und die Seitenlisten.
// Gespeichert wird genau dort, wo auch der Player speichert (storage.local „gm:settings“) – beide Wege passen zusammen.
'use strict';
(async () => {
  let s = await store.settings();
  applyLang(s);
  document.title = 'Kadri – ' + t('Einstellungen');
  document.getElementById('ver').textContent = t('Einstellungen') + ' · ' + api.runtime.getManifest().version + ' · ' + t('Wird im Player auch unter ⋮ → Einstellungen geändert.');
  const app = document.getElementById('app');
  const saved = el('div', { class: 'saved' });
  let tm = 0;
  async function set(k, v) {
    s = await store.settings();
    s[k] = v;
    await store.saveSettings(s);
    saved.textContent = t('Gespeichert – gilt ab dem nächsten Laden der Seite');
    clearTimeout(tm); tm = setTimeout(() => { saved.textContent = ''; }, 2500);
  }
  const yes = (k, label, note) => {
    const cb = el('input', { type: 'checkbox', 'data-k': k });
    cb.checked = !!eff(s, k);
    cb.addEventListener('change', () => set(k, cb.checked));
    return el('div', { class: 'row' }, el('div', { class: 'lab' }, t(label), note ? el('small', {}, t(note)) : null), el('label', { class: 'sw' }, cb, el('span')));
  };
  const pick = (k, label, opts, note) => {
    const sel = el('select', { 'data-k': k });
    const cur = eff(s, k);
    opts.forEach(([v, l]) => { const o = el('option', { value: JSON.stringify(v) }, t(l)); if (JSON.stringify(v) === JSON.stringify(cur)) o.selected = true; sel.append(o); });
    sel.addEventListener('change', () => set(k, JSON.parse(sel.value)));
    return el('div', { class: 'row' }, el('div', { class: 'lab' }, t(label), note ? el('small', {}, t(note)) : null), sel);
  };
  const ZONES = [[0, 'Aus'], [0.1, 'Schmal'], [0.15, 'Mittel'], [0.2, 'Breit'], [0.25, 'Sehr breit']];
  const list = (k, label) => {
    const ta = el('textarea', { 'data-k': k, spellcheck: 'false', autocapitalize: 'off' });
    ta.value = (eff(s, k) || []).join('\n');
    ta.addEventListener('change', () => set(k, ta.value.split(/[\s,]+/).map((x) => x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean)));
    return el('div', { class: 'row listrow' }, el('div', { class: 'lab' }, t(label), el('small', {}, t('eine Seite pro Zeile, gilt auch für Unterdomains'))), ta);
  };

  app.append(
    el('h2', {}, t('Player')),
    el('div', { class: 'card' },
      pick('lensGlass', 'Design', [[true, 'Glas'], [false, 'Schlicht']]),
      yes('ambient', 'Ambient'),
      yes('progressLine', 'Fortschrittslinie'),
      yes('startFullscreen', 'Vollbild'),
      yes('autoRotate', 'Auto-Drehen'),
      pick('leaveAction', 'Beim Verlassen', [['play', 'Weiter'], ['pause', 'Anhalten']]),
      pick('subSize', 'Untertitel-Größe', [['s', 'klein'], ['m', 'mittel'], ['l', 'groß']]),
      yes('subHigh', 'Untertitel oben'),
      yes('dialogBoost', 'Dialog-Verstärker'),
      pick('language', 'Sprache', [['auto', 'Auto'], ['de', 'Deutsch'], ['en', 'English']])),
    el('h2', {}, t('Gesten')),
    el('div', { class: 'card' },
      pick('seekPreview', 'Spul-Vorschau', [['thumb', 'Kleines Bild'], ['live', 'Im Bild']], 'Im Bild: das Video springt beim Ziehen mit (geht überall)'),
      pick('skipSeconds', 'Sprungweite', [[5, '5 s'], [10, '10 s'], [15, '15 s'], [30, '30 s']]),
      pick('holdSpeed', 'Halten', [[1.5, '1,5×'], [2, '2×'], [3, '3×']]),
      pick('topGuard', 'Wischsperre oben', ZONES),
      pick('bottomGuard', 'Wischsperre unten', ZONES)),
    el('h2', {}, t('Download & Helfer')),
    el('div', { class: 'card' },
      pick('downloader', 'Download', [['ytdlnis', 'YTDLnis'], ['share', 'Teilen']]),
      yes('systemHelper', 'Helper-App', 'wenn die Helfer-App läuft')),
    el('h2', {}, t('Seiten')),
    el('div', { class: 'card' },
      list('disabledSites', 'Kadri ganz aus auf'),
      list('downloadOnlySites', 'Nur Download (YTDLnis) auf'),
      list('ytdlpSites', 'Download-Knopf (YTDLnis kennt die Seite) auf')),
    saved,
    el('div', { class: 'btns' }, el('button', { class: 'wide', onclick: async () => {
      if (!confirm(t('Wirklich alle Einstellungen zurücksetzen?'))) return;
      await store.saveSettings({}); location.reload();
    } }, t('Alles zurücksetzen'))),
  );
})();
