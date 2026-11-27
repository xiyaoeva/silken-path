// PATCH /api/admin/questions/:id —— 修改题目内容，或归档 / 恢复。字段名和题型建好后不能改。
import { handle, json, readJson, rest, loadCurrentVersion, cleanQuestion, isUuid, HttpError } from '../../../../server/lib.js';

export const onRequestPatch = handle(async ({ request, env, params }) => {
  if (!isUuid(params.id)) throw new HttpError(404, '没有找到这道题。');
  const found = await rest(env, `questions?id=eq.${params.id}&select=*`);
  if (!found.length) throw new HttpError(404, '没有找到这道题。');
  const body = await readJson(request);
  const patch = cleanQuestion(body, { create: false, existing: found[0] });

  if (body.archived !== undefined) {
    if (body.archived) {
      const version = await loadCurrentVersion(env);
      if (version.items.some((i) => i.question_id === params.id)) {
        throw new HttpError(409, '这道题还在问卷里，请先取消勾选并保存问卷，再归档。');
      }
      patch.archived_at = new Date().toISOString();
    } else {
      patch.archived_at = null;
    }
  }
  if (!Object.keys(patch).length) throw new HttpError(422, '没有要修改的内容。');
  patch.updated_at = new Date().toISOString();
  const rows = await rest(env, `questions?id=eq.${params.id}`, {
    method: 'PATCH', body: patch, prefer: 'return=representation',
  });
  return json(rows[0]);
});
