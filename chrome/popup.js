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
