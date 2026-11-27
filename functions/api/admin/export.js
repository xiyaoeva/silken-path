// GET /api/admin/export?scope=all（可带与列表相同的筛选条件）
// GET /api/admin/export?scope=one&id=…
// 每次导出都会在 export_logs 里留一条记录。
import {
  handle, rest, loadForm, loadSubmissions, loadSubmission, csvAll, csvOne, csvResponse, HttpError,
} from '../../../server/lib.js';

export const onRequestGet = handle(async ({ request, env, data }) => {
  const params = new URL(request.url).searchParams;
  const scope = params.get('scope');
  const form = await loadForm(env);
  const day = new Date().toISOString().slice(0, 10);

  if (scope === 'one') {
    const submission = await loadSubmission(env, params.get('id'));
    await rest(env, 'export_logs', {
      method: 'POST',
      body: { admin_email: data.admin.email, scope: 'one', submission_id: submission.id, row_count: 1 },
    });
    return csvResponse(csvOne(submission, form.items), `示范-单人记录-${day}.csv`);
  }
  if (scope === 'all') {
    const submissions = await loadSubmissions(env, params);
    await rest(env, 'export_logs', {
      method: 'POST',
      body: { admin_email: data.admin.email, scope: 'all', row_count: submissions.length },
    });
    return csvResponse(csvAll(submissions, form.items, form.questions), `示范-填写记录-${day}.csv`);
  }
  throw new HttpError(400, '导出范围不正确。');
});
