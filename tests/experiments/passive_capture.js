/* Isolated research code. NOT shipped by tools/build.js; no network or publication API.
 * Observes one existing hls.js instance. Playlist identity stays in memory only.
 * Deliberately limited to a single, unencrypted, contiguous muxed fMP4 VOD rendition.
 * This is a completeness gate, NOT a general media/container/security validator.
 */
(function (root) {
  'use strict';
  class PassiveCapture {
    constructor(hls, Hls, limits = {}) {
      this.state = 'collecting'; this.reason = ''; this.bytes = 0;
      this.parts = new Map(); this.plan = null; this.hls = hls;
      if (typeof limits.ownerCurrent !== 'function') throw Error('owner binding required');
      this.ownerCurrent = limits.ownerCurrent;
      this.maxBytes = limits.maxBytes || 4 * 1024 * 1024;
      this.maxPart = limits.maxPart || 1024 * 1024;
      this.maxParts = limits.maxParts || 2048;
      this.listeners = [];
      const on = (event, fn) => {
        const safe = (...args) => { try { fn(...args); } catch (_) { this.fail('observer_exception'); } };
        hls.on(event, safe); this.listeners.push([event, safe]);
      };
      on(Hls.Events.LEVEL_LOADED, (_, d) => this.setPlan(d));
      on(Hls.Events.LEVEL_SWITCHING, (_, d) => {
        if (this.plan && d.level !== this.plan.level) this.fail('quality_changed');
      });
      on(Hls.Events.MANIFEST_LOADING, (_, d) => {
        if (!this.active()) return;
        if (this.source && this.source !== d.url) return this.fail('source_changed');
        this.source = d.url;
      });
      on(Hls.Events.ERROR, (_, d) => { if (d.fatal) this.fail('playback_failed'); });
      on(Hls.Events.DESTROYING, () => this.cancel('player_closed'));
    }
    fail(reason) {
      if (this.state === 'cancelled' || this.state === 'rejected') return;
      this.state = 'rejected'; this.reason = reason; this.clear();
    }
    clear() { this.parts.clear(); this.bytes = 0; this.plan = null; this.source = ''; }
    cancel(reason = 'user_cancelled') {
      this.state = 'cancelled'; this.reason = reason; this.clear();
    }
    active() {
      if (this.state !== 'collecting') return false;
      let current = false;
      try { current = this.ownerCurrent() === true; } catch (_) {}
      if (!current) this.cancel('player_changed');
      return current;
    }
    setPlan(data) {
      if (!this.active()) return;
      const d = data.details, level = this.hls.levels[data.level];
      const fs = d && d.fragments;
      if (!d || d.live || !Array.isArray(fs) || !fs.length || fs.length > this.maxParts ||
          !level || !/^avc1\./.test(level.videoCodec || '') || level.audioCodec !== 'mp4a.40.2' ||
          this.hls.audioTracks.length) return this.fail('unsupported_playlist');
      const cc = fs[0].cc, init = fs[0].initSegment;
      let end = 0;
      if (!init || !init.url || init.byteRange.length || init.encrypted) return this.fail('unsupported_init');
      const resources = [{sn:'initSegment', url:init.url}];
      for (let i = 0; i < fs.length; i++) {
        const f = fs[i];
        if (!Number.isSafeInteger(f.sn) || f.sn !== d.startSN+i || f.cc !== cc || f.gap || f.encrypted ||
            f.byteRange.length || f.initSegment?.url !== init.url || !Number.isFinite(f.duration) ||
            f.duration <= 0 || Math.abs(f.start-end) > 0.1) return this.fail('unsupported_timeline');
        resources.push({sn:f.sn, url:f.url}); end = f.start+f.duration;
      }
      if (fs.at(-1).sn !== d.endSN || Math.abs(end-d.totalduration) > 0.1) return this.fail('unsupported_timeline');
      const plan = {level:data.level, resources, duration:end};
      if (this.plan && JSON.stringify(this.plan) !== JSON.stringify(plan)) return this.fail('playlist_changed');
      this.plan = plan;
    }
    response(frag, payload) {
      if (!this.active() || !frag || frag.type !== 'main') return;
      if (!this.plan) return this.fail('no_plan');
      const expected = this.plan.resources.find(r => r.sn === frag.sn);
      if (!expected || frag.level !== this.plan.level || expected.url !== frag.url) return this.fail('source_changed');
      if (!(payload instanceof ArrayBuffer) || !payload.byteLength || payload.byteLength > this.maxPart)
        return this.fail('resource_limit');
      const b = new Uint8Array(payload), previous = this.parts.get(frag.sn);
      if (previous) {
        if (previous.length !== b.length || previous.some((v,i) => v !== b[i])) this.fail('conflicting_duplicate');
        return; // byte-identical re-observation is harmless; never append twice
      }
      if (this.bytes+b.length > this.maxBytes) return this.fail('storage_limit');
      this.parts.set(frag.sn, b.slice()); this.bytes += b.length;
    }
    snapshot() {
      return {state:this.state, reason:this.reason, bytes:this.bytes, received:this.parts.size,
        expected:this.plan ? this.plan.resources.length : 0}; // no URLs or identifiers
    }
    finish() {
      if (!this.active()) return null;
      if (!this.plan || this.plan.resources.some(r => !this.parts.has(r.sn))) {
        this.fail('incomplete'); return null;
      }
      // Only a candidate for independent container/track/timing validation; NEVER publish here.
      const blocks = this.plan.resources.map(r => this.parts.get(r.sn));
      this.state = 'candidate'; this.clear();
      return blocks;
    }
  }
  root.PassiveCaptureProbe = PassiveCapture;
})(globalThis);
