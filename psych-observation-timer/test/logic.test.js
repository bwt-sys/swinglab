const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logic.js');

const B = [
  { id: 'e', name: 'Hit', key: 'h', type: 'event' },
  { id: 'd', name: 'On task', key: 'o', type: 'duration' },
];

// On task 5–25 s, Hit at 3 s and 12 s, session ends at 35 s (10 s intervals -> 3 complete + 1 partial).
const events = [
  { t: 3, kind: 'event', behaviorId: 'e' },
  { t: 5, kind: 'start', behaviorId: 'd' },
  { t: 12, kind: 'event', behaviorId: 'e' },
  { t: 15, kind: 'note', text: 'x' },
  { t: 25, kind: 'stop', behaviorId: 'd' },
];
const END = 35;

test('buildBouts pairs start/stop and closes open bouts at end', () => {
  assert.deepEqual(L.buildBouts(events, END), { d: [[5, 25]] });
  const open = [...events, { t: 30, kind: 'start', behaviorId: 'd' }];
  assert.deepEqual(L.buildBouts(open, END), { d: [[5, 25], [30, 35]] });
  assert.deepEqual(L.activeBouts(open), { d: 30 });
});

test('partial interval', () => {
  const iv = L.scoreIntervals(B, events, END, 10, 'partial');
  assert.equal(iv.length, 4);
  assert.deepEqual(iv.map((i) => i.complete), [true, true, true, false]);
  assert.deepEqual(iv.map((i) => i.scores.e), [true, true, false, false]);
  assert.deepEqual(iv.map((i) => i.scores.d), [true, true, true, false]);
});

test('whole interval', () => {
  const iv = L.scoreIntervals(B, events, END, 10, 'whole');
  assert.deepEqual(iv.map((i) => i.scores.d), [false, true, false, false]);
  assert.deepEqual(iv.map((i) => i.scores.e), [null, null, null, null]);
});

test('momentary time sampling scores the end of each interval', () => {
  const iv = L.scoreIntervals(B, events, END, 10, 'momentary');
  assert.deepEqual(iv.map((i) => i.scores.d), [true, true, false, false]);
});

test('event exactly on a boundary belongs to the later interval', () => {
  const iv = L.scoreIntervals(B, [{ t: 10, kind: 'event', behaviorId: 'e' }], 20, 10, 'partial');
  assert.deepEqual(iv.map((i) => i.scores.e), [false, true]);
  const atEnd = L.scoreIntervals(B, [{ t: 20, kind: 'event', behaviorId: 'e' }], 20, 10, 'partial');
  assert.deepEqual(atEnd.map((i) => i.scores.e), [false, true]);
});

test('summarize', () => {
  const iv = L.scoreIntervals(B, events, END, 10, 'partial');
  const [e, d] = L.summarize(B, events, END, iv);
  assert.equal(e.count, 2);
  assert.ok(Math.abs(e.ratePerMin - 2 / (35 / 60)) < 1e-9);
  assert.equal(e.totalDuration, null);
  assert.equal(e.intervalsScored, 2);
  assert.equal(e.intervalsTotal, 3); // partial last interval excluded
  assert.equal(d.count, 1);
  assert.equal(d.totalDuration, 20);
  assert.equal(d.meanDuration, 20);
  assert.ok(Math.abs(d.pctSession - (20 / 35) * 100) < 1e-9);
  assert.equal(d.pctIntervals, 100);
});

test('no time observed', () => {
  assert.deepEqual(L.scoreIntervals(B, [], 0, 10, 'partial'), []);
  const [e] = L.summarize(B, [], 0, []);
  assert.equal(e.ratePerMin, 0);
  assert.equal(e.pctIntervals, null);
});

test('fmtTime', () => {
  assert.equal(L.fmtTime(0, true), '0:00.0');
  assert.equal(L.fmtTime(75.36, true), '1:15.3');
  assert.equal(L.fmtTime(75.99, false), '1:15');
  assert.equal(L.fmtTime(3725, false), '1:02:05');
});

test('toCSV escapes', () => {
  assert.equal(L.toCSV([['a', 'b,c'], ['he said "hi"', null]]), 'a,"b,c"\r\n"he said ""hi""",\r\n');
});
