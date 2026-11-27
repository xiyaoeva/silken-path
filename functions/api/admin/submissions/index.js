// GET /api/admin/submissions —— 填写记录列表，支持按状态、日期、方向、称呼或邮箱筛选。
import { handle, json, loadSubmissions, summarize } from '../../../../server/lib.js';

export const onRequestGet = handle(async ({ request, env }) => {
  const rows = await loadSubmissions(env, new URL(request.url).searchParams);
  return json({ submissions: rows.map(summarize), capped: rows.length >= 1000 });
});
