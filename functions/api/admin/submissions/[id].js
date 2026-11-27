// GET   /api/admin/submissions/:id —— 一个人的全部回答
// PATCH /api/admin/submissions/:id —— 修改处理状态和备注
import { handle, json, readJson, rest, loadSubmission, loadForm, sortAnswers, HttpError, STATUSES } from '../../../../server/lib.js';

async function detail(env, id) {
  const [submission, form] = await Promise.all([loadSubmission(env, id), loadForm(env)]);
  submission.answers = sortAnswers(submission.answers, form.items);
  return submission;
}

export const onRequestGet = handle(async ({ env, params }) => json(await detail(env, params.id)));

export const onRequestPatch = handle(async ({ request, env, params }) => {
  const body = await readJson(request, 20_000);
  const patch = {};
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) throw new HttpError(422, '处理状态不正确。');
    patch.status = body.status;
  }
  if (body.note !== undefined) {
    if (typeof body.note !== 'string' || body.note.length > 5000) throw new HttpError(422, '备注最多 5000 个字。');
    patch.note = body.note;
  }
  if (!Object.keys(patch).length) throw new HttpError(422, '没有要修改的内容。');
  await loadSubmission(env, params.id); // 不存在时返回 404
  await rest(env, `submissions?id=eq.${params.id}`, { method: 'PATCH', body: patch });
  return json(await detail(env, params.id));
});
