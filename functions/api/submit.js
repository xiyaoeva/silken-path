// POST /api/submit —— 前台答完后提交。所有校验在这里重做一遍，不信任浏览器。
import { handle, json, readJson, loadForm, validateAnswers, rpc, HttpError, CONSENT_VERSION } from '../../server/lib.js';

export const onRequestPost = handle(async ({ request, env }) => {
  const body = await readJson(request);
  // 隐藏的陷阱字段：真人看不到也不会填，自动程序常常会填。假装成功，不保存。
  if (body.website) return json({ ok: true });
  if (body.consent !== true || body.consent_version !== CONSENT_VERSION) {
    throw new HttpError(422, '请先阅读并同意隐私说明。');
  }
  if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) {
    throw new HttpError(400, '请求格式不正确。');
  }
  const { version, items } = await loadForm(env);
  if (body.version_id !== version.id) {
    throw new HttpError(409, '问卷刚刚更新过，请刷新页面后重新填写。');
  }
  const rows = validateAnswers(items, body.answers);
  await rpc(env, 'submit_form', {
    p_form_version_id: version.id,
    p_consent_version: CONSENT_VERSION,
    p_answers: rows,
  });
  return json({ ok: true }, 201);
});
