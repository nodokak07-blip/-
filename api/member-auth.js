'use strict';
const { createServices, begin, bodyOf, fail, HttpError, hash, recoveryCode, memberId, nickname, password } = require('../lib/journal-server.cjs');
function createHandler(options) {
  const service = createServices(options);
  return async function handler(req, res) {
    try {
      begin(req, res, ['POST']); service.configured();
      const body = bodyOf(req), action = body.action;
      if (!['signup', 'login', 'recover', 'identity'].includes(action)) throw new HttpError(400, '操作を確認してください。');
      if (action === 'identity') {
        const user = await service.actor(req);
        const rows = await service.rest('member_identity', 'select=member_id,nickname,recovery_hash&user_id=eq.' + user.id);
        if (rows.length) {
          const identity = { member_id: rows[0].member_id, nickname: rows[0].nickname };
          if (body.nickname !== undefined) { const nick = nickname(body.nickname); await service.rest('profiles', 'on_conflict=id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { id: user.id, username: nick } }); await service.rest('member_identity', 'user_id=eq.' + user.id, { method: 'PATCH', body: { nickname: nick } }); identity.nickname = nick; }
          if (!rows[0].recovery_hash) { const code = recoveryCode(); const changed = await service.request('/rest/v1/rpc/rotate_member_recovery', { method: 'POST', body: { p_member_id: identity.member_id, p_old_hash: '', p_new_hash: hash(code) } }); if (changed) identity.recovery_code = code; }
          return res.status(200).json(identity);
        }
        // Existing users keep their auth account, history and admin rights.
        const nick = nickname(body.nickname || user.user_metadata?.nickname || 'メンバー');
        await service.rate(req, 'identity');
        const id = memberId(), code = recoveryCode();
        try { await service.rest('member_identity', '', { method: 'POST', body: { user_id: user.id, member_id: id, nickname: nick, recovery_hash: hash(code) } }); }
        catch (error) { const winner = await service.rest('member_identity', 'select=member_id,nickname&user_id=eq.' + user.id); if (winner.length) return res.status(200).json(winner[0]); throw error; }
        return res.status(201).json({ member_id: id, nickname: nick, recovery_code: code });
      }
      if (action === 'signup') {
        const nick = nickname(body.nickname), pass = password(body.password);
        await service.rate(req, action);
        const id = memberId(), code = recoveryCode();
        // An internal, non-deliverable auth alias. No person's email is requested or used for new accounts.
        const user = await service.request('/auth/v1/admin/users', { method: 'POST', body: { email: 'm' + id + '@members.invalid', password: pass, email_confirm: true, user_metadata: { nickname: nick } } });
        if (!user?.id) throw new HttpError(502, '登録を完了できませんでした。');
        try {
          await service.rest('member_identity', '', { method: 'POST', body: { user_id: user.id, member_id: id, nickname: nick, recovery_hash: hash(code) } });
          await service.rest('profiles', 'on_conflict=id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { id: user.id, username: nick } });
        } catch (error) { await service.request('/auth/v1/admin/users/' + user.id, { method: 'DELETE' }).catch(() => {}); throw error; }
        return res.status(201).json({ member_id: id, nickname: nick, recovery_code: code });
      }
      const id = String(body.member_id || '').replace(/[ -]/g, '');
      if (!/^\d{10}$/.test(id)) throw new HttpError(400, '10桁の会員番号を入力してください。');
      await service.rate(req, action, id);
      if (action === 'recover') {
        const pass = password(body.password), code = String(body.recovery_code || '').trim();
        if (!/^[a-f0-9]{48}$/.test(code)) throw new HttpError(401, '会員番号または復旧コードを確認してください。');
        const nextCode = recoveryCode();
        const userId = await service.request('/rest/v1/rpc/rotate_member_recovery', { method: 'POST', body: { p_member_id: id, p_old_hash: hash(code), p_new_hash: hash(nextCode) } });
        if (!userId) throw new HttpError(401, '会員番号または復旧コードを確認してください。');
        try { await service.request('/auth/v1/admin/users/' + userId, { method: 'PUT', body: { password: pass } }); }
        catch (error) { await service.request('/rest/v1/rpc/rotate_member_recovery', { method: 'POST', body: { p_member_id: id, p_old_hash: hash(nextCode), p_new_hash: hash(code) } }).catch(() => {}); throw error; }
        return res.status(200).json({ member_id: id, recovery_code: nextCode });
      }
      if (typeof body.password !== 'string' || !body.password || body.password.length > 128) throw new HttpError(401, '会員番号またはパスワードを確認してください。');
      const identities = await service.rest('member_identity', 'select=user_id&member_id=eq.' + id);
      if (!identities.length) throw new HttpError(401, '会員番号またはパスワードを確認してください。');
      const user = await service.request('/auth/v1/admin/users/' + identities[0].user_id);
      let session;
      try { session = await service.request('/auth/v1/token?grant_type=password', { method: 'POST', key: service.anon, token: service.anon, body: { email: user.email, password: body.password } }); }
      catch { throw new HttpError(401, '会員番号またはパスワードを確認してください。'); }
      return res.status(200).json({ access_token: session.access_token, refresh_token: session.refresh_token });
    } catch (error) { fail(res, error); }
  };
}
module.exports = createHandler(); module.exports.createHandler = createHandler;
