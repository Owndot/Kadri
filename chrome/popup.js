// Kadri – Menü hinter dem Puzzle-Symbol: an/aus für die Seite, Diagnose, Einstellungen, Zustand der Helfer-App.
'use strict';
(async () => {
  const app = document.getElementById('app');
  document.getElementById('ver').textContent = api.runtime.getManifest().version;
  let s = await store.settings();
  applyLang(s);
  let tab = null;
  try {
    const qt = +new URLSearchParams(location.search).get('tab');   // (Tests: Menü für einen bestimmten Tab)
    tab = qt ? await api.tabs.get(qt) : (await api.tabs.query({ active: true, currentWindow: true }))[0];
  } catch (e) {}
  let host = '';
  try { const u = new URL(tab && tab.url || ''); if (/^https?:$/.test(u.protocol)) host = u.hostname.toLowerCase(); } catch (e) {}

  const card = el('div', { class: 'card' });
  app.append(card);
  // an/aus für diese Seite (über die Liste „Kadri ganz aus auf“)
  if (host) {
    const off = () => (eff(s, 'disabledSites') || []).some((d) => hostMatches(host, d));
    const cb = el('input', { type: 'checkbox', id: 'siteOn' });
    cb.checked = !off();
    const hint = el('div', { class: 'note', style: 'display:none' }, t('Seite neu laden, damit es gilt'));
    const reload = el('button', { class: 'wide', style: 'display:none;margin-top:8px', onclick: () => { try { api.tabs.reload(tab.id); } catch (e) {} window.close(); } }, t('Seite neu laden'));
    cb.addEventListener('change', async () => {
      s = await store.settings();
      let list = (eff(s, 'disabledSites') || []).slice();
      if (cb.checked) list = list.filter((d) => !hostMatches(host, d));
      else list.push(host.replace(/^www\./, ''));
      s.disabledSites = list;
      await store.saveSettings(s);
      hint.style.display = ''; reload.style.display = '';
    });
    card.append(el('div', { class: 'row' }, el('div', { class: 'lab' }, t('Kadri auf dieser Seite'), el('small', {}, host)), el('label', { class: 'sw' }, cb, el('span'))));
    app.append(hint, reload);
  } else {
    card.append(el('div', { class: 'row' }, el('div', { class: 'lab' }, t('Hier läuft keine Webseite'))));
  }
  // Helfer-App
  const hs = el('div', { class: 'row', id: 'helper' }, el('div', { class: 'lab' }, el('span', { class: 'dot' }), '…'));
  card.append(hs);
  // Über den sicheren Kanal im Hintergrund (nur wenn gekoppelt; der Hintergrund fragt den gekoppelten Helfer).
  (async () => {
    let ok = false, text = 'Helfer-App: nicht gekoppelt';
    try {
      const st = await api.runtime.sendMessage({ t: 'kadri-channel', op: 'status' });
      if (st && st.ok && st.value && st.value.paired) {
        const r = await api.runtime.sendMessage({ t: 'kadri-channel', op: 'check' });
        ok = !!(r && r.ok && r.value && r.value.ok === true);
        text = ok ? 'Helfer-App: verbunden' : 'Helfer-App: gekoppelt, nicht erreichbar';
      }
    } catch (e) { ok = false; }
    hs.firstChild.replaceChildren(el('span', { class: 'dot ' + (ok ? 'ok' : '') }), t(text));
  })();
  // Downloads über die Helfer-App (Phase C3): Liste aus dem Hintergrund (ohne URL), Stand und Abbrechen. Abgefragt wird
  // nur, solange das Menü offen ist; laufende Aufträge fragen den Helfer (dlstatus).
  const dls = el('div', { class: 'card', id: 'downloads', style: 'display:none' });
  app.append(dls);
  const send = (m) => api.runtime.sendMessage(Object.assign({ t: 'kadri-download' }, m)).catch(() => null);
  const ACTIVE = ['starting', 'unconfirmed', 'running', 'cancelling'];
  // Nur die Ansicht ausblenden, niemals das Downloadjournal verändern. Bereits fertige Aufträge bleiben beim
  // Öffnen unsichtbar; ein hier beobachteter Abschluss wird vier Sekunden lang bestätigt.
  const DISMISSED = 'kadri-download-dismissed-v1';
  const closed = await api.storage.local.get(DISMISSED).catch(() => ({}));
  const dismissed = new Set(Array.isArray(closed[DISMISSED]) ? closed[DISMISSED].filter((x) => typeof x === 'string') : []);
  const observed = new Set(), notices = new Map();
  const failed = (j) => j.state === 'failed' || j.state === 'interrupted';
  const noticeKey = (j) => j.id + ':' + j.at + ':' + j.state;
  let refresh = Promise.resolve();
  function downloads() {
    const p = refresh.then(updateDownloads, updateDownloads);
    refresh = p.catch(() => {});
    return p;
  }
  async function updateDownloads() {
    const r = await send({ op: 'list' });
    if (!r || !r.ok || !Array.isArray(r.value)) return true; // kurzzeitiger Kanal-/Workerfehler leert die Ansicht nicht
    let jobs = r.value;
    for (const j of jobs) if (ACTIVE.includes(j.state)) observed.add(j.id);
    if (jobs.some((j) => ACTIVE.includes(j.state))) {
      for (const j of jobs.filter((x) => ACTIVE.includes(x.state))) await send({ op: 'status', id: j.id });
      const r2 = await send({ op: 'list' });
      if (r2 && r2.ok && Array.isArray(r2.value)) jobs = r2.value;
    }
    const now = Date.now();
    for (const j of jobs) {
      if (j.state === 'done' && observed.delete(j.id)) notices.set(j.id, now + 4000);
      if (j.state === 'cancelled' || failed(j)) observed.delete(j.id);
    }
    for (const [id, until] of notices) if (until <= now || !jobs.some((j) => j.id === id)) notices.delete(id);
    for (const id of observed) if (!jobs.some((j) => j.id === id)) observed.delete(id);
    for (const key of dismissed) if (!jobs.some((j) => failed(j) && noticeKey(j) === key)) dismissed.delete(key);
    const visible = jobs.filter((j) => ACTIVE.includes(j.state) || (j.state === 'done' && notices.has(j.id)) || (failed(j) && !dismissed.has(noticeKey(j))));
    dls.style.display = visible.length ? '' : 'none';
    dls.replaceChildren(el('div', { class: 'row' }, el('div', { class: 'lab' }, t('Downloads über die Helfer-App'))),
      ...visible.map((j) => el('div', { class: 'row dl', 'data-state': j.state },
        el('div', { class: 'lab' }, j.name, el('small', {}, (j.state === 'failed' ? t('Fehlgeschlagen') + ': ' : '') + t(j.label) + (j.progress ? ' · ' + j.progress : ''))),
        ACTIVE.includes(j.state) && j.state !== 'cancelling'
          ? el('button', { onclick: async () => { await send({ op: 'cancel', id: j.id }); downloads(); } }, t('Abbrechen'))
          : failed(j) ? el('button', { 'aria-label': t('Fehlermeldung schließen'), onclick: async (e) => {
            const keys = [...dismissed, noticeKey(j)];
            try {
              await api.storage.local.set({ [DISMISSED]: keys });
              dismissed.add(noticeKey(j));
              downloads();
            } catch (err) { e.currentTarget.textContent = t('Erneut versuchen'); }
          } }, t('Schließen')) : null)));
    return jobs.some((j) => ACTIVE.includes(j.state)) || notices.size > 0;
  }
  (async function loop() {
    let active = false;
    try { active = await downloads(); } catch (e) {}
    setTimeout(loop, active ? 1500 : 5000);
  })();
  // Knöpfe
  const btns = el('div', { class: 'btns' });
  if (host) {
    btns.append(el('button', { class: 'wide', onclick: async () => {
      try { await api.tabs.sendMessage(tab.id, { t: 'kadri-menu' }, { frameId: 0 }); } catch (e) {}
      window.close();
    } }, t('Diagnose anzeigen')));
  }
  btns.append(el('button', { class: 'wide primary', onclick: () => { try { api.runtime.openOptionsPage(); } catch (e) {} window.close(); } }, t('Einstellungen')));
  app.append(btns);
})();
