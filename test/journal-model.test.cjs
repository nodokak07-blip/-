const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/journal-model.js');
const habit = { id: 'stretch', name: '腹筋', type: 'binary' };
const fixture = () => ({ items: [habit], daily: { '2026-10-01': { stretch: true }, '2026-10-02': { stretch: false }, '2026-11-01': { stretch: true } }, months: { '2026-10': { targets: { stretch: 10 }, actuals: {} } } });
test('monthly goal defines denominator, independent of calendar elapsed days', () => {
  const w = fixture(); assert.equal(M.summary(w, habit, '2026-10').percentage, 10);
  w.months['2026-10'].targets.stretch = 30; assert.equal(M.summary(w, habit, '2026-10').percentage, 3.3);
});
test('bulk totals replace daily values, including explicit zero', () => {
  const w = fixture(); w.months['2026-10'].actuals.stretch = 5;
  assert.equal(M.summary(w, habit, '2026-10').percentage, 50);
  assert.equal(M.summary(w, habit, '2026-10').actual, 5);
  w.months['2026-10'].actuals.stretch = 0;
  assert.equal(M.summary(w, habit, '2026-10').actual, 0);
  assert.equal(M.summary(w, habit, '2026-10').percentage, 0);
  delete w.months['2026-10'].actuals.stretch;
  assert.equal(M.summary(w, habit, '2026-10').actual, 1);
});
test('unrecorded differs from did-not-do and excludes other months', () => {
  const w = fixture(), s = M.summary(w, habit, '2026-10');
  assert.equal(s.recordedDays, 2); assert.equal(s.missingDays, 29);
  assert.equal(M.summary(w, habit, '2026-09').actual, null);
  w.daily['2026-10-01'].stretch = false; assert.equal(M.summary(w, habit, '2026-10').actual, 0);
});
test('numbers retain zero, averages use recorded days, and overachievement is not discarded', () => {
  const item = { id: 'sleep', name: '睡眠', type: 'number', unit: '時間', aggregate: 'average' };
  const w = { items: [item], daily: { '2026-10-01': { sleep: 0 }, '2026-10-02': { sleep: 8 } }, months: { '2026-10': { targets: { sleep: 2 }, actuals: {} } } };
  const s = M.summary(w, item, '2026-10'); assert.equal(s.actual, 4); assert.equal(s.percentage, 200); assert.equal(s.recordedDays, 2);
});
test('qualitative items have distributions rather than achievement percentages', () => {
  const item = { id: 'mood', name: '気分', type: 'choice' }, w = { items: [item], daily: { '2026-10-01': { mood: 'ふつう' } }, months: {} };
  const s = M.summary(w, item, '2026-10'); assert.equal(s.percentage, null); assert.equal(s.distribution['ふつう'], 1);
});
test('invalid dates and targets cannot enter reports', () => {
  assert.equal(M.monthDays('2024-02'), 29); assert.equal(M.monthDays('2026-02'), 28);
  const w = fixture(); w.daily['2026-02-30'] = { stretch: true }; assert.throws(() => M.report(w, '2026-02'));
  delete w.daily['2026-02-30']; w.months['2026-10'].targets.stretch = 0; assert.throws(() => M.report(w,'2026-10'));
});
test('month-specific item snapshots preserve earlier recording types', () => {
  const w=fixture(); w.months['2026-10'].items=[habit]; w.items=[{ id:'walk',name:'散歩',type:'binary' }];
  assert.equal(M.report(w,'2026-10')[0].name,'腹筋'); assert.equal(M.report(w,'2026-10')[0].actual,1);
});
