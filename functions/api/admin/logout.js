// POST /api/admin/logout
import { handle, logout, clearCookies } from '../../../server/lib.js';

export const onRequestPost = handle(async ({ request, env, data }) => {
  await logout(env, request);
  data.admin.cookies.length = 0; // 不要把刚续期的凭证再写回去
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  for (const c of clearCookies()) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify({ ok: true }), { headers });
});
