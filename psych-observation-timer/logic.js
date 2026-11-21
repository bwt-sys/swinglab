/*
 * Pure scoring / formatting logic for the observation timer.
 * No DOM access, so it can be unit-tested in Node (see test/logic.test.js).
 *
 * Event log entries look like:
 *   { t: seconds, kind: 'event' | 'start' | 'stop' | 'note' | 'pause' | 'resume',
 *     behaviorId?: string, text?: string }
 * Times are seconds of *observed* time (the clock stops while paused).
 */
(function (root) {
  'use strict';

  const EPS = 1e-9;

  /** Pair start/stop events into bouts per duration behaviour. Open bouts close at endT. */
  function buildBouts(events, endT) {
    const open = {};
    const bouts = {};
    for (const ev of events) {
      if (ev.kind === 'start') {
        if (open[ev.behaviorId] == null) open[ev.behaviorId] = ev.t;
      } else if (ev.kind === 'stop' && open[ev.behaviorId] != null) {
        (bouts[ev.behaviorId] = bouts[ev.behaviorId] || []).push([open[ev.behaviorId], ev.t]);
        delete open[ev.behaviorId];
      }
    }
    for (const id of Object.keys(open)) {
      (bouts[id] = bouts[id] || []).push([open[id], Math.max(endT, open[id])]);
    }
    return bouts;
  }

  /** Map of behaviourId -> start time for duration behaviours currently switched on. */
  function activeBouts(events) {
    const open = {};
    for (const ev of events) {
      if (ev.kind === 'start') open[ev.behaviorId] = ev.t;
      else if (ev.kind === 'stop') delete open[ev.behaviorId];
    }
    return open;
  }

  /**
   * Split [0, endT] into intervals and score each behaviour.
   * method: 'partial' | 'whole' | 'momentary'
   *   partial   - behaviour occurred at any point in the interval
   *   whole     - duration behaviour was on for the entire interval
   *   momentary - duration behaviour was on at the instant the interval ended
   * Event-type behaviours are only scorable with partial interval; otherwise null.
   */
  function scoreIntervals(behaviors, events, endT, intervalSec, method) {
    if (!(endT > 0) || !(intervalSec > 0)) return [];
    const n = Math.ceil(endT / intervalSec - EPS);
    const bouts = buildBouts(events, endT);
    const out = [];
    for (let i = 0; i < n; i++) {
      const start = i * intervalSec;
      const end = Math.min((i + 1) * intervalSec, endT);
      const last = i === n - 1;
      const complete = end - start >= intervalSec - 1e-6;
      const scores = {};
      for (const b of behaviors) {
        if (b.type === 'event') {
          if (method !== 'partial') { scores[b.id] = null; continue; }
          scores[b.id] = events.some(
            (ev) => ev.kind === 'event' && ev.behaviorId === b.id &&
              ev.t >= start && (ev.t < end || (last && ev.t <= end))
          );
        } else {
          const bs = bouts[b.id] || [];
          if (method === 'partial') {
            scores[b.id] = bs.some(([s, e]) => s < end && e > start || (s === e && s >= start && s < end));
          } else if (method === 'whole') {
            scores[b.id] = bs.some(([s, e]) => s <= start + EPS && e >= end - EPS);
          } else {
            scores[b.id] = bs.some(([s, e]) => s <= end + EPS && e >= end - EPS);
          }
        }
      }
      out.push({ index: i + 1, start, end, complete, scores });
    }
    return out;
  }

  /** Per-behaviour summary statistics. Interval percentages use complete intervals only. */
  function summarize(behaviors, events, endT, intervals) {
    const bouts = buildBouts(events, endT);
    const minutes = endT / 60;
    return behaviors.map((b) => {
      let count, total = null, mean = null, pctSession = null;
      if (b.type === 'event') {
        count = events.filter((ev) => ev.kind === 'event' && ev.behaviorId === b.id).length;
      } else {
        const bs = bouts[b.id] || [];
        count = bs.length;
        total = bs.reduce((acc, [s, e]) => acc + (e - s), 0);
        mean = count ? total / count : null;
        pctSession = endT > 0 ? (total / endT) * 100 : 0;
      }
      const scorable = (intervals || []).filter((iv) => iv.complete && iv.scores[b.id] != null);
      const scored = scorable.filter((iv) => iv.scores[b.id]).length;
      return {
        id: b.id, name: b.name, key: b.key, type: b.type,
        count,
        ratePerMin: minutes > 0 ? count / minutes : 0,
        totalDuration: total,
        meanDuration: mean,
        pctSession,
        intervalsScored: scorable.length ? scored : null,
        intervalsTotal: scorable.length,
        pctIntervals: scorable.length ? (scored / scorable.length) * 100 : null,
      };
    });
  }

  /** 75.3 -> "1:15.3" (tenths) or "1:15"; adds hours past 60 min. */
  function fmtTime(sec, tenths) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const totalTenths = tenths ? Math.floor(sec * 10 + EPS) : Math.floor(sec + EPS) * 10;
    const whole = Math.floor(totalTenths / 10);
    const h = Math.floor(whole / 3600);
    const m = Math.floor((whole % 3600) / 60);
    const s = whole % 60;
    const ss = String(s).padStart(2, '0');
    let out = h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
    if (tenths) out += '.' + (totalTenths % 10);
    return out;
  }

  function csvCell(v) {
    if (v == null) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** rows: array of arrays (first row = header). */
  function toCSV(rows) {
    return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  const api = { buildBouts, activeBouts, scoreIntervals, summarize, fmtTime, toCSV };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ObsLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
