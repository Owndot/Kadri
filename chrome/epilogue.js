    // ===== Ende des Skripts aus src/ =====
  }
  // Gespeicherte Einstellungen einmal laden, dann starten (das Skript liest sie danach ohne Warten)
  let started = false;
  const go = (all) => {
    if (started) return;
    started = true;
    const cache = {};
    Object.keys(all || {}).forEach((k) => { if (k.indexOf('gm:') === 0) cache[k] = all[k]; });
    start(cache);
  };
  try {
    const p = api.storage.local.get(null);
    if (p && p.then) p.then(go, () => go({}));
    else api.storage.local.get(null, (all) => go(all));
  } catch (e) { go({}); }
})();
