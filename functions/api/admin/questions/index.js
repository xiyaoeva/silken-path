// GET  /api/admin/questions —— 题库全部题目，加上当前问卷选用了哪些
// POST /api/admin/questions —— 新建一道题（先进题库，不会自动放进问卷）
import { handle, json, readJson, rest, loadQuestions, loadCurrentVersion, normalizeItems, cleanQuestion, HttpError } from '../../../../server/lib.js';

export const onRequestGet = handle(async ({ env }) => {
  const [questions, version] = await Promise.all([loadQuestions(env), loadCurrentVersion(env)]);
  return json({ questions, items: normalizeItems(version.items, questions), saved_at: version.created_at });
});

export const onRequestPost = handle(async ({ request, env }) => {
  const input = cleanQuestion(await readJson(request), { create: true });
  const existing = await rest(env, `questions?field_key=eq.${input.field_key}&select=id`);
  if (existing.length) throw new HttpError(409, `字段名“${input.field_key}”已经被别的题用了。`);
  const rows = await rest(env, 'questions', { method: 'POST', body: input, prefer: 'return=representation' });
  return json(rows[0], 201);
});
