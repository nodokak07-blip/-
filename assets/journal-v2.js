/* Bloom Journal: account-scoped records, monthly goals and counselor reports. */
(() => {
  'use strict';
  const M = window.BloomModel;
  const $ = id => document.getElementById(id);
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cleanLabel = text => String(text || '').replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').trim();
  const icon = name => '<svg class="ico" aria-hidden="true"><use href="#ic-' + name + '"/></svg>';
  const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const fmt = value => value === null || value === undefined ? '—' : Number(value).toLocaleString('ja-JP', { maximumFractionDigits: 1 });
  const clone = object => JSON.parse(JSON.stringify(object));
  const fresh = () => ({ items: [
    { id: 'steps', name: '歩数', type: 'number', unit: '歩', aggregate: 'sum' },
    { id: 'sleep', name: '睡眠', type: 'number', unit: '時間', aggregate: 'average' },
    { id: 'stretch', name: 'ストレッチ', type: 'binary' },
    { id: 'snack', name: '夜の間食を控える', type: 'binary' },
    { id: 'mood', name: '今日の気分', type: 'choice' }
  ], daily: {}, months: {} });
  let workspace = fresh(), revision = 0, identity = null, account = 'guest', ready = false, dirty = false, conflict = false;
  let loadInFlight = null, loadingAccount = null, syncInFlight = null, editGeneration = 0, accountEpoch = 0;
  let date = today(), month = today().slice(0, 7), active = 0, draft, animating = false, reportReplies = [], submittedReport = null;
  let members = [], adminDetail = null, adminSelected = '', adminOffset = 0, adminNext = null, adminRequest = 0;
  let settingsItems = null, settingsTargets = null, bulkDay = today(), syncMessage = '記録を読み込んでいます。';
  let sendingReport = false;
  const legacyInitialState = clone(state);
  let legacyOwner = null;
  function resetLegacyAccount() {
    const owner = currentUser?.id || 'guest'; if (legacyOwner === owner) return;
    legacyOwner = owner; state = clone(legacyInitialState); todoData = {}; recordData = {}; journalData = {}; badges = []; monthlySummaryCache = null;
    loadFromStorage();
  }
  const storageKey = () => 'bloom-journal-v2:' + account;
  function monthConfig() { return workspace.months[month] || { targets: {}, actuals: {} }; }
  function ensureMonth() { if (!workspace.months[month]) workspace.months[month] = { targets: {}, actuals: {} }; workspace.months[month].targets ||= {}; workspace.months[month].actuals ||= {}; return workspace.months[month]; }
  function reportItems() { return monthConfig().items || workspace.items; }
  function dayItems() { return workspace.months[date.slice(0,7)]?.items || workspace.items; }
  function store() { localStorage.setItem(storageKey(), JSON.stringify({ workspace, revision, dirty })); }
  function announce(text, bad = false) { syncMessage = text; document.querySelectorAll('.jv .sync-state').forEach(n => { n.textContent = text; n.classList.toggle('error', bad); }); }
  function changed() { M.validateWorkspace(workspace); dirty = true; editGeneration++; store(); announce(currentUser ? 'この端末に保存しました。同期しています。' : 'この端末に保存しました。ログインすると同期・報告できます。'); }
  async function token() { if (!supabaseClient || !currentUser) throw new Error('ログインしてください。'); const { data, error } = await supabaseClient.auth.getSession(); if (error || !data.session) throw new Error('ログインし直してください。'); return data.session.access_token; }
  async function api(path, body, auth = true) {
    const headers = { 'Content-Type': 'application/json' }; if (auth) headers.Authorization = 'Bearer ' + await token();
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store' });
    const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || '接続できませんでした。'); return result;
  }
  async function sync() {
    if (!currentUser) return false;
    if (!ready) throw new Error('記録の読み込みを待ってください。');
    if (conflict) throw new Error('別端末の記録と競合しています。「同期を確認」から再読み込みしてください。');
    if (syncInFlight) { await syncInFlight; if (dirty) return sync(); return true; }
    if (!dirty) return true;
    const epoch = accountEpoch, generation = editGeneration, data = clone(workspace), expected = revision;
    syncInFlight = (async () => {
      const { data: next, error } = await supabaseClient.rpc('save_journal_workspace', { p_expected_revision: expected, p_data: data });
      if (epoch !== accountEpoch) throw new Error('アカウントが切り替わりました。');
      if (error) { conflict = String(error.message).includes('workspace_conflict'); throw new Error(conflict ? '別端末で更新されています。端末内の入力は残しています。「同期を確認」を押してください。' : '端末には保存済みですが、オンライン同期に失敗しました。再試行してください。'); }
      revision = next; dirty = generation !== editGeneration; store(); announce('オンラインに保存済みです。');
    })();
    try { await syncInFlight; } finally { syncInFlight = null; }
    if (dirty) return sync(); return true;
  }
  function backgroundSync() { sync().catch(error => announce(error.message, true)); }
  async function loadWorkspace(force = false) {
    const wanted = currentUser?.id || 'guest';
    if (loadingAccount === wanted && loadInFlight) return loadInFlight;
    if (account === wanted && ready && !force) return;
    loadingAccount = wanted;
    loadInFlight = (async () => {
      accountEpoch++; const epoch = accountEpoch; account = wanted; ready = false; dirty = false; conflict = false; workspace = fresh(); revision = 0; identity = null; submittedReport = null; reportReplies = []; syncInFlight = null; active = 0; draft = undefined; settingsItems = null; settingsTargets = null;
      const stored = localStorage.getItem(storageKey());
      if (stored) { try { const parsed = JSON.parse(stored); M.validateWorkspace(parsed.workspace); workspace = parsed.workspace; revision = parsed.revision || 0; dirty = parsed.dirty === true; } catch { announce('保存データを読み込めませんでした。', true); } }
      renderCurrent();
      if (wanted === 'guest') { ready = true; announce('端末内で記録できます。カウンセラーへの報告にはログインが必要です。'); renderCurrent(); return; }
      try {
        const [idResult, remote] = await Promise.all([api('/api/member-auth', { action: 'identity' }), supabaseClient.from('journal_workspaces').select('data,revision').eq('user_id', wanted).maybeSingle()]);
        if (epoch !== accountEpoch) return;
        identity = idResult;
        if (idResult.recovery_code) showCredentials(idResult);
        if (remote.error) throw new Error('記録用データベースに接続できませんでした。管理者にご連絡ください。');
        if (remote.data) {
          if (dirty && revision !== remote.data.revision) conflict = true;
          else if (!dirty) { M.validateWorkspace(remote.data.data); workspace = remote.data.data; revision = remote.data.revision; }
        } else if (!stored) {
          // Import only server records belonging to this authenticated account, never another user's browser cache.
          const [profile, todos] = await Promise.all([supabaseClient.from('profiles').select('selected_habits').eq('id', wanted).maybeSingle(), supabaseClient.from('todos').select('date,habit,done').eq('user_id', wanted)]);
          if (epoch !== accountEpoch) return;
          if (profile.error || todos.error) throw new Error('以前の記録を読み込めませんでした。再試行してください。');
          if (profile.data?.selected_habits?.length) {
            const habits = profile.data.selected_habits;
            workspace.items = habits.map((name, i) => ({ id: 'legacy-' + i, name: cleanLabel(name) || '習慣' + (i + 1), type: 'binary', legacyName: name }));
            for (const row of todos.data || []) { const item = workspace.items.find(i => i.legacyName === row.habit); if (item && M.validDay(row.date, row.date.slice(0, 7))) { workspace.daily[row.date] ||= {}; workspace.daily[row.date][item.id] = row.done === true; } }
          }
          dirty = true;
        }
        ready = true; store();
        bloomStorage.setItem('bloom-profile-username', identity.nickname);
        updateAuthUI();
        announce(conflict ? '別端末の更新と競合しています。同期を確認してください。' : '会員番号 ' + identity.member_id + ' · オンラインの記録を読み込みました。', conflict);
        renderCurrent(); if (dirty && !conflict) backgroundSync();
      } catch (error) { if (epoch !== accountEpoch) return; ready = false; announce(error.message + '「同期を確認」で再試行できます。', true); renderCurrent(); }
    })();
    const thisLoad = loadInFlight;
    try { await thisLoad; } finally { if (loadInFlight === thisLoad) { loadInFlight = null; loadingAccount = null; } }
  }
  function shell(title, sub, content) { return '<h1>' + title + '</h1><p class="muted">' + sub + '</p>' + (identity ? '<p class="section"><span class="badge">' + e(identity.nickname) + ' · 会員番号 ' + e(identity.member_id) + '</span></p>' : '') + '<p class="sync-state" role="status">' + e(syncMessage) + '</p><button type="button" class="text-button" data-action="sync">同期を確認</button>' + content; }
  function usable() { if (!ready || animating) throw new Error('読み込み・保存の完了を待ってください。'); }
  function button(label, action, cls = 'secondary', extra = '') { return '<button type="button" class="' + cls + '" data-action="' + action + '" ' + extra + '>' + label + '</button>'; }
  function field(item, value, mode = 'daily', index = 0) {
    const base = 'data-item="' + e(item.id) + '"';
    if (item.type === 'binary' && mode === 'daily') return '<div class="choice-row">' + [true, false].map(v => '<button type="button" class="chip" data-action="pick" data-value="' + v + '" aria-pressed="' + (value === v) + '">' + (v ? 'できた' : '今日はできなかった') + '</button>').join('') + '</div>';
    if (item.type === 'choice') return '<select ' + base + ' data-input="' + mode + '" aria-label="' + e(item.name) + '"><option value="">未記録</option>' + ['すっきり', 'ふつう', '疲れぎみ'].map(v => '<option ' + (v === value ? 'selected' : '') + '>' + v + '</option>').join('') + '</select>';
    return '<div class="row"><input type="number" ' + base + ' data-input="' + mode + '" min="0" max="' + (item.type === 'binary' ? M.monthDays(month) : 1e9) + '" step="' + (item.type === 'binary' ? 1 : 'any') + '" inputmode="decimal" aria-label="' + e(item.name) + '" placeholder="未記録" value="' + e(value ?? '') + '"><span>' + e(item.type === 'binary' ? '回' : item.unit) + '</span></div>';
  }
  function renderDaily() {
    const root = $('page-v2-home'), items = dayItems(), row = workspace.daily[date] || {};
    if (active >= items.length) active = 0;
    const count = items.filter(i => M.own(row, i.id)).length, item = items[active];
    if (draft === undefined && item) draft = row[item.id];
    const announcement = $('admin-msg-list');
    root.innerHTML = shell('一粒ずつ、わたしが育つ。', 'できた日も、お休みした日も。記録がひとつのしずくに。',
      '<div id="v2-announcements"></div><div class="daily-head section"><label class="field"><span>記録する日付</span><input type="date" id="v2-date" value="' + date + '" max="' + today() + '"></label>' + button('月次レポートを見る', 'report', 'secondary') + '</div>' +
      '<div class="drop-pool"><div class="big-drop" style="width:' + (62 + Math.min(count, 5) * 18) + 'px;height:' + (66 + Math.min(count, 5) * 19) + 'px" aria-label="' + count + '項目を記録"><strong>' + count + '</strong><small>粒</small></div><p class="muted">' + count + ' / ' + items.length + ' 項目がひとつに</p></div>' +
      '<div class="daily-items">' + items.map((i, n) => button((M.own(row, i.id) ? icon('check') : '') + e(i.name), 'item', 'chip', 'data-index="' + n + '" aria-pressed="' + (n === active) + '"')).join('') + '</div>' +
      (item ? '<article class="jelly" id="v2-daily-card"><p class="muted">' + e(date) + ' · ' + (active + 1) + ' / ' + items.length + '</p><h2>' + e(item.name) + '</h2><div class="daily-value">' + field(item, draft) + '</div><p class="swipe-label">' + icon('share') + ' 上にスワイプして、記録にぽとん</p></article>' + button('この内容を記録する', 'save-day', 'primary wide-button', !ready ? 'disabled' : '') : '<p class="notice">「目標設定」からマイ項目を追加してください。</p>') +
      '<p class="muted section">毎日の記録は蓄積されます。カウンセラーへの報告は月次レポートから。</p><div class="row section">' + button('マイ項目・目標を設定', 'settings') + button('グループを見る', 'groups') + '</div><i class="flight" hidden aria-hidden="true"></i>');
    // Preserve the existing announcement endpoint and permissions.
    if (announcement) $('v2-announcements').append(announcement);
    bindSwipe($('v2-daily-card'), saveDaily);
  }
  function summaryHtml(rows) {
    return rows.map(s => '<div class="metric-row"><h3>' + e(s.name) + '</h3>' + (s.type === 'choice' ? '<p>' + Object.entries(s.distribution || {}).map(([k, v]) => e(k) + ' ' + v + '日').join(' ／ ') + '</p>' : '<div class="row space"><strong>' + fmt(s.actual) + ' ' + e(s.unit) + '</strong><span>' + (s.target ? '目標 ' + fmt(s.target) + ' ' + e(s.unit) + ' · ' + (s.percentage === null ? '—' : fmt(s.percentage) + '%') : '目標未設定') + '</span></div>' + (s.percentage !== null ? '<div class="meter"><div style="width:' + Math.min(s.percentage, 100) + '%"></div></div>' : '')) + '<p class="muted">記録 ' + s.recordedDays + '日 ／ 未記録 ' + s.missingDays + '日' + (s.manual ? ' · 月合計を手入力' : '') + (s.aggregate === 'average' ? ' · 記録日の平均' : '') + '</p></div>').join('');
  }
  function monthHeader() { return '<div class="row space monthly-head section"><label class="field"><span>対象月</span><input class="month-input" type="month" id="v2-month" value="' + month + '" max="' + today().slice(0, 7) + '"></label>' + button('月の目標を設定', 'settings', 'secondary') + '</div>'; }
  function renderReport() {
    const rows = M.report(workspace, month);
    $('page-v2-report').innerHTML = shell('今月の一歩を、届ける。', '本人が決めた月間目標に対して、達成率を自動で計算します。', monthHeader() + '<article class="paper" id="v2-month-card" style="touch-action:none"><p class="muted">MONTHLY REPORT · ' + month + '</p><h2>わたしのふりかえり</h2>' + summaryHtml(rows) + '<p class="swipe-label">' + icon('share') + ' 上にスワイプして、担当カウンセラーへ報告</p></article>' +
      button('月の回数・数字をまとめて入力', 'bulk', 'secondary wide-button') + '<label class="field section"><span>カウンセラーにひとこと（任意・本名や連絡先は書かないでください）</span><textarea id="v2-comment" rows="3" maxlength="2000">' + e(monthConfig().comment || '') + '</textarea></label>' + button(sendingReport ? '報告しています…' : '月次レポートを報告する', 'send-report', 'primary wide-button', sendingReport || !currentUser || !ready ? 'disabled' : '') +
      '<p class="muted section" id="v2-report-state">' + (submittedReport ? '提出済みです。記録を更新した場合は、再報告できます。' : '同期済みの記録だけを、担当カウンセラーに届けます。') + '</p><div class="row section">' + button('SNS用画像を保存', 'save-image') + button('SNSにシェア', 'share-image') + '</div><p class="muted">画像には本名・会員番号・カウンセラーへのコメントを載せません。</p><section class="section"><h2>カウンセラーからのお返事</h2>' + (reportReplies.length ? reportReplies.map(r => '<div class="reply">' + e(r.content) + '</div>').join('') : '<p class="muted">まだお返事はありません。</p>') + '</section>');
    bindSwipe($('v2-month-card'), submitReport);
  }
  async function refreshReplies() {
    if (!currentUser) return;
    const epoch = accountEpoch, wantedMonth = month;
    const { data, error } = await supabaseClient.from('monthly_reports').select('*').eq('user_id', currentUser.id).eq('month', wantedMonth).maybeSingle();
    if (epoch !== accountEpoch || wantedMonth !== month) return;
    if (error) { announce('報告履歴を取得できませんでした。再試行してください。', true); return; }
    submittedReport = data; reportReplies = [];
    if (data) { const result = await supabaseClient.from('report_replies').select('content,created_at').eq('report_id', data.id).order('created_at'); if (epoch !== accountEpoch || wantedMonth !== month) return; if (result.error) { announce('返信を取得できませんでした。', true); return; } reportReplies = result.data || []; }
    if ($('page-v2-report').classList.contains('active')) renderReport();
  }
  function renderBulk() {
    const config = monthConfig();
    const rows = reportItems().filter(i => i.type !== 'choice').map(item => {
      const s = M.summary(workspace, item, month);
      return '<div class="bulk-row"><h3>' + e(item.name) + '</h3><p class="muted">月間目標：' + fmt(s.target) + ' ' + e(s.unit) + (s.aggregate === 'average' ? '（月の平均値を入力）' : '') + '</p><div class="row">' + field(item, M.own(config.actuals, item.id) ? config.actuals[item.id] : s.actual, 'bulk') + '<output class="bulk-pct" data-pct="' + item.id + '">' + (s.percentage === null ? '—' : fmt(s.percentage) + '%') + '</output></div><label class="muted"><input style="width:auto;min-height:0" type="checkbox" data-auto="' + item.id + '"> 手入力を使わず、日々の記録から計算する</label></div>';
    }).join('');
    if (!M.validDay(bulkDay, month)) bulkDay = month + '-01';
    $('page-v2-summary').innerHTML = shell('ひと月分を、まとめて入力。', 'パーセンテージの入力は不要です。実績を入れると自動計算します。', monthHeader() + '<div class="notice">ここで入力するのは月全体の実績です。日別の合計に加算せず、この数字で置き換えます。空欄は未記録、0は実績0として扱います。</div><form id="v2-bulk-form" class="paper">' + rows + '<button class="primary wide-button" type="submit">月の実績を保存する</button></form><details class="paper"><summary>日付ごとに5項目をまとめて入力</summary><label class="field"><span>日付</span><input id="v2-bulk-date" type="date" value="' + bulkDay + '" min="' + month + '-01" max="' + (month === today().slice(0, 7) ? today() : month + '-' + M.monthDays(month)) + '"></label><div id="v2-bulk-daily"></div>' + button('この日の記録を保存する', 'bulk-day-save', 'primary') + '</details>' + button('月次レポートへ', 'report', 'secondary wide-button'));
    renderBulkDay();
  }
  function renderBulkDay() {
    const row = workspace.daily[bulkDay] || {};
    $('v2-bulk-daily').innerHTML = reportItems().map(item => '<label class="field"><span>' + e(item.name) + '</span>' + (item.type === 'binary' ? '<select data-bulk-day="' + item.id + '"><option value="">未記録</option><option value="yes" ' + (row[item.id] === true ? 'selected' : '') + '>できた</option><option value="no" ' + (row[item.id] === false ? 'selected' : '') + '>できなかった</option></select>' : field(item, row[item.id], 'bulk-day')) + '</label>').join('');
  }
  function renderSettings() {
    settingsItems ||= clone(reportItems()); settingsTargets ||= clone(monthConfig().targets || {});
    $('page-v2-settings').innerHTML = shell('わたしの項目、わたしの目標。', 'いつもの4〜5項目を選んで、自分のペースを決めましょう。', '<label class="field section"><span>目標を設定する月</span><input type="month" id="v2-settings-month" value="' + month + '"></label><div class="notice">「できた・できない」は、できた1日を1回と数えます。1日に複数回を数えたい項目は「数字・月合計」を選びます。気分は達成率をつけません。</div><form id="v2-settings-form">' + settingsItems.map((item, i) => '<section class="paper" data-config="' + i + '"><div class="row space"><h2>マイ項目 ' + (i + 1) + '</h2>' + button('外す', 'remove-item', 'text-button', 'data-index="' + i + '"') + '</div><label class="field"><span>項目名</span><input data-config-name="' + i + '" maxlength="80" required value="' + e(item.name) + '"></label><div class="fields"><label class="field"><span>記録方法</span><select data-config-type="' + i + '">' + [['binary','できた・できない'],['sum','数字・月合計'],['average','数字・月平均'],['choice','気分を選ぶ']].map(([type, label]) => '<option value="' + type + '" ' + ((item.type === 'number' ? item.aggregate : item.type) === type ? 'selected' : '') + '>' + label + '</option>').join('') + '</select></label>' + (item.type === 'number' ? '<label class="field"><span>単位</span><input data-config-unit="' + i + '" maxlength="12" required value="' + e(item.unit) + '"></label>' : '') + '</div>' + (item.type !== 'choice' ? '<label class="field"><span>' + (item.aggregate === 'average' ? 'この月の目標平均' : 'この月の目標回数・数量') + '（' + e(item.type === 'binary' ? '回' : item.unit) + '）</span><input type="number" min="0.001" max="1000000000" step="any" required data-target="' + item.id + '" value="' + e(settingsTargets[item.id] ?? '') + '" placeholder="例：10"></label>' : '<p class="muted">気分は、選んだ内容を月次で振り返ります。</p>') + '</section>').join('') + '<div class="row section">' + button('項目を追加する', 'add-item', 'secondary', settingsItems.length >= 10 ? 'disabled' : '') + '<button class="primary" type="submit">項目と月間目標を保存する</button></div></form><p class="muted section">以前の月の目標・提出済みレポートは、この月の目標を変えても書き換わりません。</p>');
  }
  function readSettings() {
    if (!settingsItems) return;
    settingsItems.forEach((item, i) => { const name = document.querySelector('[data-config-name="' + i + '"]'); if (name) item.name = name.value.trim(); const unit = document.querySelector('[data-config-unit="' + i + '"]'); if (unit) item.unit = unit.value.trim(); });
    document.querySelectorAll('#v2-settings-form [data-target]').forEach(node => { settingsTargets[node.dataset.target] = node.value === '' ? '' : Number(node.value); });
  }
  function renderCurrent() {
    const page = document.querySelector('.page.active')?.id;
    if (page === 'page-v2-home') renderDaily();
    if (page === 'page-v2-report') renderReport();
    if (page === 'page-v2-summary') renderBulk();
    if (page === 'page-v2-settings') renderSettings();
  }
  async function animate(element, frames, duration) { if (!element || matchMedia('(prefers-reduced-motion: reduce)').matches || !element.animate) return; await element.animate(frames, { duration, easing: 'cubic-bezier(.22,.7,.25,1)' }).finished; }
  async function saveDaily() {
    usable(); const item = dayItems()[active], value = draft;
    if (!item || !M.validValue(item, value)) throw new Error('項目の数字を入力するか、選択肢を選んでください。');
    if (!M.validDay(date, date.slice(0, 7)) || date > today()) throw new Error('記録する日付を確認してください。');
    const epoch = accountEpoch; animating = true;
    const card = $('v2-daily-card'), water = document.querySelector('#page-v2-home .big-drop'), flight = document.querySelector('#page-v2-home .flight');
    try {
      const c = card.getBoundingClientRect(), w = water.getBoundingClientRect();
      await animate(card, [{ transform: card.style.transform || 'none', opacity: 1 }, { offset: .3, transform: 'scale(1.06,.87)', opacity: 1 }, { transform: 'translateY(-12px) scale(.1,.14)', borderRadius: '50%', opacity: 0 }], 350);
      card.style.visibility = 'hidden'; flight.hidden = false;
      const start = 'translate(' + (c.left + c.width / 2 - 14) + 'px,' + (c.top + 30) + 'px)', end = 'translate(' + (w.left + w.width / 2 - 14) + 'px,' + (w.top + w.height * .7) + 'px)';
      flight.style.transform = start;
      await animate(flight, [{ transform: start + ' scale(.9,1.2)', opacity: 1 }, { transform: end + ' scale(1.2,.7)', opacity: 0 }], 500);
      if (epoch !== accountEpoch) return;
      workspace.daily[date] ||= {}; workspace.daily[date][item.id] = value; changed();
      // Mirror the old daily boolean so existing group/flower functionality still has its history.
      if (item.type === 'binary') { const legacyName = item.legacyName || item.name; todoData[date] ||= {}; todoData[date][legacyName] = value; }
      const next = dayItems().findIndex(i => !M.own(workspace.daily[date], i.id));
      active = next === -1 ? (active + 1) % dayItems().length : next; draft = undefined;
      renderDaily(); const grown = document.querySelector('#page-v2-home .big-drop');
      await animate(grown, [{ transform: 'scale(1)' }, { transform: 'scale(1.18,.8)' }, { transform: 'scale(.91,1.12)' }, { transform: 'scale(1.05,.95)' }, { transform: 'scale(1)' }], 600);
      backgroundSync();
    } finally { animating = false; if (flight?.isConnected) flight.hidden = true; if (card?.isConnected) { card.style.visibility = ''; card.style.transform = ''; } }
  }
  function bindSwipe(element, action) {
    if (!element) return; let start = null, delta = 0;
    element.addEventListener('pointerdown', event => { if (animating || event.target.closest('input,button,select,textarea')) return; start = event.clientY; delta = 0; element.setPointerCapture(event.pointerId); });
    element.addEventListener('pointermove', event => { if (start === null) return; delta = Math.max(-130, Math.min(20, event.clientY - start)); element.style.transform = 'translateY(' + delta * .65 + 'px) scale(' + (1 - Math.abs(delta) / 1800) + ',' + (1 + Math.abs(delta) / 1000) + ')'; });
    element.addEventListener('pointerup', async () => { if (start === null) return; start = null; try { if (delta < -58) await action(); else { const from = element.style.transform; element.style.transform = ''; await animate(element, [{ transform: from }, { transform: 'scale(1.04,.95)' }, { transform: 'none' }], 400); } } catch (error) { announce(error.message, true); } finally { element.style.transform = ''; } });
    element.addEventListener('pointercancel', () => { start = null; element.style.transform = ''; });
  }
  async function submitReport() {
    usable(); if (sendingReport) return; if (!currentUser) throw new Error('ログインしてから報告してください。');
    if (month > today().slice(0, 7)) throw new Error('未来の月には報告できません。');
    const epoch = accountEpoch, targetMonth = month, text = $('v2-comment')?.value || monthConfig().comment || '';
    ensureMonth().comment = text; changed(); sendingReport = true;
    try { await sync(); const result = await api('/api/journal-report', { month: targetMonth, revision, comment: text }); if (epoch !== accountEpoch) return; const card = $('v2-month-card'); await animate(card, [{ transform: card.style.transform || 'none', opacity: 1 }, { offset: .25, transform: 'scale(1.06,.9)', opacity: 1 }, { transform: 'translateY(-210px) scale(.15,.2)', borderRadius: '50%', opacity: 0 }], 650); if (targetMonth === month) submittedReport = result.report; announce('月次レポートをカウンセラーに届けました。'); } finally { sendingReport = false; renderCurrent(); }
  }
  function showCredentials(result) {
    let dialog = $('v2-credentials'); if (!dialog) { const container = document.createElement('div'); container.className = 'jv'; container.innerHTML = '<dialog class="dialog" id="v2-credentials" aria-labelledby="v2-credential-title"></dialog>'; document.body.append(container); dialog = $('v2-credentials'); }
    dialog.innerHTML = '<h2 id="v2-credential-title">会員番号と復旧コードを保管してください</h2><p class="muted">本名・メールアドレスの登録はありません。復旧コードはこの画面だけに表示されます。</p><label class="field section"><span>会員番号</span><div class="credential">' + e(result.member_id) + '</div></label><label class="field"><span>復旧コード（他の人には渡さないでください）</span><div class="credential">' + e(result.recovery_code) + '</div></label><button type="button" class="primary" id="v2-credential-close">安全な場所に控えました</button>';
    dialog.oncancel=event=>event.preventDefault();dialog.showModal(); $('v2-credential-close').onclick = () => { dialog.close(); dialog.replaceChildren(); };
  }
  async function exportImage(share) {
    if(document.fonts?.ready)await document.fonts.ready;
    const rows=M.report(workspace,month), canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1920;
    const context=canvas.getContext('2d'); if(!context)throw new Error('このブラウザーでは画像を作成できません。');
    const brandStyles=getComputedStyle(document.body);
    const fonts={main:brandStyles.getPropertyValue('--font-main').trim()||'sans-serif',heading:brandStyles.getPropertyValue('--font-serif-jp').trim()||'serif',logo:brandStyles.getPropertyValue('--font-serif-en').trim()||'serif'};
    const setFont=(size,kind='main',weight=400)=>{context.font=weight+' '+size+'px '+fonts[kind];};
    const gradient=context.createLinearGradient(0,0,1080,1920);gradient.addColorStop(0,'#f2dce4');gradient.addColorStop(1,'#faf3e7');context.fillStyle=gradient;context.fillRect(0,0,1080,1920);
    try{const image=await loadStoryTemplateImage();if(image){const scale=Math.max(1080/image.width,1920/image.height);context.drawImage(image,(1080-image.width*scale)/2,(1920-image.height*scale)/2,image.width*scale,image.height*scale);}}catch{}
    context.fillStyle='#fffdfb';context.fillRect(75,110,930,1700);context.fillStyle='#9e586c';setFont(48,'logo',500);context.textAlign='center';context.fillText('Bloom Journal',540,220);setFont(32);context.fillStyle='#78685f';context.fillText(month+'  MONTHLY REPORT',540,292);context.fillStyle='#514946';setFont(45,'heading');context.fillText('小さな一歩が、ひとつになった。',540,380);
    const line=Math.min(210,1190/Math.max(rows.length,1));
    function fitted(text,maxWidth){while(context.measureText(text).width>maxWidth&&text.length>1)text=text.slice(0,-2)+'…';return text;}
    rows.forEach((s,index)=>{const y=475+index*line;context.textAlign='left';setFont(34,'heading');context.fillStyle='#514946';context.fillText(fitted(cleanLabel(s.name),800),130,y);setFont(32);context.fillStyle='#9e586c';const value=s.type==='choice'?Object.entries(s.distribution||{}).map(([name,count])=>name+' '+count+'日').join(' ／ '):fmt(s.actual)+' '+s.unit+(s.target?' ／ 目標 '+fmt(s.target)+' '+s.unit+' · '+fmt(s.percentage)+'%':'');context.fillText(fitted(value,800),130,y+48);setFont(24);context.fillStyle='#78685f';context.fillText('記録 '+s.recordedDays+'日 ／ 未記録 '+s.missingDays+'日',130,y+86);});
    context.textAlign='center';setFont(27);context.fillStyle='#78685f';context.fillText('自分のペースで、また一歩。',540,1740);
    const blob=await new Promise((resolve,reject)=>{try{canvas.toBlob(result=>result?resolve(result):reject(new Error('画像を作成できませんでした。')),'image/png');}catch{reject(new Error('背景画像を読み込めませんでした。管理者にご連絡ください。'));}});
    const file=new File([blob],'bloom-'+month+'.png',{type:'image/png'});
    if(share&&navigator.canShare?.({files:[file]})&&navigator.share){try{await navigator.share({files:[file],title:'今月のふりかえり'});return;}catch(error){if(error.name==='AbortError')return;}}
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);announce('月次カードの画像を保存しました。SNSに添付できます。');
  }
  async function loadAdmin(append = false) {
    if (!isAdmin) throw new Error('管理者権限が必要です。');
    const generation = ++adminRequest, targetMonth = month;
    $('v2-admin-list').innerHTML = '<p class="muted">利用者を読み込んでいます。</p>';
    const result = await api('/api/journal-admin?month=' + targetMonth + '&offset=' + (append ? adminNext : 0));
    if (generation !== adminRequest || month !== targetMonth) return;
    members = append ? members.concat(result.members) : result.members; adminNext = result.next_offset;
    $('v2-admin-list').innerHTML = '<div class="admin-members">' + members.map(m => button(e(m.nickname) + '<small>ID ' + m.member_id + ' · ' + m.status + '</small>', 'admin-member', 'chip admin-member', 'data-member="' + m.member_id + '" aria-pressed="' + (m.member_id === adminSelected) + '"')).join('') + '</div>' + (adminNext !== null ? button('次の100人を読む', 'admin-more') : '') + (!members.length ? '<p class="notice">登録された会員はまだいません。</p>' : '');
    if (!append) { adminDetail = null; $('v2-admin-detail').replaceChildren(); }
  }
  async function openAdminMember(member) {
    const request = ++adminRequest, targetMonth = month; adminSelected = member;
    $('v2-admin-detail').innerHTML = '<p class="muted">記録を読み込んでいます。</p>';
    const detail = await api('/api/journal-admin?month=' + targetMonth + '&member_id=' + member);
    if (request !== adminRequest || targetMonth !== month) return;
    adminDetail = detail; renderAdminDetail();
    document.querySelectorAll('[data-member]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.member === member)));
  }
  function renderAdminDetail() {
    const d = adminDetail; if (!d) return;
    $('v2-admin-detail').innerHTML = '<div class="paper"><h2>' + e(d.member.nickname) + ' <span class="badge">ID ' + d.member.member_id + '</span></h2>' + (d.report ? '<p class="muted">' + month + ' · 提出時点の記録</p>' + summaryHtml(d.report.snapshot) + '<p class="notice">' + e(d.report.comment || 'ひとことはありません。') + '</p><h2 class="section">カウンセラーから返信</h2>' + d.replies.map(r => '<div class="reply">' + e(r.content) + '</div>').join('') + '<textarea id="v2-admin-reply" rows="3" maxlength="4000" aria-label="返信コメント" placeholder="記録を見て、ひとこと"></textarea>' + button('返信を送る', 'admin-reply', 'primary wide-button') : '<p class="admin-empty">この月のレポートはまだ届いていません。</p>') + '<details><summary>この方の日別記録を確認する</summary><label class="field"><span>日付</span><input type="date" id="v2-admin-date" value="' + month + '-01" min="' + month + '-01" max="' + month + '-' + M.monthDays(month) + '"></label><div id="v2-admin-day"></div></details></div>';
    renderAdminDay();
  }
  function displayValue(item, value) { return !M.validValue(item, value) ? '— 未記録' : item.type === 'binary' ? value ? 'できた' : 'できなかった' : item.type === 'choice' ? e(value) : fmt(value) + ' ' + e(item.unit); }
  function renderAdminDay() { const d = adminDetail, dateValue = $('v2-admin-date')?.value; if (!d || !dateValue) return; $('v2-admin-day').innerHTML = (d.workspace?.items || []).map(item => '<div class="record-row"><span>' + e(item.name) + '</span><strong>' + displayValue(item, d.workspace.daily?.[dateValue]?.[item.id]) + '</strong></div>').join('') || '<p class="muted">日別の記録はまだありません。</p>'; }
  function buildAdmin() {
    const page = $('page-admin'), existing = page.firstElementChild; existing.classList.add('jv');
    const top = existing.firstElementChild; if (top) top.querySelector('.card-title').innerHTML = icon('sliders') + ' Bloom 管理画面';
    const nav = document.createElement('nav'); nav.className = 'admin-tabs'; nav.setAttribute('aria-label', '管理メニュー');
    nav.innerHTML = [['reports','記録・月次レポート'],['notices','お知らせ'],['groups','グループ・イベント'],['requests','参加申請'],['story','ストーリー背景']].map(([key, text]) => button(text, 'admin-tab', 'chip', 'data-tab="' + key + '" aria-pressed="false"')).join('');
    top.after(nav);
    const reports = document.createElement('section'); reports.id = 'v2-admin-reports'; reports.dataset.adminPanel = 'reports'; reports.innerHTML = '<h1>記録・月次レポート</h1><label class="field"><span>対象月</span><input type="month" id="v2-admin-month" value="' + month + '" max="' + today().slice(0, 7) + '"></label><div id="v2-admin-list"></div><div id="v2-admin-detail"></div><p class="sync-state" role="status"></p>'; nav.after(reports);
    const mapping = { 'admin-announcement-text': 'notices', 'admin-story-template-input': 'story', 'admin-group-form': 'groups', 'admin-groups-list': 'groups', 'admin-pending-members': 'requests' };
    Object.entries(mapping).forEach(([id, panel]) => { const card = $(id)?.closest('.card'); if (card) card.dataset.adminPanel = panel; });
    const kind = document.createElement('label'); kind.className='field'; kind.innerHTML='<span>種類</span><select id="v2-group-kind"><option value="group">グループ</option><option value="event">イベント</option></select>'; $('admin-group-form').prepend(kind);
    if ($('admin-dashboard')) $('admin-dashboard').hidden = true;
    showAdminTab('reports');
  }
  function showAdminTab(tab) { document.querySelectorAll('[data-admin-panel]').forEach(p => p.hidden = p.dataset.adminPanel !== tab); document.querySelectorAll('[data-action="admin-tab"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === tab))); if (tab === 'reports' && isAdmin) loadAdmin().catch(error => announce(error.message, true)); }
  function setupPages() {
    const parent = $('page-todo').parentElement;
    for (const name of ['home', 'settings', 'report', 'summary']) { const div = document.createElement('section'); div.id = 'page-v2-' + name; div.className = 'page jv'; parent.insertBefore(div,$('page-goal')); }
    // Move rather than duplicate this element, keeping the existing announcement renderer intact.
    const announcement = $('admin-msg-list'); if (announcement) $('page-v2-home').append(announcement);
    buildAdmin();
  }
  const originalShowPage = showPage;
  showPage = function(id) {
    if (animating) return;
    const remap = { 'page-todo': 'page-v2-home', 'page-goal': 'page-v2-settings', 'page-report': 'page-v2-report', 'page-summary': 'page-v2-summary' };
    const target = remap[id] || id; originalShowPage(target);
    const tabs = document.querySelectorAll('.nav-tab'); if (target.startsWith('page-v2-')) { tabs.forEach(t => t.classList.remove('active')); tabs[target === 'page-v2-home' ? 0 : target === 'page-v2-settings' ? 1 : 5]?.classList.add('active'); }
    if (target === 'page-v2-home') { renderDaily(); loadAnnouncement(); }
    if (target === 'page-v2-settings') renderSettings();
    if (target === 'page-v2-report') { renderReport(); refreshReplies(); }
    if (target === 'page-v2-summary') renderBulk();
    if (target === 'page-admin') { $('v2-admin-month').value = month; showAdminTab('reports'); }
  };
  const oldStartApp = startApp;
  startApp = function() { oldStartApp(); if (!document.querySelector('.page.active')?.id.startsWith('page-v2-')) showPage('page-todo'); };
  const oldUserLoad = loadUserDataFromSupabase;
  loadUserDataFromSupabase = async function() { resetLegacyAccount(); await oldUserLoad(); await loadWorkspace(); };
  const oldAuthUI = updateAuthUI;
  updateAuthUI = function() {
    resetLegacyAccount();
    oldAuthUI(); const userName = identity && account === currentUser?.id ? identity.nickname : 'メンバー';
    if ($('nav-icon')) $('nav-icon').innerHTML = icon(currentUser ? 'user' : 'key');
    if ($('nav-name')) $('nav-name').textContent = currentUser ? userName : 'ログイン';
    if (account !== (currentUser?.id || 'guest')) { settingsItems = null; settingsTargets = null; if($('page-v2-home'))showPage('page-todo'); loadWorkspace(); }
  };
  // Profile editing requires no real name, photo or email. Keep existing public nickname integrations.
  openProfileModal = async function() {
    try { await loadWorkspace(); const result = prompt('ニックネームを入力してください。本名や連絡先は使わないでください。', identity?.nickname || ''); if (result === null) return; const nick = result.trim(); if (!nick || nick.length > 40 || nick.includes('@')) throw new Error('ニックネームは1〜40文字で入力してください。'); identity = await api('/api/member-auth', { action: 'identity', nickname: nick }); bloomStorage.setItem('bloom-profile-username',nick); updateAuthUI(); if (identity.recovery_code) showCredentials(identity); announce('ニックネームを保存しました。'); } catch (error) { alert(error.message); }
  };
  // ID-based auth: no email inputs or email reset flows.
  handleLogin = async function() { try { const result = await api('/api/member-auth', { action: 'login', member_id: $('login-email').value, password: $('login-password').value }, false); const { error } = await supabaseClient.auth.setSession(result); if (error) throw error; $('login-password').value = ''; } catch (error) { showAuthMsg('login-msg', error.message, 'error'); } };
  handleSignup = async function() { const pass = $('signup-password').value; if (pass !== $('signup-password2').value) { showAuthMsg('signup-msg', 'パスワードが一致しません。', 'error'); return; } try { const result = await api('/api/member-auth', { action: 'signup', nickname: $('signup-email').value, password: pass }, false); $('login-email').value = result.member_id; $('signup-password').value = ''; $('signup-password2').value = ''; resetAuthForms(); showCredentials(result); showAuthMsg('login-msg', '登録できました。会員番号とパスワードでログインしてください。', 'success'); } catch (error) { showAuthMsg('signup-msg', error.message, 'error'); } };
  showResetForm = function() { resetAuthForms(); $('auth-login-form').style.display = 'none'; $('auth-reset-form').style.display = 'flex'; $('reset-email').value = $('login-email').value; };
  handlePasswordResetRequest = async function() { try { const result = await api('/api/member-auth', { action: 'recover', member_id: $('reset-email').value, recovery_code: $('v2-recovery-code').value, password: $('v2-recovery-password').value }, false); $('v2-recovery-code').value = ''; $('v2-recovery-password').value = ''; resetAuthForms(); $('login-email').value = result.member_id; showCredentials(result); showAuthMsg('login-msg', 'パスワードを更新しました。新しい復旧コードを保管してください。', 'success'); } catch (error) { showAuthMsg('reset-msg', error.message, 'error'); } };
  switchAuthTab = function(tab) { resetAuthForms(); $('auth-login-form').style.display = tab === 'login' ? 'flex' : 'none'; $('auth-signup-form').style.display = tab === 'signup' ? 'flex' : 'none'; document.querySelectorAll('.auth-tab').forEach((t, i) => t.classList.toggle('active', i === (tab === 'login' ? 0 : 1))); };
  function authUI() {
    $('login-email').type = 'text'; $('login-email').inputMode = 'numeric'; $('login-email').placeholder = '会員番号（10桁）'; $('login-email').setAttribute('aria-label','会員番号'); $('login-email').autocomplete = 'username';
    $('signup-email').type = 'text'; $('signup-email').placeholder = 'ニックネーム（本名は使わないでください）'; $('signup-email').setAttribute('aria-label','ニックネーム'); $('signup-email').maxLength = 40;
    $('reset-email').type = 'text'; $('reset-email').inputMode = 'numeric'; $('reset-email').placeholder = '会員番号（10桁）';
    $('auth-login-form').querySelector('.auth-sub').textContent = '会員番号とパスワードでログイン'; $('auth-signup-form').querySelector('.auth-sub').textContent = '本名・メールアドレスは登録しません。'; $('auth-reset-form').querySelector('.auth-sub').textContent = '会員番号と、登録時に控えた復旧コードを使います。';
    ['signup-password', 'signup-password2'].forEach(id => { $(id).placeholder = 'パスワード（15文字以上）'; $(id).minLength = 15; $(id).maxLength = 128; $(id).autocomplete = 'new-password'; });
    $('login-password').autocomplete = 'current-password';
    $('auth-reset-form').querySelector('.auth-btn').textContent = 'パスワードを再設定する';
    const recovery = document.createElement('input'); recovery.id = 'v2-recovery-code'; recovery.className = 'auth-input'; recovery.placeholder = '復旧コード'; recovery.setAttribute('aria-label','復旧コード'); recovery.autocomplete = 'off';
    const pass = document.createElement('input'); pass.id = 'v2-recovery-password'; pass.type = 'password'; pass.className = 'auth-input'; pass.placeholder = '新しいパスワード（15文字以上）'; pass.autocomplete = 'new-password';
    $('reset-email').after(recovery, pass);
  }
  let authBusy=false;
  for(const name of ['handleLogin','handleSignup','handlePasswordResetRequest']){const handler=window[name];window[name]=async function(){if(authBusy)return;authBusy=true;document.querySelectorAll('.auth-btn').forEach(b=>b.disabled=true);try{return await handler();}finally{authBusy=false;document.querySelectorAll('.auth-btn').forEach(b=>b.disabled=false);}};}
  async function action(event) {
    const b = event.target.closest('[data-action]'); if (!b || b.disabled) return;
    const a = b.dataset.action;
    try {
      if (['report','settings','bulk','groups'].includes(a)) { if (animating) return; showPage({ report:'page-report', settings:'page-goal', bulk:'page-summary', groups:'page-group' }[a]); return; }
      if (a === 'sync') { if (!ready) { await loadWorkspace(true); return; } if (conflict) { if (!confirm('オンラインの記録を読み直しますか？この端末の未同期分は、この端末用のバックアップとして保管します。')) return; localStorage.setItem(storageKey() + ':conflict-backup:' + Date.now(), JSON.stringify(workspace)); localStorage.removeItem(storageKey()); await loadWorkspace(true); } else await sync(); return; }
      if (a === 'admin-tab') { showAdminTab(b.dataset.tab); return; }
      if (a === 'admin-member') { await openAdminMember(b.dataset.member); return; }
      if (a === 'admin-more') { await loadAdmin(true); return; }
      if (a === 'save-image' || a === 'share-image') { await exportImage(a==='share-image'); return; }
      if (a === 'admin-reply') { const content = $('v2-admin-reply').value.trim(); if (!content) throw new Error('返信内容を入力してください。'); b.disabled = true; try { await api('/api/journal-admin', { report_id: adminDetail.report.id, content }); await openAdminMember(adminSelected); announce('返信を届けました。'); } finally { b.disabled = false; } return; }
      usable();
      if (a === 'item') { active = Number(b.dataset.index); draft = undefined; renderDaily(); }
      if (a === 'pick') { draft = b.dataset.value === 'true'; document.querySelectorAll('#v2-daily-card [data-action="pick"]').forEach(n => n.setAttribute('aria-pressed', String(n.dataset.value === b.dataset.value))); }
      if (a === 'save-day') await saveDaily();
      if (a === 'send-report') await submitReport();
      if (a === 'add-item') { readSettings(); if (settingsItems.length < 10) settingsItems.push({ id:'habit-' + crypto.randomUUID(), name:'新しい習慣', type:'binary' }); renderSettings(); }
      if (a === 'remove-item') { readSettings(); settingsItems.splice(Number(b.dataset.index), 1); renderSettings(); }
      if (a === 'bulk-day-save') {
        if (!M.validDay(bulkDay, month) || bulkDay > today()) throw new Error('日付を確認してください。');
        const data = {};
        for (const item of reportItems()) { const node = document.querySelector('[data-bulk-day="' + item.id + '"], [data-input="bulk-day"][data-item="' + item.id + '"]'); if (!node || node.value === '') continue; const value = item.type === 'binary' ? node.value === 'yes' : item.type === 'number' ? Number(node.value) : node.value; if (!M.validValue(item,value)) throw new Error(item.name + 'の値を確認してください。'); data[item.id] = value; }
        workspace.daily[bulkDay] = data; changed(); backgroundSync(); announce('日別の記録を端末に保存しました。月合計を手入力している項目には、その月合計が優先されます。');
      }
    } catch (error) { announce(error.message, true); }
  }
  function input(event) {
    const node = event.target;
    if (node.dataset.input === 'daily') { const item = dayItems()[active]; draft = node.value === '' ? undefined : item.type === 'number' ? Number(node.value) : node.value; }
    if (node.dataset.input === 'bulk') { const item = reportItems().find(i => i.id === node.dataset.item), target = monthConfig().targets?.[item.id]; const out = document.querySelector('[data-pct="' + item.id + '"]'); if (out) out.textContent = node.value !== '' && target ? fmt(Number(node.value) / target * 100) + '%' : '—'; }
    if (node.id === 'v2-comment') { ensureMonth().comment = node.value; changed(); }
  }
  async function change(event) {
    const node = event.target;
    try {
      if (node.id === 'v2-date') { if (animating) return; if (!M.validDay(node.value,node.value.slice(0,7)) || node.value>today()) throw new Error('日付を確認してください。'); date=node.value; draft=undefined; renderDaily(); }
      if (node.id === 'v2-month' || node.id === 'v2-settings-month') { M.monthDays(node.value); month=node.value; submittedReport=null; reportReplies=[]; settingsItems=null; settingsTargets=null; renderCurrent(); if ($('page-v2-report').classList.contains('active')) refreshReplies(); }
      if (node.id === 'v2-bulk-date') { bulkDay=node.value; renderBulkDay(); }
      if (node.id === 'v2-admin-date') renderAdminDay();
      if (node.id === 'v2-admin-month') { M.monthDays(node.value); month=node.value; await loadAdmin(); }
      if (node.dataset.configType !== undefined) { readSettings(); const i=Number(node.dataset.configType), value=node.value, item=settingsItems[i]; item.type=['sum','average'].includes(value)?'number':value; if(item.type==='number'){item.aggregate=value;item.unit||='回';} renderSettings(); }
    } catch(error){announce(error.message,true);}
  }
  async function submit(event) {
    if (!['v2-settings-form','v2-bulk-form'].includes(event.target.id)) return; event.preventDefault();
    try {
      usable(); const next=clone(workspace);
      next.months[month] ||= {targets:{},actuals:{}};
      if(event.target.id==='v2-settings-form') {
        readSettings(); if(!settingsItems.length)throw new Error('1項目以上選んでください。');
        const oldItems=reportItems();
        const knownMonths=new Set([...Object.keys(workspace.months),...Object.keys(workspace.daily).map(d=>d.slice(0,7))]);
        for(const previous of knownMonths){if(previous!==month&&!next.months[previous]?.items){next.months[previous] ||= {targets:{},actuals:{}};next.months[previous].items=clone(workspace.items);}}
        for (const item of settingsItems) { M.validateItem(item); const old=oldItems.find(i=>i.id===item.id); if(old&&(old.type!==item.type||old.aggregate!==item.aggregate)){item.id='habit-'+crypto.randomUUID();} }
        // A changed recording type gets a new ID; historical values keep their original meaning.
        next.items=clone(settingsItems); next.months[month].items=clone(settingsItems);
        event.target.querySelectorAll('[data-target]').forEach((node,index)=>{const item=next.items.filter(i=>i.type!=='choice')[index]; const value=Number(node.value); if(!node.value||!Number.isFinite(value)||value<=0)throw new Error('各項目の月間目標を入力してください。'); next.months[month].targets[item.id]=value;});
        state.selectedHabits=next.items.map(i=>i.legacyName||i.name);state.goalCreated=true;
      } else {
        for(const item of reportItems().filter(i=>i.type!=='choice')){const node=event.target.querySelector('[data-input="bulk"][data-item="'+item.id+'"]'),auto=event.target.querySelector('[data-auto="'+item.id+'"]');if(auto?.checked||node.value===''){delete next.months[month].actuals[item.id];continue;}const value=Number(node.value);if(!M.validValue(item,value,true)||(item.type==='binary'&&value>M.monthDays(month)))throw new Error(item.name+'の実績を確認してください。');next.months[month].actuals[item.id]=value;}
      }
      M.validateWorkspace(next);workspace=next;changed();draft=undefined;settingsItems=null; settingsTargets=null;await sync().catch(error=>announce(error.message,true));showPage('page-report');
    }catch(error){announce(error.message,true);}
  }
  window.addEventListener('load',()=>{setupPages();authUI();document.addEventListener('click',action);document.addEventListener('input',input);document.addEventListener('change',change);document.addEventListener('submit',submit);showPage('page-todo');loadWorkspace();});
  // Expose only the calculation-free UI entry point for the existing app's links.
  window.BloomJournal={reload:()=>loadWorkspace(true)};
})();

