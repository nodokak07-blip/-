(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BloomModel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  function monthDays(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('対象月が正しくありません');
    const [year, number] = month.split('-').map(Number);
    return new Date(year, number, 0).getDate();
  }
  function validDay(day, month) {
    return typeof day === 'string' && day.startsWith(month + '-') && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number(day.slice(8)) >= 1 && Number(day.slice(8)) <= monthDays(month);
  }
  function validateItem(item) {
    if (!item || !/^[a-z0-9-]{1,64}$/.test(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80 || !['binary', 'number', 'choice'].includes(item.type)) throw new Error('項目の設定を確認してください');
    if (item.type === 'number' && (!['sum', 'average'].includes(item.aggregate) || typeof item.unit !== 'string' || item.unit.length > 12)) throw new Error('数値の単位・集計方法を確認してください');
  }
  function validValue(item, value, monthly = false) {
    if (item.type === 'binary') return monthly ? Number.isInteger(value) && value >= 0 && value <= 31 : typeof value === 'boolean';
    if (item.type === 'number') return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e9;
    return !monthly && ['すっきり', 'ふつう', '疲れぎみ'].includes(value);
  }
  function summary(workspace, item, month) {
    validateItem(item);
    const days = monthDays(month);
    const values = Object.entries(workspace.daily || {}).filter(([date, row]) => validDay(date, month) && own(row, item.id) && validValue(item, row[item.id])).map(([, row]) => row[item.id]);
    let actual = null;
    if (values.length && item.type === 'binary') actual = values.filter(value => value === true).length;
    if (values.length && item.type === 'number') actual = values.reduce((sum, value) => sum + value, 0) / (item.aggregate === 'average' ? values.length : 1);
    const override = workspace.months?.[month]?.actuals?.[item.id];
    const manual = validValue(item, override, true);
    if (manual) actual = override; // A monthly total replaces, rather than adds to, daily totals. Zero is meaningful.
    const rawTarget = workspace.months?.[month]?.targets?.[item.id];
    const target = typeof rawTarget === 'number' && Number.isFinite(rawTarget) && rawTarget > 0 && rawTarget <= 1e9 && item.type !== 'choice' ? rawTarget : null;
    const percentage = actual === null || target === null ? null : Math.round(actual / target * 1000) / 10;
    return { id: item.id, name: item.name, type: item.type, aggregate: item.aggregate || null, unit: item.type === 'binary' ? '回' : item.unit || '', actual, target, percentage, manual, recordedDays: values.length, missingDays: days - values.length, distribution: item.type === 'choice' ? Object.fromEntries(['すっきり', 'ふつう', '疲れぎみ'].map(value => [value, values.filter(v => v === value).length])) : null };
  }
  function validateWorkspace(workspace) {
    if (!workspace || !Array.isArray(workspace.items) || workspace.items.length > 20 || !workspace.daily || typeof workspace.daily !== 'object' || !workspace.months || typeof workspace.months !== 'object') throw new Error('保存データの形式を確認してください');
    const seen = new Set();
    workspace.items.forEach(item => { validateItem(item); if (seen.has(item.id)) throw new Error('項目が重複しています'); seen.add(item.id); });
    for (const [date, row] of Object.entries(workspace.daily)) {
      if (!validDay(date, date.slice(0, 7)) || !row || typeof row !== 'object') throw new Error('日付を確認してください');
      for (const [id, value] of Object.entries(row)) { const item = workspace.items.find(i => i.id === id); if (item && !validValue(item, value)) throw new Error(item.name + 'の記録を確認してください'); }
    }
    for (const [month, data] of Object.entries(workspace.months)) {
      monthDays(month);
      if (!data || typeof data !== 'object') throw new Error('月次データを確認してください');
      if (data.items !== undefined) { if (!Array.isArray(data.items) || data.items.length > 20) throw new Error('月の項目設定を確認してください'); const unique = new Set(); data.items.forEach(item => { validateItem(item); if (unique.has(item.id)) throw new Error('月の項目が重複しています'); unique.add(item.id); }); }
      for (const [id, value] of Object.entries(data.targets || {})) { const item = workspace.items.find(i => i.id === id); if (item && (item.type === 'choice' || typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1e9)) throw new Error('月間目標は0より大きい数字にしてください'); }
      for (const [id, value] of Object.entries(data.actuals || {})) { const item = workspace.items.find(i => i.id === id); if (item && (!validValue(item, value, true) || (item.type === 'binary' && value > monthDays(month)))) throw new Error('月合計を確認してください'); }
    }
    return workspace;
  }
  function report(workspace, month) { validateWorkspace(workspace); return (workspace.months?.[month]?.items || workspace.items).map(item => summary(workspace, item, month)); }
  return { own, monthDays, validDay, validateItem, validValue, summary, validateWorkspace, report };
});
