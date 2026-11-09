'use strict';
const { createServices, begin, bodyOf, fail, HttpError, Model } = require('../lib/journal-server.cjs');
function createHandler(options) { const service = createServices(options); return async (req, res) => {
  try {
    begin(req, res, ['POST']); const user = await service.actor(req), body = bodyOf(req);
    const month = String(body.month || ''); try { Model.monthDays(month); } catch { throw new HttpError(400, '対象月を確認してください。'); }
    const nowMonth = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).format(new Date());
    if (month > nowMonth) throw new HttpError(400, '未来の月には報告できません。');
    const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
    if (comment.length > 2000) throw new HttpError(400, 'コメントは2000文字以内で入力してください。');
    const workspaces = await service.rest('journal_workspaces', 'select=revision,data&user_id=eq.' + user.id);
    const workspace = workspaces?.[0];
    if (!workspace || workspace.revision !== body.revision) throw new HttpError(409, '記録を同期してから、もう一度報告してください。');
    let snapshot; try { snapshot = Model.report(workspace.data, month); } catch { throw new HttpError(400, '保存済みの記録を確認してください。'); }
    if (!snapshot.length || !snapshot.some(s => s.actual !== null || s.recordedDays > 0)) throw new HttpError(400, '1項目以上を記録してから報告してください。');
    const rows = await service.rest('monthly_reports', 'on_conflict=user_id,month', { method: 'POST', prefer: 'resolution=merge-duplicates,return=representation', body: { user_id: user.id, month, workspace_revision: workspace.revision, snapshot, comment, submitted_at: new Date().toISOString() } });
    res.status(200).json({ report: rows[0] });
  } catch (error) { fail(res, error); }
}; }
module.exports = createHandler(); module.exports.createHandler = createHandler;
