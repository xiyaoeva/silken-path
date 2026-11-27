// PUT /api/admin/form —— 保存问卷：勾选了哪些题、顺序和显示条件。保存后前台立即生效。
import { handle, json, readJson, rpc, loadQuestions, cleanFormItems } from '../../../server/lib.js';

export const onRequestPut = handle(async ({ request, env }) => {
  const body = await readJson(request);
  const items = cleanFormItems(body.items, await loadQuestions(env));
  const id = await rpc(env, 'publish_form', { p_items: items });
  return json({ version_id: id, items });
});
