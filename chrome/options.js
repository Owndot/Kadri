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

  // Kopplung mit der Helfer-App (sicherer Kanal im Hintergrund). Der Code kommt aus der App; er geht nur in den
  // Hintergrund und nirgends sonst hin. Gespeichert werden nur Kadris eigener Schlüssel und der des Helfers.
  function pairCard() {
    const ask = (op, extra) => api.runtime.sendMessage(Object.assign({ t: 'kadri-channel', op }, extra || {})).catch(() => null);
    const line = el('div', { class: 'note', id: 'pairState' }, '…');
    const msg = el('div', { class: 'note', id: 'pairMsg' });
    const code = el('input', { id: 'pairCode', type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '9', placeholder: '1234 5678', spellcheck: 'false' });
    const show = async () => {
      const r = await ask('status');
      const v = r && r.ok ? r.value : null;
      line.textContent = !v ? '–' : v.paired ? t('Gekoppelt mit Helfer') + ' ' + v.helper + ' · ' + v.reg : t('Nicht gekoppelt');
      return v;
    };
    const pairBtn = el('button', { id: 'pairBtn', class: 'primary', onclick: async () => {
      const c = code.value.replace(/\s+/g, '');
      pairBtn.disabled = true; msg.textContent = t('Koppelt …');
      const r = await ask('pair', { code: c });
      pairBtn.disabled = false; code.value = '';
      msg.textContent = r && r.ok ? t('Verbunden') + (r.value.helperChanged ? ' – ' + t('Neue Helfer-Identität. Wenn du den Helper nicht selbst zurückgesetzt hast, entferne die Kopplung und überprüfe die Verbindung.') : '')
        : (r && r.error ? r.error.message : '–');
      show();
    } }, t('Koppeln'));
    const checkBtn = el('button', { id: 'checkBtn', onclick: async () => {
      const r = await ask('check');
      msg.textContent = r && r.ok && r.value.ok === true ? t('Verbunden') : t('Nicht erreichbar') + (r && r.error ? ' – ' + r.error.message : '');
    } }, t('Verbindung prüfen'));
    const forgetBtn = el('button', { id: 'forgetBtn', onclick: async () => {
      if (!confirm(t('Kopplung wirklich entfernen?'))) return;
      const r = await ask('forget');
      msg.textContent = r && r.ok ? t('Kopplung entfernt') : '–';
      show();
    } }, t('Kopplung entfernen'));
    show();
    return el('div', { class: 'card' },
      el('div', { class: 'row' }, el('div', { class: 'lab' }, t('Code aus der Helfer-App (8 Ziffern)'),
        el('small', {}, t('In der Helfer-App „Code anzeigen“ tippen und den Code hier eingeben. Der Code gilt 2 Minuten und nur für einen Versuch.'))), code),
      el('div', { class: 'btns' }, pairBtn, checkBtn, forgetBtn), line, msg);
  }

  app.append(
    el('h2', {}, t('Player')),
    el('div', { class: 'card' },
      pick('lensGlass', 'Design', [[true, 'Glas'], [false, 'Schlicht']]),
      yes('ambient', 'Ambient'),
      yes('progressLine', 'Fortschrittslinie'),
      yes('startFullscreen', 'Vollbild'),
      pick('openUi', 'Beim Öffnen', [['quiet', 'Nur Bild'], ['controls', 'Mit Bedienung']], 'Nur Bild: Bedienung erst nach dem ersten Antippen'),
      yes('autoRotate', 'Auto-Drehen'),
      pick('leaveAction', 'Beim Verlassen', [['play', 'Weiter'], ['pause', 'Anhalten']]),
      pick('subSize', 'Untertitel-Größe', [['s', 'klein'], ['m', 'mittel'], ['l', 'groß']]),
      yes('subHigh', 'Untertitel oben'),
      yes('dialogBoost', 'Dialog-Verstärker'),
      pick('language', 'Sprache', [['auto', 'Auto'], ['de', 'Deutsch'], ['en', 'English']])),
    el('h2', {}, t('Gesten')),
    el('div', { class: 'card' },
      pick('seekPreview', 'Spul-Vorschau', [['thumb', 'Kleines Bild'], ['live', 'Im Bild']], 'Im Bild: das Video springt beim Ziehen mit (geht überall)'),
      yes('seekZoom', 'Spul-Lupe', 'beim Spulen Finger unter die Leiste = feiner'),
      yes('seekBuzz', 'Vibration', 'kurz beim Spulen: Lupe, Abbrechen, Anfang/Ende'),
      pick('skipSeconds', 'Sprungweite', [[5, '5 s'], [10, '10 s'], [15, '15 s'], [30, '30 s']]),
      pick('holdSpeed', 'Halten', [[1.5, '1,5×'], [2, '2×'], [3, '3×']]),
      pick('topGuard', 'Wischsperre oben', ZONES),
      pick('bottomGuard', 'Wischsperre unten', ZONES)),
    el('h2', {}, t('Download & Helfer')),
    el('div', { class: 'card' },
      pick('downloader', 'Download', [['ytdlnis', 'YTDLnis'], ['share', 'Teilen']]),
      yes('systemHelper', 'Helper-App', 'Helligkeit und Lautstärke über die Helfer-App; Downloads über die App sind vorübergehend aus')),
    el('h2', {}, t('Helfer koppeln')),
    pairCard(),
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
