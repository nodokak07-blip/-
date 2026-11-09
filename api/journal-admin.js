'use strict';
const { createServices, begin, bodyOf, fail, HttpError, Model } = require('../lib/journal-server.cjs');
function createHandler(options) { const service = createServices(options); return async (req, res) => {
  try {
    begin(req, res, ['GET', 'POST']); const admin = await service.actor(req, true);
    if (req.method === 'POST') {
      const body = bodyOf(req), content = typeof body.content === 'string' ? body.content.trim() : '';
      if (!/^[a-f0-9-]{36}$/.test(body.report_id || '') || !content || content.length > 4000) throw new HttpError(400, '返信内容を確認してください。');
      const reports = await service.rest('monthly_reports', 'select=id&id=eq.' + encodeURIComponent(body.report_id));
      if (!reports.length) throw new HttpError(404, 'レポートが見つかりません。');
      const rows = await service.rest('report_replies', '', { method: 'POST', prefer: 'return=representation', body: { report_id: body.report_id, admin_id: admin.id, content } });
      return res.status(201).json({ reply: rows[0] });
    }
    const query = new URL(req.url, 'https://local.invalid').searchParams;
    const month = query.get('month') || ''; try { Model.monthDays(month); } catch { throw new HttpError(400, '対象月を確認してください。'); }
    const member = query.get('member_id');
    if (member) {
      if (!/^\d{10}$/.test(member)) throw new HttpError(400, '会員番号を確認してください。');
      const identities = await service.rest('member_identity', 'select=user_id,member_id,nickname&member_id=eq.' + member);
      if (!identities.length) throw new HttpError(404, '会員が見つかりません。');
      const identity = identities[0];
      const [workspaces, reports] = await Promise.all([service.rest('journal_workspaces', 'select=data,revision&user_id=eq.' + identity.user_id), service.rest('monthly_reports', 'select=*&user_id=eq.' + identity.user_id + '&month=eq.' + month)]);
      const report = reports[0] || null;
      const replies = report ? await service.rest('report_replies', 'select=id,content,created_at&report_id=eq.' + report.id + '&order=created_at.asc') : [];
      return res.status(200).json({ member: { member_id: identity.member_id, nickname: identity.nickname }, workspace: workspaces[0]?.data || null, report, replies });
    }
    const offset = Math.max(0, Math.min(1000000, Number(query.get('offset')) || 0));
    const identities = await service.rest('member_identity', 'select=member_id,nickname,user_id&order=created_at.desc&limit=100&offset=' + Math.floor(offset));
    if (!identities.length) return res.status(200).json({ members: [], next_offset: null });
    const ids = identities.map(m => m.user_id).join(',');
    const reports = await service.rest('monthly_reports', 'select=id,user_id,submitted_at&month=eq.' + month + '&user_id=in.(' + ids + ')');
    const reportIds = reports.map(r => r.id).join(',');
    const replies = reportIds ? await service.rest('report_replies', 'select=report_id,created_at&report_id=in.(' + reportIds + ')') : [];
    return res.status(200).json({ members: identities.map(m => { const report = reports.find(r => r.user_id === m.user_id); return { member_id: m.member_id, nickname: m.nickname, status: !report ? '未提出' : replies.some(r => r.report_id === report.id && r.created_at >= report.submitted_at) ? '返信済み' : '返信待ち' }; }), next_offset: identities.length === 100 ? offset + 100 : null });
  } catch (error) { fail(res, error); }
}; }
module.exports = createHandler(); module.exports.createHandler = createHandler;
