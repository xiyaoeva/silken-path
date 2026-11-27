// POST /api/admin/login —— 用邮箱和密码登录，成功后把登录凭证放进浏览器读不到的 Cookie。
import { handle, readJson, login, sessionCookies, HttpError } from '../../../server/lib.js';

export const onRequestPost = handle(async ({ request, env }) => {
  const body = await readJson(request, 2000);
  if (typeof body.email !== 'string' || typeof body.password !== 'string' || !body.email || !body.password) {
    throw new HttpError(422, '请填写邮箱和密码。');
  }
  const session = await login(env, body.email.trim(), body.password);
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  for (const c of sessionCookies(session)) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify({ email: session.user.email }), { headers });
});
