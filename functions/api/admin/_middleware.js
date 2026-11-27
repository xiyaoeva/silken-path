// /api/admin/ 下的所有接口都先经过这里：除了登录，其余必须是已登录的管理员。
import { handle, requireAdmin, checkOrigin } from '../../../server/lib.js';

export const onRequest = handle(async ({ request, env, data, next }) => {
  checkOrigin(request);
  if (new URL(request.url).pathname === '/api/admin/login') return next();
  const admin = await requireAdmin(env, request);
  data.admin = admin;
  const res = await next();
  if (!admin.cookies.length) return res;
  const out = new Response(res.body, res);
  for (const c of admin.cookies) out.headers.append('Set-Cookie', c);
  return out;
});
